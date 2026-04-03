// index.js
// Punto de entrada principal del bot de WhatsApp con IA.
// - Inicializa el cliente de WhatsApp.
// - Aplica filtro de grupo objetivo.
// - Mantiene en memoria el historial de los últimos 5 mensajes del grupo objetivo.
// - Llama al servicio de IA para generar respuestas contextuales.

const { createWhatsappClient } = require('./services/whatsapp.service');
const { generateAIResponse } = require('./services/ai.service');
const { TARGET_GROUP_ID, BOT_OWNER_PHONE } = require('./config');
const {
  getMessageChatId,
  isTargetGroup,
  extractPhoneNumber,
  getSenderPhoneDigits,
} = require('./utils/filters');
const { prepareContentForModeration } = require('./utils/message-content');

/** Todas las respuestas del bot llevan esto al inicio; si llega un mensaje con el mismo prefijo, no se modera (evita autorespuesta). */
const MODERATOR_PREFIX = '[MODERADOR]';

/** @param {string} body */
function isModeratorBotPlainText(body) {
  return (
    typeof body === 'string' &&
    body.trimStart().startsWith(MODERATOR_PREFIX)
  );
}

/**
 * @param {string} text
 * @returns {string}
 */
function withModeratorPrefix(text) {
  const t = String(text ?? '');
  if (t.trimStart().startsWith(MODERATOR_PREFIX)) {
    return t;
  }
  return `${MODERATOR_PREFIX} ${t}`;
}

/** Si false, el bot no analiza ni responde en el grupo (salvo comandos del dueño). */
let botEnabled = true;

/** Entre avisos [MODERADOR] por política (no aplica a /activar ni /desactivar). */
const MODERATION_COOLDOWN_MS = 30 * 1000;
let lastModerationWarningSentAt = 0;

// Historial en memoria de los últimos mensajes del grupo objetivo
// Estructura: [{ sender: string, text: string }]
const groupHistory = [];
const MAX_HISTORY = 5;

/**
 * Añade un mensaje al historial de conversación del grupo.
 *
 * @param {string} sender - Número de teléfono del remitente (solo dígitos).
 * @param {string} text - Contenido del mensaje.
 */
function addToHistory(sender, text) {
  if (!text) return;

  groupHistory.push({ sender, text });

  // Mantener solo los últimos MAX_HISTORY mensajes
  if (groupHistory.length > MAX_HISTORY) {
    groupHistory.splice(0, groupHistory.length - MAX_HISTORY);
  }
}

/**
 * Mensajes enviados desde la misma sesión del bot (p. ej. WhatsApp Web) llegan con
 * fromMe === true y en grupos a menudo sin message.author, así que no basta con el número.
 * Si WhatsApp usa @lid, el número se obtiene vía getContact().
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<boolean>}
 */
async function isMessageFromOwner(message) {
  if (message.fromMe) {
    return true;
  }
  if (!BOT_OWNER_PHONE) {
    return false;
  }
  const syncDigits = getSenderPhoneDigits(message);
  if (syncDigits && syncDigits === BOT_OWNER_PHONE) {
    return true;
  }
  const author = message.author || '';
  const needsContact =
    author.endsWith('@lid') ||
    (Boolean(author) && !author.endsWith('@c.us') && !author.endsWith('@g.us'));
  if (!needsContact) {
    return false;
  }
  try {
    const contact = await message.getContact();
    const serialized = contact.id?._serialized || '';
    const fromCus = serialized
      .replace(/@c\.us$/i, '')
      .replace(/\D/g, '');
    const fromNumber = String(contact.number || contact.id?.user || '').replace(
      /\D/g,
      ''
    );
    return (
      fromCus === BOT_OWNER_PHONE || fromNumber === BOT_OWNER_PHONE
    );
  } catch (err) {
    console.warn(
      '[MAIN] No se pudo resolver el remitente (owner check):',
      err.message
    );
    return false;
  }
}

