// Browser raster check using an actual Windows cursor snapshot produced by:
// $env:SNAP_SYSTEM_CURSOR_FIXTURE = "$PWD/test-results/system-cursor.json"
// cargo test --manifest-path src-tauri/Cargo.toml --lib system_cursor
// Run with `npm run dev`; SNAP_PLAYWRIGHT_MODULE can point to Playwright.
import { pathToFileURL } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture = JSON.parse(await readFile('test-results/system-cursor.json', 'utf8'));
const { chromium } = await import(process.env.SNAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.SNAP_TEST_BROWSER || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 390 } });
  await page.addInitScript(cursor => {
    globalThis.cursorTest = { calls: 0, cursor };
    globalThis.__TAURI_INTERNALS__ = { invoke: async command => {
      if (command === 'get_system_cursor') { cursorTest.calls++; return cursorTest.cursor; }
      return null;
    } };
  }, fixture);
  await page.goto(`${process.env.SNAP_TEST_URL || 'http://localhost:1420'}/?window=donate`);
  const checks = await page.evaluate(async () => {
    const { loadSystemCursor, drawSystemCursor } = await import('/src/lib/systemCursor.ts');
    const { DEFAULT_EDITOR_CONFIG } = await import('/src/lib/types.ts');
    const asset = await loadSystemCursor();
    if (!asset) throw new Error('Actual Windows pointer failed to decode');
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;padding:28px;background:#171719;color:#ededeb;font:13px system-ui;display:flex;gap:24px;';
    const results = [];
    const make = label => {
      const card = document.createElement('section');
      const title = document.createElement('p'); title.textContent = label;
      const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 240;
      canvas.style.cssText = 'border:1px solid #ffffff18;border-radius:12px;';
      const g = canvas.getContext('2d');
      g.fillStyle = '#303038'; g.fillRect(0,0,360,240);
      g.strokeStyle = '#ffffff10';
      for (let x=0;x<360;x+=24) { g.beginPath();g.moveTo(x,0);g.lineTo(x,240);g.stroke(); }
      for (let y=0;y<240;y+=24) { g.beginPath();g.moveTo(0,y);g.lineTo(360,y);g.stroke(); }
      card.append(title,canvas);document.body.append(card);return {canvas,g};
    };
    const preview = make('Default · Windows pointer');
    const exported = make('Same pointer · different click color');
    drawSystemCursor(preview.g,160,90,{...DEFAULT_EDITOR_CONFIG.cursorStyle,size:40,color:'#d58a55'},asset);
    drawSystemCursor(exported.g,160,90,{...DEFAULT_EDITOR_CONFIG.cursorStyle,size:40,color:'#ff0000'},asset);
    const a = preview.g.getImageData(0,0,360,240).data, b = exported.g.getImageData(0,0,360,240).data;
    results.push({name:'Windows image is identical regardless of old click-color tint',pass:a.every((value,index)=>value===b[index])});
    const icon = document.createElement('canvas');icon.width=asset.image.naturalWidth;icon.height=asset.image.naturalHeight;
    const iconCtx=icon.getContext('2d');iconCtx.drawImage(asset.image,0,0);
    const pixels=iconCtx.getImageData(0,0,icon.width,icon.height).data;
    results.push({name:'Native pointer has real transparent edges, not an opaque bitmap rectangle',pass:Array.from(pixels).some((value,index)=>index%4===3&&value===0)});
    const calls = cursorTest.calls;
    const scratch=document.createElement('canvas');scratch.width=360;scratch.height=240;
    const scratchCtx=scratch.getContext('2d');
    for(let i=0;i<60;i++) drawSystemCursor(scratchCtx,160,90,DEFAULT_EDITOR_CONFIG.cursorStyle,asset);
    results.push({name:'No Windows IPC or image decoding per frame',pass:cursorTest.calls===calls});
    await loadSystemCursor();
    results.push({name:'Preview and export share the same cached pointer',pass:cursorTest.calls===calls});
    const pngBytes=canvas=>Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
    const transparent=document.createElement('canvas');transparent.width=1;transparent.height=1;
    const inverse=document.createElement('canvas');inverse.width=1;inverse.height=1;inverse.getContext('2d').fillStyle='#fff';inverse.getContext('2d').fillRect(0,0,1,1);
    cursorTest.cursor={width:1,height:1,hotspotX:0,hotspotY:0,png:pngBytes(transparent),invertPng:pngBytes(inverse)};
    const inverted=await loadSystemCursor(true);
    const sample=document.createElement('canvas');sample.width=2;sample.height=2;const g=sample.getContext('2d');
    g.fillStyle='rgb(80,130,200)';g.fillRect(0,0,2,2);
    drawSystemCursor(g,0,0,{...DEFAULT_EDITOR_CONFIG.cursorStyle,size:1},inverted);
    const actual=Array.from(g.getImageData(0,0,1,1).data);
    results.push({name:'Inverted pointer pixels invert the real footage',pass:actual.join(',')==='175,125,55,255'&&g.globalCompositeOperation==='source-over'});
    return {dimensions:[asset.image.naturalWidth,asset.image.naturalHeight],hotspot:asset.hotspot,results};
  });
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/system-cursor-render.png'});
  for(const check of checks.results) console.log(`${check.pass?'PASS':'FAIL'} ${check.name}`);
  console.log(`Native pointer ${checks.dimensions.join(' × ')}; hotspot ${JSON.stringify(checks.hotspot)}`);
  assert.ok(checks.results.every(check=>check.pass),'System pointer raster regression failed');
} finally { await browser.close(); }
