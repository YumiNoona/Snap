// Shared Signal / Flow stage. Importing this module does not render or write files.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { productMusic } from './product-film-soundtrack.mjs';

const W = 1920, H = 1080;
const root = fileURLToPath(new URL('../../', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10); };
const mix = (a, b, p) => a + (b - a) * p;

/** Create the approved Flow environment without encoding or writing any media. */
export async function createFlowRuntime({ duration = 60, audioStart = 16.6 } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Flow duration must be positive.');
  if (!Number.isFinite(audioStart) || audioStart < 0) throw new Error('Flow audio offset must be non-negative.');
  await access(productMusic);
  for (const weight of ['Regular', 'Bold']) {
    const font = fileURLToPath(new URL(`./fonts/JetBrainsMono-${weight}.ttf`, import.meta.url));
    if (!GlobalFonts.registerFromPath(font, 'Snap Flow Mono')) throw new Error(`Missing JetBrains Mono ${weight}`);
  }

  const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
  const glow = createCanvas(960, 540), gc = glow.getContext('2d');
  const imageEntries = [
    ['motion', join(publicDir, 'screenshots', 'motion.webp')],
    ['logo', join(publicDir, 'snap-logo.png')],
    ...['Boo', 'Bee', 'Dorito', 'Knight', 'Hornet'].map(name => [name, join(root, 'public', 'Cursors', name, 'Cursor.png')]),
  ];
  const images = Object.fromEntries(await Promise.all(imageEntries.map(async ([name, path]) => [name, await loadImage(path)])));
  for (const c of [ctx, gc]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }

  // The supplied OST drives exactly the same normalized, nine-bin-smoothed
  // envelope and quintic interpolation as the approved renderer.
  const audio = spawnSync(process.env.SNAP_FFMPEG || 'ffmpeg', [
    '-v', 'error', '-ss', String(audioStart), '-i', productMusic,
    '-t', String(duration), '-ac', '1', '-ar', '8000', '-f', 'f32le', '-',
  ], { windowsHide: true, maxBuffer: Math.max(4 * 1024 * 1024, Math.ceil(duration * 8000 * 4 * 1.1)) });
  if (audio.status !== 0) throw new Error(audio.stderr?.toString() || String(audio.error));
  const samples = audio.stdout.length / 4;
  if (!samples) throw new Error('The OST has no samples at the requested offset.');
  const bins = Math.max(1, Math.ceil(duration * 20));
  const energies = Array.from({ length: bins }, (_, i) => {
    let sum = 0; const a = Math.floor(i * samples / bins), b = Math.floor((i + 1) * samples / bins);
    for (let n = a; n < b; n++) sum += audio.stdout.readFloatLE(n * 4) ** 2;
    return Math.sqrt(sum / Math.max(1, b - a));
  });
  const maxEnergy = Math.max(...energies) || 1;
  const smoothedEnergy = energies.map((_, index) => {
    let sum = 0; for (let i = -4; i <= 4; i++) sum += energies[clamp(index + i, 0, energies.length - 1)];
    return sum / 9 / maxEnergy;
  });
  const energy = t => {
    const sample = clamp(t * 20, 0, smoothedEnergy.length - 1), a = Math.floor(sample), b = Math.min(a + 1, smoothedEnergy.length - 1);
    return mix(smoothedEnergy[a], smoothedEnergy[b], ease(sample - a));
  };

  // Keep the approved ribbon geometry and palette. Precompute each column's
  // time-dependent coordinates once, shared by the glow and fine-line passes.
  function ribbonColumns(t, variant) {
    const mint = variant === 0;
    return Array.from({ length: 106 }, (_, i) => {
      const u = i / 105, phase = t * .22 + (mint ? 0 : 2.1);
      return {
        x: -360 + u * 2700,
        y: (mint ? 1030 : 285) - 390 * u + Math.sin(u * 6.3 + phase) * (mint ? 212 : 172) + Math.cos(u * 3.2 - t * .14) * 95,
        width: 110 + 180 * Math.sin(u * Math.PI) ** 2,
        twist: u * 6.2 - t * .24 + variant * 1.8,
        bend: Math.sin(u * 7 + t * .25),
      };
    });
  }
  function ribbon(c, columns, variant, glowPass = false) {
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
      columns.forEach(({ x, y, width, twist, bend }, i) => {
        const px = x + v * width * Math.sin(twist) * .55;
        const py = y + v * width * Math.cos(twist) + v * v * 110 * bend;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      });
      c.stroke();
    }
    c.restore();
  }
  function background(t) {
    const columns = [ribbonColumns(t, 0), ribbonColumns(t, 1)];
    ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, W, H);
    gc.clearRect(0, 0, 960, 540); gc.save(); gc.scale(.5, .5);
    const glows = [
      [420 + Math.sin(t * .16) * 380, 860 + Math.cos(t * .14) * 120, '#276b6340', 720],
      [1530 + Math.cos(t * .13) * 220, 260 + Math.sin(t * .18) * 190, '#3a55893b', 780],
    ];
    for (const [x, y, color, radius] of glows) {
      const g = gc.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, color); g.addColorStop(1, '#00000000');
      gc.fillStyle = g; gc.fillRect(0, 0, W, H);
    }
    ribbon(gc, columns[0], 0, true); ribbon(gc, columns[1], 1, true); gc.restore();
    ctx.drawImage(glow, 0, 0, W, H);
    ctx.save(); ctx.globalAlpha *= .67 + .18 * energy(t);
    ribbon(ctx, columns[0], 0); ribbon(ctx, columns[1], 1); ctx.restore();
    for (let i = 0; i < 48; i++) {
      const x = (i * 379.19 + t * (i % 2 ? 2.5 : -1.8) + 2200) % 2050 - 65;
      const y = (i * 163.31 + Math.sin(t * .16 + i) * 28) % 1170;
      ctx.fillStyle = `rgba(190,224,225,${.05 + .08 * (1 + Math.sin(t * .4 + i)) / 2})`;
      ctx.beginPath(); ctx.arc(x, y, i % 4 ? .85 : 1.4, 0, Math.PI * 2); ctx.fill();
    }
    const vignette = ctx.createRadialGradient(960, 480, 370, 960, 520, 1180);
    vignette.addColorStop(0, '#02050a00'); vignette.addColorStop(1, '#02050a80');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  }

  return { W, H, canvas, ctx, images, background, energy };
}
