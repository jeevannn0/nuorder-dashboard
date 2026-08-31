"""Fetch the published NuORDER color sheet and emit the static lookup table.

Writes site/data/colors.json, consumed by the static GitHub Pages app.

The translation dictionary is read out of app.py via `ast` so the Streamlit app
and the static site can never drift apart. If you edit the dictionary, edit it
in app.py only.
"""

import ast
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP_PY = ROOT / "app.py"
SITE = ROOT / "site"
INDEX = SITE / "index.html"
OUT = SITE / "data" / "colors.json"

# GitHub Pages serves assets with Cache-Control: max-age=600, so a browser can
# hold a stale app.js or styles.css for ten minutes after a deploy and appear to
# ignore a fix. Stamping the references with a content hash makes each deploy
# request a new URL.
STAMPED_ASSETS = ("styles.css", "app.js")

SHEET_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQLtwVng-2paE3JmYRfENRg3_ZEFvCxcZscbZu9fKSrlRkXeWLaZtM6S4G8i3c8wUhA7Xzc0gZJKmDA"
    "/pub?gid=415337850&single=true&output=csv"
)


def extract_from_app_py(name):
    """Pull a module-level literal assignment out of app.py without importing it."""
    tree = ast.parse(APP_PY.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise SystemExit(f"could not find `{name}` in {APP_PY}")


def stamp_assets():
    """Rewrite index.html asset references to include a content hash."""
    html = INDEX.read_text(encoding="utf-8")
    original = html

    for name in STAMPED_ASSETS:
        path = SITE / name
        if not path.exists():
            raise SystemExit(f"missing asset {path}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
        # Matches the bare name or an already-stamped one, so this is idempotent.
        pattern = re.compile(rf'(?P<attr>href|src)="{re.escape(name)}(?:\?v=[^"]*)?"')
        html, count = pattern.subn(
            lambda m: f'{m.group("attr")}="{name}?v={digest}"', html
        )
        if count == 0:
            raise SystemExit(f"could not find a reference to {name} in {INDEX}")
        print(f"stamped     : {name}?v={digest} ({count} reference)")

    if html != original:
        INDEX.write_text(html, encoding="utf-8")


def main():
    translation = extract_from_app_py("translation_dict")
    url = extract_from_app_py("SHEET_CSV_URL")

    print(f"fetching {url[:70]}...")
    with urllib.request.urlopen(url, timeout=120) as resp:
        raw = resp.read()
    print(f"  {len(raw):,} bytes")

    import csv

    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    if reader.fieldnames is None or "COLOR" not in reader.fieldnames:
        raise SystemExit(f"unexpected sheet columns: {reader.fieldnames}")
    if "Color Family" not in reader.fieldnames:
        raise SystemExit(f"missing 'Color Family' column: {reader.fieldnames}")

    families = []
    family_index = {}
    colors = {}
    skipped = 0

    for row in reader:
        color = (row.get("COLOR") or "").strip()
        family = (row.get("Color Family") or "").strip()
        if not color or not family:
            skipped += 1
            continue
        key = color.lower()
        if key in colors:
            continue  # first match wins, matching the Streamlit app
        if family not in family_index:
            family_index[family] = len(families)
            families.append(family)
        colors[key] = family_index[family]

    if not colors:
        raise SystemExit("refusing to write an empty lookup table")

    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": url,
        "families": families,
        "translation": translation,
        "colors": colors,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(text, encoding="utf-8")

    print(f"colors     : {len(colors):,}")
    print(f"families   : {len(families)} {families}")
    print(f"skipped    : {skipped:,} rows (blank color or family)")
    print(f"wrote      : {OUT.relative_to(ROOT)} ({len(text.encode()):,} bytes)")

    stamp_assets()
    return 0


if __name__ == "__main__":
    sys.exit(main())
