const http = require('http');
const url = require('url');

const BASE  = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL    || 'qwen2.5:7b';

// Inactivity timeout — with streaming, tokens arrive continuously so
// this only fires if Ollama goes completely silent for 10 minutes.
const INACTIVITY_MS = 10 * 60 * 1000;
const PING_TIMEOUT_MS = 3 * 1000;

// Ollama only runs an 8h/night on this box (systemd timer, shared with other
// services). Every caller funnels through this single queue so cron jobs and
// live user requests never open concurrent inference requests against it.
let queue = Promise.resolve();
function enqueue(fn) {
  const result = queue.then(fn, fn);
  queue = result.then(() => {}, () => {});
  return result;
}

function rawChat(prompt, { model = MODEL, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      prompt,
      stream: true,            // Stream tokens so the socket stays alive
      format: json ? 'json' : undefined,
      think: false,
    });

    const parsed = url.parse(`${BASE}/api/generate`);
    const req = http.request({
      hostname: parsed.hostname,
      port:     parsed.port || 11434,
      path:     parsed.path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: INACTIVITY_MS,
    }, (res) => {
      let fullResponse = '';
      let buffer = '';

      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // hold back any partial line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.response) fullResponse += obj.response;
          } catch { /* skip malformed lines */ }
        }
      });

      res.on('end', () => {
        // Flush any remaining partial line in buffer
        if (buffer.trim()) {
          try {
            const obj = JSON.parse(buffer);
            if (obj.response) fullResponse += obj.response;
          } catch { /* ignore */ }
        }
        resolve(fullResponse.trim());
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama went silent for 10 minutes — request aborted'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function chat(prompt, opts) {
  return enqueue(() => rawChat(prompt, opts));
}

// Cheap reachability probe so callers can skip a chat() attempt in ~ms
// instead of waiting on the 2-10 minute timeouts when Ollama is off
// (it's intentionally stopped outside its nightly window on this box).
function isReachable() {
  return new Promise(resolve => {
    const parsed = url.parse(`${BASE}/api/tags`);
    const req = http.request({
      hostname: parsed.hostname,
      port:     parsed.port || 11434,
      path:     parsed.path,
      method:   'GET',
      timeout:  PING_TIMEOUT_MS,
    }, res => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = { chat, isReachable };
