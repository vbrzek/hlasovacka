// Konfigurace PM2.  Spuštění:  pm2 start ecosystem.config.js
// Nastavení (port, veřejná URL…) se čte ze souboru .env vedle tohoto souboru – viz .env.example.
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const env = { ...loadEnv(path.join(__dirname, '.env')), ...process.env };

module.exports = {
  apps: [
    {
      name: env.PM2_NAME || 'hlasovacka',
      script: 'server.js',
      cwd: __dirname,
      // Stav prezentací je v paměti procesu → vždy jen JEDNA instance, žádný cluster mód.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      // Při stop/restart pošle PM2 SIGINT – server do té doby stihne uložit data na disk.
      kill_timeout: 5000,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: env.PORT || 3210,
        HOST: env.HOST || '127.0.0.1',
        PUBLIC_URL: env.PUBLIC_URL || '',
        DATA_DIR: env.DATA_DIR || path.join(__dirname, 'data'),
      },
    },
  ],
};
