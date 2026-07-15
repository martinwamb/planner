const path = require('path');

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'planner',
      cwd: path.resolve(rootDir, 'server'),
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || 4002,
        DB_FILE: process.env.DB_FILE || path.resolve(rootDir, 'server', 'data.db'),
        OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
        // ENCRYPTION_KEY intentionally omitted: pm2 bakes this env block in at
        // process-start time, so a fallback of '' here would permanently shadow
        // the real value in server/.env (index.js's dotenv.config() never
        // overrides a key that already exists in process.env, even an empty
        // one). Let dotenv load it straight from .env instead.
      },
    },
  ],
};
