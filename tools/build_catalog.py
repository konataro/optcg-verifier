#!/usr/bin/env python3
"""
Genera el catálogo local de cartas del One Piece TCG (inglés).

Descarga los datasets JSON de apitcg/one-piece-tcg-data (GitHub),
los normaliza a un esquema slim y los fusiona en un único
data/catalog.json listo para ser servido por la SPA.

Uso responsable: este script corre UNA vez por build de datos, nunca en runtime.
Los datos provienen de la web oficial de Bandai vía apitcg;
datos e imágenes ©Eiichiro Oda / Shueisha / Toei Animation / Bandai Namco.

Uso:
    python tools/build_catalog.py
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

# Fix para consolas Windows (cp1252): fuerza UTF-8 en stdout
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data"
OUT_FILE = OUT_DIR / "catalog.json"

REPO_API = "https://api.github.com/repos/apitcg/one-piece-tcg-data/contents/cards/en"
TIMEOUT = 30


def fetch_json(url: str, retries: int = 3):
    """Descarga un JSON con reintentos y backoff respetuoso."""
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "opcg-verifier-catalog-builder/1.0 (educational/personal use)",
                    "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            wait = 2 ** attempt  # backoff exponencial: 1s, 2s, 4s
            print(f"  reintento {attempt + 1}/{retries} tras error: {err} (espero {wait}s)")
            time.sleep(wait)
    raise RuntimeError(f"No se pudo descargar {url}: {last_err}")


def slim_card(raw: dict) -> dict | None:
    """Normaliza una carta del dataset apitcg al esquema slim de la app."""
    if not raw.get("id") or not raw.get("code"):
        return None

    attr = raw.get("attribute") or {}
    attribute = attr.get("name") if isinstance(attr, dict) else None
    if attribute and attribute not in ("Slash", "Strike", "Ranged", "Special", "Wisdom"):
        attribute = None  # eventos/stages no tienen atributo real

    img = (raw.get("images") or {}).get("large") or (raw.get("images") or {}).get("small")
    set_info = raw.get("set") or {}

    def clean(text):
        if not isinstance(text, str):
            return ""
        # colapsa saltos de línea/espacios que trae el scraping del site de Bandai
        return " ".join(text.split())

    name = clean(raw.get("name"))

    return {
        "id": raw["id"],
        "code": raw["code"],
        "name": name,
        "rarity": raw.get("rarity") or "",
        "type": (raw.get("type") or "").upper(),
        "color": raw.get("color") or "",
        "cost": raw.get("cost"),
        "power": raw.get("power"),
        "counter": clean(str(raw.get("counter") or "")) if raw.get("counter") is not None else "-",
        "attribute": attribute,
        "family": clean(raw.get("family") or ""),
        "ability": clean(raw.get("ability") or ""),
        "trigger": clean(raw.get("trigger") or ""),
        "setName": clean(set_info.get("name") or ""),
        "img": img or "",
    }


def main() -> int:
    print("Listando archivos del dataset apitcg/one-piece-tcg-data (cards/en)...")
    files = fetch_json(REPO_API)
    json_files = [f["download_url"] for f in files if f["name"].endswith(".json")]
    print(f"Encontrados {len(json_files)} archivos de sets.")

    cards: dict[str, dict] = {}
    for i, url in enumerate(json_files, 1):
        set_name = url.rsplit("/", 1)[-1].replace(".json", "")
        print(f"[{i}/{len(json_files)}] descargando {set_name}...")
        data = fetch_json(url)
        if not isinstance(data, list):
            print(f"  ⓘ formato inesperado en {set_name}, se omite")
            continue
        for raw in data:
            card = slim_card(raw)
            if card:
                cards[card["id"]] = card
        time.sleep(0.5)  # ritmo amable con GitHub

    payload = {
        "meta": {
            "source": "github.com/apitcg/one-piece-tcg-data (datos de en.onepiece-cardgame.com)",
            "credit": "Datos de cartas ©Eiichiro Oda / Shueisha / Toei Animation / BANDAI NAMCO Entertainment Inc.",
            "cardCount": len(cards),
            "setCount": len(json_files),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "cards": sorted(cards.values(), key=lambda c: (c["code"], c["id"])),
    }

    OUT_DIR.mkdir(exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_mb = OUT_FILE.stat().st_size / 1_000_000
    print(f"\n✔ Catálogo generado: {OUT_FILE} ({len(cards)} cartas, {size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
