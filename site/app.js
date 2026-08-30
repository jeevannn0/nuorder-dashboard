// NuORDER Color Dashboard - static build.
// Mirrors the formatting logic in app.py exactly. See pyTitle() for the
// subtle part: Python's str.title() treats digits as word boundaries.

const NOT_FOUND = "Not found in database";

let DATA = null;

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

// --- rendering ---

const els = {};

function render() {
  const raw = els.input.value;

  if (!raw.trim()) {
    els.results.hidden = true;
    return;
  }

  const formatted = getCustomerFacingColor(raw);
  const { found, family } = lookupFamily(raw);

  els.facing.textContent = formatted;
  els.family.textContent = family;
  els.familyCard.classList.toggle("is-error", !found);
  els.familyCard.classList.toggle("is-ok", found);
  els.hint.hidden = found;
  els.copyText.value = `${formatted}\t${family}`;
  els.results.hidden = false;
  els.copyBtn.textContent = "Copy";
}

async function copyToClipboard() {
  const text = els.copyText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to a manual selection.
    els.copyText.hidden = false;
    els.copyText.select();
    document.execCommand("copy");
  }
  els.copyBtn.textContent = "Copied";
  setTimeout(() => (els.copyBtn.textContent = "Copy"), 1500);
}

async function init() {
  els.input = document.getElementById("query");
  els.results = document.getElementById("results");
  els.facing = document.getElementById("facing");
  els.family = document.getElementById("family");
  els.familyCard = document.getElementById("family-card");
  els.hint = document.getElementById("hint");
  els.copyText = document.getElementById("copy-text");
  els.copyBtn = document.getElementById("copy-btn");
  els.status = document.getElementById("status");

  els.copyBtn.addEventListener("click", copyToClipboard);

  try {
    const resp = await fetch("data/colors.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    DATA = await resp.json();
  } catch (err) {
    els.status.textContent = `Could not load the color database (${err.message}).`;
    els.status.className = "status status-error";
    return;
  }

  const count = Object.keys(DATA.colors).length.toLocaleString();
  const when = new Date(DATA.generated).toLocaleString();
  els.status.textContent = `${count} colors loaded · data refreshed ${when}`;
  els.status.className = "status";

  els.input.disabled = false;
  els.input.addEventListener("input", render);
  els.input.focus();
}

document.addEventListener("DOMContentLoaded", init);
