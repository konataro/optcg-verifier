/* ============================================================
  Escáner: cámara (getUserMedia) + captura y subida de imagen.
  Todo en memoria, del navegador del usuario, sin subir nada
  a ningún servidor.
  ============================================================ */

export class CameraScanner {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.active = false;
    this.track = null;
    this.capabilities = {};
  }

  /** ¿SOPORTA la cámara este navegador? */
  static isSupported() {
    return !!(navigator.mediaDevices?.getUserMedia);
  }

  async start(videoEl) {
    if (this.active) this.stop();
    this.video = videoEl;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // cámara trasera en móviles
        // pedimos resolución REAL: min obligatorio + ideal 4K (el navegador
        // negocia lo mejor disponible; ideal solo no alcanza para el OCR)
        width: { min: 1280, ideal: 3840 },
        height: { min: 720, ideal: 2160 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.active = true;
    this.track = this.stream.getVideoTracks()[0] || null;
    this.capabilities = this.track?.getCapabilities?.() || {};
    return this.capabilities;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.active = false;
    this.track = null;
    this.capabilities = {};
  }

  /* ---------- zoom digital (donde el hardware lo soporte) ---------- */

  supportsZoom() {
    const caps = this.capabilities;
    return caps && typeof caps.zoom === "object" && caps.zoom.max > caps.zoom.min;
  }

  getZoom() {
    const s = this.track?.getSettings?.() || {};
    return s.zoom ?? this.capabilities?.zoom?.min ?? 1;
  }

  async adjustZoom(delta) {
    if (!this.supportsZoom() || !this.track) return null;
    const caps = this.capabilities.zoom;
    const target = Math.min(caps.max, Math.max(caps.min, this.getZoom() + delta * (caps.step || 0.5)));
    try {
      await this.track.applyConstraints({ advanced: [{ zoom: target }] });
      return target;
    } catch (e) {
      return null;
    }
  }

  /** límites útiles para dibujar el control: { min, max, value } */
  zoomInfo() {
    if (!this.supportsZoom()) return null;
    return {
      min: this.capabilities.zoom.min,
      max: this.capabilities.zoom.max,
      value: this.getZoom(),
    };
  }

  /* ---------- linterna (donde el hardware lo soporte) ---------- */

  supportsTorch() {
    return !!this.capabilities?.torch;
  }

  async setTorch(on) {
    if (!this.supportsTorch() || !this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch {
      return false;
    }
  }

  /** Toma un frame del video, lo recorta al área de la carta y lo devuelve. */
  capture(crop) {
    const v = this.video;
    if (!v || !v.videoWidth) return null;

    const out = document.createElement("canvas");
    const vw = v.videoWidth, vh = v.videoHeight;

    // recorte al marco de guía (proporciones relativas al frame del video)
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (crop) {
      sx = Math.round(vw * crop.x);
      sy = Math.round(vh * crop.y);
      sw = Math.min(vw - sx, Math.round(vw * crop.w));
      sh = Math.min(vh - sy, Math.round(vh * crop.h));
      if (sw < 8 || sh < 8) return null;
    }
    const MAX_W = 1600; // upscaled crops plean mejor texto; 1600 sigue siendo liviano
    const scale = Math.min(1, MAX_W / sw);
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    out.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  /** Recorta exactamente lo que el usuario ve dentro del marco guía (WYSIWYG). */
  captureFrame(frameEl) {
    const crop = cropRectForFrame(this.video, frameEl);
    if (!crop) return null;
    return this.capture(crop);
  }
}

/**
 * Convierte la posición del marco guía (en pantalla) a un recorte
 * relativo del frame del video, compensando el object-fit: cover.
 *
 * Math: con cover, el video se escala por `scale` y se centra;
 * el píxel (fx, fy) de pantalla corresponde a
 *   videoX = (fx - videoLeft + dx) / scale  con  dx = (vw*scale - anchoVisible)/2.
 */
export function cropRectForFrame(video, frameEl) {
  if (!video || !frameEl) return null;
  const vRect = video.getBoundingClientRect();
  const fRect = frameEl.getBoundingClientRect();
  if (!vRect.width || !vRect.height || !fRect.width) return null;
  const vw = video.videoWidth || vRect.width;
  const vh = video.videoHeight || vRect.height;

  const scale = Math.max(vRect.width / vw, vRect.height / vh);
  const dx = (vw * scale - vRect.width) / 2;
  const dy = (vh * scale - vRect.height) / 2;

  const vx = ((fRect.left - vRect.left) + dx) / scale;
  const vy = ((fRect.top - vRect.top) + dy) / scale;
  const fw = fRect.width / scale;
  const fh = fRect.height / scale;

  // clamp al frame real del video
  const x = Math.min(Math.max(vx, 0), vw - 2);
  const y = Math.min(Math.max(vy, 0), vh - 2);
  const w = Math.min(Math.max(fw, 2), vw - x);
  const h = Math.min(Math.max(fh, 2), vh - y);

  return { x: x / vw, y: y / vh, w: w / vw, h: h / vh };
}

/** Carga un File (imagen subida) a un canvas normalizado. */
export function fileToCanvas(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("El archivo no es una imagen válida."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1280;
      const scale = Math.min(1, MAX_W / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
    img.src = url;
  });
}
