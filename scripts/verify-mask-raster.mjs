// Optional real-Chromium canvas regression check. Run against `npm run dev`:
// SNAP_PLAYWRIGHT_MODULE may point at an installed Playwright index.mjs.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.SNAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await page.goto(process.env.SNAP_TEST_URL || 'http://localhost:1420');
  const checks = await page.evaluate(async () => {
    const { drawMaskLayer } = await import('/src/lib/canvasDraw.ts');
    const results = [];
    const source = document.createElement('canvas'); source.width = 256; source.height = 144;
    const s = source.getContext('2d');
    for (let x = 0; x < 256; x += 2) { s.fillStyle = x % 4 ? '#3094e8' : '#ef5038'; s.fillRect(x, 0, 2, 144); }
    const pixel = (g, x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    const whole = { x: 0, y: 0, w: 256, h: 144 }, rect = { x: 120, y: 60, w: 80, h: 50 };
    const same = (a, b) => a.every((value, index) => value === b[index]);
    document.body.replaceChildren(); document.body.style.cssText = 'background:#18181c;display:grid;grid-template-columns:repeat(3,256px);gap:20px;padding:25px;color:white;font:14px Arial';
    for (const mask of ['spotlight', 'blur', 'magnifier', 'pixelate', 'redact', 'colorFocus']) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
      const g = canvas.getContext('2d');
      const layer = { id:mask, type:'mask', mask, start:0, end:5, x:.2,y:.2,w:.3,h:.3, shape:'rectangle', opacity:1, feather:0, intensity:mask === 'blur' ? 8 : mask === 'pixelate' ? 16 : mask === 'magnifier' ? 2 : 1, borderWidth:0 };
      g.drawImage(source, 0, 0); drawMaskLayer(g, layer, source, whole, whole, rect);
      const inside = pixel(g, 160, 85), outside = pixel(g, 40, 40);
      results.push({ name: `${mask}: correct marked region`, pass: mask === 'spotlight' || mask === 'colorFocus' ? same(inside, pixel(s,160,85)) : !same(inside, pixel(s,160,85)) });
      results.push({ name: `${mask}: outside behavior`, pass: mask === 'spotlight' || mask === 'colorFocus' ? !same(outside, pixel(s,40,40)) : same(outside,pixel(s,40,40)) });
      results.push({ name: `${mask}: opaque output`, pass: inside[3] === 255 && outside[3] === 255 });
      g.clearRect(0,0,256,144); g.drawImage(source,0,0);
      drawMaskLayer(g,{...layer,rotation:90},source,whole,whole,{x:130,y:65,w:80,h:20});
      const rotatedInside=pixel(g,170,45),rotatedOutside=pixel(g,145,75),outsideEffect=['spotlight','colorFocus'].includes(mask);
      results.push({name:`${mask}: rotated area follows outline`,pass:outsideEffect ? same(rotatedInside,pixel(s,170,45)) && !same(rotatedOutside,pixel(s,145,75)) : !same(rotatedInside,pixel(s,170,45)) && same(rotatedOutside,pixel(s,145,75))});
      g.clearRect(0,0,256,144); g.drawImage(source,0,0); drawMaskLayer(g,layer,source,whole,whole,rect);
      const card = document.createElement('div'), label = document.createElement('p'); label.textContent = mask; card.append(label, canvas); document.body.append(card);
      if (['blur','pixelate'].includes(mask)) {
        g.clearRect(0,0,256,144); g.drawImage(source,0,0); drawMaskLayer(g,{...layer,inverted:true},source,whole,whole,rect);
        results.push({ name:`${mask}: inverted area`, pass:same(pixel(g,160,85),pixel(s,160,85)) && !same(pixel(g,40,40),pixel(s,40,40)) });
        g.clearRect(0,0,256,144); g.drawImage(source,0,0); drawMaskLayer(g,{...layer,feather:8},source,whole,whole,rect);
        results.push({ name:`${mask}: feather reaches edge`, pass:!same(pixel(g,118,85),pixel(s,118,85)) && same(pixel(g,40,40),pixel(s,40,40)) });
      }
    }
    // Stacked effects must never reveal an opaque redaction by sampling the original.
    const canvas = document.createElement('canvas'); canvas.width=256;canvas.height=144;const g=canvas.getContext('2d');g.drawImage(source,0,0);
    drawMaskLayer(g,{ mask:'redact',intensity:1,coverColor:'#151515' },source,whole,whole,rect);
    const snapshot=document.createElement('canvas');snapshot.width=256;snapshot.height=144;snapshot.getContext('2d').drawImage(canvas,0,0);
    drawMaskLayer(g,{mask:'pixelate',shape:'rectangle',intensity:8,feather:0,opacity:1},snapshot,whole,whole,rect);
    results.push({name:'stack preserves opaque redaction',pass:same(pixel(g,160,85),[21,21,21,255])});
    return results;
  });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path:'test-results/mask-raster.png' });
  for (const check of checks) { console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`); }
  assert.ok(checks.every(check => check.pass), 'Mask raster regression failed');
  // Exercise the actual React player with browser pointer capture and layout.
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: Player } = await import('/src/components/Editor/PreviewPlayer.tsx');
    await import('/src/components/Editor/Editor.css');
    document.body.style.cssText='margin:0;background:linear-gradient(135deg,#29453f,#172735,#45322b);';
    document.body.replaceChildren();
    const area=document.createElement('div');area.style.cssText='position:relative;width:900px;height:540px;';document.body.append(area);
    globalThis.playerActions=[];
    ReactDOM.createRoot(area).render(React.createElement(Player,{position:2,duration:27,playing:false,muted:false,volume:80,hasCaptions:true,captionsVisible:true,onCaptions:()=>globalThis.playerActions.push('cc'),onActivity:()=>{},onSeek:()=>{},onToggle:()=>{},onMute:()=>{},onVolume:()=>{}}));
  });
  await page.getByRole('button',{name:'Preview captions',exact:true}).click();
  assert.equal(await page.evaluate(()=>globalThis.playerActions[0]),'cc');
  const handle = page.getByRole('button',{name:'Move playback controls',exact:true});
  const before = await page.locator('.ss-preview-player').boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
  await page.mouse.move(240,120,{steps:10});await page.mouse.up();
  const after = await page.locator('.ss-preview-player').boundingBox();
  assert.ok(Math.abs(after.x-before.x)>50 && Math.abs(after.y-before.y)>50,'Player dock must move');
  assert.ok(after.x>=8 && after.y>=8 && after.x+after.width<=892 && after.y+after.height<=532,'Player dock remains within the preview');
  assert.equal(await page.locator('.ss-preview-player small').count(),0);
  await page.screenshot({path:'test-results/preview-player.png'});
  console.log('PASS player CC, browser drag capture, viewport bounds and icon-only controls');
} finally { await browser.close(); }
