const http = require('http');
const url = require('url');

const BASE  = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL    || 'llama3:8b';

// Inactivity timeout — with streaming, tokens arrive continuously so
// this only fires if Ollama goes completely silent for 10 minutes.
const INACTIVITY_MS = 10 * 60 * 1000;

function chat(prompt, { model = MODEL, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      prompt,
      stream: true,            // Stream tokens so the socket stays alive
      format: json ? 'json' : undefined,
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

module.exports = { chat };
