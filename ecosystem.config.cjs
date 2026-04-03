// PM2: arranca siempre desde la carpeta del proyecto (para que cargue .env).
module.exports = {
  apps: [
    {
      name: 'whatsapp-ai-bot',
      cwd: __dirname,
      script: 'index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: '15s',
      watch: false,
    },
  ],
};
