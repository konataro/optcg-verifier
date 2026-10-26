# 🏴‍☠️ OPTCG Verifier

Web app para **identificar y valorar cartas del One Piece Card Game** a través de la
cámara o de imágenes, 100% en el navegador, sin backend y con **uso responsable de APIs gratuitas**.

## ✨ Qué hace

1. **Escanear carta** con la cámara del móvil/PC o subiendo una foto.
2. **OCR en tu navegador** (Tesseract.js, vía CDN) para leer el código de la carta (p. ej. `OP09-004`)
   con corrección automática de confusiones típicas del OCR y fallback por nombre con búsqueda difusa.
3. **Ficha oficial** completa: nombre, set, rareza, tipo, coste, poder, counter, atributo, familia,
   efecto, trigger e imagen oficial — comparadas **lado a lado** con tu captura.
4. **Verificación básica**: si un código no existe en el catálogo oficial, la app te avisa
   (posible carta falsificada, de otro idioma o mal impresa). *No certifica autenticidad*; te da la
   ficha para comparar tú mismo.
5. **Precio de mercado** (opcional) vía la API gratuita de [TCG Price Lookup](https://tcgpricelookup.com/tcg-api),
   con **caché local de 24 h** por carta para estirar la cuota gratuita.

## 🚀 Cómo arrancarla

No necesita Node ni build. Con Python ya instalado basta:

```powershell
cd opcg-verifier
python -m http.server 8000
# abre http://localhost:8000
```

> La cámara requiere contexto seguro: `localhost` vale para pruebas; en producción
> despliega con HTTPS (GitHub Pages, Netlify, Vercel — plan gratuito).

## 🗂 Estructura

```
opcg-verifier/
├─ index.html            # SPA única (+= manifest, apple-touch-icon, registro SW)
├─ manifest.webmanifest  # PWA: nombre, iconos, standalone
├─ sw.js                 # service worker: app shell offline + cache de imágenes acotada
├─ icons/                # iconos 192/512 (con variante maskable) — generados por tools/make_icons.py
├─ css/style.css         # tema oscuro, mobile-first
├─ js/
│  ├─ app.js             # ruteo, flujo de escaneo, vistas
│  ├─ pwa.js             # registro del SW + aviso de nueva versión
│  ├─ catalog.js         # carga + índices + búsqueda difusa del catálogo
│  ├─ ocr.js             # Tesseract.js (CDN) + extracción/corrección de códigos
│  ├─ scanner.js         # cámara getUserMedia + captura a canvas
│  ├─ prices.js          # API de precios con cola, backoff y caché
│  └─ db.js              # IndexedDB (caché de precios)
├─ data/catalog.json     # catálogo generado (3.000+ cartas, 32 sets, ~1.7 MB)
├─ tools/build_catalog.py  # regenera data/catalog.json desde apitcg/one-piece-tcg-data
└─ tools/make_icons.py     # regenera los iconos PWA si cambia el diseño
```

## 🧭 Uso responsable de APIs (diseñado así, no prometido así)

| Fuente | Uso | Salvaguardas |
|---|---|---|
| **Catálogo apitcg** (GitHub) | descargado **una vez por build** con `tools/build_catalog.py` | en runtime: **0 llamadas** |
| **TCG Price Lookup** (free: 100 req/día) | precios bajo demanda | caché IndexedDB 24 h · espaciado ≥ 1.1 s · backoff ante 429/5xx · crédito visible "Powered by TCG Price Lookup" |
| **Tesseract.js** (CDN jsDelivr) | OCR | se carga bajo demanda, solo cuando escaneas |
| **Imágenes de cartas** (CDN de Bandai) | ficha visual | carga directa; si el hotlinking falla, proxy [wsrv.nl](https://wsrv.nl) con su propia caché |
| **Tu cámara / tus fotos** | escaneo local | **ninguna imagen sale de tu navegador** |

La clave API se guarda solo en `localStorage` de tu navegador; nunca se envía a un
tercero distinto de la propia API de precios.

## 🔑 Conseguir la clave de precios

1. Crea una cuenta gratis en [tcgpricelookup.com/tcg-api](https://tcgpricelookup.com/tcg-api).
2. Copia la clave (`tk_live_…`).
3. En la app: **Ajustes → pega la clave → Guardar**.

Sin clave, la app funciona igualmente (identificación y fichas); solo no muestra precios.

## 🔄 Actualizar el catálogo

Cuando salgan sets nuevos:

```powershell
python tools/build_catalog.py
```

The script descarga los JSON de `apitcg/one-piece-tcg-data` (con reintentos
y ritmo moderado) y reescribe `data/catalog.json`.

## ⚖️ Créditos y aviso

- Datos de cartas: [apitcg/one-piece-tcg-data](https://github.com/apitcg/one-piece-tcg-data), derivados de la
  [cardlist oficial de Bandai](https://en.onepiece-cardgame.com/cardlist/).
- Precios: [TCG Price Lookup](https://tcgpricelookup.com).
- **One Piece Card Game © Eiichiro Oda / Shueisha / Toei Animation / BANDAI NAMCO Entertainment Inc.**
- Proyecto educativo/personal, sin fines comerciales. La app no autoriza el uso comercial de precios
  (el tier gratuito de TCG Price Lookup es no-comercial) ni certifica autenticidad de cartas.
