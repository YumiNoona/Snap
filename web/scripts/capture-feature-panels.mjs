// Capture the real desktop React tools in an isolated browser fixture.
// The host supplies demo state only: no recording, transcription or native work runs.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(root, 'web/public/screenshots/tour');
const scratch = path.join(root, 'web/test-results/feature-panels');
const base = process.env.SNAP_TEST_URL || 'http://127.0.0.1:1420';
const playwright = process.env.SNAP_PLAYWRIGHT_MODULE || 'C:/Users/Yuna/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwright).href);
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
let vite;
try { await fetch(`${base}/@vite/client`); }
catch {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const response = await fetch(`${base}/@vite/client`); if (response.ok) break; } catch { /* Startup in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
const manifest = { source: 'Real Snap React components with demo state; no native operations performed.', deviceScaleFactor: 2, assets: {} };
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__feature-capture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' }));
  await page.addInitScript(origin => {
    const callbacks = new Map(); let id = 0;
    globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    globalThis.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'editor' }, currentWebview: { label: 'editor' } },
      transformCallback(callback) { callbacks.set(++id, callback); return id; },
      convertFileSrc(value) { return /^https?:/.test(value) ? value : `${origin}/${value.replace(/^\//, '')}`; },
      async invoke(command) {
        if (command === 'list_cursor_packs') return ['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet'].map(name => ({ name, label: name, pointer_path: `/Cursors/${name}/Cursor.png`, pointer_url: `${origin}/Cursors/${name}/Cursor.png`, states: [] }));
        if (command === 'get_system_cursor') throw new Error('Browser fixture uses the neutral pointer fallback');
        if (command === 'read_input_log') return [];
        if (command === 'transcription_environment') return { available: true, executablePath: 'demo/whisper', modelPath: 'demo/base.bin', installedModels: ['base'], message: 'Ready' };
        if (command === 'probe_media_duration') return 24;
        if (command === 'editor_cached_media') return '/Wallpapers/previews/ModernBlueWave.jpg';
        if (command === 'plugin:event|listen') return ++id;
        return null;
      },
    };
    localStorage.setItem('snap.editorMediaLibrary.v1', JSON.stringify({ assets: [
      { id: 'background-1', name: 'BlueWaves.jpg', kind: 'image', path: '/Wallpapers/previews/BlueWaves.jpg' },
      { id: 'background-2', name: 'ModernBlueWave.jpg', kind: 'image', path: '/Wallpapers/previews/ModernBlueWave.jpg' },
      { id: 'background-3', name: 'ColorWave.jpg', kind: 'image', path: '/Wallpapers/previews/ColorWave.jpg' },
      { id: 'background-4', name: 'Abstract.jpg', kind: 'image', path: '/Wallpapers/previews/Abstract.jpg' },
      { id: 'clip-1', name: 'Screen recording.mp4', kind: 'video', path: 'demo/Screen recording.mp4', duration: 24 },
    ] }));
  }, base);
  await page.goto(`${base}/__feature-capture`);
  await page.evaluate(async () => {
    const RefreshRuntime = (await import('/@react-refresh')).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: Panels } = await import('/src/components/Editor/Panels/index.tsx');
    const { default: GraphEditor } = await import('/src/components/Editor/GraphEditor.tsx');
    const { DEFAULT_EDITOR_CONFIG } = await import('/src/lib/types.ts');
    const { DEFAULT_COLOR_GRADE } = await import('/src/lib/colorGrade.ts');
    const { DEFAULT_SCREEN_TILT } = await import('/src/lib/screenTilt.ts');
    await import('/src/App.css');
    await import('/src/GlassSurfaces.css');
    await import('/src/components/Editor/Editor.css');
    const style = document.createElement('style');
    style.textContent = 'html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#111} .capture-root.screenstudio-editor-layout{display:block;padding:0;width:100%;height:100%;min-height:0} .capture-root .ss-panels-drawer{position:relative;inset:auto;width:100%!important;height:100%;max-height:none;margin:0;border-radius:16px;animation:none} .capture-root .ss-drawer-content{height:100%;max-height:100%;overflow-y:auto} .capture-root .ss-panels-drawer>*{box-sizing:border-box} .capture-root .graph-backdrop{background:#111;backdrop-filter:none} .graph-editor{background:#171717!important}';
    document.head.append(style);
    document.body.className = 'window-editor'; document.body.dataset.editorTheme = 'dark';
    const noop = () => {};
    const audio = [
      { id: 'system', label: 'System audio', kind: 'system', path: 'demo/system.wav', volume: .7, muted: false, start: 0, end: 24 },
      { id: 'microphone', label: 'Microphone', kind: 'microphone', path: 'demo/microphone.wav', volume: 1, muted: false, start: 0, end: 24 },
    ];
    const initial = { ...structuredClone(DEFAULT_EDITOR_CONFIG), trimEnd: 24, bgType: 'gradient', padding: 48,
      cursorStyle: { ...DEFAULT_EDITOR_CONFIG.cursorStyle, size: 32 },
      actionOverlay: { ...DEFAULT_EDITOR_CONFIG.actionOverlay, enabled: true },
      motionBlur: { enabled: true, zoomAmount: 25, panAmount: 20, cursorAmount: 30 },
      cursorMovement: { enabled: true, speed: 'medium', durationMs: 600 },
      zoomMovement: { enabled: true, speed: 'slow', durationMs: 800, curve: 'smoother' },
      screenTilt: { ...DEFAULT_SCREEN_TILT, enabled: true, tiltX: 18, tiltY: -24, scale: .9, keys: [{ ...DEFAULT_SCREEN_TILT, time: 0, tiltX: 18, tiltY: -24, scale: .9, easing: 'smoother' }] },
      colorGrade: { ...DEFAULT_COLOR_GRADE, look: 'cinema', exposure: .2, contrast: 12, saturation: 110, warmth: 8, curves: { master: [{x:0,y:0},{x:.25,y:.19},{x:.75,y:.82},{x:1,y:1}] } },
      audio: { ...DEFAULT_EDITOR_CONFIG.audio, systemVolume: 65, micVolume: 100 },
    };
    const graphTracks = [{ id: 'zoom', name: 'Camera zoom', maximum: 24, zoom: true,
      keys: [{time:0,scale:1,easing:'smoother'}, {time:3,scale:1.65,easing:'smoother'}, {time:8,scale:1.65,easing:'smoother'}, {time:11,scale:1,easing:'smoother'}, {time:16,scale:1.9,easing:'smoother'}, {time:21,scale:1,easing:'smoother'}],
      channels: [{id:'scale',name:'Zoom',min:1,max:2.5,step:.05}], base: {time:0,scale:1,easing:'smoother'}, onChange: noop, seek: noop }];
    function Harness() {
      const [tab, setTab] = React.useState('canvas');
      const [config, setConfig] = React.useState(initial);
      const [graph, setGraph] = React.useState(false);
      globalThis.captureFixture = { setTab, setConfig, setGraph, config, initial };
      const props = { config, onConfigChange: setConfig, colorConfig: config, onColorConfigChange: setConfig,
        comparison: {enabled:false,split:.5,reverse:false}, onComparison:noop, inputLogPath:'', duration:24, sequenceLength:24, currentTime:0,
        layers:[], selectedLayerId:null, activeTab:tab, onAddLayer:noop, onSelectLayer:noop, onAddManualZoom:noop, onRegenerateAutoZoom:noop,
        onZoomModeChange:mode=>setConfig(c=>({...c,zoomMode:mode})), selectedZoomRegion:null, onSelectedZoomChange:noop, onClearSelectedZoom:noop,
        onDeleteSelectedZoom:noop, audioTracks:audio, audioError:'', onAddAudio:noop, onAddAudioSources:async()=>{}, onAddMediaToTimeline:noop,
        onAddManualCaption:noop, onAudioTracksChange:noop, captionTracks:[], onCaptionTracksChange:noop, selectedCaption:null, onSelectCaption:noop,
        selectedActionId:null, onSelectAction:noop, onSnapLayerToAction:async()=>{},
      };
      return React.createElement('main',{className:'capture-root screenstudio-editor-layout','data-theme':'dark'},
        React.createElement(Panels,{...props,key:tab}), graph && React.createElement(GraphEditor,{tracks:graphTracks,fps:60,onClose:()=>setGraph(false)}));
    }
    ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(Harness));
  });
  await page.locator('.ss-panels-drawer').waitFor();
  const settle = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    await page.waitForTimeout(100);
  };
  const capture = async (name, description, selector = '.ss-panels-drawer') => {
    await settle();
    const png = await page.locator(selector).screenshot({ animations: 'disabled' });
    const destination = path.join(output, `${name}.webp`);
    await sharp(png).webp({ quality: 97 }).toFile(destination);
    const { width, height } = await sharp(png).metadata();
    manifest.assets[name] = { file: `${name}.webp`, width, height, description };
    console.log(`${name}: ${width}x${height} ${destination}`);
  };
  const tab = async name => { await page.evaluate(value => captureFixture.setTab(value), name); await page.waitForTimeout(120); };
  const scrollTo = async text => page.getByText(text, { exact: true }).first().evaluate(element => {
    const scroller = element.closest('.ss-drawer-content');
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
  });

  await capture('canvas-gradients', 'Canvas styling with built-in gradients and custom gradient stops.');
  await page.getByRole('button', { name: 'Colors', exact: true }).click();
  await capture('canvas-colors', 'Canvas background colors and custom color picker.');
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await capture('canvas-images', 'Wallpaper library and Add image import control.');
  await tab('cursor'); await capture('cursor', 'Default pointer, five real cursor packs, and click effects.');
  await tab('motion'); await capture('motion-blur', 'Enabled motion blur and cursor movement controls.');
  await scrollTo('Zoom & Pan'); await capture('auto-zoom', 'Automatic camera style, intent, and shot timing controls.');
  await scrollTo('Zoom Movement'); await capture('camera-curves', 'Camera curve, transition, and duration controls.');
  await tab('tilt'); await capture('tilt', 'Isometric 3D tilt with animation keyframe controls.');
  await tab('annotations'); await capture('layers', 'Text, shapes, and masks.');
  await tab('actions'); await capture('actions', 'Keys, clicks, and action overlay styling.');
  await tab('audio'); await capture('audio', 'Independent system and microphone mixing.');
  await tab('captions'); await page.getByRole('button', { name: 'Generate Captions', exact: true }).waitFor();
  await capture('captions', 'Model-ready automatic captions controls; demo environment, no transcription executed.');
  await tab('color'); await capture('color-looks', 'Film looks and basic color correction.');
  await scrollTo('Adjustments'); await capture('color-correction', 'Exposure, contrast, saturation, warmth, grading scope, and LUT controls.');
  await scrollTo('RGB curves'); await capture('rgb-curves', 'Real RGB curve editor with a gentle S curve.');
  await tab('uploads'); await capture('uploads', 'Real media library with sample app wallpaper assets.');
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.locator('.uploads-drawer-content').dispatchEvent('dragenter', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  await capture('media-drop', 'Active drag-and-drop media target.');
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.evaluate(() => captureFixture.setGraph(true));
  await page.locator('.graph-editor').waitFor();
  await capture('keyframe-graph', 'Camera zoom keyframes and animation curves.', '.graph-editor');
  manifest.errors = errors;
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const thumbs = await Promise.all(Object.entries(manifest.assets).map(async ([name, asset]) => ({ input: await sharp(path.join(output, asset.file)).resize({ width: 210, height: 410, fit: 'contain', background: '#111' }).toBuffer(), name })));
  const columns = 6, rows = Math.ceil(thumbs.length / columns);
  await sharp({ create: { width: columns * 210, height: rows * 410, channels: 3, background: '#111' } }).composite(thumbs.map((thumb, i) => ({ input: thumb.input, left: (i % columns) * 210, top: Math.floor(i / columns) * 410 }))).png().toFile(path.join(scratch, 'contact-sheet.png'));
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  if (vite) vite.kill();
}
