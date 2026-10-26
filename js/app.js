/* ============================================================
  App principal: ruteo de pestañas, flujo de escaneo → OCR →
  identificación → ficha + comparativa visual → precio.

  Pipeline de identificación:
   1. captura / subida de imagen
   2. OCR en el navegador (Tesseract.js)
   3. extracción del código de carta con corrección difusa
   4. fallback por nombre con ranking
   5. ficha oficial + verificación + precio (con caché)
  ============================================================ */

import { catalog, esc, escMultiline } from "./catalog.js";
import { recognize, extractCodeCandidates, extractNameWords } from "./ocr.js";
import { CameraScanner, fileToCanvas } from "./scanner.js";
import { priceService } from "./prices.js";

const view = document.getElementById("view");
const toastEl = document.getElementById("toast");
const priceCredit = document.getElementById("price-credit");

const scanner = new CameraScanner();
let lastCanvas = null; // última imagen capturada para la comparativa
let scanMode = "full"; // "full" (carta completa) | "code" (solo esquina del código)

/* ------------------ utilidades UI ------------------ */

function toast(msg, ms = 3600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function colorBadgeHTML(color) {
  const first = (color || "—").split("/")[0];
  const colors = {
    Red: "#e74c3c", Green: "#27ae60", Blue: "#2980b9",
    Yellow: "#f0b429", Purple: "#8e44ad", Black: "#222",
  };
  return `<span class="quote-badge" style="background:${colors[first] || "#555"}">${esc(color || "—")}</span>`;
}

/**
 * Imagen oficial de la carta: intento directo contra el CDN de Bandai;
 * si el origen lo bloquea (hotlinking), recae en wsrv.nl (CDN de imágenes
 * gratuito, con su propia caché → mínimo impacto adicional).
 */
function officialImg(card, alt, loading = "lazy") {
  if (!card.img) return `<div class="empty">sin imagen</div>`;
  const proxy = `https://wsrv.nl/?url=${encodeURIComponent(card.img)}&w=500&output=jpg&q=85`;
  return `<img src="${esc(card.img)}" alt="${esc(alt)}" loading="${loading}" referrerpolicy="no-referrer"
    data-fallback="${esc(proxy)}" onerror="window.__imgFallback(this)" />`;
}

// instalado globalmente para los atributos onerror inline
if (typeof window !== "undefined") {
  window.__imgFallback = function (img) {
    if (img.dataset.fell === "1") { img.removeAttribute("src"); return; }
    img.dataset.fell = "1";
    const fb = img.dataset.fallback;
    if (fb) { img.src = fb; img.removeAttribute("data-fallback"); }
  };
}

/* ------------------ vista: Escanear ------------------ */

function renderScanView() {
  priceCredit.hidden = !priceService.getApiKey();
  view.innerHTML = `
    <section class="panel">
      <h2>📷 Escanear carta</h2>
      <p class="hint">Enfoca la carta completa con buena luz. Si el OCR falla, sube una foto o añade el código a mano.</p>
      ${CameraScanner.isSupported() ? `
        <div class="mode-switch" role="tablist" aria-label="Modo de captura">
          <button class="mode-btn active" data-mode="full" role="tab" aria-selected="true">🃏 Carta completa</button>
          <button class="mode-btn" data-mode="code" role="tab" aria-selected="false">🔍 Solo código</button>
        </div>
        <div class="camera-wrap">
          <video id="cam" playsinline muted autoplay></video>
          <div id="guide" class="guide-frame" aria-hidden="true">
            <span class="guide-label">Cabe la carta completa dentro de este marco</span>
          </div>
          <div class="cam-actions">
            <button id="btn-start" class="btn ghost">▶️ Activar cámara</button>
            <button id="btn-capture" class="btn primary" disabled>📸 Capturar</button>
          </div>
        </div>` : `
        <p class="hint warn">Tu navegador no permite acceso a cámara (o falta HTTPS/permisos). Sube una imagen.</p>`}
      <div class="upload-row">
        <label class="btn ghost file-label">
          🖼 Subir imagen
          <input id="file-in" type="file" accept="image/*" hidden />
        </label>
        <div class="manual-row">código manual:
          <input id="manual-code" type="text" placeholder="OP09-004" spellcheck="false" />
          <button id="btn-manual" class="btn ghost">Verificar</button>
        </div>
      </div>
      <div id="scan-status" class="status"></div>
    </section>
    <section id="scan-result" class="panel" hidden></section>
  `;

  const video = document.getElementById("cam");
  const btnStart = document.getElementById("btn-start");
  const btnCapture = document.getElementById("btn-capture");
  const fileIn = document.getElementById("file-in");
  const manualCode = document.getElementById("manual-code");
  const btnManual = document.getElementById("btn-manual");
  const status = document.getElementById("scan-status");
  const result = document.getElementById("scan-result");

  // --- switch de modo (carta completa / solo código) ---
  const guide = document.getElementById("guide");
  view.querySelectorAll(".mode-btn").forEach((b) => {
    b.onclick = () => {
      scanMode = b.dataset.mode;
      view.querySelectorAll(".mode-btn").forEach((x) => {
        const active = x.dataset.mode === scanMode;
        x.classList.toggle("active", active);
        x.setAttribute("aria-selected", active);
      });
      guide.classList.toggle("guide-frame--code", scanMode === "code");
      guide.querySelector(".guide-label").textContent = scanMode === "code"
        ? "Alinea el texto del código dentro de este marco"
        : "Cabe la carta completa dentro de este marco";
    };
  });

  if (btnStart) {
    btnStart.onclick = async () => {
      try {
        await scanner.start(video);
        btnStart.classList.add("hidden");
        btnCapture.disabled = false;
        toast("Cámara activada. Nada se sube a ningún servidor: todo aquí mismo.");
      } catch (e) {
        toast(`No se pudo activar la cámara: ${e.message}`);
      }
    };
    btnCapture.onclick = async () => {
      // modo "solo código": recortamos exactamente lo que el usuario encaja en el marco
      const canvas = scanMode === "code" && guide
        ? scanner.captureFrame(guide)
        : scanner.capture(null);
      if (!canvas) {
        // marco fuera de rango → captura completa como respaldo
        await identify(scanner.capture(null), status, result);
        return;
      }
      await identify(canvas, status, result);
    };
  }

  fileIn.onchange = async () => {
    if (!fileIn.files?.[0]) return;
    try {
      const canvas = await fileToCanvas(fileIn.files[0]);
      await identify(canvas, status, result);
    } catch (e) {
      toast(e.message);
    }
    fileIn.value = "";
  };

  btnManual.onclick = async () => {
    try { await catalog.ensureLoaded(); } catch (e) { return toast(`No se pudo cargar el catálogo: ${e.message}`); }
    const parsed = catalog.strictParse(manualCode.value);
    if (!parsed) return toast("Código no reconocido. Formato: OP09-004 / ST21-007");
    // entrada manual = modo estricto: jamás "corregimos" el set en silencio
    const variants = catalog.getCode(parsed.code);
    if (!variants.length) return showNotVerified(parsed.code, status, result);
    status.hidden = true;
    renderResult(variants, null, result);
  };
}

/* ------------------ pipeline de identificación ------------------ */

async function identify(canvas, status, result) {
  lastCanvas = canvas;
  status.hidden = false;
  result.hidden = true;
  result.innerHTML = "";

  status.innerHTML = `<div class="spinner"></div> Cargando catálogo local…`;
  try { await catalog.ensureLoaded(); } catch (e) {
    status.textContent = `⚠️ ${e.message}`;
    return;
  }

  status.innerHTML = `<div class="spinner"></div> Leyendo la carta (OCR, sin salir de tu navegador)…`;
  let text = "";
  try {
    text = await recognize(canvas, (m) => {
      if (m.progress) {
        status.innerHTML = `<div class="spinner"></div> OCR: ${Math.round(m.progress * 100)}% (${esc(m.status)})`;
      }
    });
  } catch (e) {
    status.textContent = `⚠️ OCR falló: ${e.message}. Prueba con una foto más nítida o entra el código a mano.`;
    return;
  }

  // 1) por código
  const code = findCode(text);
  if (code) {
    const variants = catalog.getCode(code);
    if (variants.length) {
      status.hidden = true;
      renderResult(variants, canvas, result);
      return;
    }
  }

  // 2) fallback por nombre
  const words = extractNameWords(text);
  if (words.length >= 2) {
    const query = words.slice(0, 8).join(" ");
    const hits = catalog.searchByName(query, { limit: 20 });
    const distinct = [...new Map(hits.map((c) => [c.code, c])).values()].slice(0, 6);
    if (distinct.length) {
      status.innerHTML = `
        <p>⚠️ No se leyó el código de forma fiable, pero el nombre coincide con:</p>
        <ul class="guess-list">${distinct.map((c) =>
          `<li><button class="btn ghost" data-code="${esc(c.code)}">${esc(c.code)} · ${esc(c.name)}</button></li>`).join("")}</ul>`;
      status.querySelectorAll("[data-code]").forEach((b) => {
        b.onclick = () => {
          const variants = catalog.getCode(b.dataset.code);
          status.hidden = true;
          renderResult(variants, canvas, result);
        };
      });
      return;
    }
  }

  // 3) nada confiable
  const tightFailed = scanMode === "code";
  status.innerHTML = `
    <p>⚠️ No pude identificar la carta con confianza.</p>
    <p class="hint">Consejos: mejor luz, carta completa en el marco, sin reflejos.
    También puedes escribir el código a mano abajo.</p>
    ${tightFailed ? `<p class="hint warn">Estás en modo "Solo código": si el texto quedó borroso o cortado, prueba con más luz, acercás el marco o cambia a "Carta completa" para que se lea también el nombre.</p>` : ""}`;
}

function findCode(text) {
  const candidates = extractCodeCandidates(text);
  for (const c of candidates) {
    const fixed = catalog.fixCodeCandidate(c);
    if (fixed && catalog.byCode.has(fixed)) return fixed;
  }
  return null;
}

/* ------------------ render de resultados ------------------ */

function renderResult(variants, canvas, result) {
  distinctView(variants, canvas, result);
}

function showNotVerified(code, status, result) {
  status.hidden = true;
  result.hidden = false;
  result.innerHTML = `
    <div class="alert warn">
      <h2>⚠️ Código no verificado: ${esc(code)}</h2>
      <p>Este código <strong>no existe en el catálogo oficial en inglés</strong> (${catalog.size} cartas cargadas).</p>
      <p class="hint">Posibles causas: carta japonesa/china (otra numeración), error de lectura del
      OCR, o directamente una <strong>carta falsificada / no oficial</strong>. Compara el costo,
      poder y diseño con una carta conocida de confianza antes de comprarla o intercambiarla.</p>
    </div>`;
}

function distinctView(variants, canvas, result) {
  const primary = variants[0];
  const code = primary.code;
  if (variants.length === 1) return cardDetail(primary, canvas, result, false);
  result.hidden = false;
  result.innerHTML = `
    <h2>Código ${esc(code)} — ${variants.length} variante(s) encontradas</h2>
    <div class="grid variants">
      ${variants.map((v) => `
        <button class="variant" data-id="${esc(v.id)}">
          ${officialImg(v, v.name)}
          <span>${esc(v.name)}</span>
          <span class="muted">${esc(v.rarity)}${v.id.includes("_") ? ` · variante ${esc(v.id.split("_")[1])}` : ""}</span>
        </button>`).join("")}
    </div>
    <p class="hint">Elige la variante que corresponde a tu carta (versiones paralelas/alternas comparten código).</p>`;
  result.querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => cardDetail(catalog.byId.get(b.dataset.id), canvas, result, true);
  });
}

