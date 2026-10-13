// Optional real-browser QA: start the production web server first.
// SNAP_PLAYWRIGHT_MODULE may point at a bundled Playwright index.mjs.
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.SNAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
const url = process.env.SNAP_TEST_URL || 'http://127.0.0.1:3000';
const output = 'test-results/product-site'; await mkdir(output, { recursive: true });
const labels = ['Editor', 'Camera', 'Layers', 'Looks', 'Audio', 'Captions', '3D tilt', 'Light mode', 'Voice polish', 'Fullscreen preview'];
const tab = (page, index) => page.getByRole('tab', { name: `Show screenshot ${index + 1}: ${labels[index]}`, exact: true });
const pauseRotation = async page => {
  await page.locator('.showcase-carousel').focus(); await page.locator('.showcase-carousel').press('Space');
  await page.waitForFunction(() => { const stage = document.querySelector('.showcase-stage'); return stage?.dataset.phase === 'idle' && stage.querySelectorAll('img').length === 1; });
};
const settled = async (page, index) => {
  await page.waitForFunction(index => {
    const stage = document.querySelector('.showcase-stage'), image = stage?.querySelector('.showcase-slide.is-active');
    const button = document.querySelectorAll('.showcase-dots button')[index];
    return stage?.dataset.phase === 'idle' && button?.getAttribute('aria-selected') === 'true' && image?.complete && image.naturalWidth > 0 && stage.querySelectorAll('img').length === 1;
  }, index);
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], broken = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && /screenshots|media\//.test(response.url())) broken.push(response.url()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const selector of ['body', '.hero h1', '.section-kicker', '.nav-download']) {
    assert.match(await page.locator(selector).first().evaluate(element => getComputedStyle(element).fontFamily), /Space Grotesk/i, `Space Grotesk throughout the website: ${selector}`);
  }
  assert.equal(await page.getByRole('heading', { name: 'Bring in what you have.', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Stay on script.', exact: true }).count(), 0);
  assert.equal(await page.getByText('Your screen, a smoother camera pass, and the finishing touches that make it yours.', { exact: true }).count(), 0);
  for (const [selector, animation] of [['.site-nav', 'intro-rise'], ['.hero-line > span', 'intro-line'], ['.showcase-carousel', 'intro-preview']]) {
    assert.equal(await page.locator(selector).first().evaluate(element => getComputedStyle(element).animationName), animation);
  }
  await page.waitForTimeout(1800);
  for (const selector of ['.site-nav', '.hero-line > span', '.hero-copy > p', '.hero-actions', '.showcase-carousel']) {
    assert.deepEqual(await page.locator(selector).first().evaluate(element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })), { opacity: '1', transform: 'none' }, `Intro settles completely: ${selector}`);
  }
  await page.screenshot({ path: `${output}/hero.png` });
  console.log('PASS Space Grotesk, staggered intro settling without lingering transforms, and requested content removals');
  // This is before any click/tap: a gesture must not be needed for muted autoplay.
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video.currentTime > .5 && !video.paused; }, {}, { timeout: 15000 });
  const metadata = await page.locator('video').evaluate(video => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, muted: video.muted, controls: video.controls, autoplay: video.autoplay, loop: video.loop }));
  assert.ok(Math.abs(metadata.duration - 30) < .1);
  assert.deepEqual([metadata.width, metadata.height], [1920, 1080]);
  for (const flag of ['muted', 'controls', 'autoplay', 'loop']) assert.equal(metadata[flag], true, flag);
  assert.equal(await page.getByRole('button', { name: 'Play Snap product film', exact: true }).count(), 0);
  assert.equal(await page.locator('.film-meta').count(), 0, 'Remove the entire metadata row');
  assert.equal(await page.getByRole('link', { name: /Download (the )?film/i }).count(), 0, 'No download-film action');
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 29.65; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true, 'Do not override a deliberate pause');
  await page.locator('video').evaluate(video => video.play());
  await page.waitForFunction(() => document.querySelector('video').currentTime < 2);
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 15; });
  assert.equal((await page.request.get(`${url}/media/snap-promo.vtt`)).status(), 200);
  console.log('PASS gesture-free muted 30-second autoplay, controls, seek, pause and looping');

  await pauseRotation(page);
  assert.equal(await page.getByRole('tab').count(), 10);
  assert.equal(await page.locator('.showcase-control').count(), 0, 'Remove pause and arrow buttons');
  assert.equal(await page.locator('.showcase-carousel button').count(), 10, 'Only navigation dots remain');
  assert.equal((await page.locator('.showcase-navigation').innerText()).trim(), '', 'No visible feature labels');
  assert.equal(await page.locator('.showcase-drag-hint').count(), 0);
  assert.equal(await page.locator('.real-workflow-grid article').count(), 1, 'Keep only the recorder card');
  const sources = new Set();
  for (let index = 0; index < labels.length; index++) {
    await tab(page, index).click(); await settled(page, index);
    sources.add(await page.locator('.showcase-slide.is-active').getAttribute('src'));
  }
  assert.equal(sources.size, 10, 'Use the 10 remaining unique screenshots');
  for (const removed of ['cursor-detail.webp', 'clip-settings.webp', 'recorder.webp', 'media-import.webp', 'teleprompter.webp', 'layouts.webp']) {
    assert.ok(![...sources].some(source => source.endsWith(removed)), `Remove ${removed} from the swipe gallery`);
  }
  await tab(page, 9).press('Home'); await settled(page, 0);
  await tab(page, 0).press('ArrowRight'); await settled(page, 1);
  await tab(page, 1).press('ArrowLeft'); await settled(page, 0);

  const box = await page.locator('.showcase-stage').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 170, y, { steps: 12 });
  assert.equal(await page.locator('.showcase-stage').getAttribute('data-phase'), 'dragging');
  assert.equal(await page.locator('.showcase-slide').count(), 2, 'Decoded adjacent image follows the drag');
  await page.mouse.up(); await settled(page, 1);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 24, y, { steps: 5 }); await page.mouse.up(); await settled(page, 1);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 170, y, { steps: 10 });
  await page.locator('.showcase-stage').dispatchEvent('pointercancel', { pointerId: 1, clientX: x + 170, clientY: y });
  await page.mouse.up(); await settled(page, 1);
  await tab(page, 0).click(); await settled(page, 0);
  for (const image of await page.locator('.real-workflow-image img').all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(element => element.decode()); }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.locator('#film').screenshot({ path: `${output}/film.png` });
  console.log('PASS 10 decoded screenshots, six excluded shots, dots-only controls, keyboard, swipe, cancellation and short-drag recovery');

  // Slow-network preparation keeps the current shot until the next is decoded.
  const delayed = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await delayed.route('**/screenshots/voice.webp', async route => { await new Promise(resolve => setTimeout(resolve, 900)); await route.continue(); });
  await delayed.goto(url, { waitUntil: 'networkidle' });
  await pauseRotation(delayed);
  await tab(delayed, 0).click(); await settled(delayed, 0);
  await tab(delayed, 8).click(); await delayed.waitForTimeout(250);
  assert.ok((await delayed.locator('.showcase-slide.is-active').getAttribute('src')).endsWith('editor-dark.webp'));
  await delayed.emulateMedia({ reducedMotion: 'reduce' }); await delayed.waitForTimeout(1200); await settled(delayed, 0);
  await tab(delayed, 8).click();
  await settled(delayed, 8);
  await delayed.setViewportSize({ width: 1100, height: 900 }); await settled(delayed, 8);
  await delayed.close();

  const failed = await browser.newPage();
  await failed.route('**/screenshots/voice.webp', route => route.abort());
  await failed.goto(url, { waitUntil: 'networkidle' });
  await pauseRotation(failed);
  await tab(failed, 0).click(); await settled(failed, 0);
  await tab(failed, 8).click(); await failed.getByRole('status').waitFor(); await settled(failed, 0);
  await failed.unroute('**/screenshots/voice.webp');
  await tab(failed, 8).click(); await settled(failed, 8); await failed.close();
  console.log('PASS slow image decode, failed-image recovery and resize without blank frames');

  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow on mobile');
  await tab(page, 5).click(); await settled(page, 5);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload({ waitUntil: 'networkidle' });
  await settled(page, 0);
  for (const selector of ['.site-nav', '.hero-line > span', '.hero-actions', '.showcase-carousel', '.cloud']) {
    assert.equal(await page.locator(selector).first().evaluate(element => getComputedStyle(element).animationName), 'none', `Reduced motion skips intro and ambient motion: ${selector}`);
    assert.equal(await page.locator(selector).first().evaluate(element => getComputedStyle(element).opacity), '1');
  }
  assert.equal(await page.locator('video').evaluate(video => video.paused), true, 'Reduced motion disables video autoplay');
  await page.waitForTimeout(6500); await settled(page, 0);
  await tab(page, 9).click(); await settled(page, 9);
  await page.getByRole('button', { name: 'Play Snap product film', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video').currentTime > .5);
  assert.equal(errors.length, 0, errors.join('\n')); assert.equal(broken.length, 0, broken.join('\n'));
  console.log('PASS responsive layout, mobile navigation, reduced-motion preferences, manual video fallback and no broken media/page errors');
} finally { await browser.close(); }
