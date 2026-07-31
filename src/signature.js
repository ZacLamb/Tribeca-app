'use strict';

/**
 * Signature handling.
 *
 * Two modes, and the difference matters legally, not just technically:
 *
 *   image  – the merchant actually drew/uploaded a signature somewhere (a GHL
 *            form signature widget, an uploaded signed app). We fetch that
 *            artifact and stamp it onto the NYTG form. This is just re-rendering
 *            a signature they made.
 *
 *   typed  – we render their name in a script face plus an audit line. This is
 *            a valid e-signature under ESIGN/UETA *only if* they consented to
 *            sign electronically. That's what `consentFieldId` is for.
 *
 * By default `requireConsent` is true: with no image and no consent record, the
 * signature box prints empty and the merchant signs by hand. Flip it off only if
 * your intake flow already captures consent and you know it does.
 */

const fieldMap = require('../config/fields.json');
const { makeScribble } = require('./scribble');

function cfValue(contact, id) {
  if (!id) return '';
  const cf = (contact.customFields || []).find((f) => f.id === id);
  let v = cf ? cf.value : '';
  if (Array.isArray(v)) v = v[0];
  return v == null ? '' : String(v).trim();
}

function isTruthy(v) {
  return ['yes', 'y', 'true', '1', 'checked', 'signed', 'agreed'].includes(
    String(v).trim().toLowerCase()
  );
}

/**
 * GHL file URLs are usually public, but some are behind the API. Fetch with the
 * PIT attached when the host is LeadConnector, then inline as a data URI so
 * Puppeteer never has to make a network request mid-render.
 */
async function toDataUri(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  try {
    const headers = /leadconnectorhq|gohighlevel|msgsndr/i.test(url)
      ? { Authorization: `Bearer ${process.env.GHL_PIT}`, Version: '2021-07-28' }
      : {};
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`signature image fetch ${res.status} for ${url}`);
      return '';
    }
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    if (!type.startsWith('image/')) {
      console.warn(`signature url is not an image (${type})`);
      return '';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) {
      console.warn('signature image over 3MB, skipping');
      return '';
    }
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(`signature image fetch failed: ${err.message}`);
    return '';
  }
}

function usDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

async function resolveOne(contact, cfg, fallbackName, data) {
  const out = { image: '', typed: '', scribble: '', meta: '', date: '' };
  if (!cfg) return out;

  const mode = (process.env.SIGNATURE_MODE || fieldMap.signature?.mode || 'auto').toLowerCase();
  if (mode === 'none') return out;

  const requireConsent =
    process.env.SIGNATURE_REQUIRE_CONSENT !== undefined
      ? process.env.SIGNATURE_REQUIRE_CONSENT !== 'false'
      : fieldMap.signature?.requireConsent !== false;

  const name =
    (cfg.nameSource && data[cfg.nameSource]) || fallbackName || '';
  if (!name) return out;

  // --- signed-at date: use the recorded one if present, else today
  const recordedAt = cfValue(contact, cfg.signedAtFieldId);
  const when = recordedAt && !isNaN(new Date(recordedAt)) ? new Date(recordedAt) : new Date();

  // --- image path
  if (mode === 'auto' || mode === 'image') {
    const url = cfValue(contact, cfg.imageFieldId);
    if (url) {
      const uri = await toDataUri(url);
      if (uri) {
        out.image = uri;
        out.date = usDate(when);
        out.meta = `Signature on file — ${name}, ${usDate(when)}`;
        return out;
      }
    }
    if (mode === 'image') return out; // explicit image mode, no fabricating
  }

  // --- generated path (scribble or script text)
  if (mode === 'auto' || mode === 'typed') {
    const consented = cfg.consentFieldId ? isTruthy(cfValue(contact, cfg.consentFieldId)) : false;
    if (requireConsent && !consented) {
      console.log(
        `[signature] no image and no consent record for "${name}" — leaving box blank`
      );
      return out;
    }

    const style = (process.env.SIGNATURE_STYLE || fieldMap.signature?.style || 'scribble')
      .toLowerCase();

    if (style === 'scribble' || style === 'both') out.scribble = makeScribble(name);
    if (style === 'script' || style === 'both') out.typed = name;

    out.date = usDate(when);
    out.meta = `Electronically signed by ${name} on ${usDate(when)}`;
    // Only cite the consent source when there actually is one. With the gate
    // off, appending it anyway would print a claim about a record that doesn't
    // exist on the contact.
    if (consented && cfg.consentSourceLabel) out.meta += ` — ${cfg.consentSourceLabel}`;
  }

  return out;
}

/** Mutates `data` with signature_1_* / signature_2_* keys. */
async function applySignatures(contact, data) {
  const cfg = fieldMap.signature || {};
  const one = await resolveOne(contact, cfg.owner1, data.owner_1_name, data);
  const two = await resolveOne(contact, cfg.owner2, data.owner_2_name, data);

  data.signature_1_image = one.image;
  data.signature_1_scribble = one.scribble;
  data.signature_1_typed = one.typed;
  data.signature_1_meta = one.meta;
  data.signature_1_date = one.date;

  data.signature_2_image = two.image;
  data.signature_2_scribble = two.scribble;
  data.signature_2_typed = two.typed;
  data.signature_2_meta = two.meta;
  data.signature_2_date = two.date;

  return data;
}

module.exports = { applySignatures };