function renderFacts(c) {
  const stat = (label, v) => `
      <div class="fact"><span class="k">${label}</span><span class="v">${esc(v ?? "-")}</span></div>`;
  return `
    <div class="facts">
      ${stat("Tipo", c.type)}
      ${stat("Rareza", c.rarity)}
      ${stat("Coste", c.cost ?? "-")}
      ${stat("Poder", c.power ?? "-")}
      ${typeof c.power === "number" ? stat("Counter", c.counter || "-") : ""}
      ${c.attribute ? stat("Atributo", c.attribute) : ""}
      ${c.family ? stat("Familia", c.family) : ""}
      ${stat("Set", c.setName)}
      ${stat("ID cartón", c.id)}
    </div>`;
}

function priceHTML(st, prices) {
  switch (st) {
    case "no-key":
      return `<p class="hint">💰 Para ver precios de mercado: consigue una clave gratis en
        <a href="https://tcgpricelookup.com/tcg-api" target="_blank" rel="noopener">tcgpricelookup.com</a>
        y pegala en <em>Ajustes</em>.</p>`;
    case "cached":
    case "cached-stale":
      return `<div class="price">${priceRow(prices, st === "cached-stale" ? " (caché, >24h)" : " (caché)")}</div>`;
    case "fresh":
      return `<div class="price">${priceRow(prices, " (en vivo)")}</div>`;
    case "not-found":
      return `<p class="hint">💰 Sin precio disponible en la API para esta carta.</p>`;
    default:
      return `<div class="hint"><div class="spinner" style="width:1rem;height:1rem;display:inline-block"></div> Buscando precio…</div>`;
  }
}

