'use strict';

/**
 * Two ways to get data in through a webhook.
 *
 * 1. DIRECT (recommended when you want GHL to own the mapping)
 *    Add Custom Data pairs in the GHL webhook action whose keys match the
 *    template keys:
 *        legal_business_name  ->  {{contact.company_name}}
 *        tax_id               ->  {{contact.tax_id}}
 *        position_1_company   ->  {{contact.position_1_company}}
 *    Anything sent this way overrides whatever the field map produced, so you
 *    can map in the GHL UI and never touch fields.json.
 *
 * 2. PAYLOAD-ONLY (no API read at all)
 *    Send skipFetch: true and the service builds the contact from the payload
 *    instead of calling GET /contacts. Faster, but you only get what GHL put in
 *    the body, and the signature image lookup won't work unless you pass the
 *    URL yourself as signature_1_image.
 *
 * Note the PIT is still required either way — the upload back into
 * contact.application is an API call regardless.
 */

// Keys GHL sends that describe the contact itself, not custom data.
const STANDARD = new Set([
  'contact_id', 'contactId', 'id', 'location', 'locationId', 'location_id',
  'first_name', 'firstName', 'last_name', 'lastName', 'full_name', 'fullName',
  'name', 'email', 'phone', 'address1', 'address', 'city', 'state', 'country',
  'postal_code', 'postalCode', 'company_name', 'companyName', 'website',
  'date_of_birth', 'dateOfBirth', 'tags', 'workflow', 'triggerData',
  'contact_type', 'customData', 'custom_data', 'key', 'force', 'skipFetch',
  'timestamp', 'version', 'attributionSource', 'source', 'user',
]);

/** Builds a contact-shaped object from a GHL workflow webhook body. */
function contactFromPayload(body) {
  const b = body || {};
  return {
    id: b.contact_id || b.contactId || b.id,
    firstName: b.first_name ?? b.firstName,
    lastName: b.last_name ?? b.lastName,
    contactName: b.full_name ?? b.fullName ?? b.name,
    email: b.email,
    phone: b.phone,
    address1: b.address1 ?? b.address,
    city: b.city,
    state: b.state,
    postalCode: b.postal_code ?? b.postalCode,
    companyName: b.company_name ?? b.companyName,
    dateOfBirth: b.date_of_birth ?? b.dateOfBirth,
    // No IDs available from a webhook body, so the ID-keyed map can't resolve.
    // Direct data (below) is how you fill the rest in this mode.
    customFields: [],
  };
}

/**
 * Pulls template-key overrides out of the payload: anything under customData,
 * plus any root-level key that isn't a known standard contact property.
 * Values are used as-is — GHL already rendered the merge tags.
 */
function directData(body) {
  const b = body || {};
  const out = {};

  const custom = b.customData || b.custom_data;
  if (custom && typeof custom === 'object') {
    for (const [k, v] of Object.entries(custom)) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      // GHL sends the merge tag verbatim when the underlying field is empty.
      if (s === '' || /^\{\{.*\}\}$/.test(s)) continue;
      out[k] = s;
    }
  }

  for (const [k, v] of Object.entries(b)) {
    if (STANDARD.has(k)) continue;
    if (v === null || v === undefined || typeof v === 'object') continue;
    const s = String(v).trim();
    // GHL sends unresolved merge tags verbatim when the field is empty.
    if (s === '' || /^\{\{.*\}\}$/.test(s)) continue;
    out[k] = s;
  }

  return out;
}

module.exports = { contactFromPayload, directData };
