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
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
      },
    },
  ],
};