function priceRow(prices, tag) {
  return (prices || []).map((s) =>
    `<div class="price-line"><strong>$${(+s.price).toFixed(2)}</strong>${tag} <span class="muted">${esc(s.label)}</span></div>`
  ).join("");
}

async function cardDetail(card, canvas, result, showBack = true) {
  const c = card;
  result.hidden = false;
  result.innerHTML = `
    <div class="detail">
      <div class="detail-head">
        <h2>${esc(c.name)}</h2>
        <div class="badges">
          <span class="code-badge">${esc(c.code)}</span>
          ${colorBadgeHTML(c.color)}
          <span class="quote-badge plain">${esc(c.rarity)}</span>
        </div>
      </div>
      <div class="compare">
        <figure>
          <figcaption>Tu captura</figcaption>
          ${canvas ? `<img src="${escapeCanvasSource(canvas)}" alt="mitad frontal" />` : `<div class="empty">…</div>`}
        </figure>
        <figure>
          <figcaption>Imagen oficial</figcaption>
          ${officialImg(c, `${c.name} oficial`, "eager")}
        </figure>
      </div>
      ${renderFacts(c)}
      ${c.ability ? `<div class="ability"><h3>Efecto</h3><p>${escMultiline(c.ability)}</p></div>` : ""}
      ${c.trigger ? `<div class="ability"><h3>Trigger</h3><p>${escMultiline(c.trigger)}</p></div>` : ""}
      <div class="price-box" id="price-box">
        ${priceHTML("loading")}
      </div>
    </div>
    ${showBack ? `<button class="btn ghost" id="btn-back">← Volver</button>` : ""}`;

  const back = document.getElementById("btn-back");
  if (back) back.onclick = () => distinctView(catalog.getCode(c.code), canvas, result);

  const priceBox = document.getElementById("price-box");
  try {
    const r = await priceService.getPriceFor(card);
    priceBox.innerHTML = `
      <h3>💰 Precio</h3>
      ${priceHTML(r.state, r.price)}
      <p class="muted small">Cacheamos las consultas 24h en tu navegador para
      gastar la menor cuota posible de la API.</p>`;
    if (r.price) priceCredit.hidden = !priceService.getApiKey();
  } catch (e) {
    priceBox.innerHTML = `
      <h3>💰 Precio</h3>
      <p class="hint warn">${esc(e.message)}</p>
      <p class="muted small">Recuerda: tu clave vive solo en este navegador.</p>`;
  }
}

