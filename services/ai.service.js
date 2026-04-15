// services/ai.service.js
// Servicio de integración con la API de IA (Google Gemini - Google AI Studio).
// Cola global: tiempo mínimo entre el fin de una petición y el inicio de la siguiente (reduce 429).
// Ante 429: reintentos con backoff dentro de la misma tarea en cola (no se libera el slot hasta fallar del todo).

const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  AI_API_KEY,
  SYSTEM_PROMPT,
  MODERATION_PROBABILITY_MIN,
  GEMINI_MIN_GAP_MS,
  GEMINI_429_MAX_RETRIES,
  GEMINI_429_BASE_WAIT_MS,
} = require('../config');

let model = null;
let queueTail = Promise.resolve();
let lastGeminiRequestEndedAt = 0;

function getModelInstance() {
  if (!AI_API_KEY) {
    console.error(
      '[AI SERVICE] AI_API_KEY no está configurada. No se puede llamar a la IA (Gemini).'
    );
    throw new Error('AI_API_KEY no configurada');
  }

  if (!model) {
    const genAI = new GoogleGenerativeAI(AI_API_KEY);
    model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.18,
        topP: 0.85,
      },
    });
  }

  return model;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isRateLimitError(err) {
  if (!err) {
    return false;
  }
  if (typeof err.status === 'number' && err.status === 429) {
    return true;
  }
  const m = String(err.message || err).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('too many requests') ||
    m.includes('resource exhausted') ||
    m.includes('resource has been exhausted') ||
    m.includes('rate limit') ||
    m.includes('quota') ||
    m.includes('exceeded your current quota')
  );
}

/**
 * Una sola llamada a Gemini con reintentos ante 429 (misma tarea en cola).
 *
 * @param {Array<{ sender: string, text: string }>} history
 * @param {{ evalDescription: string, inlineImages?: Array<{ mimeType: string, data: string }> }} payload
 * @returns {Promise<{ probabilidad: number, respuesta: string }>}
 */
async function runGeminiEvaluation(history, payload) {
  const evalDescription = payload.evalDescription;
  const inlineImages = payload.inlineImages || [];

  const variantesEstilo = [
    'Más pancho, como charla de café.',
    'Un toque absurdo o exagerado (sin ofender a nadie).',
    'Cortito, al pie, estilo "listo, basta".',
    'Con humor boludo pero cariñoso.',
    'Irónico suave, como para bajarle el volumen al grupo.',
    'Tipo comentario de grupo de amigos que cambia de tema.',
  ];
  const estiloTurno =
    variantesEstilo[Math.floor(Math.random() * variantesEstilo.length)];

  const historyText =
    history && history.length > 0
      ? history
          .map((msg, index) => `${index + 1}. ${msg.sender}: ${msg.text}`)
          .join('\n')
      : 'Sin historial previo.';

  const userPrompt = `
Historial reciente del grupo de WhatsApp:
${historyText}

Último mensaje a evaluar (texto y, si aplica, imagen/sticker adjuntos en el mismo turno):
${evalDescription}

Pista de estilo para ESTE turno (solo si "probabilidad" > ${MODERATION_PROBABILITY_MIN} y debés rellenar "respuesta"): ${estiloTurno}

Evaluá con criterio conservador (ante la duda, probabilidad baja). Devolvé solo el JSON requerido; si corresponde "respuesta", que sea nueva y pegada a lo que mandaron en este mensaje.
`.trim();

  const geminiModel = getModelInstance();

  const parts = [{ text: userPrompt }];
  for (const img of inlineImages) {
    if (img && img.mimeType && img.data) {
      parts.push({
        inlineData: { mimeType: img.mimeType, data: img.data },
      });
    }
  }

  const maxAttempts = 1 + Math.max(0, GEMINI_429_MAX_RETRIES);
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        console.log('[AI SERVICE] Reintento de llamada a Gemini tras límite de tasa...');
      } else {
        console.log('[AI SERVICE] Llamando a Gemini con el contexto de conversación...');
      }

      const result = await geminiModel.generateContent({
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
      });

      const response = result.response;
      const text = (response && response.text && response.text()) || '';
      const trimmed = (text || '').trim();

      if (!trimmed) {
        console.warn('[AI SERVICE] Gemini devolvió una respuesta vacía.');
        throw new Error('Respuesta vacía de la IA (Gemini)');
      }

      const parsed = JSON.parse(trimmed);

      if (
        typeof parsed.probabilidad !== 'number' ||
        typeof parsed.respuesta !== 'string'
      ) {
        throw new Error(
          'Formato de respuesta inválido: faltan probabilidad o respuesta'
        );
      }

      console.log('[AI SERVICE] Respuesta evaluada por Gemini.');
      return parsed;
    } catch (error) {
      lastError = error;
      const canRetry =
        isRateLimitError(error) && attempt < maxAttempts - 1;
      if (!canRetry) {
        if (error instanceof SyntaxError) {
          console.error(
            '[AI SERVICE] La IA no devolvió un JSON válido:',
            error.message
          );
        } else {
          console.error(
            '[AI SERVICE] Error al generar respuesta de la IA (Gemini):',
            error
          );
        }
        throw error;
      }
      const waitMs = GEMINI_429_BASE_WAIT_MS * Math.pow(2, attempt);
      console.warn(
        `[AI SERVICE] Límite de tasa (429 / too many requests). Esperando ${Math.ceil(
          waitMs / 1000
        )}s antes del reintento ${attempt + 2}/${maxAttempts}...`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw lastError || new Error('Gemini: sin respuesta tras reintentos');
}

/**
 * Evalúa si el mensaje/conversación trata sobre política argentina.
 * Las peticiones se encolan: GEMINI_MIN_GAP_MS entre el fin de una y el inicio de la siguiente.
 *
 * @param {Array<{ sender: string, text: string }>} history - Últimos mensajes del grupo.
 * @param {{ evalDescription: string, inlineImages?: Array<{ mimeType: string, data: string }> }} payload
 * @returns {Promise<{ probabilidad: number, respuesta: string }>}
 */
function generateAIResponse(history, payload) {
  if (!AI_API_KEY) {
    console.error(
      '[AI SERVICE] AI_API_KEY no está configurada. No se puede llamar a la IA (Gemini).'
    );
    return Promise.reject(new Error('AI_API_KEY no configurada'));
  }

  return new Promise((resolve, reject) => {
    queueTail = queueTail.catch(() => {}).then(async () => {
      const now = Date.now();
      if (lastGeminiRequestEndedAt > 0) {
        const waitMs = GEMINI_MIN_GAP_MS - (now - lastGeminiRequestEndedAt);
        if (waitMs > 0) {
          console.log(
            `[AI SERVICE] Cola: esperando ${Math.ceil(waitMs / 1000)}s (espacio mínimo ${GEMINI_MIN_GAP_MS}ms entre peticiones a Gemini).`
          );
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
      try {
        const result = await runGeminiEvaluation(history, payload);
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        lastGeminiRequestEndedAt = Date.now();
      }
    });
  });
}

module.exports = {
  generateAIResponse,
};
