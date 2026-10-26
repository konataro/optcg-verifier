#!/usr/bin/env python3
"""
Genera el catálogo local de cartas del One Piece TCG (inglés).

Fuente: buhbbl/punk-records (GitHub) — dataset generado con vegapull
contra la cardlist oficial de Bandai, actualizado automáticamente
cada pocos días. Es la fuente estática más fresca disponible
(OP-01 ... OP-17+ extras destacados, EB, PRB, ST, packs especiales).

Uso responsable: este script corre UNA vez por build de datos, nunca en runtime.
Datos e imágenes ©Eiichiro Oda / Shueisha / Toei Animation / Bandai Namco.

Uso:
    python tools/build_catalog.py
"""

import html as _html
import json
import sys
import time
import urllib.request
from pathlib import Path

# Fix para consolas Windows: fuerce UTF-8 en stdout
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data"
OUT_FILE = OUT_DIR / "catalog.json"

REPO = "buhbbl/punk-records"
BRANCH = "main"
BASE_RAW = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/english"
API_CONTENTS = f"https://api.github.com/repos/{REPO}/contents/english/data?ref={BRANCH}"
TIMEOUT = 30

# Mapeo de rarezas vegapull → notación compacta del catálogo de la app
RARITY_MAP = {
    "Common": "C",
    "Uncommon": "UC",
    "Rare": "R",
    "SuperRare": "SR",
    "SecretRare": "SEC",
    "Special": "SP",
    "Leader": "L",
    "Promo": "P",
    "TreasureRare": "TR",
}


def fetch_json(url: str, retries: int = 3):
    """Descarga un JSON con reintentos y backoff respetuoso."""
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "opcg-verifier-catalog-builder/2.0 (educational/personal use)",
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


def main() -> int:
    # 1) meta oficial punk-records (para vigilar frescura)
    manifest = fetch_json(f"{BASE_RAW}/manifest.json")
    generated_iso = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(manifest.get("generated_at", 0))
    )
    print(f"Frescura punk-records: generado {generated_iso} (v{manifest.get('version')})")

    # 2) packs.json → mapa pack_id → {label, title}
    packs = fetch_json(f"{BASE_RAW}/packs.json")
    pack_names = {}
    for pid, p in packs.items():
        tp = p.get("title_parts") or {}
        label, title = tp.get("label"), (tp.get("title") or "").strip()
        if label and title:
            pack_names[pid] = f"{_html.unescape(title)} [{label}]"
        else:
            pack_names[pid] = _html.unescape(title) or pid
    print(f"Packs en packlist: {len(pack_names)}")

    # 3) listado real de archivos descargables (el repo manda)
    files = fetch_json(API_CONTENTS)
    json_files = [f for f in files if f["name"].endswith(".json")]
    print(f"Archivos de packs con cartas: {len(json_files)}")

    cards: dict[str, dict] = {}
    for i, f in enumerate(json_files, 1):
        name = f["name"]
        pack_id = name.replace(".json", "")
        url = f["download_url"]
        print(f"[{i}/{len(json_files)}] {pack_id} ({pack_names.get(pack_id, '?')})...")
        data = fetch_json(url)
        if not isinstance(data, list):
            print(f"  ⓘ formato inesperado en {name}, se omite")
            continue
        for raw in data:
            card = slim_card(raw, pack_names.get(pack_id, ""))
            if card:
                cards.setdefault(card["id"], card)  # 1er pack gana (ordenz natural)
        time.sleep(0.4)  # ritmo amable con GitHub

    # 4) meta del output
    meta = {
        "source": f"github.com/{REPO} (vegapull → en.onepiece-cardgame.com)",
        "upstreamGeneratedAt": generated_iso,
        "credit": "Datos de cartas ©Eiichiro Oda / Shueisha / Toei Animation / BANDAI NAMCO Entertainment Inc.",
        "cardCount": len(cards),
        "setCount": len(json_files),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    payload = {"meta": meta, "cards": sorted(cards.values(), key=lambda c: (c["code"], c["id"]))}

    OUT_DIR.mkdir(exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_mb = OUT_FILE.stat().st_size / 1_000_000
    print(f"\n✔ Catálogo generado: {OUT_FILE} ({len(cards)} cartas, {size_mb:.1f} MB)")

    # 5) sanity-check de sets clave reportados por el usuario
    for probe in ("OP16-080", "OP17-001", "EB05-001"):
        hit = probe in cards
        print(f"  {'✓' if hit else '✗'} {probe}")
    return 0


def slim_card(raw: dict, set_display: str) -> dict | None:
    """Normaliza una carta punk-records al esquema slim de la app."""
    cid, name = raw.get("id"), raw.get("name")
    if not cid or not name or "-" not in str(cid):
        return None
    code = str(cid).split("_")[0]  # EB04-061_p2 → EB04-061
    colors = raw.get("colors") or []
    color = "/".join(colors)
    attrs = raw.get("attributes") or []
    attribute = attrs[0] if attrs else None
    families = raw.get("types") or []
    rarity = RARITY_MAP.get(raw.get("rarity"), raw.get("rarity") or "")

    def clean(text):
        if isinstance(text, str):
            return " ".join(text.split())
        return ""

    return {
        "id": cid,
        "code": code,
        "name": clean(name),
        "rarity": rarity,
        "type": (raw.get("category") or "").upper(),
        "color": color,
        "cost": raw.get("cost"),
        "power": raw.get("power"),
        "counter": clean(str(raw.get("counter"))) if raw.get("counter") is not None else "-",
        "attribute": attribute,
        "family": " / ".join(families),
        "ability": clean(raw.get("effect") or ""),
        "trigger": clean(raw.get("trigger") or ""),
        "setName": clean(set_display),
        "img": raw.get("img_full_url") or "",
    }


if __name__ == "__main__":
    sys.exit(main())
