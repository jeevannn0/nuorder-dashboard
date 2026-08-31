# NuORDER Color Dashboard

Paste a raw vendor color, get back the **Customer Facing Color** and its
**Color Family**, plus a tab-separated line ready to paste into NuORDER.

There are two ways to run it, sharing one source of truth for the logic.

| | Static site (GitHub Pages) | Streamlit app (local) |
|---|---|---|
| Entry point | `site/index.html` | `app.py` |
| Data | `site/data/colors.json`, rebuilt daily in CI, plus on-demand live refresh | read live from the sheet, 60s cache |
| Needs a server | no | yes (Python) |

## What the static site does

**Single lookup** with shell-style completion over the whole index. Prefix
matches rank above substring matches, capped at 8. Arrow keys move, `tab`
completes, `enter` copies, `esc` dismisses. A near miss offers the real
spelling instead of dead-ending, so a typo no longer looks like a missing
color.

**Batch mode** takes one raw color per line — paste a column straight out of
Excel. You get a table of `raw_input`, `customer_facing_color` and
`color_family` with unmatched rows flagged, plus four outputs: the two NuORDER
columns as TSV, all three columns, just the unmatched inputs (handy for
appending to the sheet), or a `.csv` download. 5,000 rows process in about
20ms; the table renders the first 1,000 while copy and download cover
everything.

**Live refresh** re-reads the published sheet in the browser and rebuilds the
index in place, which restores the always-current behaviour of the Streamlit
app's 60-second cache. It works because the published sheet sends
`Access-Control-Allow-Origin: *`. The client-side CSV parse was checked against
`build_data.py` and produces an identical index: same 116,508 colors, same 14
families in the same order, zero family mismatches.

**Family swatches** rather than a coloured status card, since the family is
data and not a success signal.

## Static site

Deployed by `.github/workflows/deploy.yml` on every push to `main`, plus a
daily scheduled run that re-pulls the Google Sheet. No server required, so it
works on GitHub Pages.

Preview it locally:

```bash
python scripts/build_data.py          # writes site/data/colors.json
python -m http.server -d site 8000    # then open http://localhost:8000
```

A plain `file://` open will not work, because the app `fetch`es its data file.

## Streamlit app

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Windows
.venv\Scripts\python -m streamlit run app.py
```

## How the two stay in sync

`app.py` is the single source of truth for the formatting rules.
`scripts/build_data.py` reads `translation_dict` and `SHEET_CSV_URL` out of it
with `ast.literal_eval`, so the static build cannot drift from the Streamlit
app. Edit the dictionary in `app.py` only.

`scripts/verify_parity.py` then runs several thousand real colors plus edge
cases through both the Python and JavaScript implementations and fails if any
result differs. CI runs it before every deploy.

The tricky case it pins down is `str.title()`: Python treats digits as word
boundaries, so `3m red` becomes `3M Red`. `pyTitle()` in `site/app.js`
reproduces that.

## Data

Source is a published Google Sheet (`COLOR`, `Notes 2`, `Color Family`).
Roughly 116,000 colors across 14 families. The build reduces the 4.2MB CSV to
about 2.2MB of JSON by dropping unused columns and interning family names,
which compresses to ~530KB over the wire.

Note that the published sheet is readable by anyone with the URL, and the
static build bakes every color mapping into a public file.

## Known quirk

Punctuation is stripped rather than replaced with a space, so `Bleu/Vert`
collapses to the single token `Bleuvert` and skips translation, giving
`Bleuvert` instead of `Blue Green`. Both implementations behave identically
here. Changing it means changing the regex in `app.py` and re-running
`verify_parity.py`.
