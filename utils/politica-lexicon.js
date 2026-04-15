// utils/politica-lexicon.js
// Fase 2: coincidencia por lista (sin tokens de economía cotidiana ni modismos generales).
// El archivo data/lexicon-politica-ar.txt NO proviene de diccionarios de argot; está curado para política.

const fs = require('fs');
const path = require('path');

let cachedTerms = null;

function loadTerms() {
  if (cachedTerms) {
    return cachedTerms;
  }
  const filePath = path.join(__dirname, '..', 'data', 'lexicon-politica-ar.txt');
  const raw = fs.readFileSync(filePath, 'utf8');
  cachedTerms = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return cachedTerms;
}

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizeForMatch(s) {
  return stripDiacritics(String(s).toLowerCase());
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} haystackNorm texto ya normalizado (lower + sin tildes)
 * @param {string} termRaw línea del léxico
 */
function termMatches(haystackNorm, termRaw) {
  const term = normalizeForMatch(termRaw);
  if (term.length < 2) {
    return false;
  }
  if (term.includes(' ')) {
    return haystackNorm.includes(term);
  }
  if (term.length <= 3) {
    const re = new RegExp(
      `(^|[^a-z0-9áéíóúüñ])${escapeRegex(term)}([^a-z0-9áéíóúüñ]|$)`,
      'i'
    );
    return re.test(haystackNorm);
  }
  return haystackNorm.includes(term);
}

/**
 * @param {string} haystack texto + historial concatenado
 * @returns {{ hit: boolean, termsFound: string[] }}
 */
function matchPoliticaLexicon(haystack) {
  const terms = loadTerms();
  const haystackNorm = normalizeForMatch(haystack);
  const termsFound = [];
  for (const t of terms) {
    if (termMatches(haystackNorm, t)) {
      termsFound.push(t);
    }
  }
  return {
    hit: termsFound.length > 0,
    termsFound,
  };
}

/**
 * @param {string} haystack
 * @returns {boolean}
 */
function haystackHasPoliticaHit(haystack) {
  return matchPoliticaLexicon(haystack).hit;
}

module.exports = {
  loadTerms,
  matchPoliticaLexicon,
  haystackHasPoliticaHit,
};
