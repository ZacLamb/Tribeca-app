'use strict';

const express = require('express');
const ghl = require('./ghl');
const { buildTemplateData, fieldMap } = require('./map');
const { renderPdf, closeBrowser, getBrowser } = require('./render');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const TEMPLATE = process.env.TEMPLATE_NAME || 'nytg';
const DEDUPE_MS = Number(process.env.DEDUPE_MS || 60000);

/* ---------------- helpers ---------------- */

const recent = new Map();

function seenRecently(contactId) {
  const now = Date.now();
  for (const [id, ts] of recent) if (now - ts > DEDUPE_MS) recent.delete(id);
  if (recent.has(contactId)) return true;
  recent.set(contactId, now);
  return false;
}

function extractContactId(req) {
  const b = req.body || {};
  return (
    b.contactId ||
    b.contact_id ||
    b.id ||
    (b.contact && (b.contact.id || b.contact.contactId)) ||
    req.query.contactId ||
    null
  );
}

function authorized(req) {
  if (!SECRET) return true; // no secret configured = open (set one in prod)
  const supplied =
    req.get('x-api-key') ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    req.query.key ||
    (req.body && req.body.key);
  return supplied === SECRET;
}

function safeName(s) {
  return String(s || 'Applicant')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function triggerIsActive(contact) {
  const id = fieldMap.trigger && fieldMap.trigger.fieldId;
  if (!id || id.startsWith('REPLACE_')) return true; // not configured = don't gate
  const active = (fieldMap.trigger.activeValues || ['Yes']).map((v) =>
    String(v).toLowerCase()
  );
  const cf = (contact.customFields || []).find((f) => f.id === id);
  const value = cf ? String(cf.value ?? '').toLowerCase() : '';
  return active.includes(value);
}

/* ---------------- core ---------------- */

async function generate(contactId, { force = false, deliver = true } = {}) {
  const contact = await ghl.getContact(contactId);

  if (!force && !triggerIsActive(contact)) {
    return { skipped: 'trigger-field-not-set' };
  }

  const data = buildTemplateData(contact);
  const pdf = await renderPdf(TEMPLATE, data);

  if (!deliver) return { pdf, data };

  const prefix = (fieldMap.output && fieldMap.output.filenamePrefix) || 'Application';
  const filename = `${prefix}-${safeName(data.legal_business_name || data.owner_1_name)}.pdf`;

  const upload = await ghl.uploadCustomFile(
    contactId,
    fieldMap.output.fileFieldId,
    pdf,
    filename
  );

  // Reset the trigger field so the workflow can fire again next time, and
  // optionally stamp a generated-at timestamp.
  const writes = [];
  const triggerId = fieldMap.trigger && fieldMap.trigger.fieldId;
  if (triggerId && !triggerId.startsWith('REPLACE_')) {
    writes.push({ id: triggerId, value: fieldMap.trigger.clearTo ?? '' });
  }
  const stampId = fieldMap.output && fieldMap.output.generatedAtFieldId;
  if (stampId) writes.push({ id: stampId, value: new Date().toISOString() });
  if (writes.length) await ghl.updateContactFields(contactId, writes);

  return { ok: true, filename, bytes: pdf.length, partStyle: upload.partStyle };
}

/* ---------------- routes ---------------- */

app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Called by the GHL workflow webhook action.
app.post('/webhook/create-app', async (req, res) => {
  const contactId = extractContactId(req);
  if (!contactId) return res.status(400).json({ error: 'no contactId in payload' });

  // Respond immediately — GHL webhooks time out well before a PDF renders.
  res.status(202).json({ accepted: true, contactId });

  if (seenRecently(contactId)) {
    console.log(`[skip] ${contactId} deduped`);
    return;
  }
  try {
    const result = await generate(contactId);
    console.log(`[done] ${contactId}`, result);
  } catch (err) {
    console.error(`[fail] ${contactId}`, err.message);
  }
});

// Called by anything outside GHL. Requires the shared secret, runs synchronously
// so the caller gets a real result.
app.post('/webhook/external', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const contactId = extractContactId(req);
  if (!contactId) return res.status(400).json({ error: 'no contactId in payload' });
  try {
    const result = await generate(contactId, { force: req.body.force !== false });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, body: err.body });
  }
});

// Render and return the PDF without touching GHL. Use this while wiring up fields.
app.get('/preview/:contactId', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { pdf } = await generate(req.params.contactId, { force: true, deliver: false });
    res.type('application/pdf').send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, body: err.body });
  }
});

// Dump every custom field in the location so you can fill in config/fields.json.
app.get('/debug/fields', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const fields = await ghl.listCustomFields();
    res.json(
      fields.map((f) => ({
        id: f.id,
        name: f.name,
        fieldKey: f.fieldKey,
        dataType: f.dataType,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message, body: err.body });
  }
});

// Show the raw contact plus what the mapper produces from it.
app.get('/debug/contact/:contactId', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const contact = await ghl.getContact(req.params.contactId);
    res.json({ mapped: buildTemplateData(contact), contact });
  } catch (err) {
    res.status(500).json({ error: err.message, body: err.body });
  }
});

/* ---------------- boot ---------------- */

const required = ['GHL_PIT', 'GHL_LOCATION_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`nytg-app-generator listening on ${PORT}`);
  getBrowser()
    .then(() => console.log('chromium warm'))
    .catch((e) => console.error('chromium launch failed:', e.message));
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await closeBrowser();
    server.close(() => process.exit(0));
  });
}
