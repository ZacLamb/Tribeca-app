'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let browserPromise = null;

function launch() {
  return puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });
}

/** One warm browser for the life of the process; relaunches if it dies. */
async function getBrowser() {
  if (!browserPromise) browserPromise = launch();
  let browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = launch();
    browser = await browserPromise;
  }
  return browser;
}

const templateCache = new Map();

let signatureFontB64 = null;

/** Read the script font once and inline it, so Chromium needs no network. */
function getSignatureFont() {
  if (signatureFontB64 === null) {
    try {
      const file = path.join(__dirname, '..', 'assets', 'fonts', 'GreatVibes-Regular.ttf');
      signatureFontB64 = fs.readFileSync(file).toString('base64');
    } catch (err) {
      console.warn(`signature font missing, falling back to italic serif: ${err.message}`);
      signatureFontB64 = '';
    }
  }
  return signatureFontB64;
}

function loadTemplate(name) {
  if (process.env.NODE_ENV !== 'production' || !templateCache.has(name)) {
    const file = path.join(__dirname, '..', 'templates', `${name}.html`);
    templateCache.set(name, fs.readFileSync(file, 'utf8'));
  }
  return templateCache.get(name);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** {{key}} substitution. Unknown keys render blank rather than leaving braces. */
function interpolate(html, data) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    escapeHtml(data[key] ?? '')
  );
}

async function renderPdf(templateName, data) {
  const withFont = { ...data, signature_font_data: getSignatureFont() };
  const html = interpolate(loadTemplate(templateName), withFont);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.emulateMediaType('print');
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' },
    });
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => {});
}

module.exports = { renderPdf, closeBrowser, getBrowser };
