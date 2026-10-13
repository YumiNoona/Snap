// A separate 35-second SaaS product film: paper, cobalt, kinetic type and UI.
// npm --prefix web run promo:studio [-- --stills]
// Deterministic 1080p/60 fps. Original screenshots and cursor assets are reused.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import sharp from 'sharp';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { productMusic, createProductAudioFilter } from './product-film-soundtrack.mjs';

const W = 1920, H = 1080, FPS = 60, DURATION = 35;
const boundaries = [0, 4, 9, 13.5, 18.5, 23.5, 28.5, 35];
const transition = 1.25;
const root = fileURLToPath(new URL('../../', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const output = join(publicDir, 'media');
const qa = fileURLToPath(new URL('../test-results/studio-film/', import.meta.url));
await mkdir(output, { recursive: true });
await mkdir(qa, { recursive: true });
await access(productMusic);
for (const weight of ['Regular', 'Bold']) {
  if (!GlobalFonts.registerFromPath(fileURLToPath(new URL(`./fonts/JetBrainsMono-${weight}.ttf`, import.meta.url)), 'Snap Studio Mono')) {
    throw new Error(`Could not load JetBrains Mono ${weight}`);
  }
}

const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
const nextCanvas = createCanvas(W, H), nextCtx = nextCanvas.getContext('2d');
for (const c of [ctx, nextCtx]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }
const images = {};
for (const name of ['motion', 'editor-dark', 'cursor-detail', 'film-looks', 'voice-detail', 'captions']) {
  images[name] = await loadImage(join(publicDir, 'screenshots', `${name}.webp`));
}
images.logo = await loadImage(join(publicDir, 'snap-logo.png'));
for (const name of ['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet']) {
  images[name] = await loadImage(join(root, 'public', 'Cursors', name, 'Cursor.png'));
}
const palette = { paper: '#f4f3ec', ink: '#14233a', blue: '#345bf5', muted: '#687482', light: '#e3eafa', white: '#ffffff', mint: '#dce9de' };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10); };
const mix = (a, b, p) => a + (b - a) * p;
// Prepare panels before the aperture uncovers them, keeping UI pixels crisp.
const enter = (dt, delay = 0, span = 1.15) => ease((dt + 1.3 - delay) / span);
const rgb = hex => hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16));
const colorMix = (a, b, p) => { const ca = rgb(a), cb = rgb(b); return `rgb(${ca.map((v, i) => Math.round(mix(v, cb[i], p))).join(',')})`; };
function round(c, x, y, w, h, r = 24) { c.beginPath(); c.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2))); }
function box(c, x, y, w, h, fill, radius = 28, border) {
  round(c, x, y, w, h, radius); c.fillStyle = fill; c.fill();
  if (border) { c.lineWidth = 1.5; c.strokeStyle = border; c.stroke(); }
}
function type(c, value, x, y, size = 28, color = palette.ink, bold = false, align = 'left', maxWidth = W - 160) {
  c.font = `${bold ? 700 : 400} ${size}px "Snap Studio Mono"`;
  if (c.measureText(value).width > maxWidth) throw new Error(`Title exceeds its layout: ${value}`);
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillText(value, x, y);
}
function reveal(c, value, x, baseline, size, p, color = palette.ink, maxWidth = W - 160) {
  c.save(); c.beginPath(); c.rect(x - 4, baseline - size * 1.22, maxWidth + 8, size * 1.5); c.clip();
  c.globalAlpha *= p; type(c, value, x, baseline + mix(size * 1.16, 0, p), size, color, true, 'left', maxWidth); c.restore();
}
function pill(c, value, x, y, w, { color = palette.ink, fill = '#ffffff', size = 24, h = 60 } = {}) {
  box(c, x, y, w, h, fill, h / 2); type(c, value, x + w / 2, y + h / 2 + size * .35, size, color, true, 'center', w - 28);
}
function imageCard(c, name, x, y, w, h, { crop, angle = 0, alpha = 1, radius = 24, shadow = true, fill = '#101212' } = {}) {
  if (alpha <= 0) return;
  const image = images[name];
  if (crop && (crop.x < 0 || crop.y < 0 || crop.x + crop.w > image.width + .01 || crop.y + crop.h > image.height + .01)) throw new Error(`Invalid source crop: ${name}`);
  c.save(); c.globalAlpha *= alpha; c.translate(x + w / 2, y + h / 2); c.rotate(angle * Math.PI / 180);
  x = -w / 2; y = -h / 2;
  if (shadow) { c.shadowColor = '#18243a25'; c.shadowBlur = 34; c.shadowOffsetY = 18; }
  box(c, x, y, w, h, fill, radius); c.shadowBlur = 0; c.shadowOffsetY = 0;
  c.save(); round(c, x, y, w, h, radius); c.clip();
  if (crop) c.drawImage(image, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  else { const s = Math.min(w / image.width, h / image.height); c.drawImage(image, x + (w - image.width * s) / 2, y + (h - image.height * s) / 2, image.width * s, image.height * s); }
  c.restore(); c.lineWidth = 1.25; c.strokeStyle = '#26395522'; round(c, x + .6, y + .6, w - 1.2, h - 1.2, radius); c.stroke(); c.restore();
}
function cursor(c, name, x, y, size) {
  const image = images[name], s = size / Math.max(image.width, image.height);
  c.drawImage(image, x - image.width * s / 2, y - image.height * s / 2, image.width * s, image.height * s);
}
function arrow(c, x, y, scale = 1, color = '#ffffff') {
  c.save(); c.translate(x, y); c.scale(scale, scale); c.beginPath();
  c.moveTo(0, 0); c.lineTo(0, 38); c.lineTo(10, 28); c.lineTo(18, 47); c.lineTo(26, 43); c.lineTo(18, 25); c.lineTo(33, 25); c.closePath();
  c.fillStyle = color; c.fill(); c.strokeStyle = palette.ink; c.lineJoin = 'round'; c.lineWidth = 2.2; c.stroke(); c.restore();
}
function brand(c, x, y, size = 54) { c.drawImage(images.logo, x, y - size * .8, size, size); type(c, 'Snap', x + size + 17, y, size, palette.ink, true); }
function header(c, title, subtitle, dt) {
  const p = enter(dt), q = enter(dt, .16);
  c.save(); c.globalAlpha *= p; type(c, title, 960, 145 + mix(28, 0, p), 64, palette.ink, true, 'center'); c.restore();
  c.save(); c.globalAlpha *= q; type(c, subtitle, 960, 204 + mix(24, 0, q), 26, palette.muted, false, 'center'); c.restore();
}
function background(c, t) {
  c.fillStyle = palette.paper; c.fillRect(0, 0, W, H);
  const phase = t / DURATION * Math.PI * 2;
  const gradient = c.createRadialGradient(1550 + Math.sin(phase) * 70, 150 + Math.cos(phase) * 60, 0, 1500, 220, 1050);
  gradient.addColorStop(0, '#dce7fc'); gradient.addColorStop(1, '#f4f3ec00'); c.fillStyle = gradient; c.fillRect(0, 0, W, H);
  c.save(); c.strokeStyle = '#41577909'; c.lineWidth = 1;
  const dx = Math.sin(phase) * 16, dy = Math.cos(phase) * 14;
  for (let x = -70; x < W + 70; x += 96) { c.beginPath(); c.moveTo(x + dx, 0); c.lineTo(x + dx, H); c.stroke(); }
  for (let y = -70; y < H + 70; y += 96) { c.beginPath(); c.moveTo(0, y + dy); c.lineTo(W, y + dy); c.stroke(); }
  c.restore();
}
function orbit(c, x, y, r, t, alpha = 1) {
  c.save(); c.globalAlpha *= alpha; c.strokeStyle = '#345bf524'; c.lineWidth = 1.5;
  for (const radius of [r, r + 28, r + 56]) { c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = palette.blue; c.beginPath(); c.arc(x + Math.cos(t * .25) * r, y + Math.sin(t * .25) * r, 8, 0, Math.PI * 2); c.fill(); c.restore();
}

// The waveform is derived from the supplied music, not random per-frame data.
const audio = spawnSync(process.env.SNAP_FFMPEG || 'ffmpeg', ['-v', 'error', '-i', productMusic, '-t', String(DURATION), '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
if (audio.status !== 0) throw new Error(audio.stderr?.toString() || String(audio.error));
const waveform = Array.from({ length: 120 }, (_, i) => {
  const length = Math.floor(audio.stdout.length / 4 / 120), offset = i * length;
  let energy = 0; for (let j = 0; j < length; j++) energy += audio.stdout.readFloatLE((offset + j) * 4) ** 2;
  return Math.sqrt(energy / length);
});
const waveMax = Math.max(...waveform); waveform.forEach((value, index) => { waveform[index] = value / waveMax; });
function wave(c, x, y, w, h, progress, variant = 0) {
  for (let i = 0; i < waveform.length; i++) {
    const v = waveform[(i + variant * 23) % waveform.length];
    const amplitude = (variant ? .2 + .68 * v : .12 + .88 * v) * h;
    const strength = 1 - ease((i / waveform.length - progress) / .08);
    box(c, x + i * w / waveform.length, y - amplitude / 2, 3.6, Math.max(4, amplitude), colorMix('#cbd3de', variant ? '#588d7d' : palette.blue, strength), 2);
  }
}

function scene(c, index, t) {
  const dt = t - boundaries[index], p = enter(dt), drift = Math.sin(t * .55) * 5;
  c.save();
  if (index === 0) {
    const a = ease(dt / 1.2), b = ease((dt - .16) / 1.35);
    c.save(); c.globalAlpha *= a; brand(c, 128, 164, 64); c.restore();
    reveal(c, 'Record it.', 128, 449, 112, a, palette.ink, 970);
    reveal(c, 'Make it shine.', 128, 590, 112, b, palette.blue, 970);
    c.save(); c.globalAlpha *= ease((dt - .5) / 1.2);
    type(c, 'Your screen. Already directed.', 136, 707, 28, palette.muted, false, 'left', 890);
    c.restore();
    const arrival = ease((dt - .25) / 1.45); c.save(); c.globalAlpha *= arrival;
    c.translate(mix(110, 0, arrival), mix(35, 0, arrival));
    orbit(c, 1473, 542, 281, t, .85);
    box(c, 1230, 195, 475, 688, palette.blue, 190);
    imageCard(c, 'editor-dark', 1080, 339 + drift, 720, 384, { angle: mix(-5, -1, ease(dt / 4)) });
    box(c, 1315, 789 + drift, 300, 122, '#ffffff', 34, '#14233a12');
    cursor(c, 'Boo', 1374, 848 + drift, 62); cursor(c, 'Bee', 1465, 848 + drift, 62); cursor(c, 'Hornet', 1554, 848 + drift, 62);
    c.restore();
  } else if (index === 1) {
    header(c, 'A camera for your screen.', 'Automatic zoom. Smooth pan. Your timing.', dt);
    const focus = ease((dt - 1.05) / 1.45) * (1 - ease((dt - 3.45) / 1.45));
    const image = images.motion, target = { x: 490, y: 132, w: 1160, h: 1160 * image.height / image.width };
    const crop = { x: target.x * focus, y: target.y * focus, w: mix(image.width, target.w, focus), h: mix(image.height, target.h, focus) };
    c.save(); c.globalAlpha *= p; c.translate(0, mix(48, 0, p));
    box(c, 221, 244, 1478, 779, '#dce6fc', 42);
    imageCard(c, 'motion', 258, 273, 1404, 752, { crop, radius: 20 });
    pill(c, `${mix(1, 1.65, focus).toFixed(1)}×`, 1550, 252, 142, { fill: palette.blue, color: '#ffffff', size: 30, h: 68 });
    c.restore();
  } else if (index === 2) {
    header(c, 'Your cursor. Your character.', 'Custom styles and click effects, in a click.', dt);
    imageCard(c, 'editor-dark', 130 + mix(-45, 0, p), 290 + drift, 1010, 539, { alpha: p, angle: -.6 });
    const detail = enter(dt, .2); imageCard(c, 'cursor-detail', 1215 + mix(60, 0, detail), 267, 337, 448, { alpha: detail, radius: 27 });
    c.save(); c.globalAlpha *= enter(dt, .5); box(c, 1600, 295, 197, 475, '#dde5fa', 46);
    const click = ease((dt - 1.1) / 1.2), pulse = ease((dt - 2.15) / 1.3);
    for (let i = 0; i < 3; i++) { c.globalAlpha = p * (1 - pulse) * .5; c.strokeStyle = palette.blue; c.lineWidth = 2; c.beginPath(); c.arc(1697, 532, 22 + pulse * 94 + i * 16, 0, Math.PI * 2); c.stroke(); }
    c.globalAlpha = p; c.save(); c.translate(1683, 507); c.scale(1 - .12 * Math.sin(click * Math.PI), 1 - .12 * Math.sin(click * Math.PI)); arrow(c, 0, 0, 1.35); c.restore(); c.restore();
    const strip = enter(dt, .4); c.save(); c.globalAlpha *= strip; const sy = 889 + mix(40, 0, strip);
    box(c, 362, sy - 61, 1200, 132, '#ffffff', 40, '#14233a12');
    const position = ease((dt - .7) / 2.9) * 4;
    box(c, 404 + position * 230, sy - 41, 96, 96, '#e4eaff', 28);
    ['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet'].forEach((name, i) => cursor(c, name, 451 + i * 230, sy + 7, 68)); c.restore();
  } else if (index === 3) {
    header(c, 'Give it your signature.', 'Backgrounds, framing and film looks.', dt);
    const change = ease((dt - 1) / 2.4), tilt = Math.sin(clamp((dt + .4) / 5) * Math.PI) * -2;
    c.save(); c.globalAlpha *= p; c.translate(995, 624 + mix(42, 0, p)); c.rotate(tilt * Math.PI / 180);
    const g = c.createLinearGradient(-570, -338, 570, 338); g.addColorStop(0, colorMix('#cbdce8', '#b4c8ff', change)); g.addColorStop(1, colorMix('#cbe4d8', '#f2cbe8', change));
    box(c, -570, -338, 1140, 676, g, 44);
    imageCard(c, 'motion', -514, -265, 1028, 512, { crop: { x: 499, y: 139, w: 975, h: 486 }, radius: mix(14, 36, change) }); c.restore();
    c.save(); c.globalAlpha *= enter(dt, .25); box(c, 128, 371, 236, 355, '#ffffff', 34, '#14233a12');
    type(c, 'Your palette', 246, 429, 20, palette.muted, true, 'center', 208);
    ['#cbded9', '#b4c8ff', '#f2cbe8'].forEach((color, i) => { c.beginPath(); c.arc(246, 491 + i * 78, 25, 0, Math.PI * 2); c.fillStyle = color; c.fill(); });
    c.strokeStyle = palette.blue; c.lineWidth = 2.5; c.beginPath(); c.arc(246, 491 + change * 156, 33, 0, Math.PI * 2); c.stroke(); c.restore();
    imageCard(c, 'film-looks', 1630, 307 + drift, 225, 406, { crop: { x: 85, y: 91, w: 337, h: 608 }, alpha: enter(dt, .42), radius: 24 });
  } else if (index === 4) {
    header(c, 'Sound as good as it looks.', 'Separate tracks. A little voice polish.', dt);
    c.save(); c.globalAlpha *= p; c.translate(mix(-40, 0, p), 0);
    box(c, 128, 294, 1055, 580, '#ffffff', 42, '#14233a12');
    type(c, 'Desktop', 177, 362, 28, palette.ink, true); type(c, 'Microphone', 177, 627, 28, palette.ink, true);
    const progress = ease((dt - .3) / 4.1);
    wave(c, 178, 453, 951, 119, progress); wave(c, 178, 722, 951, 117, progress, 1);
    c.beginPath(); c.moveTo(178, 560); c.lineTo(1130, 560); c.strokeStyle = '#14233a12'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.moveTo(178 + progress * 951, 393); c.lineTo(178 + progress * 951, 786); c.strokeStyle = palette.blue; c.lineWidth = 2; c.stroke();
    c.restore();
    imageCard(c, 'voice-detail', 1260 + mix(54, 0, enter(dt, .28)), 300 + drift, 516, 488, { alpha: enter(dt, .28), radius: 28 });
    c.save(); c.globalAlpha *= enter(dt, .52); pill(c, 'Two tracks. One clear story.', 375, 922, 1170, { fill: '#e0e9e0', color: '#28493d', size: 28, h: 70 }); c.restore();
  } else if (index === 5) {
    header(c, 'Make every word count.', 'Local captions. Ready for every screen.', dt);
    imageCard(c, 'captions', 135 + mix(-40, 0, p), 277, 326, 575, { crop: { x: 76, y: 66, w: 350, h: 618 }, alpha: p, radius: 26 });
    const panel = enter(dt, .15); c.save(); c.globalAlpha *= panel;
    box(c, 538, 271 + mix(35, 0, panel), 1229, 649, '#dfe6f8', 44);
    imageCard(c, 'motion', 583, 315 + mix(35, 0, panel), 1140, 569, { crop: { x: 499, y: 139, w: 975, h: 486 }, radius: 20 });
    const words = ['Make', 'every', 'word', 'count.'], wordWidths = [96, 120, 96, 144], x = 823, y = 797;
    const positions = [0, 120, 264, 384], progress = clamp((dt - .7) / .86, 0, 3), from = Math.floor(progress), to = Math.min(3, from + 1), blend = ease(progress - from);
    box(c, x - 35, y - 52, 602, 80, '#101927f2', 22);
    box(c, x - 8 + mix(positions[from], positions[to], blend), y - 41, mix(wordWidths[from], wordWidths[to], blend) + 16, 57, palette.blue, 12);
    words.forEach((word, i) => type(c, word, x + positions[i], y, 40, '#ffffff', true));
    c.restore();
    c.save(); c.globalAlpha *= enter(dt, .55);
    const formatY = 975, widths = [49, 29, 40], heights = [29, 49, 40];
    widths.forEach((w, i) => { const px = 656 + i * 240; box(c, px, formatY - heights[i] / 2, w, heights[i], '#e0e7fb', 5, '#345bf5'); });
    type(c, '16:9', 725, 984, 21, palette.muted); type(c, '9:16', 951, 984, 21, palette.muted); type(c, '1:1', 1197, 984, 21, palette.muted); c.restore();
  } else {
    const arrival = enter(dt, 0, 1.2); c.save(); c.globalAlpha *= arrival;
    box(c, 921, 113, 931, 852, palette.blue, 104);
    c.save(); c.strokeStyle = '#ffffff25'; c.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(1390, 542, 255 + i * 48, 0, Math.PI * 2); c.stroke(); } c.restore();
    imageCard(c, 'editor-dark', 974 + mix(80, 0, arrival), 313 + drift, 834, 445, { angle: mix(2, 0, ease(dt / 4)), radius: 24 });
    box(c, 1074, 789 + drift, 130, 130, '#ffffff', 38); cursor(c, 'Boo', 1139, 854 + drift, 78);
    box(c, 1600, 184 - drift, 122, 122, '#ffffff', 38); cursor(c, 'Hornet', 1661, 245 - drift, 68);
    c.restore();
    c.save(); c.globalAlpha *= arrival; brand(c, 136, 319, 92); c.restore();
    reveal(c, 'Make the next', 136, 489, 70, enter(dt, .1), palette.ink, 735);
    reveal(c, 'one with Snap.', 136, 581, 70, enter(dt, .25), palette.ink, 735);
    c.save(); c.globalAlpha *= enter(dt, .48); pill(c, 'Free for Windows', 137, 666, 661, { fill: palette.blue, color: '#ffffff', h: 86, size: 30 });
    type(c, 'Local. Private. Yours.', 145, 816, 26, palette.muted, false, 'left', 680);
    type(c, 'snap.venusapp.in', 145, 885, 28, palette.blue, true); c.restore();
  }
  c.restore();
}

function render(t) {
  ctx.resetTransform(); ctx.globalAlpha = 1; background(ctx, t);
  let boundary = -1;
  for (let i = 1; i < boundaries.length - 1; i++) if (Math.abs(t - boundaries[i]) <= transition / 2) { boundary = i; break; }
  if (boundary > 0) {
    // The next complete canvas unfolds from a rounded product tile. Scaling
    // the whole page keeps titles inside the frame throughout the transition.
    const u = ease((t - boundaries[boundary] + transition / 2) / transition);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1 - .025 * u, 1 - .025 * u); ctx.translate(-W / 2, -H / 2); ctx.globalAlpha = 1 - .3 * u;
    scene(ctx, boundary - 1, t); ctx.restore();
    nextCtx.resetTransform(); nextCtx.globalAlpha = 1; background(nextCtx, t); scene(nextCtx, boundary, t);
    const origins = [[.72, .49], [.65, .52], [.48, .52], [.48, .5], [.61, .51], [.4, .48]];
    const [ox, oy] = origins[boundary - 1];
    const w = mix(0, W, u), h = mix(0, H, u), x = (W - w) * ox, y = (H - h) * oy;
    if (u > 0) {
      const radius = Math.min(190, h / 2) * (1 - u);
      ctx.save(); ctx.shadowColor = '#14233a24'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 16;
      box(ctx, x, y, w, h, palette.paper, radius); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      round(ctx, x, y, w, h, radius); ctx.clip(); ctx.drawImage(nextCanvas, x, y, w, h); ctx.restore();
    }
  } else {
    let index = 0; while (index < boundaries.length - 2 && t >= boundaries[index + 1]) index++;
    ctx.save(); ctx.globalAlpha = 1 - ease((t - 33.85) / 1.15); scene(ctx, index, t); ctx.restore();
  }
}

const sampleTimes = [2.5, 6.8, 11.25, 16.05, 21.2, 26, 31.3];
for (const [index, t] of sampleTimes.entries()) { render(t); await writeFile(join(qa, `scene-${index + 1}.png`), await canvas.encode('png')); }
for (const t of [0, .6, ...boundaries.slice(1, -1).flatMap(t => [t - .3, t, t + .3]), 34.4, 34.9833]) { render(t); await writeFile(join(qa, `transition-${t.toFixed(2)}.png`), await canvas.encode('png')); }
const sheet = createCanvas(1920, 1080), sheetCtx = sheet.getContext('2d'); sheetCtx.fillStyle = '#e4e4df'; sheetCtx.fillRect(0, 0, 1920, 1080);
for (const [index, t] of [...sampleTimes, 4, 23.5].entries()) { render(t); sheetCtx.drawImage(canvas, (index % 3) * 640, Math.floor(index / 3) * 360, 640, 360); }
await writeFile(join(qa, 'contact-sheet.png'), await sheet.encode('png'));
render(2.5); await sharp(await canvas.encode('png')).resize(1440).webp({ quality: 93 }).toFile(join(output, 'snap-studio-promo-poster.webp'));
const captions = ['Meet Snap. Record it. Make it shine.', 'A camera for your screen. Automatic zoom and smooth pan.', 'Your cursor. Your character. Custom cursors and click effects.', 'Give it your signature. Backgrounds, framing and film looks.', 'Sound as good as it looks. Separate tracks and voice polish.', 'Make every word count. Local captions and flexible formats.', 'Make the next one with Snap. Free for Windows. snap.venusapp.in'];
const timestamp = t => `00:${Math.floor(t).toString().padStart(2, '0')}.${Math.round(t % 1 * 1000).toString().padStart(3, '0')}`;
await writeFile(join(output, 'snap-studio-promo.vtt'), 'WEBVTT\n\n' + captions.map((value, i) => `${timestamp(boundaries[i])} --> ${timestamp(boundaries[i + 1])}\n${value}\n`).join('\n'));
console.log(`Review frames: ${qa}`);
if (process.argv.includes('--stills')) process.exit(0);

const film = join(output, 'snap-studio-promo.mp4');
const ffmpeg = spawn(process.env.SNAP_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0', '-i', productMusic, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-threads', '4', '-pix_fmt', 'yuv420p', '-af', createProductAudioFilter(DURATION), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(DURATION), '-movflags', '+faststart', film], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
let stderr = '', pipeError;
ffmpeg.stderr.on('data', data => { stderr += data; }); ffmpeg.stdin.on('error', error => { pipeError = error; });
const completion = new Promise((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`))); });
completion.catch(() => {});
for (let frame = 0; frame < DURATION * FPS; frame++) {
  if (pipeError) throw pipeError;
  render(frame / FPS); if (!ffmpeg.stdin.write(canvas.data())) await once(ffmpeg.stdin, 'drain');
  if (frame % (FPS * 5) === 0) console.log(`Rendered ${frame / FPS}/${DURATION} seconds`);
}
ffmpeg.stdin.end(); await completion;
console.log(`Created ${film}: 35 seconds, 1080p, 60 fps, JetBrains Mono and supplied OST.`);
