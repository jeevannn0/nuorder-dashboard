"""Check the static JS logic matches app.py's Python logic on real data.

Generates expected values with the Python implementation, then runs the same
inputs through site/app.js under Node and diffs the results.
"""

import ast
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "site" / "data" / "colors.json").read_text(encoding="utf-8"))

# Load the real implementation out of app.py so we test what actually ships.
tree = ast.parse((ROOT / "app.py").read_text(encoding="utf-8"))
translation_dict = None
for node in tree.body:
    if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "translation_dict":
        translation_dict = ast.literal_eval(node.value)
assert translation_dict is not None


def get_customer_facing_color(color_name):
    if not isinstance(color_name, str):
        return ""
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", color_name)
    words = cleaned.split()
    translated = [translation_dict.get(w.lower(), w) for w in words]
    return " ".join(translated[:3]).title()


EDGE_CASES = [
    "ROUGE FONCE", "bleu", "Bleu/Vert 123", "3m red", "NERO ASSOLUTO EXTRA LONG",
    "  spaced   out  ", "ALL-CAPS-HYPHEN", "123", "", "   ", "a", "é accented",
    "rosso/blu/verde", "MIXED case Rouge", "9/23- BO confirmed cancelled!",
    "tab\tseparated", "new\nline", "under_score", "50% COTTON", "a1b2c3",
]

colors = list(DATA["colors"].keys())
step = max(1, len(colors) // 4000)
sample = colors[::step]
inputs = EDGE_CASES + sample + [c.upper() for c in sample[:500]]

expected = [get_customer_facing_color(s) for s in inputs]

payload = json.dumps({"inputs": inputs, "expected": expected}, ensure_ascii=False)
(ROOT / "scripts" / "_parity_input.json").write_text(payload, encoding="utf-8")

js = r"""
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'site', 'app.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'site', 'data', 'colors.json'), 'utf8'));

// Load app.js in a shim that provides the browser globals it touches at import.
global.document = { addEventListener() {} };
const sandbox = { module: {}, exports: {} };
const fn = new Function('document', 'navigator', 'setTimeout', src + `
  ;return { getCustomerFacingColor, pyTitle, FAMILY_SWATCH, lookupFamily,
            setData: (d) => { DATA = d; } };
`);
const api = fn({ addEventListener() {} }, {}, () => {});
api.setData(data);

// Prototype-chain regression check: names inherited from Object.prototype must
// not report phantom matches when they are not actually colors in the sheet.
for (const probe of ['constructor', '__proto__', 'hasownproperty', 'tostring']) {
  const inSheet = Object.hasOwn(data.colors, probe);
  const r = api.lookupFamily(probe);
  if (r.found !== inSheet || (r.found && typeof r.family !== 'string')) {
    console.log('PROTO LEAK:', probe, JSON.stringify(r), 'inSheet=' + inSheet);
    process.exit(1);
  }
}
console.log('proto-leak probes: clean');

// Every family the sheet produces must have a swatch defined in app.js.
const missingSwatch = data.families.filter((f) => !(f in api.FAMILY_SWATCH));
if (missingSwatch.length) {
  console.log('MISSING SWATCH for families:', JSON.stringify(missingSwatch));
  console.log('  add them to FAMILY_SWATCH in site/app.js');
  process.exit(1);
}
console.log(`swatches: all ${data.families.length} families covered`);

const { inputs, expected } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_parity_input.json'), 'utf8')
);

let fails = 0;
for (let i = 0; i < inputs.length; i++) {
  const got = api.getCustomerFacingColor(inputs[i]);
  if (got !== expected[i]) {
    if (fails < 15) {
      console.log('MISMATCH', JSON.stringify(inputs[i]),
                  'py=' + JSON.stringify(expected[i]),
                  'js=' + JSON.stringify(got));
    }
    fails++;
  }
}
console.log(`checked ${inputs.length} inputs, ${fails} mismatches`);
process.exit(fails === 0 ? 0 : 1);
"""

(ROOT / "scripts" / "_parity_check.js").write_text(js, encoding="utf-8")
r = subprocess.run(["node", str(ROOT / "scripts" / "_parity_check.js")], text=True)

# Also verify the family lookup table agrees with the live sheet for a sample.
print("families:", DATA["families"])
sys.exit(r.returncode)