/** dataURL seguro para mostrar la captura localmente. */
function escapeCanvasSource(canvas) {
  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch { return ""; }
}

/* ------------------ vista: Buscar ------------------ */

function renderSearchView() {
  view.innerHTML = `
    <section class="panel">
      <h2>🔍 Buscar carta manual</h2>
      <p class="hint">Sin mirar el código OCR: consulta la ficha oficial y el precio buscando por nombre.</p>
      <input id="q" class="search-input" type="search" placeholder="p. ej. shanks, udaughter, moria, OP09-004…" autocomplete="off" />
      <div id="q-results" class="grid results"></div>
    </section>
    <section id="q-detail" class="panel" hidden></section>`;
  const q = document.getElementById("q");
  const results = document.getElementById("q-results");
  const detail = document.getElementById("q-detail");
  let t = null;
  q.oninput = async () => {
    clearTimeout(t);
    t = setTimeout(doSearch, 250);
  };
  async function doSearch() {
    const text = q.value.trim();
    if (!text) { results.innerHTML = ""; detail.hidden = true; return; }
    await catalog.ensureLoaded();
    let hits;
    const fixed = catalog.fixCodeCandidate(text);
    if (fixed && catalog.byCode.has(fixed)) hits = catalog.getCode(fixed);
    else hits = catalog.searchByName(text, { limit: 60 });
    results.innerHTML = hits.length ? hits.map((c) => `
      <button class="variant" data-id="${esc(c.id)}">
        ${officialImg(c, c.name)}
        <span>${esc(c.name)}</span>
        <span class="muted">${esc(c.code)} · ${esc(c.rarity)}</span>
      </button>`).join("") : `<p class="hint">Sin resultados para “${esc(text)}”.</p>`;
    results.querySelectorAll("[data-id]").forEach((b) => {
      b.onclick = () => cardDetail(catalog.byId.get(b.dataset.id), null, detail, false);
    });
  }
}

