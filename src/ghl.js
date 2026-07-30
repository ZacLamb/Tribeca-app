'use strict';

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${process.env.GHL_PIT}`,
    Version: VERSION,
    Accept: 'application/json',
    ...extra,
  };
}

async function handle(res, label) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${label} failed: ${res.status} ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Full contact record, including customFields: [{ id, value }] */
async function getContact(contactId) {
  const res = await fetch(`${BASE}/contacts/${contactId}`, { headers: headers() });
  const body = await handle(res, 'getContact');
  return body.contact || body;
}

/** All custom field definitions for the location. Used by /debug/fields. */
async function listCustomFields() {
  const url = `${BASE}/locations/${process.env.GHL_LOCATION_ID}/customFields`;
  const res = await fetch(url, { headers: headers() });
  const body = await handle(res, 'listCustomFields');
  return body.customFields || [];
}

/** Patch contact custom fields. values = [{ id, value }] */
async function updateContactFields(contactId, values) {
  if (!values.length) return null;
  const res = await fetch(`${BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customFields: values }),
  });
  return handle(res, 'updateContactFields');
}

/**
 * Write a file into a FILE_UPLOAD custom field.
 *
 * The multipart part NAME is the payload here, not the filename. GHL's docs say
 * `<customFieldId>_<uuid>`; several working integrations use the bare field id.
 * FILE_PART_KEY_STYLE lets you flip between them without a code change, and
 * "auto" tries the documented form first then falls back.
 */
async function uploadCustomFile(contactId, fieldId, buffer, filename) {
  const style = (process.env.FILE_PART_KEY_STYLE || 'auto').toLowerCase();
  const attempts =
    style === 'bare' ? ['bare'] : style === 'uuid' ? ['uuid'] : ['uuid', 'bare'];

  let lastErr;
  for (const attempt of attempts) {
    const partName =
      attempt === 'uuid' ? `${fieldId}_${crypto.randomUUID()}` : fieldId;

    const form = new FormData();
    form.append(
      partName,
      new Blob([buffer], { type: 'application/pdf' }),
      filename
    );

    const url =
      `${BASE}/forms/upload-custom-files` +
      `?contactId=${encodeURIComponent(contactId)}` +
      `&locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`;

    try {
      const res = await fetch(url, { method: 'POST', headers: headers(), body: form });
      const body = await handle(res, `uploadCustomFile[${attempt}]`);
      return { body, partStyle: attempt };
    } catch (err) {
      lastErr = err;
      // A 401 is a token/scope problem, not a key-format problem. Don't retry.
      if (err.status === 401) throw err;
      console.warn(`upload attempt "${attempt}" failed: ${err.message}`);
    }
  }
  throw lastErr;
}

module.exports = { getContact, listCustomFields, updateContactFields, uploadCustomFile };
