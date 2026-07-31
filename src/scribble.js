'use strict';

/**
 * Generates a handwriting-style scribble as inline SVG.
 *
 * Deterministic: the same name always produces the same mark, so a merchant's
 * signature looks consistent across every application you send out. This is the
 * same idea as an e-sign product's "adopt a signature style" — it represents a
 * signature the signer consented to, it is not a copy of their handwriting.
 */

function hashName(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Builds a cursive-ish stroke: a run of connected cubic curves along a baseline,
 * with taller ascenders where word breaks fall and a trailing flourish.
 */
function buildPath(name, rand, W, H) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = Math.max(6, Math.min(26, String(name).replace(/\s/g, '').length));

  const left = W * 0.04;
  const right = W * 0.9;
  const baseline = H * 0.66;
  const span = right - left;

  // One "bump" per letter, but wider strokes for longer names look wrong, so
  // cap the count and let the amplitude carry the variation instead.
  const bumps = Math.max(5, Math.min(18, letters));
  const step = span / bumps;

  let d = '';
  let x = left;
  let y = baseline + (rand() - 0.5) * 3;

  // Capital-style entry stroke: a tall opening loop.
  const capH = H * (0.45 + rand() * 0.2);
  d += `M ${x.toFixed(1)} ${(baseline + 4).toFixed(1)}`;
  d += ` C ${(x - step * 0.2).toFixed(1)} ${(baseline - capH * 0.5).toFixed(1)},`;
  d += ` ${(x + step * 0.5).toFixed(1)} ${(baseline - capH).toFixed(1)},`;
  d += ` ${(x + step * 0.9).toFixed(1)} ${(baseline - capH * 0.35).toFixed(1)}`;
  x += step * 0.9;
  y = baseline - capH * 0.35;

  // Word boundaries get an ascender so the mark reads as multiple words.
  const perWord = bumps / Math.max(1, words.length);
  const ascenders = new Set(
    words.map((_, i) => Math.round(i * perWord) + 1).filter((n) => n > 0 && n < bumps)
  );

  for (let i = 0; i < bumps; i++) {
    const up = i % 2 === 0;
    const tall = ascenders.has(i);
    const amp = tall ? H * (0.3 + rand() * 0.18) : H * (0.1 + rand() * 0.14);
    // Few bumps means a large step, which can walk past the right edge on
    // short names. Clamp so the mark always sits inside the box.
    const nx = Math.min(right, x + step * (0.75 + rand() * 0.5));
    const ny = baseline - (up ? amp : amp * 0.25) + (rand() - 0.5) * 2;

    const c1x = x + step * (0.2 + rand() * 0.3);
    const c1y = y - amp * (up ? 1.1 : 0.2) - rand() * 3;
    const c2x = Math.max(x, nx - step * (0.2 + rand() * 0.3));
    const c2y = ny - amp * (up ? 0.2 : -0.6);

    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${nx.toFixed(1)} ${ny.toFixed(1)}`;
    x = nx;
    y = ny;
  }

  // Trailing flourish sweeping out and back under the mark.
  const fx = Math.min(W * 0.98, x + step * 1.6);
  d += ` C ${(x + step * 0.6).toFixed(1)} ${(y - H * 0.3).toFixed(1)},`;
  d += ` ${fx.toFixed(1)} ${(baseline - H * 0.28).toFixed(1)},`;
  d += ` ${fx.toFixed(1)} ${(baseline + H * 0.06).toFixed(1)}`;

  // Underline swash, drawn as a second subpath.
  const uy = baseline + H * 0.2;
  d += ` M ${fx.toFixed(1)} ${(baseline + H * 0.02).toFixed(1)}`;
  d += ` C ${(W * 0.55).toFixed(1)} ${(uy + 4).toFixed(1)},`;
  d += ` ${(W * 0.2).toFixed(1)} ${(uy - 2).toFixed(1)},`;
  d += ` ${left.toFixed(1)} ${(uy + 1).toFixed(1)}`;

  return d;
}

/** Returns an inline SVG string, or '' when there's no name to work from. */
function makeScribble(name, opts = {}) {
  const clean = String(name || '').trim();
  if (!clean) return '';

  const W = opts.width || 230;
  const H = opts.height || 58;
  const rand = seeded(hashName(clean.toLowerCase()));
  const d = buildPath(clean, rand, W, H);
  const stroke = (1.3 + rand() * 0.5).toFixed(2);

  return (
    `<svg class="sigscribble" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="signature">` +
    `<path d="${d}" fill="none" stroke="#1a1a4b" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

module.exports = { makeScribble };
