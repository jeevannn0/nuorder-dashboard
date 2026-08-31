// NuORDER Color Dashboard - static build.
// Mirrors the formatting logic in app.py exactly. See pyTitle() for the
// subtle part: Python's str.title() treats digits as word boundaries.

const NOT_FOUND = "Not found in database";
const MAX_SUGGESTIONS = 8;
// Kept in one place because render() resets the button label on every keystroke.
const COPY_BOTH_LABEL = 'copy both <kbd>⏎</kbd>';
const MAX_BATCH_ROWS_RENDERED = 1000;

// Presentation only. scripts/verify_parity.py asserts every family present in
// colors.json has an entry here, so a new family in the sheet cannot silently
// render without a swatch.
const FAMILY_SWATCH = {
  Black: "#15181d",
  Blue: "#3b82f6",
  Brown: "#8b5a2b",
  Green: "#22c55e",
  Grey: "#9ca3af",
  Orange: "#f97316",
  Pink: "#ec4899",
  Purple: "#a855f7",
  Red: "#ef4444",
  White: "#f4f6f8",
  Yellow: "#eab308",
  "Beige / Neutral": "#d8c4a4",
  Metallic:
    "linear-gradient(135deg, #b9c2cc 0%, #f0f4f8 38%, #8e99a6 62%, #dfe6ed 100%)",
  Multi:
    "conic-gradient(#ef4444, #f97316, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)",
};

const FALLBACK_SWATCH = "#4a5566";

let DATA = null;
let KEYS = [];
let matches = [];
let activeIndex = -1;
let batchResults = [];

/**
 * Faithful port of Python's str.title().
 * Words are delimited by anything that is not a letter, so digits count as
 * boundaries: "3m red" -> "3M Red", "bleuvert 123" -> "Bleuvert 123".
 */
function pyTitle(s) {
  let out = "";
  let prevIsAlpha = false;
  for (const ch of s) {
    const isAlpha = ch.toLowerCase() !== ch.toUpperCase();
    if (isAlpha) {
      out += prevIsAlpha ? ch.toLowerCase() : ch.toUpperCase();
    } else {
      out += ch;
    }
    prevIsAlpha = isAlpha;
  }
  return out;
}

/** Port of get_customer_facing_color() from app.py. */
function getCustomerFacingColor(colorName) {
  if (typeof colorName !== "string") return "";
  const cleaned = colorName.replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const translated = words.map((w) => {
    const hit = DATA.translation[w.toLowerCase()];
    return hit === undefined ? w : hit;
  });
  return pyTitle(translated.slice(0, 3).join(" "));
}

function lookupFamily(rawQuery) {
  const key = rawQuery.trim().toLowerCase();
  // hasOwn, not a bare property read: querying "constructor" or "__proto__"
  // would otherwise hit Object.prototype and report a phantom match with an
  // undefined family. DATA.colors is also re-keyed onto a null prototype at
  // load, so this is belt and braces.
  if (!Object.hasOwn(DATA.colors, key)) {
    return { found: false, family: NOT_FOUND };
  }
  return { found: true, family: DATA.families[DATA.colors[key]] };
}

/**
 * Prefix matches first, then substring matches, capped. One pass over the key
 * list, which is ~116k entries and measures in low single-digit milliseconds.
 */
function findMatches(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2) return [];

  const prefix = [];
  const infix = [];

  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i];
    if (k === q) continue; // exact hit is already shown in the results block
    if (k.startsWith(q)) {
      if (prefix.length < MAX_SUGGESTIONS) prefix.push(k);
    } else if (infix.length < MAX_SUGGESTIONS && k.includes(q)) {
      infix.push(k);
    }
    if (prefix.length >= MAX_SUGGESTIONS) break;
  }

  return prefix.concat(infix).slice(0, MAX_SUGGESTIONS);
}

// --- live refresh -----------------------------------------------------------

/** Minimal RFC 4180 parser: handles quoted fields, escaped quotes and CRLF. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Re-read the published sheet in the browser and rebuild the index.
 * Mirrors scripts/build_data.py: first match wins, blanks skipped.
 */