// Crear e inicializar el cliente de WhatsApp
const client = createWhatsappClient();

/**
 * IDs de mensajes que nosotros enviamos (reply del bot). El eco llega como fromMe;
 * solo esos se ignoran. Un contador fallaba si el eco no llegaba: el próximo mensaje
 * tuyo se tomaba por eco y no se moderaba.
 */
const botReplyIds = new Set();
const botReplyIdOrder = [];
const BOT_REPLY_ID_CAP = 48;

function trackBotReplyMessageId(messageIdSerialized) {
  if (!messageIdSerialized) {
    return;
  }
  botReplyIds.add(messageIdSerialized);
  botReplyIdOrder.push(messageIdSerialized);
  while (botReplyIdOrder.length > BOT_REPLY_ID_CAP) {
    const old = botReplyIdOrder.shift();
    botReplyIds.delete(old);
  }
}

/**
 * @param {string|undefined} messageIdSerialized
 * @returns {boolean} true si era eco del bot (y se consumió el id)
 */
function consumeIfBotOwnEcho(messageIdSerialized) {
  if (!messageIdSerialized || !botReplyIds.has(messageIdSerialized)) {
    return false;
  }
  botReplyIds.delete(messageIdSerialized);
  const i = botReplyIdOrder.indexOf(messageIdSerialized);
  if (i >= 0) {
    botReplyIdOrder.splice(i, 1);
  }
  return true;
}

/**
 * @param {import('whatsapp-web.js').Message} toMessage
 * @param {string} text
 */
async function replyFromBot(toMessage, text) {
  const sent = await toMessage.reply(withModeratorPrefix(text));
  const sid = sent?.id?._serialized;
  if (sid) {
    trackBotReplyMessageId(sid);
  } else {
    console.warn(
      '[MAIN] replyFromBot: el envío no devolvió id; si el eco se confunde con un mensaje tuyo, reiniciá el bot.'
    );
  }
}

/**
 * whatsapp-web.js NO emite el evento `message` para mensajes propios (fromMe).
 * Solo `message_create` incluye lo que vos enviás desde Web/teléfono vinculado.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @param {string} body
 * @returns {Promise<boolean>} true si se manejó un comando
 */
async function tryHandleOwnerCommands(message, body) {
  const inTargetGroup = isTargetGroup(message, TARGET_GROUP_ID);
  const fromPrivate = Boolean(
    message.from && !message.from.endsWith('@g.us')
  );
  if (!(inTargetGroup || fromPrivate)) {
    return false;
  }
  if (!(await isMessageFromOwner(message))) {
    return false;
  }
  if (body === '/activar') {
    if (botEnabled) {
      await replyFromBot(
        message,
        'Ya estaba activado el bot.\n\n' +
          '⚠️ Por las dudas: sigo acá nomás para cuando la charla se pone muy de política partidaria de acá y conviene frenar un poco. Con el resto de los temas no me meto.'
      );
    } else {
      botEnabled = true;
      await replyFromBot(
        message,
        'Listo, bot activado.\n\n' +
          '⚠️ Les cuento a todos: voy a hablar recién si la política de partidos de Argentina viene fuerte y se empiezan a subir los tonos. El día a día, el laburo, el fútbol y eso quedan afuera de esto.'
      );
    }
    console.log('[MAIN] Bot activado por el dueño.');
    return true;
  }
  if (body === '/desactivar') {
    if (!botEnabled) {
      await replyFromBot(
        message,
        'Ya estaba desactivado.\n\n' +
          '⚠️ Igual, ojo: hasta que vuelva a activarse, tratemos de no irnos al humo con la política partidaria. Sin aviso automático a veces se complica más rápido.'
      );
    } else {
      botEnabled = false;
      await replyFromBot(
        message,
        'Listo, bot desactivado. No escribo más nada acá hasta que alguien mande /activar.\n\n' +
          '⚠️ La idea sigue siendo la misma: no pelearnos por política de partidos o del gobierno de acá. Sin el bot no hay recordatorio automático, así que cuenta la buena onda de cada uno.'
      );
    }
    console.log('[MAIN] Bot desactivado por el dueño.');
    return true;
  }
  return false;
}

