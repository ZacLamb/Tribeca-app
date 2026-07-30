# NYTG Application Generator

Renders the New York Tribeca Group MCA application as a PDF from a GoHighLevel
contact record and writes the finished file back into the contact's
`Application` file-upload custom field.

```
GHL: Create App = Yes
  → workflow webhook → POST /webhook/create-app { contactId }
  → GET /contacts/{id}
  → map field IDs to template keys (config/fields.json)
  → render templates/nytg.html to PDF (Puppeteer)
  → POST /forms/upload-custom-files  → lands in contact.application
  → PUT /contacts/{id}               → clears the trigger field
```

---

## 1. Deploy

Push this repo to GitHub, then in Railway: **New Project → Deploy from GitHub
repo**. It ships with a `Dockerfile`, so Railway builds that and ignores
Nixpacks. Chromium comes from apt inside the image — nothing to configure.

Add the variables from `.env.example` under **Variables**. `PORT` is injected by
Railway; don't set it yourself.

Generate a public domain under **Settings → Networking**. That URL is what GHL
calls.

## 2. Point it at your fields

`config/fields.json` is the only file you edit per location. Everything else is
generic.

Get the IDs:

```
GET https://<your-railway-domain>/debug/fields?key=<WEBHOOK_SECRET>
```

That returns every custom field in the location as `{ id, name, fieldKey,
dataType }`. Paste each ID into the matching template key in
`config/fields.json`.

Each mapping accepts three forms:

```jsonc
"nature_of_business": "AbC123defGHI456jkl789",              // custom field id
"legal_business_name": "std:companyName",                    // standard property
"advance_amount": { "source": "AbC...", "format": "money" }  // with a formatter
```

Formatters: `raw` (default), `money`, `date`, `phone`, `ssn`, `ein`, `percent`,
`yesno`. Leave a source as `""` and that box prints blank.

Two blocks at the top of the same file:

- `trigger.fieldId` — the `Create App` field. Set it and the service will
  refuse to run unless that field holds one of `trigger.activeValues`, then
  clear it afterwards. Leave the `REPLACE_...` placeholder and the gate is off.
- `output.fileFieldId` — already set to `Tbq51b5psdjfzrq8GLLv`
  (`contact.application`). `output.generatedAtFieldId` is optional.

## 3. Check the output before wiring GHL

```
GET https://<your-railway-domain>/preview/<contactId>?key=<WEBHOOK_SECRET>
```

Returns the PDF in the browser without touching the contact. Iterate on
`templates/nytg.html` until it looks right.

```
GET https://<your-railway-domain>/debug/contact/<contactId>?key=<WEBHOOK_SECRET>
```

Shows the raw contact next to the mapped template data — the fastest way to spot
a wrong field ID.

## 4. Wire the GHL workflow

1. Create a contact custom field `Create App`, type Dropdown, options `Yes`.
2. New workflow → Trigger: **Contact Changed**, filter `Create App` `is` `Yes`.
3. Action: **Webhook**, POST to `https://<your-railway-domain>/webhook/create-app`
   with body:

```json
{ "contactId": "{{contact.id}}" }
```

No auth header needed on this route (GHL's own webhook is the trust boundary),
but you can add `?key=<WEBHOOK_SECRET>` to the URL if you want it locked down.

The service replies `202` immediately and renders in the background, because GHL
times out webhooks long before Chromium finishes. It then clears `Create App`
back to blank, which re-fires the trigger — that's what the trigger gate and the
60-second dedupe are for.

## 5. External callers

```
POST https://<your-railway-domain>/webhook/external
x-api-key: <WEBHOOK_SECRET>
{ "contactId": "..." }
```

Runs synchronously and returns the result. Ignores the `Create App` gate by
default; send `"force": false` to respect it.

---

## Adding another lender's application

1. Copy `templates/nytg.html` to `templates/<lender>.html`, rewrite the tables.
2. Either set `TEMPLATE_NAME` on a second Railway service pointed at the same
   repo, or add a `?template=` param to the routes.

The mapper and GHL client are lender-agnostic — only the HTML and the field map
change.

## Gotchas

- **`401 Invalid JWT` on upload but `/contacts` works.** The PIT is missing the
  forms scope. Regenerate it with forms access.
- **Upload returns 200 but the field stays empty.** Flip
  `FILE_PART_KEY_STYLE` to `bare`. GHL's docs specify
  `<fieldId>_<uuid>` as the multipart part name; some accounts only accept the
  bare field ID. `auto` tries both.
- **Blank boxes everywhere.** Almost always a stale field ID. Check
  `/debug/contact/<id>` — if `contact.customFields` has values but `mapped` is
  empty, the IDs in `fields.json` don't match.
- **Checkboxes/multi-select come back as arrays.** They're joined with commas
  before formatting.
- **PDF spills onto a second page.** Long values (a 60-character business
  address, a wordy "reason for funding") push rows taller. Drop `body
  { font-size }` in `templates/nytg.html` from `8.2pt` to `7.6pt`, or tighten
  `@page { margin }`. Check with `/preview` before blaming the mapping.
