// services/whatsapp.service.js
// Servicio de inicialización y gestión del cliente de WhatsApp usando whatsapp-web.js.

const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

/**
 * Crea e inicializa una instancia de cliente de WhatsApp.
 *
 * @returns {Client} Cliente de WhatsApp inicializado.
 */
function createWhatsappClient() {
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    // Menos RAM / menos procesos auxiliares (útil en VM de 1 GB sin swap)
    '--mute-audio',
    '--no-first-run',
    '--disable-extensions',
    '--disable-sync',
    // NO usar --disable-background-networking: rompe el emparejamiento / sync tras escanear el QR
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--metrics-recording-only',
  ];

  const executablePath =
    typeof process.env.PUPPETEER_EXECUTABLE_PATH === 'string' &&
    process.env.PUPPETEER_EXECUTABLE_PATH.trim()
      ? process.env.PUPPETEER_EXECUTABLE_PATH.trim()
      : undefined;

  // Por defecto 30s en whatsapp-web.js; en VM lenta / poca RAM la página no llega a tiempo → "auth timeout"
  const authTimeoutMs = Math.max(
    60_000,
    parseInt(process.env.WWEBJS_AUTH_TIMEOUT_MS || '600000', 10) || 600_000
  );

  // Puppeteer por defecto usa ~180s; en VM lenta inject() falla con Runtime.callFunctionOn timed out
  const protocolTimeoutMs = Math.max(
    300_000,
    parseInt(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS || String(authTimeoutMs), 10) ||
      authTimeoutMs
  );

  const qrPngPath = path.join(process.cwd(), 'last-qr.png');

  const takeoverOnConflict =
    process.env.WWEBJS_TAKEOVER_ON_CONFLICT !== '0' &&
    process.env.WWEBJS_TAKEOVER_ON_CONFLICT !== 'false';

  // UA tipo Chrome reciente en Linux (la VM es Linux; el default de la lib es macOS viejo)
  const userAgent =
    typeof process.env.WWEBJS_USER_AGENT === 'string' &&
    process.env.WWEBJS_USER_AGENT.trim()
      ? process.env.WWEBJS_USER_AGENT.trim()
      : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // Configuración básica del cliente. LocalAuth guarda la sesión en disco.
  const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs,
    takeoverOnConflict,
    userAgent,
    puppeteer: {
      headless: true,
      defaultViewport: null,
      ...(executablePath ? { executablePath } : {}),
      args: puppeteerArgs,
      // 0 = sin tope al lanzar Chromium (evita fallos en arranque lento)
      timeout: 0,
      protocolTimeout: protocolTimeoutMs,
    },
  });

  let qrHintLogged = false;

  client.on('change_state', (state) => {
    console.log('[WHATSAPP] Estado:', state);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(
      '[WHATSAPP] Cargando WhatsApp Web:',
      String(percent),
      '%',
      message || ''
    );
  });

  // Evento: se genera un nuevo QR para autenticación
  client.on('qr', (qr) => {
    if (!qrHintLogged) {
      qrHintLogged = true;
      console.warn(
        '[WHATSAPP] Solo vale el QR más reciente. WhatsApp lo renueva cada ~20s; si Chromium ' +
          'se cierra o PM2 reinicia, los anteriores quedan inválidos. En e2-micro hace falta swap (~2G).'
      );
      console.warn(
        '[WHATSAPP] En PM2 el QR ASCII suele cortarse: usá el archivo last-qr.png (scp a tu Mac) o el string raw.'
      );
    }
    console.log('[WHATSAPP] QR generado. Escanéalo con WhatsApp > Dispositivos vinculados > Vincular dispositivo.');
    void QRCode.toFile(qrPngPath, qr, { width: 400, margin: 2 })
      .then(() => {
        console.log(
          '[WHATSAPP] PNG del QR (recomendado para escanear):',
          qrPngPath,
          '— desde tu PC: scp USUARIO@IP_SERVIDOR:' + qrPngPath + ' .'
        );
      })
      .catch((err) => {
        console.error('[WHATSAPP] No se pudo escribir last-qr.png:', err.message);
      });
    if (process.stdout.isTTY) {
      qrcode.generate(qr, { small: true });
    }
    console.log('[WHATSAPP] QR raw:', qr);
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
    if (String(reason).includes('LOGOUT') || String(reason).includes('NAVIGATION')) {
      console.warn(
        '[WHATSAPP] Si quedó sesión a medias, probá borrar la carpeta .wwebjs_auth en el servidor y volver a vincular.'
      );
    }
  });

  console.log(
    `[WHATSAPP] Iniciando Chromium (authTimeoutMs=${authTimeoutMs} ms, protocolTimeout=${protocolTimeoutMs} ms).`
  );

  // Inicializar el cliente
  client.initialize().catch((error) => {
    const errStr =
      typeof error === 'string' ? error : error && (error.message || String(error));
    if (errStr === 'auth timeout' || errStr === 'ready timeout') {
      console.error(
        '[WHATSAPP] Timeout esperando a WhatsApp Web (' + errStr + '). ' +
          'Subí RAM/swap o aumentá WWEBJS_AUTH_TIMEOUT_MS en .env (actualmente ' +
          authTimeoutMs +
          ' ms).'
      );
      return;
    }
    console.error('[WHATSAPP] Error al inicializar el cliente de WhatsApp:', error);
  });

  return client;
}

module.exports = {
  createWhatsappClient,
};

