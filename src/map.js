'use strict';

const fieldMap = require('../config/fields.json');

/* ---------- formatters ---------- */

const fmt = {
  raw: (v) => (v === null || v === undefined ? '' : String(v).trim()),

  money(v) {
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    if (!isFinite(n) || String(v ?? '').trim() === '') return fmt.raw(v);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  },

  date(v) {
    const s = fmt.raw(v);
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
  },

  phone(v) {
    const d = fmt.raw(v).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : fmt.raw(v);
  },

  ssn(v) {
    const d = fmt.raw(v).replace(/\D/g, '');
    return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : fmt.raw(v);
  },

  ein(v) {
    const d = fmt.raw(v).replace(/\D/g, '');
    return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : fmt.raw(v);
  },

  percent(v) {
    const s = fmt.raw(v);
    if (!s) return '';
    return /%$/.test(s) ? s : `${s}%`;
  },

  // Normalizes anything truthy-ish coming out of GHL into Yes / No / blank
  yesno(v) {
    const s = fmt.raw(v).toLowerCase();
    if (!s) return '';
    if (['yes', 'y', 'true', '1', 'checked'].includes(s)) return 'Yes';
    if (['no', 'n', 'false', '0', 'unchecked'].includes(s)) return 'No';
    return fmt.raw(v);
  },
};

/* ---------- extraction ---------- */

function customFieldIndex(contact) {
  const index = {};
  for (const cf of contact.customFields || contact.customField || []) {
    let value = cf.value !== undefined ? cf.value : cf.field_value;
    if (Array.isArray(value)) value = value.join(', ');
    index[cf.id] = value;
  }
  return index;
}

function standardValue(contact, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), contact);
}

/**
 * Turns a GHL contact into the flat object the template consumes.
 * A mapping entry is either:
 *   "AbCdEf1234567890abcdef"        → custom field id
 *   "std:companyName"               → standard contact property
 *   { source: "...", format: "money" }
 */
function buildTemplateData(contact) {
  const custom = customFieldIndex(contact);
  const out = {};

  for (const [key, entry] of Object.entries(fieldMap.fields || {})) {
    const spec = typeof entry === 'string' ? { source: entry } : entry || {};
    if (!spec.source) {
      out[key] = '';
      continue;
    }

    const rawValue = spec.source.startsWith('std:')
      ? standardValue(contact, spec.source.slice(4))
      : custom[spec.source];

    const formatter = fmt[spec.format] || fmt.raw;
    out[key] = formatter(rawValue);
  }

  // Composed / derived values used by the template
  out.owner_1_city_state_zip = [out.owner_1_city, out.owner_1_state, out.owner_1_zip]
    .filter(Boolean)
    .join(', ');
  out.owner_2_city_state_zip = [out.owner_2_city, out.owner_2_state, out.owner_2_zip]
    .filter(Boolean)
    .join(', ');

  out.generated_date = fmt.date(new Date().toISOString());

  // Account manager block comes from env, not the contact
  out.am_name = process.env.AM_NAME || '';
  out.am_office = process.env.AM_OFFICE || '';
  out.am_cell = process.env.AM_CELL || '';
  out.am_email = process.env.AM_EMAIL || '';

  return out;
}

module.exports = { buildTemplateData, fieldMap, fmt };