/* ------------------ vista: Ajustes ------------------ */

function renderSettingsView() {
  const key = priceService.getApiKey();
  view.innerHTML = `
    <section class="panel">
      <h2>⚙️ Ajustes</h2>
      <h3>🔑 Clave API de precios (TCG Price Lookup)</h3>
      <p class="hint">Consigue la tuya gratis en
        <a href="https://tcgpricelookup.com/tcg-api" target="_blank" rel="noopener">tcgpricelookup.com/tcg-api</a>.
        Free = 100 consultas/día; la app cachea cada carta 24h para estirar la cuota lo máximo posible.</p>
      <input id="api-key" class="search-input" type="password" placeholder="tk_live_…" value="${esc(key)}" autocomplete="off" />
      <div class="cam-actions" style="margin-top:.6rem">
        <button class="btn primary" id="save-key">Guardar</button>
        <button class="btn ghost" id="clear-key">Borrar</button>
        <button class="btn ghost" id="clear-cache">Limpiar caché de precios</button>
      </div>
      <p id="settings-msg" class="hint"></p>

      <h3>🧭 Uso responsable de esta app</h3>
      <ul>
        <li>Catálogo de cartas <strong>pre-cargado localmente</strong>: 0 llamadas a ninguna API.
          Fuente: <a href="https://github.com/buhbbl/punk-records" target="_blank" rel="noopener">punk-records</a>
          (datos del site oficial de Bandai, actualizados automáticamente cada pocos días).</li>
        <li>Precios: <strong>caché IndexedDB de 24h</strong> por carta + espaciado ≥ 1.1s por consulta.</li>
        <li>OCR y cámara corren <strong>100% en tu navegador</strong>: ninguna imagen sale de tu equipo.</li>
        <li>Imágenes oficiales: se intentan cargar directo del CDN de Bandai; si el hotlink falla,
          se recae en <a href="https://wsrv.nl" target="_blank" rel="noopener">wsrv.nl</a> (CDN con su propia caché, mínimo impacto).</li>
        <li>Crédito: datos de
          <a href="https://github.com/apitcg/one-piece-tcg-data" target="_blank" rel="noopener">apitcg</a>
          (© Bandai/Shueisha/Toei); precios: <a href="https://tcgpricelookup.com" target="_blank" rel="noopener">Powered by TCG Price Lookup</a>.</li>
      </ul>
      <h3>🧾 Meta del catálogo</h3>
      <p id="catalog-meta" class="hint">…</p>
    </section>`;

  document.getElementById("catalog-meta").textContent = "—";
  catalog.ensureLoaded().then(() => {
    document.getElementById("catalog-meta").textContent =
      `${catalog.meta.cardCount} cartas · ${catalog.meta.setCount} sets · generado ${catalog.meta.generatedAt}. ${catalog.meta.credit}`;
  });

  const msg = document.getElementById("settings-msg");
  document.getElementById("save-key").onclick = () => {
    priceService.setApiKey(document.getElementById("api-key").value);
    priceCredit.hidden = !priceService.getApiKey();
    msg.textContent = priceService.getApiKey() ? "Clave guardada en este navegador." : "Cuidado: campo vacío.";
  };
  document.getElementById("clear-key").onclick = () => {
    priceService.setApiKey("");
    document.getElementById("api-key").value = "";
    priceCredit.hidden = true;
    msg.textContent = "Clave borrada.";
  };
  document.getElementById("clear-cache").onclick = async () => {
    await (await import("./db.js")).clearAllCache();
    msg.textContent = "Caché de precios vaciada (IndexedDB).";
  };
}

/* ------------------ routing ------------------ */

const renderers = { scan: renderScanView, search: renderSearchView, settings: renderSettingsView };

function setTab(name) {
  document.querySelectorAll(".tab").forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active);
  });
  scanner.stop();
  renderers[name]();
}

document.querySelectorAll(".tab").forEach((b) => {
  b.onclick = () => setTab(b.dataset.tab);
});

setTab("scan");
// precarga silenciosa del catálogo para que buscar/verificar sea instantáneo
catalog.ensureLoaded().catch(() => toast("No se pudo precargar el catálogo; se reintentará con la primera búsqueda."));
window.addEventListener("beforeunload", () => scanner.stop());
