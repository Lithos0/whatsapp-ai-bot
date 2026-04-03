// services/whatsapp.service.js
// Servicio de inicialización y gestión del cliente de WhatsApp usando whatsapp-web.js.

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

/**
 * Crea e inicializa una instancia de cliente de WhatsApp.
 *
 * @returns {Client} Cliente de WhatsApp inicializado.
 */
function createWhatsappClient() {
  // Configuración básica del cliente. LocalAuth guarda la sesión en disco.
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  // Evento: se genera un nuevo QR para autenticación
  client.on('qr', (qr) => {
    console.log('[WHATSAPP] QR generado. Escanéalo con tu WhatsApp para iniciar sesión.');
    qrcode.generate(qr, { small: true });
  });

  // Evento: cliente listo para usar
  client.on('ready', () => {
    console.log('[WHATSAPP] Cliente listo. Bot de WhatsApp inicializado correctamente.');
  });

  // Evento: autenticación exitosa
  client.on('authenticated', () => {
    console.log('[WHATSAPP] Autenticación exitosa.');
  });

  // Evento: falla de autenticación
  client.on('auth_failure', (msg) => {
    console.error('[WHATSAPP] Error de autenticación:', msg);
  });

  // Evento: desconexión
  client.on('disconnected', (reason) => {
    console.warn('[WHATSAPP] Cliente desconectado. Razón:', reason);
  });

  // Inicializar el cliente
  client.initialize().catch((error) => {
    console.error(
      '[WHATSAPP] Error al inicializar el cliente de WhatsApp:',
      error
    );
  });

  return client;
}

module.exports = {
  createWhatsappClient,
};

