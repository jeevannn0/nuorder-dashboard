// NuORDER Color Dashboard - static build.
// Mirrors the formatting logic in app.py exactly. See pyTitle() for the
// subtle part: Python's str.title() treats digits as word boundaries.

const NOT_FOUND = "Not found in database";
const MAX_SUGGESTIONS = 8;

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
  const idx = DATA.colors[key];
  if (idx === undefined) return { found: false, family: NOT_FOUND };
  return { found: true, family: DATA.families[idx] };
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

// --- rendering ---

const els = {};

function swatchFor(family) {
  const paint = FAMILY_SWATCH[family] || FALLBACK_SWATCH;
  const span = document.createElement("span");
  span.className = "swatch";
  span.style.background = paint;
  span.setAttribute("aria-hidden", "true");
  return span;
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
    const shown = key.toUpperCase();
    const at = key.indexOf(q);
    const name = document.createElement("span");
    name.className = "s-name";
    if (at === -1) {
      name.textContent = shown;
    } else {
      name.append(
        document.createTextNode(shown.slice(0, at)),
        Object.assign(document.createElement("b"), {
          textContent: shown.slice(at, at + q.length),
        }),
        document.createTextNode(shown.slice(at + q.length))
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
  els.input.value = key.toUpperCase();
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

  // Paste line, with the tab rendered visibly but copied as a real tab.
  els.paste.textContent = "";
  els.paste.append(
    document.createTextNode(formatted),
    Object.assign(document.createElement("span"), {
      className: "tab-glyph",
      textContent: "⇥",
      ariaHidden: "true",
    }),
    document.createTextNode(family)
  );

  els.results.hidden = false;
  resetBtn(els.copyBtn, 'copy <kbd>⏎</kbd>');

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

function resetBtn(btn, html) {
  btn.classList.remove("is-done");
  btn.innerHTML = html;
}

async function copyText(text, btn, doneLabel) {
  const before = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  btn.classList.add("is-done");
  btn.innerHTML = doneLabel;
  setTimeout(() => resetBtn(btn, before), 1400);
}

function copyPasteLine() {
  const family = els.family.textContent;
  copyText(`${els.facing.textContent}\t${family}`, els.copyBtn, "copied ✓");
}

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
  els.statusLeft = document.getElementById("status-left");
  els.statusRight = document.getElementById("status-right");

  els.copyBtn.addEventListener("click", copyPasteLine);

  els.clear.addEventListener("click", () => {
    els.input.value = "";
    render();
    els.input.focus();
  });

  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", () => {
      const target = els[btn.dataset.copy];
      copyText(target.textContent, btn, "✓");
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
    els.boot.innerHTML = "";
    els.boot.className = "c-red";
    els.boot.textContent = `error: could not load data/colors.json (${err.message})`;
    els.statusLeft.textContent = "index: failed";
    return;
  }

  KEYS = Object.keys(DATA.colors);
  const ms = Math.round(performance.now() - t0);
  const count = KEYS.length.toLocaleString();
  const stamp = new Date(DATA.generated);

  els.boot.innerHTML = "";
  els.boot.append(
    document.createTextNode("indexed "),
    Object.assign(document.createElement("span"), {
      className: "c-cyan",
      textContent: count,
    }),
    document.createTextNode(" colors · "),
    Object.assign(document.createElement("span"), {
      className: "c-cyan",
      textContent: String(DATA.families.length),
    }),
    document.createTextNode(" families · "),
    Object.assign(document.createElement("span"), {
      className: "c-green",
      textContent: `${ms}ms`,
    })
  );

  els.statusLeft.textContent = `index: ${count} colors`;
  els.statusRight.textContent = `rebuilt: ${stamp.toLocaleString()}`;

  els.input.disabled = false;
  els.input.placeholder = "paste raw vendor color";
  els.input.addEventListener("input", () => render());
  els.input.addEventListener("keydown", onKeyDown);
  els.input.focus();
}

document.addEventListener("DOMContentLoaded", init);
