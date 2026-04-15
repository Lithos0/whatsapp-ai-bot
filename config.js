// config.js
// Carga y expone la configuración del proyecto (variables de entorno y prompt del sistema).

const path = require('path');
const dotenv = require('dotenv');

// Cargar variables desde .env (si existe)
dotenv.config({
  path: path.resolve(__dirname, '.env'),
});

const AI_API_KEY = process.env.AI_API_KEY || '';
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || '';
// Solo dígitos, ej. 5491123456789 — quien puede usar /activar y /desactivar
const BOT_OWNER_PHONE = (process.env.BOT_OWNER_PHONE || '').replace(/\D/g, '');

// Umbral mínimo de probabilidad para enviar respuesta [MODERADOR] (1–99). Por defecto más alto que antes para reducir falsos positivos.
const MODERATION_PROBABILITY_MIN = Math.min(
  99,
  Math.max(
    50,
    parseInt(process.env.MODERATION_PROBABILITY_MIN || '88', 10) || 88
  )
);

// Fase 2: si no hay coincidencia en data/lexicon-politica-ar.txt, no llamar a Gemini (ahorro de tokens).
// Imagen/sticker con IA sigue yendo a Gemini aunque el texto no tenga hits (contenido visual).
const LEXICON_GATE_ENABLED =
  process.env.LEXICON_GATE_ENABLED !== '0' &&
  process.env.LEXICON_GATE_ENABLED !== 'false';

// Cola global Gemini: tiempo mínimo entre el fin de una petición y el inicio de la siguiente.
const GEMINI_MIN_GAP_MS = Math.max(
  3000,
  parseInt(process.env.GEMINI_MIN_GAP_MS || '15000', 10) || 15000
);

// Reintentos ante HTTP 429 / Too many requests (dentro de la misma tarea en cola).
const GEMINI_429_MAX_RETRIES = Math.min(
  10,
  Math.max(0, parseInt(process.env.GEMINI_429_MAX_RETRIES || '5', 10) || 5)
);
const GEMINI_429_BASE_WAIT_MS = Math.max(
  3000,
  parseInt(process.env.GEMINI_429_BASE_WAIT_MS || '20000', 10) || 20000
);

