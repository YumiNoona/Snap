// Optional browser check for launcher artwork and the native-file-drop library UI.
// Run against `npm run dev`; SNAP_PLAYWRIGHT_MODULE can point to Playwright.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.SNAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 340 } });
  await page.addInitScript(() => {
    const callbacks = new Map(), events = new Map();
    let callbackId = 0;
    globalThis.surfaceTest = { calls: [], nextFile: null };
    globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    globalThis.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: callback => { const id = ++callbackId; callbacks.set(id, callback); return id; },
      invoke: async (command, args) => {
        surfaceTest.calls.push({ command, args });
        if (command === 'plugin:event|listen') {
          const listeners = events.get(args.event) || [];
          listeners.push(args.handler); events.set(args.event, listeners);
          return args.handler;
        }
        if (command === 'enumerate_targets') return [{ id: 'monitor:0', name: 'Display 1', target_type: 'monitor' }];
        if (command === 'enumerate_audio_devices') return [{ id: 'default', name: 'Default microphone', device_type: 'microphone' }];
        if (command === 'enumerate_video_devices' || command === 'list_recordings') return [];
        if (command === 'get_videos_dir') return 'C:\\Videos';
        if (command === 'resolve_recording_log_path') return '';
        if (command === 'microphone_preview_level') return 0;
        if (command === 'plugin:dialog|open') return surfaceTest.nextFile;
        return null;
      },
    };
    surfaceTest.emit = (event, payload = {}) => {
      for (const id of events.get(event) || []) callbacks.get(id)?.({ event, id, payload });
    };
    localStorage.setItem('snap.settings', JSON.stringify({ autoCheckUpdates: false }));
  });
  const base = process.env.SNAP_TEST_URL || 'http://localhost:1420';
  await mkdir('test-results', { recursive: true });
  await page.goto(base);
  await page.locator('.wallpaper-preview').first().waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const wallpapers = await page.locator('.wallpaper-preview').evaluateAll(elements => elements.map(element => ({
    parent: getComputedStyle(element).filter,
    image: getComputedStyle(element, '::before').filter,
    background: getComputedStyle(element, '::before').backgroundImage,
  })));
  assert.equal(wallpapers.length, 4);
  assert.ok(wallpapers.every(style => style.parent === 'none' && style.image.includes('brightness(1.05)') && style.background.includes('recorder-panel.jpg')), 'Only artwork receives the brighter filter');
  assert.equal(await page.locator('.card-title-text').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(12, 12, 14, 0.62)', 'Footer chrome remains unchanged');
  await page.screenshot({ path: 'test-results/recorder-brighter-artwork.png' });

  await page.setViewportSize({ width: 760, height: 600 });
  await page.goto(`${base}/?window=library`);
  const zone = page.getByRole('button', { name: 'Import video' });
  await zone.waitFor();
  assert.equal(await zone.evaluate(element => getComputedStyle(element).borderTopStyle), 'dashed');
  assert.equal(await zone.evaluate(element => getComputedStyle(element).alignItems), 'center');
  assert.equal(await page.locator('.import-card-label').textContent(), 'Drag and drop');
  assert.equal(await page.locator('.import-card-label').evaluate(element => getComputedStyle(element).opacity), '0.6');
  assert.equal(await page.getByRole('button', { name: 'Choose file', exact: true }).count(), 0);
  const assertCentered = async () => {
    const area = await zone.boundingBox();
    const icon = await page.locator('.import-card-icon').boundingBox();
    const label = await page.locator('.import-card-label').boundingBox();
    const center = area.x + area.width / 2;
    assert.ok(Math.abs(icon.x + icon.width / 2 - center) < 1 && Math.abs(label.x + label.width / 2 - center) < 1, 'Icon and label are centered horizontally');
    assert.ok(label.y >= icon.y + icon.height, 'Label sits below the icon');
    assert.ok(Math.abs((icon.y + label.y + label.height) / 2 - (area.y + area.height / 2)) < 1, 'Content group is centered vertically');
  };
  await assertCentered();
  await page.screenshot({ path: 'test-results/library-drop-zone.png' });
  await page.waitForFunction(() => surfaceTest.calls.some(call => call.command === 'plugin:event|listen' && call.args.event === 'tauri://drag-leave'));
  await page.evaluate(() => surfaceTest.emit('tauri://drag-enter', { paths: ['C:\\Videos\\demo.MP4'], position: { x: 200, y: 150 } }));
  await page.locator('.import-card.is-drag-over').waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal(await zone.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(229, 229, 227)', 'Accepted drags brighten the dashed outline');
  assert.equal(await page.locator('.library-window').evaluate(element => getComputedStyle(element, '::after').content), 'none', 'Drag feedback does not cover the whole library');
  await page.screenshot({ path: 'test-results/library-drop-zone-active.png' });
  await page.evaluate(() => surfaceTest.emit('tauri://drag-drop', { paths: ['C:\\Videos\\demo.MP4'], position: { x: 200, y: 150 } }));
  await page.waitForFunction(() => surfaceTest.calls.some(call => call.command === 'open_editor_window'));
  assert.equal(await page.evaluate(() => surfaceTest.calls.filter(call => call.command === 'open_editor_window').length), 1);
  assert.equal(await zone.isDisabled(), false);

  await page.evaluate(() => surfaceTest.emit('tauri://drag-drop', { paths: ['C:\\Pictures\\image.png'], position: { x: 200, y: 150 } }));
  await page.getByRole('alert').filter({ hasText: 'Choose an MP4' }).waitFor();
  assert.equal(await page.evaluate(() => surfaceTest.calls.filter(call => call.command === 'open_editor_window').length), 1);
  await page.evaluate(() => { surfaceTest.nextFile = 'C:\\Videos\\chosen.mov'; });
  await zone.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => surfaceTest.calls.filter(call => call.command === 'open_editor_window').length === 2);
  assert.equal(await page.getByRole('alert').count(), 0);

  await page.setViewportSize({ width: 420, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertCentered();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
  await page.screenshot({ path: 'test-results/library-drop-zone-compact.png' });
  console.log('PASS image-only brightness, centered upload icon/label, 60% text opacity, no Choose file button, native drops, keyboard file picker and compact layout');
} finally { await browser.close(); }
