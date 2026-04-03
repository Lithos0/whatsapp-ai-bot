// services/ai.service.js
// Servicio de integración con la API de IA (Google Gemini - Google AI Studio).
// Cola global: mínimo 15 s entre el fin de una petición y el inicio de la siguiente (reduce 429).

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AI_API_KEY, SYSTEM_PROMPT } = require('../config');

const MIN_GAP_BETWEEN_GEMINI_REQUESTS_MS = 15 * 1000;

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
        temperature: 0.75,
        topP: 0.92,
      },
    });
  }

  return model;
}

/**
 * Una sola llamada a Gemini (sin cola ni espera).
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

Pista de estilo para ESTE turno (si tenés que escribir "respuesta" porque la probabilidad supera 85): ${estiloTurno}

Evaluá si el tema es política partidaria o gubernamental de Argentina según las reglas del sistema. Devolvé solo el JSON requerido; si corresponde respuesta, que sea nueva y pegada a lo que mandaron en este mensaje.
`.trim();

  console.log('[AI SERVICE] Llamando a Gemini con el contexto de conversación...');

  const geminiModel = getModelInstance();

  const parts = [{ text: userPrompt }];
  for (const img of inlineImages) {
    if (img && img.mimeType && img.data) {
      parts.push({
        inlineData: { mimeType: img.mimeType, data: img.data },
      });
    }
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
}

/**
 * Evalúa si el mensaje/conversación trata sobre política argentina.
 * Las peticiones se encolan: mínimo 15 s entre el fin de una y el inicio de la siguiente.
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
        const waitMs =
          MIN_GAP_BETWEEN_GEMINI_REQUESTS_MS -
          (now - lastGeminiRequestEndedAt);
        if (waitMs > 0) {
          console.log(
            `[AI SERVICE] Cola: esperando ${Math.ceil(waitMs / 1000)}s (espacio mínimo entre peticiones a Gemini).`
          );
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
      try {
        const result = await runGeminiEvaluation(history, payload);
        resolve(result);
      } catch (error) {
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
