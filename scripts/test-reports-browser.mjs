import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import axe from 'axe-core';
import { chromium } from 'playwright';

const root = new URL('../dist/kotailor-reports-demo/browser/', import.meta.url);
const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', ico: 'image/x-icon', ttf: 'font/ttf' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const name = path === '/' || path === '/reportes' ? 'index.html' : path.slice(1);
  if (!/^(?:assets\/)?[\w-][\w.-]*\.(js|css|html|ico|ttf)$/.test(name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(name, root));
    response.writeHead(200, { 'Content-Type': types[name.split('.').at(-1)] }).end(body);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(error);
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ channel: process.env.REPORTS_BROWSER_CHANNEL || undefined });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`);
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
  await page.goto(`${origin}/reportes`);
  await page.locator('html').evaluate((element) => element.ownerDocument.fonts.ready.then(() => undefined));
  const scenario = page.getByLabel('Escenario de demostración');
  await scenario.waitFor();
  const metric = (label) => page.locator('.metrics article').filter({
    has: page.getByText(label, { exact: true }),
  }).locator('strong');
  const chartCount = () => page.locator('.charts article .bars').count();
  const checkAxe = async (label) => {
    const result = await page.evaluate(async () => globalThis.axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    }));
    assert.deepEqual(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), [], label);
    console.log(`AXE ${label}: ${result.passes.length} reglas aprobadas, ${result.incomplete.length} requieren revisión`);
  };
  await page.addScriptTag({ content: axe.source });
  assert.equal(await chartCount(), 6);
  for (const chart of await page.locator('.charts article .bars').all()) {
    const widths = await chart.locator('.bar').evaluateAll((bars) => bars.map((bar) => Number.parseFloat(bar.style.width)));
    assert.ok(widths.every((width) => width >= 0 && width <= 100));
    assert.equal(Math.max(...widths), 100);
  }
  assert.match(await metric('Facturas pagadas').locator('..').locator('small').textContent(), /\d(?:[.,]\d+)?\s*%/);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator('html').evaluate((element) => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    await checkAxe(`${width}px`);
  }
  await scenario.focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByLabel('Desde').evaluate((input) => input === input.ownerDocument.activeElement), true);
  await page.getByLabel('Estado de orden').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Aplicar filtros' }).evaluate((button) => button === button.ownerDocument.activeElement), true);
  const status = page.locator('.status-bar').first();
  await status.press('Enter');
  await page.locator('.status-bar[aria-pressed="true"]').waitFor();
  assert.equal(await page.locator('.status-bar').count(), 1);
  assert.equal(await status.getAttribute('aria-pressed'), 'true');
  assert.equal(await status.evaluate((button) => button === button.ownerDocument.activeElement), true);
  assert.equal(await status.evaluate((button) => button.matches(':focus-visible')), true);

  await scenario.selectOption('minimal');
  assert.equal(await metric('Facturación pendiente').textContent(), '—');
  assert.match(await metric('Ingresos cobrados').textContent(), /0\.00/);
  assert.match(await metric('Facturas pagadas').locator('..').locator('small').textContent(), /^—/);
  await scenario.selectOption('empty');
  assert.equal(await chartCount(), 0);
  assert.equal(await metric('Total de clientes').textContent(), '0');
  await checkAxe('sin registros');

  await scenario.selectOption('high-volume');
  assert.equal(await chartCount(), 6);
  const counts = await page.locator('.status-bar strong').allTextContents();
  assert.equal(counts.reduce((sum, value) => sum + Number(value), 0), 12_000);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('html').evaluate((el) => el.scrollWidth > el.clientWidth), false, `High volume at ${width}px`);
  }
  await page.getByLabel('Buscar cliente').fill('Maria Alcantara');
  await page.getByLabel('Coincidencias').selectOption('demo-1');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  assert.equal(await metric('Total de clientes').textContent(), '1');
  await page.getByLabel('Desde').fill('2026-02-01');
  await page.getByLabel('Hasta').fill('2026-02-28');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  const salesMonths = await page.locator('.charts article').first().locator('.bar-item > span:first-child').allTextContents();
  assert.equal(salesMonths.length, 1);
  assert.match(salesMonths[0], /feb.+2026/);

  await scenario.selectOption('complete');
  await page.getByLabel('Buscar cliente').fill('Luis Rosario');
  await page.getByLabel('Coincidencias').selectOption('demo-2');
  await page.getByLabel('Estado de orden').selectOption('cutting');
  await page.getByLabel('Desde').fill('2026-02-03');
  await page.getByLabel('Hasta').fill('2026-02-03');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  assert.match(await metric('Flujo neto del período').textContent(), /[-−]/);
  assert.equal(await page.locator('.bar.collected.negative').count(), 1);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await delay(50);
  assert.deepEqual(requests.filter((request) => !request.startsWith(`${origin}/`) || new URL(request).pathname.startsWith('/api/')), []);
  assert.deepEqual(errors, []);
  console.log('Reportes: escenarios, cinco viewports, teclado, filtros y aislamiento aprobados.');
} finally {
  try { await browser?.close(); } finally { server.close(); }
}
