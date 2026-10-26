/* ============================================================
  Catálogo local: carga, índice y búsqueda difusa
   CERO llamadas a APIs en runtime: todo el dataset vive en
   data/catalog.json (generado por tools/build_catalog.py).
   ============================================================ */

export class Catalog {
  constructor() {
    this.cards = [];
    this.byId = new Map();      // id -> card
    this.byCode = new Map();    // code -> card[] (variantes paralelas)
    this.byPrefix = new Set();  // prefijos de set conocidos: OP09, ST01, EB01, PRB01, P...
    this.uniqueNames = [];      // nombres únicos, para el fallback difuso
    this.nameIndex = new Map(); // nombre normalizado -> card ejemplo
    this.readyPromise = null;
    this.meta = null;
  }

  /** Carga el catálogo una sola vez; llamadas posteriores reutilizan la promesa. */
  async ensureLoaded() {
    if (!this.readyPromise) {
      this.readyPromise = this.#load();
    }
    return this.readyPromise;
  }

  async #load() {
    const res = await fetch("data/catalog.json");
    if (!res.ok) throw new Error(`No se pudo cargar el catálogo (${res.status})`);
    const data = await res.json();
    this.meta = data.meta;
    this.cards = data.cards;

    for (const card of this.cards) {
      this.byId.set(card.id, card);
      if (!this.byCode.has(card.code)) this.byCode.set(card.code, []);
      this.byCode.get(card.code).push(card);

      const prefix = card.code.replace(/-\d+$/, "");
      if (prefix) this.byPrefix.add(prefix);
    }

    // nombres únicos (primera variante de cada nombre) para el fallback difuso
    const seen = new Set();
    for (const card of this.cards) {
      const key = norm(card.name);
      if (key && !seen.has(key)) {
        seen.add(key);
        this.uniqueNames.push(card);
        this.nameIndex.set(key, card);
      }
    }
    return this;
  }

  get size() { return this.cards.length; }

  /** Todas las cartas (variantes) de un código de carta: OP09-004 */
  getCode(code) {
    return this.byCode.get(code) || [];
  }

  /** Búsqueda por texto de nombre (con orden por relevancia simple). */
  searchByName(query, { limit = 50 } = {}) {
    const q = norm(query);
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const results = [];
    for (const card of this.uniqueNames) {
      const name = norm(card.name);
      if (!name.includes(q)) {
        // exigir que cada token del query aparezca en el nombre o la familia
        const haystack = `${name} ${norm(card.family)}`;
        if (!tokens.every((t) => haystack.includes(t))) continue;
      }
      // rango: coincidencia al inicio del nombre pesa más; cartas más recientes/legendarias también
      let score = 0;
      if (name.startsWith(q)) score += 4;
      else if (name.includes(q)) score += 2;
      const b = this.byCode.get(card.code)?.[0];
      if (b?.rarity === "L") score += 0.3;
      else if (b?.rarity === "SEC" || b?.rarity === "SP") score += 0.4;
      else if (b?.rarity === "SR") score += 0.2;
      results.push({ card, score });
      if (results.length > 400) break; // techo de código defensivo
    }
    // añade las variantes de cada resultado
    const out = [];
    for (const { card, score } of results.sort((a, b) => b.score - a.score).slice(0, limit)) {
      for (const variant of this.byCode.get(card.code) || []) {
        out.push(variant);
        if (out.length >= limit * 2) break;
      }
    }
    return out;
  }

  /** Canonicaliza un código OCR corrigiendo confusiones típicas del OCR. */
  fixCodeCandidate(raw) {
    let s = raw.toUpperCase()
      .replace(/[—–_]/g, "-")
      .replace(/[^A-Z0-9-]/g, "");
    // separador: el patrón es PREFIX#-### (1 bloque de 2-4 alnum, guion, 3 chars)
    const m = s.match(/^([A-Z0-9]{1,4})-?(\d{3})$/) || s.match(/^([A-Z0-9]{1,4})-([\dA-Z]{3})$/);
    if (!m) return null;
    let prefix = m[1].replace(/-/g, "");
    let num = m[2];
    num = num.replace(/O/g, "0").replace(/[ILl|]/g, "1").replace(/S/g, "5")
             .replace(/Z/g, "2").replace(/B/g, "8").replace(/T/g, "7")
             .replace(/G/g, "6").replace(/D/g, "0");
    // corrige el prefijo contra los prefijos reales del catálogo
    const zones = [...this.byPrefix];
    if (zones.includes(prefix)) return `${prefix}-${num}`;
    const fixed = prefix
      .replace(/^0P/, "OP").replace(/^OP0?P?/, "OP").replace(/^5T/, "ST")
      .replace(/^3B/, "EB").replace(/^PR8/, "PRB").replace(/^PR3/, "PRB")
      .replace(/^ST0$/, "ST").replace(/^0P/, "OP");
    if (zones.includes(fixed)) return `${fixed}-${num}`;
    // busca el mejor prefijo por similitud
    let best = null, bestDist = Infinity;
    for (const zone of zones) {
      if (Math.abs(zone.length - prefix.length) > 2) continue;
      const d = lev(zone, prefix);
      if (d < bestDist) { bestDist = d; best = zone; }
    }
    if (best && bestDist <= Math.min(2, prefix.length - 1)) return `${best}-${num}`;
    return null;
  }
}

/** Normaliza texto: minúsculas, sin diacríticos, solo alfanumérico como tokens. */
export function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distancia de Levenshtein compacta (para prefijos cortos). */
export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...Array(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Escapa HTML para render seguro (las habilidades traen <br> etc.). */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Convierte los <br> del dataset en saltos seguros tras el escape. */
export function escMultiline(s) {
  return esc(s).replace(/(&lt;br\s*\/?&gt;|\\n)/g, "<br>");
}

export const catalog = new Catalog();
