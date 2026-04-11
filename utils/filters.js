// utils/filters.js
// Funciones auxiliares para filtrar mensajes por grupo objetivo.

/**
 * ID del chat donde ocurrió el mensaje.
 * Si fromMe === true, WhatsApp Web suele dejar el destino en `to` (p. ej. el @g.us del grupo);
 * `from` puede ser un @lid u otro id, y fallaba isTargetGroup solo mirando `from`.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {string}
 */
function getMessageChatId(message) {
  if (message.fromMe) {
    return message.to || message.from || '';
  }
  return message.from || message.to || '';
}

/**
 * Estados de WhatsApp y otros "broadcast" del sistema (no son el grupo ni DM del dueño).
 * Si no se filtran, tryHandleOwnerCommands puede llamar getContact() y agotar protocolTimeout.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {boolean}
 */
function isSystemBroadcastChat(message) {
  const id = getMessageChatId(message) || message.from || '';
  return id.includes('broadcast');
}

/**
 * Verifica si el mensaje pertenece al grupo objetivo.
 *
 * @param {import('whatsapp-web.js').Message} message - Mensaje entrante.
 * @param {string} targetId - ID del grupo objetivo (por ejemplo: 1234567890@g.us).
 * @returns {boolean}
 */
function isTargetGroup(message, targetId) {
  if (!targetId) return false;
  const chatId = getMessageChatId(message);
  const isTarget = chatId === targetId;

  // Solo log en grupos ajenos; los chats privados no son "grupo incorrecto"
  if (!isTarget && chatId.endsWith('@g.us')) {
    console.log(
      '[FILTER] Mensaje ignorado: no es el grupo objetivo. chatId:',
      chatId
    );
  }

  return isTarget;
}

/**
 * Extrae el número de teléfono del remitente desde el mensaje.
 * En grupos, el remitente real está en message.author (ej: 5548996499993@c.us).
 * Se elimina el sufijo @c.us y se devuelven solo los dígitos.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {string} Número de teléfono sin sufijos de WhatsApp (solo dígitos).
 */
function extractPhoneNumber(message) {
  // En grupos: message.author = remitente (a veces @c.us o @lid)
  const rawId = message.author || '';
  if (rawId.endsWith('@lid')) {
    const userPart = rawId.replace(/@lid$/i, '');
    return userPart.replace(/\D/g, '') || 'lid';
  }
  const withoutSuffix = rawId.replace(/@c\.us$/i, '');
  return withoutSuffix.replace(/\D/g, '');
}

/**
 * Dígitos del remitente: en grupo usa author; en chat privado, from.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {string}
 */
function getSenderPhoneDigits(message) {
  const chatId = getMessageChatId(message);
  const isGroup = chatId.endsWith('@g.us');
  let rawId;
  if (isGroup) {
    rawId = message.author || '';
  } else {
    rawId = message.fromMe
      ? message.from || message.to || ''
      : message.from || '';
  }
  // @lid no es el número de teléfono; hay que resolver con getContact()
  if (rawId.endsWith('@lid')) {
    return '';
  }
  const withoutSuffix = rawId.replace(/@c\.us$/i, '');
  return withoutSuffix.replace(/\D/g, '');
}

module.exports = {
  getMessageChatId,
  isSystemBroadcastChat,
  isTargetGroup,
  extractPhoneNumber,
  getSenderPhoneDigits,
};