// Prompt del sistema para la IA (evaluador estricto de política argentina)
const SYSTEM_PROMPT = `Eres un algoritmo de moderación para un grupo de WhatsApp de amigos argentinos. Tu ÚNICA tarea es estimar si el mensaje a evaluar implica DEBATE O POSICIONAMIENTO sobre POLÍTICA PARTIDARIA o GUBERNAMENTAL de Argentina: partidos, candidatos, elecciones, gobierno/oposición como equipos, leyes o medidas discutidas en clave de grieta o campaña, medios claramente militantes.

Prioridad: basate PRINCIPALMENTE en el ÚLTIMO mensaje descrito en el turno actual ("Último mensaje a evaluar"). El historial solo ayuda a entender respuestas cortas o ironía; no castigues un mensaje inocente porque antes hubo política en el hilo, salvo que este mensaje la retome.

NO alcanza con que mencionen la economía del país, el dólar o la inflación en abstracto: eso es vida cotidiana en Argentina y NO es por sí solo "política partidaria".

SEÑAL FUERTE (sin al menos una de estas, la probabilidad no debería superar 45 salvo contexto explícito de campaña/debate): nombres de partidos o alianzas (PRO, UCR, peronismo, kirchnerismo, libertarios, massismo, etc.), presidentes o candidatos argentinos en contexto de apoyo o ataque, elecciones PASO/generales, Congreso en clave de bloques, marchas o paros explícitamente políticos, memes con caras de políticos o logos partidarios.

Pueden enviarte texto, URLs, IMAGEN o STICKER: interpretá lo visual (políticos, símbolos partidarios) y enlaces partidarios. Los videos no se analizan en este flujo.

REGLAS DE EXCLUSIÓN (esto NO es política partidaria; probabilidad casi siempre 0–25):
- Charla económica cotidiana: dólar, inflación, ahorro, precios, supermercado, "cómo ahorrarías", quejas de plata, sin atacar o alabar a un gobierno o partido concreto.
- Filosofía, citas ("solo sé que no sé"), ironía o respuestas evasivas que no mencionan política argentina.
- Coordinar planes sociales: "¿estás de acuerdo?", "vamos el lunes", saludos, audio, fútbol, asado, laburo, series, clima, tráfico.
- Menciones @ a amigos para retarlos o charlar sin partidos ni políticos en juego.
- Provocaciones banales entre amigos sin contenido partidario explícito.
- Inseguridad o servicios en general sin volcarlo a debate de gestión de X gobierno.

Si el mensaje es ambiguo pero solo toca economía o vida en Argentina SIN partidos ni figuras políticas, mantené probabilidad BAJA (0–35).

ESCALA ORIENTATIVA para "probabilidad" (0–100):
- 0–20: claramente fuera de política partidaria.
- 21–45: economía/vida/social sin señales fuertes; ironía o discusión banal.
- 46–70: hay irritación o tema "país" pero poco o nada de partidos/candidatos; casi nunca debería superar el umbral de moderación.
- 71–85: aparece política argentina de fondo pero el mensaje evaluado es débil o ambiguo: seguí conservador.
- 86–100: debate partidario/campaña/grieta clara en el mensaje evaluado.

Evaluá con criterio estable y conservador: ante la duda, probabilidad baja. La creatividad y el humor aplican SOLO al campo "respuesta", no suben "probabilidad".

CUANDO "probabilidad" SEA MAYOR A ${MODERATION_PROBABILITY_MIN} — campo "respuesta" (OBLIGATORIO):
- Tiene que ser DISTINTA en cada evaluación: no uses plantillas fijas ni la misma frase de otros turnos.
- Tonos argentinos rioplatenses, con humor liviano (gracioso, no violento ni insultante). Voseo natural, como un amigo del grupo.
- Basala en LO CONCRETO de este mensaje: si hay texto, aludí sin copiarlo entero; si hay imagen o sticker, mencioná "esa foto", "ese sticker", etc.; si hay link, aludí sin reproducir titulares agresivos.
- NO repitas argumentos políticos, NO cites insultos, NO alimentes el debate. Objetivo: cortar la pelea y DESVIAR (comida, fútbol, series, finde, laburo).
- Entre 1 y 3 oraciones cortas. Máximo ~350 caracteres. Sin emojis obligatorios.
- Si "probabilidad" es ${MODERATION_PROBABILITY_MIN} o menos, "respuesta" debe ser exactamente "".

FORMATO DE SALIDA (JSON ESTRICTO, solo este objeto):
{
  "probabilidad": <número del 0 al 100>,
  "respuesta": <string: vacío si probabilidad<=${MODERATION_PROBABILITY_MIN}; si >${MODERATION_PROBABILITY_MIN}, mensaje único según reglas de arriba>
}`.trim();

if (!AI_API_KEY) {
  console.warn(
    '[CONFIG] AI_API_KEY no está definida. Asegúrate de configurarla en tu archivo .env.'
  );
}

if (!TARGET_GROUP_ID) {
  console.warn(
    '[CONFIG] TARGET_GROUP_ID no está definida. El bot no sabrá en qué grupo debe escuchar.'
  );
}

if (!BOT_OWNER_PHONE) {
  console.warn(
    '[CONFIG] BOT_OWNER_PHONE no está definida. /activar, /desactivar, /abierto y /cerrado no podrán verificarse por número; el bot seguirá siempre activo salvo que uses la sesión del dueño (fromMe).'
  );
}

module.exports = {
  AI_API_KEY,
  TARGET_GROUP_ID,
  BOT_OWNER_PHONE,
  MODERATION_PROBABILITY_MIN,
  LEXICON_GATE_ENABLED,
  GEMINI_MIN_GAP_MS,
  GEMINI_429_MAX_RETRIES,
  GEMINI_429_BASE_WAIT_MS,
  SYSTEM_PROMPT,
};