// message_create: propios y ajenos. El evento `message` omite fromMe (tus /activar nunca llegaban).
client.on('message_create', async (message) => {
  console.log(
    '[MAIN] Mensaje chat:',
    getMessageChatId(message) || message.from,
    'fromMe:',
    message.fromMe,
    'type:',
    message.type
  );
  try {
    // whatsapp-web.js siempre expone body como string (puede ser '' en stickers/imagen sin pie).
    if (typeof message.body !== 'string') {
      console.log('[MAIN] Mensaje sin body string, ignorado.');
      return;
    }

    if (isModeratorBotPlainText(message.body)) {
      console.log('[MAIN] Mensaje con prefijo de moderador, ignorado (eco del bot).');
      return;
    }

    const body = message.body.trim();
    const msgId = message.id?._serialized;

    // Solo ignorar ecos de mensajes que envió este cliente (ids devueltos por reply/sendMessage)
    if (message.fromMe && consumeIfBotOwnEcho(msgId)) {
      return;
    }

    if (body && (await tryHandleOwnerCommands(message, body))) {
      return;
    }

    const inTargetGroup = isTargetGroup(message, TARGET_GROUP_ID);
    if (!inTargetGroup) {
      return;
    }

    if (!botEnabled) {
      console.log('[MAIN] Bot desactivado; mensaje del grupo ignorado.');
      return;
    }

    const content = await prepareContentForModeration(message);
    if (!content) {
      return;
    }

    // En grupos, mensajes propios (fromMe) suelen venir sin message.author
    let senderPhone = extractPhoneNumber(message);
    if (!senderPhone && message.fromMe) {
      const wid = client.info?.wid?._serialized || '';
      senderPhone =
        wid.replace(/@c\.us$/i, '').replace(/\D/g, '') || 'yo';
    }

    addToHistory(senderPhone, content.historySummary);

    console.log(
      '[MAIN] Mensaje en grupo objetivo (tipo:',
      message.type,
      ', fromMe:',
      message.fromMe,
      '). Procesando con IA...'
    );

    // Generar respuesta con IA usando el historial
    let aiResponse;
    try {
      aiResponse = await generateAIResponse(groupHistory, {
        evalDescription: content.evalDescription,
        inlineImages: content.inlineImages,
      });
    } catch (aiError) {
      console.error(
        '[MAIN] Error al procesar el mensaje con la IA. El bot no responderá a este mensaje.',
        aiError
      );
      return;
    }

    if (!aiResponse) {
      console.warn(
        '[MAIN] La IA no devolvió una respuesta válida. No se enviará nada al grupo.'
      );
      return;
    }

    const { probabilidad, respuesta } = aiResponse;

    if (probabilidad > 85 && respuesta) {
      const now = Date.now();
      if (now - lastModerationWarningSentAt < MODERATION_COOLDOWN_MS) {
        const restanteSec = Math.ceil(
          (MODERATION_COOLDOWN_MS - (now - lastModerationWarningSentAt)) / 1000
        );
        console.log(
          `[MAIN] Política detectada; cooldown de moderación (~${restanteSec}s). No se envía aviso.`
        );
      } else {
        await replyFromBot(message, respuesta);
        lastModerationWarningSentAt = Date.now();
        console.log('[MAIN] Respuesta enviada al grupo (política detectada).');
      }
    } else {
      console.log(
        `🤖 Tema no político (${probabilidad}%). El bot se queda en silencio.`
      );
    }
  } catch (error) {
    // Cualquier error inesperado en el flujo principal no debería crashear la app
    console.error(
      '[MAIN] Error inesperado al manejar el mensaje. La aplicación seguirá ejecutándose.',
      error
    );
  }
});

