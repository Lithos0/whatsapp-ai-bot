// PM2: arranca siempre desde la carpeta del proyecto (para que cargue .env).
module.exports = {
  apps: [
    {
      name: 'whatsapp-ai-bot',
      cwd: __dirname,
      script: 'index.js',
      interpreter: 'node',
      // cluster rompe Puppeteer / una sola sesión de WhatsApp
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: '15s',
      // Evita tormenta de reinicios (cada uno genera QR nuevo e invalida el anterior)
      restart_delay: 20_000,
      watch: false,
    },
  ],
};
