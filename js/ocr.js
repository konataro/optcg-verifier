/* ============================================================
  OCR con Tesseract.js (CDN, corre 100% en el navegador).
  Se carga bajo demanda: la SPA arranca liviana.
  ============================================================ */

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
let loadPromise = null;

/** Inyecta Tesseract.js una sola vez. */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESSERACT_CDN;
    s.async = true;
    s.onload = () => window.Tesseract
      ? resolve(window.Tesseract)
      : reject(new Error("Tesseract.js cargó pero no está disponible"));
    s.onerror = () => { loadPromise = null; reject(new Error("Fallo al descargar Tesseract.js (¿sin conexión?)")); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Ejecuta OCR sobre un canvas/imagen y devuelve el texto crudo.
 * isSkeleton solo se usa en fase inicial; los lang data se descargan del CDN.
 */
export async function recognize(imageEl, onProgress) {
  const T = await loadTesseract();
  const { data } = await T.recognize(imageEl, "eng", {
    logger: (m) => {
      if (m.status && typeof onProgress === "function") onProgress(m);
    },
    tessedit_char_whitelist: undefined,
  });
  return data.text || "";
}

/**
 * Extrae candidatos de código de carta del texto OCR:
 * patrón del juego: OP09-004, ST21-001, EB01-001, PRB01-003, OP10-104...
 * y también nombres plausibles para el fallback.
 */
export function extractCodeCandidates(text) {
  const up = text.toUpperCase()
    .replace(/[—–_]/g, "-")
    .replace(/\s+/g, " ");

  const candidates = new Set();
  // bloque 1: 2-4 alfanum + separador + bloque 2: 3 chars con posible confusión
  const re = /([A-Z0-9]{1,5}) ?- ?([0-9OILSZTBD]{3})/g;
  let m;
  while ((m = re.exec(up)) !== null) {
    candidates.add(`${m[1]}-${m[2]}`);
  }
  // algunos OCRs pegan código sin guion: "OP09004" / "ST21001"
  const re2 = /\b(OPR?0?P\d{5}|5T\d{5}|0P\d{5}|EB\d{5}|PR8\d{5}|\b[A-Z]{2,4}\d{5,7})\b/g;
  while ((m = re2.exec(up)) !== null) {
    const t = m[1];
    candidates.add(`${t.slice(0, t.length - 3)}-${t.slice(-3)}`);
  }
  return [...candidates];
}

/** Busca fragmentos de nombres de cartas en el texto OCR (fallback por nombre). */
export function extractNameWords(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim().split(/\s+/)
    .filter((w) => w.length >= 3);
}
