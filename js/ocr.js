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

/**
 * Pre-procesado de imagen para el OCR (100% local, sin dependencias):
 *  1. escala a un ancho objetivo (~1600 px) → el texto gana píxeles reales
 *  2. escala de grises con estiramiento de contraste (percentiles 2%–98%)
 *     → neutraliza reflejos y bordes lavados típicos de la cámara
 *
 * Devuelve un canvas nuevo; el original queda intacto.
 */
export function preprocess(srcCanvas, targetW = 1600) {
  if (!srcCanvas || !srcCanvas.width) return srcCanvas;
  const scale = Math.max(1, targetW / srcCanvas.width); // nunca reduce aquí
  const out = document.createElement("canvas");
  out.width = Math.round(srcCanvas.width * scale);
  out.height = Math.round(srcCanvas.height * scale);
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(srcCanvas, 0, 0, out.width, out.height);

  let img;
  try {
    img = g.getImageData(0, 0, out.width, out.height);
  } catch {
    return out; // imagen "tainted" (raro en flujo cámara): devolvemos tal cual
  }
  const px = img.data;

  // histograma de luminancia para el estiramiento
  const hist = new Uint32Array(256);
  const n = px.length;
  for (let i = 0; i < n; i += 4) {
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
    hist[lum]++;
  }
  const total = n / 4;
  const loCut = total * 0.02, hiCut = total * 0.98;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc <= loCut) lo = v;
    if (acc <= hiCut) hi = v;
  }
  if (hi - lo < 20) { lo = 0; hi = 255; } // imagen casi plana: no estires
  const span = hi - lo;

  for (let i = 0; i < n; i += 4) {
    let lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
    let v = (lum - lo) * (255 / span);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
