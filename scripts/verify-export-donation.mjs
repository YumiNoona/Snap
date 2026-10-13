// Optional real-browser UI regression check. Run against `npm run dev`.
// SNAP_PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.SNAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.addInitScript(() => {
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async command => command === 'get_exports_dir' ? 'C:\\Videos\\Exports' : undefined,
      transformCallback: () => 0,
    };
  });
  await page.goto(`${process.env.SNAP_TEST_URL || 'http://localhost:1420'}/?window=donate`);
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: ExportModal } = await import('/src/components/Editor/ExportModal.tsx');
    const { DEFAULT_EDITOR_CONFIG } = await import('/src/lib/types.ts');
    await import('/src/App.css');
    document.body.replaceChildren();
    document.body.className = 'window-editor';
    document.body.style.cssText = 'margin:0;background:#101012;';
    const container = document.createElement('div');
    container.id = 'donation-test-root';
    document.body.append(container);
    globalThis.donationTest = { requests: 0, opened: 0, closed: 0 };
    function Harness() {
      const [state, setState] = React.useState({ status: '', progress: 0, exportedPath: '' });
      donationTest.update = setState;
      return React.createElement(ExportModal, {
        videoPath: 'C:\\Videos\\recording.mp4', duration: 5,
        config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5 }, captionTrackCount: 0,
        ...state,
        onClose: () => donationTest.closed++, onCancel: () => {},
        onOpenFile: async () => { donationTest.opened++; },
        onExport: () => {
          donationTest.requests++;
          return new Promise(resolve => {
            donationTest.finish = (saved, status = saved ? 'Export Saved' : 'Export cancelled') => {
              setState({ status, progress: saved ? 1 : 0, exportedPath: saved ? 'C:\\Videos\\finished.mp4' : '' });
              resolve(saved);
            };
          });
        },
      });
    }
    const root = ReactDOM.createRoot(container);
    donationTest.reset = () => { root.render(React.createElement(Harness, { key: ++donationTest.generation })); };
    donationTest.generation = 0;
    donationTest.reset();
  });

  const donation = page.locator('.donate-modal');
  const start = page.getByRole('button', { name: 'Start export', exact: true });
  await start.click();
  assert.equal(await start.isDisabled(), true, 'Prevent duplicate requests while choosing/saving');
  assert.equal(await donation.count(), 0, 'No prompt before completion');
  await page.evaluate(() => donationTest.update({ status: 'Finalizing...', progress: 1, exportedPath: '' }));
  assert.equal(await donation.count(), 0, '100% progress alone is not success');
  await page.evaluate(() => donationTest.finish(true));
  await donation.waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Your video is saved' }).count(), 1);
  assert.equal(await page.locator('.donate-qr-frame img').evaluate(image => image.complete && image.naturalWidth > 0), true, 'QR image loads');
  assert.equal(await page.locator('#donation-test-root').evaluate(root => root.inert), true, 'Background stays out of the focus order');
  assert.equal(await page.getByRole('button', { name: 'Close donation panel' }).evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Not now' }).evaluate(button => document.activeElement === button), true, 'Reverse Tab wraps within the donation dialog');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Close donation panel' }).evaluate(button => document.activeElement === button), true, 'Tab wraps without the export dialog stealing focus');
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/export-donation-desktop.png' });
  await page.keyboard.press('Escape');
  assert.equal(await donation.count(), 0);
  assert.equal(await page.evaluate(() => donationTest.closed), 0, 'Escape closes only the donation dialog');
  assert.equal(await page.locator('#donation-test-root').evaluate(root => root.inert), false);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  assert.equal(await page.evaluate(() => donationTest.opened), 1, 'Finished video remains accessible');

  await page.getByRole('button', { name: 'Export again', exact: true }).click();
  await page.evaluate(() => donationTest.finish(true));
  await donation.waitFor();
  assert.equal(await page.evaluate(() => donationTest.requests), 2, 'Same-path repeat export prompts again');
  await page.setViewportSize({ width: 480, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const box = await donation.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 480 && box.y + box.height <= 680, 'Donation dialog fits a compact viewport');
  assert.equal(await donation.evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.screenshot({ path: 'test-results/export-donation-compact.png' });
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.setViewportSize({ width: 1100, height: 760 });

  for (const status of ['Export cancelled', 'Export failed: Encoder unavailable']) {
    await page.getByRole('button', { name: /Export again|Start export/ }).click();
    await page.evaluate(status => donationTest.finish(false, status), status);
    await page.waitForFunction(() => !document.querySelector('.export-start-button')?.disabled);
    assert.equal(await donation.count(), 0, `${status}: no donation prompt`);
  }
  await start.click();
  await page.evaluate(() => donationTest.finish(true, 'Export Saved — delivery package incomplete. Export again to retry.'));
  await donation.waitFor();
  await page.getByRole('button', { name: 'Not now' }).click();
  assert.ok(await page.locator('.export-progress.done').innerText().then(text => text.includes('delivery package incomplete')), 'Donation does not erase package warnings');
  console.log('PASS successful and repeat exports, failures/cancellation, QR loading, file access, keyboard focus, Escape, compact layout and reduced motion');
} finally {
  await browser.close();
}
