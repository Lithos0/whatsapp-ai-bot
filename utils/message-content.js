// utils/message-content.js
// Prepara texto e imágenes (base64) para moderación con IA a partir de mensajes de WhatsApp.

const { MessageTypes } = require('whatsapp-web.js');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * @param {import('whatsapp-web.js').Message} message
 * @returns {string}
 */
function formatLinksBlock(message) {
  if (!Array.isArray(message.links) || message.links.length === 0) {
    return '';
  }
  const urls = message.links.map((x) => x && x.link).filter(Boolean);
  if (!urls.length) {
    return '';
  }
  return `\nEnlaces detectados en el mensaje: ${urls.join(' | ')}`;
}

/**
 * @param {import('whatsapp-web.js').Message} message
 * @returns {string}
 */
function trimmedBody(message) {
  if (!message.body || typeof message.body !== 'string') {
    return '';
  }
  return message.body.trim();
}

/**
 * Tipos que intentamos moderar. Videos y notas de voz se excluyen por pedido del proyecto.
 *
 * @param {string} type
 * @returns {boolean}
 */
function isSupportedMessageType(type) {
  return (
    type === MessageTypes.TEXT ||
    type === MessageTypes.IMAGE ||
    type === MessageTypes.STICKER ||
    type === MessageTypes.DOCUMENT
  );
}

/**
 * @typedef {Object} PreparedContent
 * @property {string} historySummary - Línea corta para el historial en memoria.
 * @property {string} evalDescription - Texto que recibe el modelo (contexto del último mensaje).
 * @property {Array<{ mimeType: string, data: string }>} inlineImages - Base64 sin prefijo data:.
 */

/**
 * Descarga y valida media como imagen para Gemini.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @param {'imagen' | 'sticker' | 'archivo'} kind
 * @returns {Promise<PreparedContent|null>}
 */
async function buildImageModerationPayload(message, kind) {
  if (!message.hasMedia) {
    console.log('[CONTENT] Sin media descargable (hasMedia false).');
    return null;
  }
  let media;
  try {
    media = await message.downloadMedia();
  } catch (e) {
    console.warn('[CONTENT] Error al descargar media:', e.message);
    return null;
  }
  if (!media || !media.data) {
    return null;
  }
  const bytes = Buffer.from(media.data, 'base64').length;
  if (bytes > MAX_IMAGE_BYTES) {
    console.warn('[CONTENT] Imagen demasiado grande para enviar a la IA, omitida.');
    return null;
  }
  const mimeType = (media.mimetype || 'image/jpeg').split(';')[0].trim();
  if (!mimeType.startsWith('image/')) {
    console.log('[CONTENT] Tipo MIME no es imagen:', mimeType);
    return null;
  }
  const caption = trimmedBody(message) || '(sin texto ni pie de foto)';
  const linksPart = formatLinksBlock(message);
  const evalDescription =
    `[El usuario envió ${kind === 'sticker' ? 'un sticker' : kind === 'archivo' ? 'una imagen como documento' : 'una imagen'}.] ` +
    `Texto o pie: ${caption}.${linksPart}\n` +
    'Evaluá si el contenido visual o el texto asociado trata sobre política partidaria o gubernamental de Argentina.';
  const historySummary = `[${kind}] ${caption}${linksPart ? ' +enlaces' : ''}`;
  return {
    historySummary,
    evalDescription,
    inlineImages: [{ mimeType, data: media.data }],
  };
}

/**
 * Arma el contenido del último mensaje para evaluar política (texto, enlaces, imagen o sticker).
 * No incluye video ni notas de voz.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<PreparedContent|null>}
 */
async function prepareContentForModeration(message) {
  if (!isSupportedMessageType(message.type)) {
    console.log('[CONTENT] Tipo de mensaje no moderado:', message.type);
    return null;
  }

  const linksPart = formatLinksBlock(message);
  const textBody = trimmedBody(message);

  if (message.type === MessageTypes.TEXT) {
    if (!textBody && !linksPart) {
      console.log('[CONTENT] Mensaje de texto vacío y sin enlaces.');
      return null;
    }
    const evalDescription = (textBody || '(sin texto, solo contexto)') + linksPart;
    const historySummary = (textBody || '[enlaces]') + linksPart.replace(/^\n/, ' ');
    return {
      historySummary,
      evalDescription,
      inlineImages: [],
    };
  }

  if (message.type === MessageTypes.IMAGE) {
    return buildImageModerationPayload(message, 'imagen');
  }

  if (message.type === MessageTypes.STICKER) {
    return buildImageModerationPayload(message, 'sticker');
  }

  if (message.type === MessageTypes.DOCUMENT) {
    return buildImageModerationPayload(message, 'archivo');
  }

  return null;
}

module.exports = {
  prepareContentForModeration,
  isSupportedMessageType,
};
