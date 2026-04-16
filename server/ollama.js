const http = require('http');
const url = require('url');

const BASE  = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL    || 'llama3:8b';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function chat(prompt, { model = MODEL, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
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
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || '');
        } catch (e) {
          reject(new Error('Ollama returned invalid JSON: ' + data.slice(0, 100)));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out after 5 minutes'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { chat };
