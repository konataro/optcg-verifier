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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.active = true;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.active = false;
  }

  /** Toma un frame del video, lo recorta al área de la carta y lo devuelve. */
  capture(crop) {
    const v = this.video;
    if (!v || !v.videoWidth) return null;

    const out = document.createElement("canvas");
    const vw = v.videoWidth, vh = v.videoHeight;

    // recorte al marco de guía (proporciones relativas)
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (crop) {
      sx = Math.round(vw * crop.x);
      sy = Math.round(vh * crop.y);
      sw = Math.round(vw * crop.w);
      sh = Math.round(vh * crop.h);
    }
    const MAX_W = 1280;
    const scale = Math.min(1, MAX_W / sw);
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    out.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }
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