async function refreshFromSheet() {
  const btn = els.refresh;
  const before = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">↻</span> fetching';

  try {
    const resp = await fetch(DATA.source, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let text = await resp.text();
    // A UTF-8 BOM would glue itself onto the first header cell and break the
    // COLOR column detection.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("sheet looks empty");

    const header = rows[0].map((h) => h.trim());
    const ci = header.indexOf("COLOR");
    const fi = header.indexOf("Color Family");
    if (ci === -1 || fi === -1) {
      throw new Error("expected COLOR and 'Color Family' columns");
    }

    const families = [];
    const famIndex = new Map();
    const colors = Object.create(null);

    for (let r = 1; r < rows.length; r++) {
      const color = (rows[r][ci] || "").trim();
      const family = (rows[r][fi] || "").trim();
      if (!color || !family) continue;
      const key = color.toLowerCase();
      if (key in colors) continue;
      if (!famIndex.has(family)) {
        famIndex.set(family, families.length);
        families.push(family);
      }
      colors[key] = famIndex.get(family);
    }

    const n = Object.keys(colors).length;
    if (n === 0) throw new Error("no usable rows");

    DATA.colors = colors;
    DATA.families = families;
    DATA.generated = new Date().toISOString();
    KEYS = Object.keys(colors);

    setBootStatus(n, families.length, null, "live");
    els.statusRight.textContent = `refreshed: ${new Date().toLocaleString()} (live)`;

    btn.disabled = false;
    btn.innerHTML = "✓ up to date";
    setTimeout(() => {
      btn.innerHTML = before;
    }, 1800);

    // Re-run whatever is on screen against the new index. suggest:false so a
    // background refresh does not pop the completion menu open under the
    // user's cursor.
    if (els.input.value) render({ suggest: false });
    if (batchResults.length) runBatch();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = before;
    // Show the failure, then restore the status line: the old index is still
    // loaded and working, so a permanent error banner would be misleading.
    els.boot.className = "c-red";
    els.boot.textContent = `refresh failed: ${err.message} — still using the loaded index`;
    setTimeout(() => {
      if (lastGoodStatus) setBootStatus(...lastGoodStatus);
    }, 5000);
  }
}

// --- rendering --------------------------------------------------------------

const els = {};

function swatchFor(family) {
  const paint = FAMILY_SWATCH[family] || FALLBACK_SWATCH;
  const span = document.createElement("span");
  span.className = "swatch";
  span.style.background = paint;
  span.setAttribute("aria-hidden", "true");
  return span;
}

let lastGoodStatus = null;

function setBootStatus(count, familyCount, ms, tag) {
  lastGoodStatus = [count, familyCount, ms, tag];
  els.boot.className = "";
  els.boot.textContent = "";
  els.boot.append(
    document.createTextNode("indexed "),
    Object.assign(document.createElement("span"), {
      className: "c-cyan",
      textContent: count.toLocaleString(),
    }),
    document.createTextNode(" colors · "),
    Object.assign(document.createElement("span"), {
      className: "c-cyan",
      textContent: String(familyCount),
    }),
    document.createTextNode(" families")
  );
  if (ms !== null && ms !== undefined) {
    els.boot.append(
      document.createTextNode(" · "),
      Object.assign(document.createElement("span"), {
        className: "c-green",
        textContent: `${ms}ms`,
      })
    );
  }
  if (tag) {
    els.boot.append(
      document.createTextNode(" · "),
      Object.assign(document.createElement("span"), {
        className: "c-green",
        textContent: tag,
      })
    );
  }
  els.statusLeft.textContent = `index: ${count.toLocaleString()} colors`;
}

function renderSuggestions(rawQuery) {
  matches = findMatches(rawQuery);
  activeIndex = -1;
  els.suggest.textContent = "";

  if (matches.length === 0) {
    els.suggest.hidden = true;
    els.input.setAttribute("aria-expanded", "false");
    els.input.removeAttribute("aria-activedescendant");
    return;
  }

  const q = rawQuery.trim().toLowerCase();

  matches.forEach((key, i) => {
    const li = document.createElement("li");
    li.id = `sug-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");

    const family = DATA.families[DATA.colors[key]];
    li.appendChild(swatchFor(family));

    // Suggestions render uppercase. The lookup is case-insensitive and
    // title-cases its output, so display casing cannot change the result.
    // Slice the key first and uppercase each piece independently: uppercasing
    // can change string length (ß -> SS), so slicing an uppercased whole by
    // key indices could misalign the highlight.
    const at = key.indexOf(q);
    const name = document.createElement("span");
    name.className = "s-name";
    if (at === -1) {
      name.textContent = key.toUpperCase();
    } else {
      name.append(
        document.createTextNode(key.slice(0, at).toUpperCase()),
        Object.assign(document.createElement("b"), {
          textContent: key.slice(at, at + q.length).toUpperCase(),
        }),
        document.createTextNode(key.slice(at + q.length).toUpperCase())
      );
    }
    li.appendChild(name);

    const fam = document.createElement("span");
    fam.className = "s-fam";
    fam.textContent = family;
    li.appendChild(fam);

    li.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep focus in the input
      accept(key);
    });

    els.suggest.appendChild(li);
  });

  const foot = document.createElement("li");
  foot.className = "suggest-foot";
  foot.setAttribute("role", "presentation");
  foot.innerHTML =
    "<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>tab</kbd> complete · <kbd>esc</kbd> dismiss";
  els.suggest.appendChild(foot);

  els.suggest.hidden = false;
  els.input.setAttribute("aria-expanded", "true");
}

function setActive(next) {
  const options = els.suggest.querySelectorAll('[role="option"]');
  if (options.length === 0) return;

  if (activeIndex >= 0 && options[activeIndex]) {
    options[activeIndex].setAttribute("aria-selected", "false");
  }
  activeIndex = (next + options.length) % options.length;
  const el = options[activeIndex];
  el.setAttribute("aria-selected", "true");
  el.scrollIntoView({ block: "nearest" });
  els.input.setAttribute("aria-activedescendant", el.id);
}

function closeSuggestions() {
  els.suggest.hidden = true;
  els.suggest.textContent = "";
  matches = [];
  activeIndex = -1;
  els.input.setAttribute("aria-expanded", "false");
  els.input.removeAttribute("aria-activedescendant");
}

function accept(key) {
  // Show uppercase only when it round-trips back to the key. For characters
  // like ß (uppercase SS) it would not, and the accepted suggestion would then
  // fail its own lookup.
  const upper = key.toUpperCase();
  els.input.value = upper.toLowerCase() === key ? upper : key;
  closeSuggestions();
  render({ suggest: false });
  els.input.focus();
}

function render(opts = {}) {
  const raw = els.input.value;
  els.clear.hidden = raw.length === 0;

  if (!raw.trim()) {
    els.results.hidden = true;
    closeSuggestions();
    return;
  }

  const formatted = getCustomerFacingColor(raw);
  const { found, family } = lookupFamily(raw);

  els.facing.textContent = formatted;

  els.family.textContent = "";
  els.family.className = found ? "val is-found" : "val is-missing";
  if (found) els.family.appendChild(swatchFor(family));
  els.family.appendChild(document.createTextNode(family));

  // Paste line. The separator is a real tab character in the DOM so that
  // selecting the line by hand and hitting ctrl+c yields the same thing the
  // copy button produces. The visible marker is drawn by a CSS pseudo-element,
  // which is not part of the text and therefore never lands in the clipboard.
  els.paste.textContent = "";
  els.paste.append(
    document.createTextNode(formatted),
    Object.assign(document.createElement("span"), {
      className: "tab-glyph",
      textContent: "\t",
    }),
    document.createTextNode(family)
  );

  els.results.hidden = false;
  resetBtn(els.copyBtn, COPY_BOTH_LABEL);

  if (opts.suggest === false) {
    els.dym.hidden = true;
    els.warn.hidden = found;
    return;
  }

  renderSuggestions(raw);

  // Only nag about adding it to the sheet when there is genuinely nothing
  // close. If a near match exists it is far more likely a typo, and telling
  // someone to add a color that is already there would be misleading.
  els.warn.hidden = found || matches.length > 0;

  // When there is no exact hit, offer the closest candidate explicitly.
  if (!found && matches.length > 0) {
    els.dym.textContent = "did you mean ";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dym-btn";
    btn.textContent = matches[0].toUpperCase();
    btn.addEventListener("click", () => accept(matches[0]));
    els.dym.appendChild(btn);
    els.dym.appendChild(document.createTextNode(" ?"));
    els.dym.hidden = false;
  } else {
    els.dym.hidden = true;
  }
}

// --- batch ------------------------------------------------------------------

function runBatch() {
  // A multi-column Excel paste arrives as tab-separated lines; the color name
  // is the first cell. This also keeps tabs out of `raw`, which would
  // otherwise shift columns in the TSV exports below. (Two sheet rows do
  // contain literal tabs in COLOR; those can still be matched in the single
  // lookup tab, where input is taken verbatim.)
  const lines = els.batchInput.value
    .split(/\r?\n/)
    .map((l) => l.split("\t")[0].trim())
    .filter((l) => l.length > 0);

  batchResults = lines.map((raw) => {
    const { found, family } = lookupFamily(raw);
    return { raw, facing: getCustomerFacingColor(raw), family, found };
  });

  const total = batchResults.length;
  const missing = batchResults.filter((r) => !r.found).length;

  if (total === 0) {
    els.batchOut.hidden = true;
    els.batchStats.textContent = "nothing to process";
    return;
  }

  els.batchStats.textContent = `${total} row${total === 1 ? "" : "s"} · ${
    total - missing
  } matched · ${missing} missing`;

  const shown = Math.min(total, MAX_BATCH_ROWS_RENDERED);
  const frag = document.createDocumentFragment();

  for (let i = 0; i < shown; i++) {
    const r = batchResults[i];
    const tr = document.createElement("tr");
    if (!r.found) tr.className = "is-missing";

    const n = document.createElement("td");
    n.className = "col-n";
    n.textContent = String(i + 1);

    const raw = document.createElement("td");
    raw.className = "raw";
    raw.textContent = r.raw;

    const facing = document.createElement("td");
    facing.className = "facing";
    facing.textContent = r.facing;

    const fam = document.createElement("td");
    fam.className = "fam";
    const wrap = document.createElement("span");
    wrap.className = "fam-cell";
    if (r.found) wrap.appendChild(swatchFor(r.family));
    wrap.appendChild(document.createTextNode(r.found ? r.family : "✗ not found"));
    fam.appendChild(wrap);

    tr.append(n, raw, facing, fam);
    frag.appendChild(tr);
  }

  els.batchRows.textContent = "";
  els.batchRows.appendChild(frag);

  if (total > shown) {
    els.batchNote.textContent = `showing the first ${shown.toLocaleString()} of ${total.toLocaleString()} rows — copy and download include all of them.`;
    els.batchNote.hidden = false;
  } else {
    els.batchNote.hidden = true;
  }

  els.batchOut.hidden = false;
}

function batchTSV() {
  return batchResults.map((r) => `${r.facing}\t${r.family}`).join("\n");
}

function batchAllColumns() {
  return [
    "raw_input\tcustomer_facing_color\tcolor_family",
    ...batchResults.map((r) => `${r.raw}\t${r.facing}\t${r.family}`),
  ].join("\n");
}

function batchMissing() {
  return batchResults
    .filter((r) => !r.found)
    .map((r) => r.raw)
    .join("\n");
}

function csvCell(v) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCSV() {
  const csv = [
    "raw_input,customer_facing_color,color_family",
    ...batchResults.map((r) =>
      [r.raw, r.facing, r.family].map(csvCell).join(",")
    ),
  ].join("\r\n");

  const blob = new Blob([`\ufeff${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nuorder-colors.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- clipboard --------------------------------------------------------------

function resetBtn(btn, html) {
  btn.classList.remove("is-done", "is-failed");
  clearTimeout(btnTimers.get(btn));
  btn.innerHTML = html;
}

/**
 * Write to the clipboard, returning whether it actually worked.
 *
 * The execCommand fallback deliberately builds its own textarea and selects it
 * explicitly. An unfocused or unselected element makes execCommand fall back to
 * the current document selection, which would silently copy whatever happens to
 * be highlighted on the page instead of the value asked for.
 */
async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  // Offscreen rather than invisible: an opacity-0 element is not reliably
  // selectable, and a failed selection is what causes the wrong-content copy.
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.setAttribute("aria-hidden", "true");
  ta.setAttribute("tabindex", "-1");

  const previous = document.activeElement;
  document.body.appendChild(ta);

  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    ta.remove();
    if (previous && typeof previous.focus === "function") {
      previous.focus({ preventScroll: true });
    }
  }
  return ok;
}

// Per-button revert timers. Without cancelling the pending timer, a second
// click inside the flash window captures "copied ✓" as the label to restore,
// leaving the button stuck on the success text.
const btnTimers = new WeakMap();

function flashBtn(btn, label, ms) {
  if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
  clearTimeout(btnTimers.get(btn));
  btn.innerHTML = label;
  btnTimers.set(
    btn,
    setTimeout(() => {
      btn.classList.remove("is-done", "is-failed");
      btn.innerHTML = btn.dataset.label;
    }, ms)
  );
}

async function copyText(text, btn, doneLabel) {
  const ok = await writeClipboard(text);
  btn.classList.toggle("is-done", ok);
  btn.classList.toggle("is-failed", !ok);
  flashBtn(btn, ok ? doneLabel : "copy failed", ok ? 1400 : 2200);
}

function copyPasteLine() {
  // els.paste already holds the exact text, tab included, so the button and a
  // manual selection cannot disagree.
  copyText(els.paste.textContent, els.copyBtn, "copied both ✓");
}

// --- keyboard ---------------------------------------------------------------

function onKeyDown(e) {
  const open = !els.suggest.hidden && matches.length > 0;

  if (e.key === "ArrowDown" && open) {
    e.preventDefault();
    setActive(activeIndex + 1);
  } else if (e.key === "ArrowUp" && open) {
    e.preventDefault();
    setActive(activeIndex - 1);
  } else if (e.key === "Tab" && open) {
    e.preventDefault();
    accept(matches[activeIndex >= 0 ? activeIndex : 0]);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (open && activeIndex >= 0) {
      accept(matches[activeIndex]);
    } else if (!els.results.hidden) {
      copyPasteLine();
    }
  } else if (e.key === "Escape") {
    if (open) closeSuggestions();
    else if (els.input.value) {
      els.input.value = "";
      render();
    }
  }
}

function switchTab(which) {
  const single = which === "single";
  els.tabSingle.classList.toggle("is-active", single);
  els.tabBatch.classList.toggle("is-active", !single);
  els.tabSingle.setAttribute("aria-selected", String(single));
  els.tabBatch.setAttribute("aria-selected", String(!single));
  els.panelSingle.hidden = !single;
  els.panelBatch.hidden = single;
  if (single) els.input.focus();
  else els.batchInput.focus();
}

// --- init -------------------------------------------------------------------

async function init() {
  els.input = document.getElementById("query");
  els.clear = document.getElementById("clear-btn");
  els.suggest = document.getElementById("suggest");
  els.results = document.getElementById("results");
  els.facing = document.getElementById("facing");
  els.family = document.getElementById("family");
  els.warn = document.getElementById("warn");
  els.dym = document.getElementById("dym");
  els.paste = document.getElementById("paste");
  els.copyBtn = document.getElementById("copy-btn");
  els.boot = document.getElementById("boot-status");
  els.refresh = document.getElementById("refresh-btn");
  els.statusLeft = document.getElementById("status-left");
  els.statusRight = document.getElementById("status-right");

  els.tabSingle = document.getElementById("tab-single");
  els.tabBatch = document.getElementById("tab-batch");
  els.panelSingle = document.getElementById("panel-single");
  els.panelBatch = document.getElementById("panel-batch");

  els.batchInput = document.getElementById("batch-input");
  els.batchRun = document.getElementById("batch-run");
  els.batchClear = document.getElementById("batch-clear");
  els.batchStats = document.getElementById("batch-stats");
  els.batchOut = document.getElementById("batch-out");
  els.batchRows = document.getElementById("batch-rows");
  els.batchNote = document.getElementById("batch-note");

  els.copyBtn.addEventListener("click", copyPasteLine);
  els.refresh.addEventListener("click", refreshFromSheet);
  els.tabSingle.addEventListener("click", () => switchTab("single"));
  els.tabBatch.addEventListener("click", () => switchTab("batch"));

  // Standard tablist keyboard behaviour: arrows move between tabs.
  for (const tab of [els.tabSingle, els.tabBatch]) {
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = tab === els.tabSingle ? "batch" : "single";
        switchTab(next);
        (next === "single" ? els.tabSingle : els.tabBatch).focus();
      }
    });
  }

  els.clear.addEventListener("click", () => {
    els.input.value = "";
    render();
    els.input.focus();
  });

  els.batchRun.addEventListener("click", runBatch);
  els.batchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runBatch();
    }
  });
  els.batchClear.addEventListener("click", () => {
    els.batchInput.value = "";
    batchResults = [];
    els.batchOut.hidden = true;
    els.batchStats.textContent = "";
    els.batchInput.focus();
  });

  document
    .getElementById("copy-tsv")
    .addEventListener("click", (e) => copyText(batchTSV(), e.currentTarget, "✓ copied"));
  document
    .getElementById("copy-all")
    .addEventListener("click", (e) =>
      copyText(batchAllColumns(), e.currentTarget, "✓ copied")
    );
  document.getElementById("copy-missing").addEventListener("click", (e) => {
    const text = batchMissing();
    if (!text) {
      // Nothing to copy. Flash the label without touching the clipboard,
      // which would otherwise be wiped by writing an empty string.
      flashBtn(e.currentTarget, "none missing", 1400);
      return;
    }
    copyText(text, e.currentTarget, "✓ copied");
  });
  document.getElementById("download-csv").addEventListener("click", downloadCSV);

  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", () => {
      copyText(els[btn.dataset.copy].textContent, btn, "copied ✓");
    });
  }

  document.addEventListener("click", (e) => {
    if (!els.suggest.contains(e.target) && e.target !== els.input) {
      closeSuggestions();
    }
  });

  const t0 = performance.now();
  try {
    const resp = await fetch("data/colors.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    DATA = await resp.json();
  } catch (err) {
    els.boot.className = "c-red";
    els.boot.textContent = `error: could not load data/colors.json (${err.message})`;
    els.statusLeft.textContent = "index: failed";
    return;
  }

  // JSON.parse yields a plain object whose prototype chain leaks names like
  // "constructor" into `in` checks and property reads. Re-key onto a null
  // prototype so the index behaves like a real map.
  DATA.colors = Object.assign(Object.create(null), DATA.colors);

  KEYS = Object.keys(DATA.colors);
  setBootStatus(
    KEYS.length,
    DATA.families.length,
    Math.round(performance.now() - t0),
    null
  );
  els.statusRight.textContent = `rebuilt: ${new Date(
    DATA.generated
  ).toLocaleString()}`;
  els.refresh.hidden = false;

  els.input.disabled = false;
  els.input.addEventListener("input", () => render());
  els.input.addEventListener("keydown", onKeyDown);
  els.input.focus();
}

document.addEventListener("DOMContentLoaded", init);
