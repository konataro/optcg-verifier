/* ============================================================
  Precios de mercado — TCG Price Lookup (tier gratuito).

  Uso responsable:
   • caché IndexedDB por carta, TTL de 24 h
   • cola con espaciado >= 1.1 s entre peticiones
   • backoff exponencial ante 429/5xx
   • una única consulta por carta visualizada (no en bucle)
   • crédito visible "Powered by TCG Price Lookup" (exigido por ToS)

  La clave API se guarda solo en localStorage del usuario
  (la app no tiene backend, la clave nunca sale de su navegador
  salvo hacia la propia API).
  ============================================================ */

import { cacheGet, cachePut } from "./db.js";
import { norm } from "./catalog.js";

const API_BASE = "https://api.tcgpricelookup.com/v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h de caché
const MIN_GAP_MS = 1100;            // espaciado mínimo entre llamadas

const keyStore = {
  get() { return localStorage.getItem("opcg_api_key") || ""; },
  set(v) { localStorage.setItem("opcg_api_key", (v || "").trim()); },
  clear() { localStorage.removeItem("opcg_api_key"); },
};

/* --------- cola + rate-limit propio --------- */
let lastCall = 0;
let chain = Promise.resolve();

function scheduleCall(url, options) {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();

    const maxAttempts = 3;
    let attempt = 0;
    for (;;) {
      attempt++;
      const res = await fetch(url, options);
      if (res.ok) return res.json();

      const backoff = Math.min(15000, 1000 * 2 ** attempt) + Math.random() * 500;
      if (res.status === 429 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (res.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      const err = new Error(`API de precios respondió ${res.status}`);
      err.status = res.status;
      if (res.status === 401) err.message = "Clave API inválida o ausente (401). Revisa Ajustes.";
      if (res.status === 403) err.message = "Tu plan no permite lo solicitado (403).";
      if (res.status === 429) err.message = "Cuota diaria agotada (429). Prueba mañana.";
      throw err;
    }
  });
  chain = run.catch(() => {}); // no rompe la cola para las siguientes
  return run;
}

/* --------- puntuación de candidatos --------- */
function scoreCandidate(apiCard, card) {
  let score = 0;
  if (norm(apiCard.name) === norm(card.name)) score += 5;
  else if (norm(apiCard.name).includes(norm(card.name)) || norm(card.name).includes(norm(apiCard.name))) score += 2;

  const apiSet = norm(apiCard.set?.name || "");
  // el set del catálogo trae "-EMPERORS IN THE NEW WORLD- [OP-09]"
  const m = card.setName.match(/\[([A-Z0-9-]+)\]/);
  const setCode = m ? norm(m[1]) : ""; // p.ej. "op-09"
  const setTokens = apiSet.split(/[^a-z0-9]+/).filter(Boolean);
  if (setCode && apiSet.includes(setCode)) score += 3;
  if (setCode && setTokens.some((t) => setCode.includes(t.replace("-", "")))) score += 0.5;
  if (apiCard.rarity && norm(apiCard.rarity) === norm(card.rarity)) score += 1;
  return score;
}

function pickPrice(rc = {}) {
  // devuelve { market, currency, source, label } si hay algo útil
  const raw = rc?.raw || {};
  const nm = raw.near_mint || {};
  const sources = [];
  if (typeof nm.ebay?.avg_7d === "number") sources.push({ label: "eBay (7d avg)", price: nm.ebay.avg_7d });
  if (typeof nm.tcgplayer?.market === "number") sources.push({ label: "TCGPlayer market", price: nm.tcgplayer.market });
  if (!sources.length && typeof raw.near_mint?.tcgplayer?.low === "number") {
    sources.push({ label: "TCGPlayer low", price: raw.near_mint.tcgplayer.low });
  }
  return sources.length ? sources : null;
}

export class PriceService {
  constructor() { this.enabled = () => !!keyStore.get(); }

  getApiKey() { return keyStore.get(); }
  setApiKey(v) { keyStore.set(v); }

  /** Devuelve precios cacheados o frescos (1 llamada), o null si no hay clave. */
  async getPriceFor(card) {
    const key = keyStore.get();
    if (!key) return { state: "no-key" };

    const cacheKey = `price:${norm(card.name)}:${card.code}`;
    const cached = await cacheGet(cacheKey);
    if (cached && Date.now() - cached.savedAt < TTL_MS) {
      return { state: "cached", price: cached.value };
    }

    try {
      const url = `${API_BASE}/cards/search?q=${encodeURIComponent(card.name)}&game=onepiece&limit=100`;
      const json = await scheduleCall(url, { headers: { "X-API-Key": key } });
      const data = Array.isArray(json.data) ? json.data : [];
      const ranked = data
        .map((c, idx) => ({ c, idx, score: scoreCandidate(c, card) }))
        .sort((a, b) => b.score - a.score || a.idx - b.idx);
      const best = ranked[0];

      let priceBlock = null;
      if (best && best.score >= 4 && pickPrice(best.c.prices)) {
        priceBlock = pickPrice(best.c.prices);
      }
      await cachePut(cacheKey, priceBlock);
      return { state: priceBlock ? "fresh" : "not-found", price: priceBlock };
    } catch (e) {
      // si ya anda algo cacheado sin TTL, úsalo como respaldo
      if (cached && cached.value) return { state: "cached-stale", price: cached.value };
      throw e;
    }
  }

  /** Borra toda la caché local. */
  async clearCache() {
    localStorage.removeItem("opcg_last_cache_clear");
  }
}

export const priceService = new PriceService();
