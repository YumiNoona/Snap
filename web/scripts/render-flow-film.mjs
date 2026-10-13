// Signal / Flow — a continuous product stage, luminous ribbons and measured motion.
// npm --prefix web run promo:flow [-- --stills | --preview]
// Every frame is deterministic; original UI pixels, JetBrains Mono, supplied OST.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import sharp from 'sharp';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { productMusic, createProductAudioFilter } from './product-film-soundtrack.mjs';

const W = 1920, H = 1080, FPS = 60, DURATION = 36, AUDIO_START = 16.6;
const root = fileURLToPath(new URL('../../', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const output = join(publicDir, 'media');
const qa = fileURLToPath(new URL('../test-results/flow-film/', import.meta.url));
await Promise.all([mkdir(output, { recursive: true }), mkdir(qa, { recursive: true }), access(productMusic)]);
for (const weight of ['Regular', 'Bold']) {
  if (!GlobalFonts.registerFromPath(fileURLToPath(new URL(`./fonts/JetBrainsMono-${weight}.ttf`, import.meta.url)), 'Snap Flow Mono')) throw new Error(`Missing JetBrains Mono ${weight}`);
}
const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
const surface = createCanvas(1500, 804), sc = surface.getContext('2d');
const glow = createCanvas(960, 540), gc = glow.getContext('2d');
const images = {};
images.motion = await loadImage(join(publicDir, 'screenshots', 'motion.webp'));
images.logo = await loadImage(join(publicDir, 'snap-logo.png'));
for (const name of ['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet']) images[name] = await loadImage(join(root, 'public', 'Cursors', name, 'Cursor.png'));
for (const c of [ctx, sc, gc]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }

const P = { bg: '#070b10', white: '#f1f6f3', mint: '#bcffd6', blue: '#93b9ff', muted: '#96a8b1' };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10); };
const mix = (a, b, p) => a + (b - a) * p;
const ramp = (t, a, b) => ease((t - a) / (b - a));
const envelope = (t, a, b, d = .75) => ramp(t, a, a + d) * (1 - ramp(t, b - d, b));
const rgb = hex => hex.match(/[a-f0-9]{2}/gi).map(v => parseInt(v, 16));
const colorMix = (a, b, p) => { const ca = rgb(a), cb = rgb(b); return `rgb(${ca.map((v, i) => Math.round(mix(v, cb[i], p))).join(',')})`; };
function round(c, x, y, w, h, r = 24) { c.beginPath(); c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }
function box(c, x, y, w, h, fill, r = 24, stroke) {
  round(c, x, y, w, h, r); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.stroke(); }
}
function type(c, text, x, y, size, color = P.white, { bold = false, align = 'left', width = 1750 } = {}) {
  c.font = `${bold ? 700 : 400} ${size}px "Snap Flow Mono"`;
  if (c.measureText(text).width > width + .5) throw new Error(`Type overflow: ${text}`);
  c.textBaseline = 'alphabetic'; c.textAlign = align; c.fillStyle = color; c.fillText(text, x, y);
}
function maskedType(c, text, x, y, size, p, color = P.white, align = 'left', width = 1750) {
  if (p <= 0) return;
  c.save(); c.beginPath(); c.rect(align === 'center' ? x - width / 2 : x - 4, y - size * 1.2, width + 8, size * 1.45); c.clip();
  c.globalAlpha *= p; type(c, text, x, y + (1 - p) * size * .9, size, color, { bold: true, align, width }); c.restore();
}
function alpha(c, value, draw) { if (value <= .0001) return; c.save(); c.globalAlpha *= value; draw(); c.restore(); }
function line(c, points, color, width = 1) { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
function cursor(c, name, x, y, size, angle = 0) {
  const image = images[name], s = size / Math.max(image.width, image.height);
  c.save(); c.translate(x, y); c.rotate(angle); c.drawImage(image, -image.width * s / 2, -image.height * s / 2, image.width * s, image.height * s); c.restore();
}
function drawImage(c, name, x, y, w, h, crop) {
  const image = images[name];
  if (crop) {
    if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > image.width + .01 || crop.y + crop.h > image.height + .01) throw new Error(`Out-of-bounds crop: ${name}`);
    c.drawImage(image, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  } else c.drawImage(image, x, y, w, h);
}

// Sample the actual soundtrack for slow light breathing and the audio visual.
const audio = spawnSync(process.env.SNAP_FFMPEG || 'ffmpeg', ['-v', 'error', '-ss', String(AUDIO_START), '-i', productMusic, '-t', String(DURATION), '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
if (audio.status !== 0) throw new Error(audio.stderr?.toString() || String(audio.error));
const samples = audio.stdout.length / 4;
const energies = Array.from({ length: DURATION * 20 }, (_, i) => {
  let sum = 0; const a = Math.floor(i * samples / (DURATION * 20)), b = Math.floor((i + 1) * samples / (DURATION * 20));
  for (let n = a; n < b; n++) sum += audio.stdout.readFloatLE(n * 4) ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
});
const maxEnergy = Math.max(...energies);
const smoothedEnergy = energies.map((_, index) => {
  let sum = 0; for (let i = -4; i <= 4; i++) sum += energies[clamp(index + i, 0, energies.length - 1)];
  return sum / 9 / maxEnergy;
});
const energy = t => {
  const sample = clamp(t * 20, 0, smoothedEnergy.length - 1), a = Math.floor(sample), b = Math.min(a + 1, smoothedEnergy.length - 1);
  return mix(smoothedEnergy[a], smoothedEnergy[b], ease(sample - a));
};

// Two luminous, continuously deforming silk ribbons. The time variable never
// resets at scene boundaries, so the environment flows through every camera move.
function ribbon(c, t, variant, glowPass = false) {
  const mint = variant === 0, strands = glowPass ? 10 : 38;
  c.save(); c.globalCompositeOperation = 'screen'; c.lineCap = 'round';
  for (let j = 0; j < strands; j++) {
    const v = j / (strands - 1) - .5, shine = .3 + .7 * Math.pow(Math.cos(v * Math.PI), 5);
    const gradient = c.createLinearGradient(0, H, W, 0);
    const opacity = (glowPass ? .032 : .12 + .36 * shine) * (mint ? 1 : .75);
    gradient.addColorStop(0, mint ? `rgba(65,164,155,${opacity * .4})` : `rgba(93,97,182,${opacity * .5})`);
    gradient.addColorStop(.48, mint ? `rgba(173,255,212,${opacity})` : `rgba(160,190,255,${opacity})`);
    gradient.addColorStop(1, mint ? `rgba(48,157,194,${opacity * .25})` : `rgba(135,122,211,${opacity * .3})`);
    c.strokeStyle = gradient; c.lineWidth = glowPass ? 20 : .85 + shine * .9; c.beginPath();
    for (let i = 0; i <= 105; i++) {
      const u = i / 105, phase = t * .22 + (mint ? 0 : 2.1);
      const x = -360 + u * 2700;
      const y = (mint ? 1030 : 285) - 390 * u + Math.sin(u * 6.3 + phase) * (mint ? 212 : 172) + Math.cos(u * 3.2 - t * .14) * 95;
      const width = 110 + 180 * Math.sin(u * Math.PI) ** 2;
      const twist = u * 6.2 - t * .24 + variant * 1.8;
      const px = x + v * width * Math.sin(twist) * .55;
      const py = y + v * width * Math.cos(twist) + v * v * 110 * Math.sin(u * 7 + t * .25);
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
  }
  c.restore();
}
function background(t) {
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  gc.clearRect(0, 0, 960, 540); gc.save(); gc.scale(.5, .5);
  const glows = [
    [420 + Math.sin(t * .16) * 380, 860 + Math.cos(t * .14) * 120, '#276b6340', 720],
    [1530 + Math.cos(t * .13) * 220, 260 + Math.sin(t * .18) * 190, '#3a55893b', 780],
  ];
  for (const [x, y, color, radius] of glows) { const g = gc.createRadialGradient(x, y, 0, x, y, radius); g.addColorStop(0, color); g.addColorStop(1, '#00000000'); gc.fillStyle = g; gc.fillRect(0, 0, W, H); }
  ribbon(gc, t, 0, true); ribbon(gc, t, 1, true); gc.restore();
  ctx.drawImage(glow, 0, 0, W, H);
  const intensity = .67 + .18 * energy(t);
  alpha(ctx, intensity, () => { ribbon(ctx, t, 0); ribbon(ctx, t, 1); });
  // Sparse, slowly travelling pin lights give depth without noisy particles.
  for (let i = 0; i < 48; i++) {
    const x = (i * 379.19 + t * (i % 2 ? 2.5 : -1.8) + 2200) % 2050 - 65;
    const y = (i * 163.31 + Math.sin(t * .16 + i) * 28) % 1170;
    ctx.fillStyle = `rgba(190,224,225,${.05 + .08 * (1 + Math.sin(t * .4 + i)) / 2})`;
    ctx.beginPath(); ctx.arc(x, y, i % 4 ? .85 : 1.4, 0, Math.PI * 2); ctx.fill();
  }
  const vignette = ctx.createRadialGradient(960, 480, 370, 960, 520, 1180);
  vignette.addColorStop(0, '#02050a00'); vignette.addColorStop(1, '#02050a80'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
}

function focusCorners(c, x, y, w, h, progress, color = P.mint, size = 31) {
  if (progress <= 0) return;
  c.save(); c.globalAlpha *= progress; c.lineWidth = 2.5; c.strokeStyle = color; c.lineCap = 'round';
  for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    c.beginPath(); c.moveTo(px + sx * size, py); c.lineTo(px + sx * 8, py); c.quadraticCurveTo(px, py, px, py + sy * 8); c.lineTo(px, py + sy * size); c.stroke();
  }
  c.restore();
}
function headline(t, start, end, lines, { x = 130, y = 376, size = 88, align = 'left', width = 650, detail = [], detailY = y + lines.length * size * 1.2 + 40 } = {}) {
  const out = 1 - ramp(t, end - .6, end - .05);
  alpha(ctx, out, () => {
    lines.forEach((text, i) => maskedType(ctx, text, x, y + i * size * 1.2, size, ramp(t, start + i * .11, start + .85 + i * .11), i === lines.length - 1 ? P.mint : P.white, align, width));
    alpha(ctx, ramp(t, start + .45, start + 1.25), () => detail.forEach((text, i) => type(ctx, text, x, detailY + i * 39, 25, P.muted, { align, width })));
  });
}

// The product frame follows a single continuous path. Scene changes alter
// contents inside that frame; they never shrink or expand a full title page.
const stageKeys = [
  [3.5, 300, 455, 1320, .022], [5.52, 245, 263, 1430, 0],
  [10.2, 245, 263, 1430, 0], [11.45, 806, 295, 994, -.015],
  [15.6, 806, 295, 994, -.015], [17.0, 380, 285, 1380, .012],
  [21.1, 380, 285, 1380, .012], [22.5, 810, 242, 995, 0],
  [26.8, 810, 242, 995, 0], [28.25, 300, 267, 1320, 0],
  [29.85, 300, 267, 1320, 0], [31.1, 395, 360, 1130, 0],
];
function stageAt(t) {
  let a = stageKeys[0], b = a;
  for (let i = 1; i < stageKeys.length; i++) { b = stageKeys[i]; if (t <= b[0]) break; a = b; }
  const u = b === a ? 0 : ramp(t, a[0], b[0]);
  return { x: mix(a[1], b[1], u), y: mix(a[2], b[2], u), w: mix(a[3], b[3], u), angle: mix(a[4], b[4], u) };
}
const contentBlend = (t, boundary) => ramp(t, boundary - .5, boundary + .5);
const cleanCrop = { x: 796, y: 139, w: 676, h: 486 };
function sourceCrop(w, h, t, full = 0) {
  const image = images.motion, cropH = cleanCrop.w * h / w;
  const pan = .5 + Math.sin(t * .18) * .08;
  return { x: mix(cleanCrop.x, 0, full), y: mix(cleanCrop.y + (cleanCrop.h - cropH) * pan, 0, full), w: mix(cleanCrop.w, image.width, full), h: mix(cropH, image.height, full) };
}
function editorContent(t) {
  const focus = ramp(t, 6.15, 7.55) * (1 - ramp(t, 8.65, 10.15));
  const image = images.motion, w = mix(image.width, 1125, focus), h = w * image.height / image.width;
  drawImage(sc, 'motion', 0, 0, 1500, 804, { x: 496 * focus, y: 123 * focus, w, h });
  alpha(sc, .55 * envelope(t, 5.7, 10.1), () => focusCorners(sc, 380 + focus * 60, 145, 820 - focus * 190, 385, 1, P.mint, 22));
}
function cursorContent(t) {
  const incoming = contentBlend(t, 11.04), outgoing = contentBlend(t, 16.56);
  if (outgoing > 0) styledContent(t, 0, outgoing);
  else drawImage(sc, 'motion', 0, 0, 1500, 804, sourceCrop(1500, 804, t, 1 - incoming));
  alpha(sc, incoming * (1 - outgoing), () => {
    sc.fillStyle = '#09141c85'; sc.fillRect(0, 0, 1500, 804);
    const dark = sc.createLinearGradient(0, 0, 0, 804); dark.addColorStop(0, '#08101900'); dark.addColorStop(1, '#081019ed'); sc.fillStyle = dark; sc.fillRect(0, 0, 1500, 804);
  });
  // Cursor movement shares one time-based path and its click has one causal ripple.
  const q = ramp(t, 11.7, 14.45), x = mix(370, 1090, q), y = 318 - Math.sin(q * Math.PI) * 126 + q * 105;
  alpha(sc, envelope(t, 11.65, 15.8, .55), () => {
    sc.beginPath();
    for (let i = 0; i <= 60; i++) { const u = q * i / 60; const px = mix(370, 1090, u), py = 318 - Math.sin(u * Math.PI) * 126 + u * 105; if (i) sc.lineTo(px, py); else sc.moveTo(px, py); }
    sc.strokeStyle = '#baffd555'; sc.lineWidth = 2; sc.stroke();
    const click = clamp((t - 14.5) / 1.1);
    if (click > 0 && click < 1) for (let n = 0; n < 2; n++) { sc.beginPath(); sc.arc(x, y, 20 + ease(click) * (95 + n * 40), 0, Math.PI * 2); sc.strokeStyle = `rgba(188,255,214,${(1 - ease(click)) * .8})`; sc.lineWidth = 2.5; sc.stroke(); }
    const change = ramp(t, 13.35, 13.85), shrink = 1 - Math.sin(clamp((t - 14.48) / .38) * Math.PI) * .15;
    // Change artwork at the edge-on midpoint; two silhouettes never overlap.
    sc.save(); sc.translate(x, y); sc.scale(Math.abs(Math.cos(change * Math.PI)), 1 - Math.sin(change * Math.PI) * .12);
    cursor(sc, change < .5 ? 'Hornet' : 'Bee', 0, 0, (change < .5 ? 126 : 139) * shrink, change < .5 ? -.07 : 0); sc.restore();
  });
  alpha(sc, envelope(t, 11.3, 16.2, .65), () => {
    const names = ['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet'];
    const selected = mix(4, 1, ramp(t, 13.15, 13.9));
    box(sc, 258, 620, 984, 137, '#0b121bed', 34, '#cee8e625');
    box(sc, 293 + selected * 190, 643, 106, 94, '#baffd514', 22, '#baffd550');
    names.forEach((name, i) => cursor(sc, name, 346 + i * 190, 690, 77));
  });
}
function styledContent(t, full = 0, arrival = 1) {
  const progress = ramp(t, 17.0, 20.3);
  const g = sc.createLinearGradient(0, 0, 1500, 804);
  g.addColorStop(0, colorMix('#174b4b', '#8c9cec', progress));
  g.addColorStop(.55, colorMix('#9addce', '#d7bbe4', progress));
  g.addColorStop(1, colorMix('#c6ecd4', '#f0d5ad', progress));
  sc.fillStyle = g; sc.fillRect(0, 0, 1500, 804);
  const pad = mix(47, 98, ramp(t, 17.5, 19.8)) * arrival * (1 - full);
  sc.save(); sc.shadowColor = '#08131ca0'; sc.shadowBlur = 52; sc.shadowOffsetY = 29;
  box(sc, pad, pad, 1500 - pad * 2, 804 - pad * 2, '#101116', mix(12, 34, progress)); sc.restore();
  sc.save(); round(sc, pad, pad, 1500 - pad * 2, 804 - pad * 2, mix(12, 34, progress) * arrival * (1 - full)); sc.clip();
  drawImage(sc, 'motion', pad, pad, 1500 - pad * 2, 804 - pad * 2, sourceCrop(1500 - pad * 2, 804 - pad * 2, t, full));
  sc.restore();
}
function captionContent(t) {
  styledContent(t, contentBlend(t, 27.6));
  alpha(sc, envelope(t, 22.25, 27.5, .65), () => {
  const words = ['Make', 'every', 'word', 'matter.'];
  const widths = [125, 157, 125, 218], positions = [0, 154, 340, 494];
  const u = clamp((t - 23.0) / .8, 0, 3), a = Math.floor(u), b = Math.min(a + 1, 3), p = ease(u - a);
  box(sc, 345, 610, 810, 104, '#080f17ed', 24, '#d1e5e627');
  const highlightX = 383 + mix(positions[a], positions[b], p), highlightW = mix(widths[a], widths[b], p) + 16;
  box(sc, highlightX, 629, highlightW, 66, P.mint, 13);
  words.forEach((word, i) => type(sc, word, 391 + positions[i], 678, 52, '#f4f6f5', { bold: true, width: 300 }));
  sc.save(); round(sc, highlightX, 629, highlightW, 66, 13); sc.clip();
  words.forEach((word, i) => type(sc, word, 391 + positions[i], 678, 52, '#10231c', { bold: true, width: 300 }));
  sc.restore();
  });
}
function renderSurface(t) {
  sc.resetTransform(); sc.globalAlpha = 1; sc.clearRect(0, 0, 1500, 804);
  if (t < 10.54) {
    editorContent(t);
  } else if (t < 17.06) {
    cursorContent(t);
  } else if (t < 22.25) {
    styledContent(t);
  } else if (t < 28.1) {
    captionContent(t);
  } else drawImage(sc, 'motion', 0, 0, 1500, 804);
}
function productStage(t) {
  const opacity = ramp(t, 3.65, 5.3) * (1 - ramp(t, 30.15, 31.5));
  if (opacity < .0001) return;
  renderSurface(t);
  const { x, y, w, angle } = stageAt(t), h = w * 804 / 1500;
  alpha(ctx, opacity, () => {
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle);
    const px = -w / 2, py = -h / 2;
    ctx.save(); ctx.shadowColor = '#000000aa'; ctx.shadowBlur = 55; ctx.shadowOffsetY = 27;
    box(ctx, px - 10, py - 10, w + 20, h + 20, '#111c22', 28); ctx.restore();
    const border = ctx.createLinearGradient(px, py, px + w, py + h); border.addColorStop(0, '#c4e4dd80'); border.addColorStop(.25, '#385c6460'); border.addColorStop(.65, '#adc6e14d'); border.addColorStop(1, '#c7eade17');
    box(ctx, px - 8, py - 8, w + 16, h + 16, border, 26);
    ctx.save(); round(ctx, px, py, w, h, 20); ctx.clip(); ctx.drawImage(surface, px, py, w, h); ctx.restore();
    round(ctx, px + .5, py + .5, w - 1, h - 1, 20); ctx.strokeStyle = '#c4dee926'; ctx.lineWidth = 1; ctx.stroke();
  });
}

function intro(t) {
  const out = 1 - ramp(t, 3.2, 4.25);
  alpha(ctx, out, () => {
    const logo = ramp(t, .1, 1.2);
    alpha(ctx, logo, () => {
      ctx.drawImage(images.logo, 829, 180 + (1 - logo) * 32, 66, 66);
      type(ctx, 'Snap', 916, 235 + (1 - logo) * 32, 65, P.white, { bold: true });
    });
    maskedType(ctx, 'Your screen.', 960, 452, 136, ramp(t, .25, 1.45), P.white, 'center');
    maskedType(ctx, 'In full flow.', 960, 626, 136, ramp(t, .6, 1.8), P.mint, 'center');
    alpha(ctx, ramp(t, 1.25, 2.25), () => type(ctx, 'A little capture. A lot of character.', 960, 727, 28, P.muted, { align: 'center' }));
    focusCorners(ctx, 345, 306, 1230, 381, ramp(t, .35, 1.7) * .65, P.mint, 40);
  });
}
function sideDetails(t) {
  alpha(ctx, envelope(t, 17.25, 21.35), () => {
    const u = ramp(t, 17.2, 20.4);
    ['#9bddcc', '#b9b2ec', '#f0d3ad'].forEach((color, i) => {
      const y = 438 + i * 134;
      const a = 1 - Math.abs(u * 2 - i) * .25;
      ctx.beginPath(); ctx.arc(203, y, 30, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.arc(203, y, 40, 0, Math.PI * 2); ctx.strokeStyle = `rgba(228,240,241,${a * .35})`; ctx.lineWidth = 1.4; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(203, mix(438, 706, u), 46, 0, Math.PI * 2); ctx.strokeStyle = P.mint; ctx.lineWidth = 2; ctx.stroke();
  });
}
function soundVisual(t) {
  alpha(ctx, envelope(t, 22.75, 27.15, .65), () => {
    // Audio is an integrated timeline extension, not a second screenshot card.
    const x = 824, y = 873, width = 966;
    line(ctx, [[x, y + 44], [x + width, y + 44]], '#bce8dc18');
    for (let i = 0; i < 100; i++) {
      const timestamp = t - 2.5 + i / 100 * 5;
      const a = energy(timestamp), h = 12 + a * 77;
      const reached = i < clamp((t - 22.8) / 4.1) * 100;
      box(ctx, x + i * width / 100, y + 44 - h / 2, 3.5, h, reached ? '#baffd5c9' : '#8aa6b051', 2);
    }
    type(ctx, 'Voice polish', x, y + 136, 23, P.muted);
    type(ctx, '+ Local captions', x + width, y + 136, 23, P.muted, { align: 'right' });
  });
}
function outro(t) {
  const p = ramp(t, 30.55, 32.0);
  alpha(ctx, p, () => {
    const breathe = Math.sin(t * .55) * 4;
    ctx.drawImage(images.logo, 833, 270 + breathe, 80, 80);
    type(ctx, 'Snap', 935, 336 + breathe, 80, P.white, { bold: true });
    maskedType(ctx, 'Make it a Snap.', 960, 551, 116, ramp(t, 30.8, 32.35), P.white, 'center');
    maskedType(ctx, 'Ready when you are.', 960, 657, 45, ramp(t, 31.15, 32.65), P.mint, 'center');
    alpha(ctx, ramp(t, 31.9, 33.2), () => {
      box(ctx, 737, 754, 446, 72, '#bcffd612', 36, '#bcffd65c');
      type(ctx, 'Free for Windows', 960, 799, 28, P.mint, { align: 'center', bold: true });
      type(ctx, 'snap.venusapp.in', 960, 893, 27, P.muted, { align: 'center' });
    });
  });
}
function render(t) {
  ctx.resetTransform(); ctx.globalAlpha = 1; background(t); productStage(t);
  intro(t);
  headline(t, 4.25, 10.65, ['Follow the action.'], { x: 960, y: 152, size: 76, align: 'center', width: 1650, detailY: 219, detail: ['Automatic zoom. Effortless motion.'] });
  headline(t, 10.7, 16.05, ['Little cursor.', 'Big energy.'], { size: 70, y: 357, width: 630, detail: ['Move with personality.', 'Make every click feel right.'] });
  headline(t, 16.15, 21.65, ['Make it yours.'], { x: 960, y: 152, size: 85, align: 'center', width: 1700, detailY: 219, detail: ['Color. Framing. A signature finish.'] });
  headline(t, 21.7, 27.2, ['Sound clear.', 'Read easy.'], { size: 83, y: 351, width: 650, detail: ['Polish the voice.', 'Let your words shine.'] });
  headline(t, 27.3, 30.1, ['One recording. All you.'], { x: 960, y: 155, size: 69, align: 'center', width: 1730 });
  sideDetails(t); soundVisual(t); outro(t);
  // Deliberate film finish. The ambient field remains visible under the fade.
  alpha(ctx, ramp(t, 35.0, 36.0) * .78, () => { ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H); });
}

const samplesAt = [2.2, 5.52, 7.8, 12.5, 14.7, 19.2, 24.6, 28.9, 33.6];
for (const [i, t] of samplesAt.entries()) { render(t); await writeFile(join(qa, `scene-${i + 1}.png`), await canvas.encode('png')); }
const sheet = createCanvas(1920, 1080), sheetCtx = sheet.getContext('2d');
for (const [i, t] of samplesAt.entries()) { render(t); sheetCtx.drawImage(canvas, i % 3 * 640, Math.floor(i / 3) * 360, 640, 360); }
await writeFile(join(qa, 'contact-sheet.png'), await sheet.encode('png'));
for (const boundary of [4.2, 11.04, 16.56, 22.08, 27.6, 30.8]) {
  const strip = createCanvas(1920, 720), c = strip.getContext('2d');
  for (let i = 0; i < 6; i++) { render(boundary - .75 + i * .3); c.drawImage(canvas, i % 3 * 640, Math.floor(i / 3) * 360, 640, 360); }
  await writeFile(join(qa, `transition-${boundary.toFixed(2)}.png`), await strip.encode('png'));
}
console.log(`Review frames: ${qa}`);
if (process.argv.includes('--stills')) process.exit(0);

const preview = process.argv.includes('--preview');
const film = preview ? join(qa, 'motion-preview.mp4') : join(output, 'snap-flow-promo.mp4');
const encodeFps = preview ? 30 : FPS;
const ffmpeg = spawn(process.env.SNAP_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(encodeFps), '-i', 'pipe:0', '-i', productMusic, '-map', '0:v:0', '-map', '1:a:0', ...(preview ? ['-vf', 'scale=1280:720'] : []), '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'medium', '-crf', preview ? '20' : '17', '-threads', '4', '-pix_fmt', 'yuv420p', '-af', createProductAudioFilter(DURATION, AUDIO_START), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(DURATION), '-movflags', '+faststart', film], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
let stderr = '', pipeError;
ffmpeg.stderr.on('data', data => { stderr += data; }); ffmpeg.stdin.on('error', error => { pipeError = error; });
const completion = new Promise((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`))); });
completion.catch(() => {});
for (let frame = 0; frame < DURATION * encodeFps; frame++) {
  if (pipeError) throw pipeError;
  render(frame / encodeFps); if (!ffmpeg.stdin.write(canvas.data())) await once(ffmpeg.stdin, 'drain');
  if (frame % (encodeFps * 3) === 0) console.log(`Rendered ${frame / encodeFps}/${DURATION} seconds`);
}
ffmpeg.stdin.end(); await completion;
if (!preview) {
  render(7.8); await sharp(await canvas.encode('png')).resize(1440).webp({ quality: 94 }).toFile(join(output, 'snap-flow-promo-poster.webp'));
  const captions = [
    [0, 5.52, 'Snap. Your screen. In full flow.'], [5.52, 11.04, 'Follow the action. Automatic zoom. Effortless motion.'],
    [11.04, 16.56, 'Little cursor. Big energy. Custom cursors and click effects.'], [16.56, 22.08, 'Make it yours. Color, framing, and a signature finish.'],
    [22.08, 27.6, 'Sound clear. Read easy. Voice polish and local captions.'], [27.6, 30.36, 'One recording. All you.'],
    [30.36, 36, 'Make it a Snap. Free for Windows. snap.venusapp.in'],
  ];
  const stamp = t => `00:${Math.floor(t).toString().padStart(2, '0')}.${Math.round(t % 1 * 1000).toString().padStart(3, '0')}`;
  await writeFile(join(output, 'snap-flow-promo.vtt'), 'WEBVTT\n\n' + captions.map(([a, b, text]) => `${stamp(a)} --> ${stamp(b)}\n${text}\n`).join('\n'));
}
console.log(`Created ${film}: ${DURATION}s, ${encodeFps}fps, JetBrains Mono, OST source ${AUDIO_START}s.`);
