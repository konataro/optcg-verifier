/* ============================================================
  Registro del Service Worker + aviso de actualización.
  Va como script normal (defer) para que corra lo antes posible
  sin bloquear el primer render.
  ============================================================ */

function showToast(msg, ms = 6000) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      // si aparece un SW nuevo esperando, ofrecemos recargar
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            showToast("🔄 Hay una versión nueva. Recarga la página para actualizar.", 10000);
          }
        });
      });
    }).catch(() => {
      /* sin SW la app sigue funcionando: es un plus, no un requisito */
    });

    // al tomar control de un SW nuevo (p.ej. tras skipWaiting) recargamos una vez
    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshed) return;
      refreshed = true;
      location.reload();
    });
  });
}
