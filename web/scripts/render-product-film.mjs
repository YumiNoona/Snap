// Deterministic 30-second, 1920×1080/60fps screenshot-based product film.
// npm --prefix web run promo:render (requires FFmpeg on PATH).
// --stills renders review frames only; --fps=30 offers a smaller variant.
// --audio-only updates the music without re-encoding any video frames.
// Screenshot pixels are preserved. All added type uses bundled JetBrains Mono.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import sharp from 'sharp';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { productMusic, productAudioFilter, replaceProductSoundtrack } from './product-film-soundtrack.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const output = join(publicDir, 'media');
const qa = fileURLToPath(new URL('../test-results/product-film/', import.meta.url));
await mkdir(output, { recursive: true });
await mkdir(qa, { recursive: true });
if (!process.argv.includes('--stills')) await access(productMusic);
if (process.argv.includes('--audio-only')) {
  await replaceProductSoundtrack(join(output, 'snap-promo.mp4'), qa);
  process.exit(0);
}
for (const weight of ['Regular', 'Bold']) {
  const font = fileURLToPath(new URL(`./fonts/JetBrainsMono-${weight}.ttf`, import.meta.url));
  if (!GlobalFonts.registerFromPath(font, 'Snap JetBrains Mono')) throw new Error(`Could not register ${font}`);
}
const width = 1920, height = 1080, duration = 30;
const fps = process.argv.includes('--fps=30') ? 30 : 60;
const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
const outgoing = createCanvas(width, height), outgoingCtx = outgoing.getContext('2d');
const incoming = createCanvas(width, height), incomingCtx = incoming.getContext('2d');
// Half-resolution gradients keep the deterministic render inexpensive; UI stays 1080p.
const atmosphere = createCanvas(width / 2, height / 2), sky = atmosphere.getContext('2d');
for (const context of [ctx, outgoingCtx, incomingCtx, sky]) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}
const images = {};
for (const name of ['editor-dark', 'motion', 'cursor-detail', 'tilt-detail', 'film-looks', 'layers', 'audio', 'voice-detail', 'layouts', 'captions', 'recorder']) {
  images[name] = await loadImage(join(publicDir, `screenshots/${name}.webp`));
}
images.logo = await loadImage(join(publicDir, 'snap-logo.png'));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = v => { v = clamp(v); return v * v * v * (v * (v * 6 - 15) + 10); };
const mix = (a, b, t) => a + (b - a) * t;
const times = [0, 4.4, 10, 14.5, 19, 24, 27, 30];
const transition = 1.4;
const cropPanel = { x: 76, y: 70, w: 352, h: 626 };

function round(c, x, y, w, h, r = 24) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function text(c, value, x, y, size = 28, color = '#eef4fb', bold = false, align = 'left') {
  c.fillStyle = color;
  c.font = `${bold ? 700 : 400} ${size}px "Snap JetBrains Mono"`;
  c.textAlign = align; c.textBaseline = 'alphabetic'; c.letterSpacing = '0px';
  c.fillText(value, x, y);
}
function glow(x, y, r, color) {
  const gradient = sky.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
  sky.fillStyle = gradient; sky.fillRect(0, 0, width / 2, height / 2);
}
function background(t) {
  // One continuous world-space animation, never restarted at a feature boundary.
  sky.fillStyle = '#080e18'; sky.fillRect(0, 0, width / 2, height / 2);
  glow(640 + Math.sin(t * .17) * 175, 175 + Math.cos(t * .13) * 100, 510, '#296477a6');
  glow(175 + Math.sin(t * .12 + 1) * 105, 395 + Math.cos(t * .19) * 65, 445, '#5c387c8c');
  glow(765 + Math.cos(t * .14 + 2) * 110, 440 + Math.sin(t * .2) * 80, 330, '#39778345');
  // Broad, translucent silk ribbons drift behind the product, not across its UI.
  for (let i = 0; i < 5; i++) {
    const y = 265 + i * 27 + Math.sin(t * .22 + i * .4) * 62;
    sky.beginPath(); sky.moveTo(-90, y + 140);
    sky.bezierCurveTo(205, y - 120 + Math.sin(t * .16) * 85, 565, y + 140, 1040, y - 115);
    sky.strokeStyle = `rgba(${i % 2 ? '180,146,235' : '126,217,237'},${.022 + i * .004})`;
    sky.lineWidth = 27; sky.stroke();
  }
  sky.lineWidth = .5;
  for (let i = 0; i < 11; i++) {
    const y = 348 + i * 15, drift = Math.sin(t * .19 + i * .15) * 24;
    sky.beginPath(); sky.moveTo(-40, y + drift);
    sky.bezierCurveTo(275, y - 86, 560, y + 95 + drift, 1010, y - 52);
    sky.strokeStyle = `rgba(183,219,248,${.026 + i * .002})`; sky.stroke();
  }
  // A few quiet stars: smooth drift rather than random per-frame noise.
  for (let i = 0; i < 28; i++) {
    const x = (i * 137.9 + t * (i % 2 ? 1.8 : -1.2) + 960) % 960;
    const y = 28 + (i * 73.3) % 470 + Math.sin(t * .3 + i) * 7;
    sky.fillStyle = `rgba(205,230,247,${.07 + .04 * Math.sin(t * .6 + i)})`;
    sky.beginPath(); sky.arc(x, y, i % 4 ? .65 : 1.1, 0, Math.PI * 2); sky.fill();
  }
}
function card(c, name, x, y, w, h, { angle = 0, scale = 1, alpha = 1, crop } = {}) {
  if (alpha <= 0) return;
  const image = images[name]; c.save(); c.globalAlpha *= alpha;
  c.translate(x + w / 2, y + h / 2); c.rotate(angle * Math.PI / 180); c.scale(scale, scale);
  x = -w / 2; y = -h / 2;
  c.shadowColor = '#0008'; c.shadowBlur = 40; c.shadowOffsetY = 22;
  c.fillStyle = '#0c0f14'; round(c, x, y, w, h, 23); c.fill(); c.shadowBlur = 0; c.shadowOffsetY = 0;
  c.save(); round(c, x, y, w, h, 23); c.clip();
  if (crop) c.drawImage(image, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  else {
    const s = Math.min(w / image.width, h / image.height), iw = image.width * s, ih = image.height * s;
    c.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  c.restore(); c.strokeStyle = '#d1e8ff30'; c.lineWidth = 1.5;
  round(c, x + .75, y + .75, w - 1.5, h - 1.5, 23); c.stroke(); c.restore();
}
function heading(c, lines, dt, accent, subtitles = []) {
  const arrival = ease((dt + .6) / 1.5), y = mix(27, 0, arrival);
  c.font = '700 74px "Snap JetBrains Mono"';
  const size = 74 * Math.min(1, 598 / Math.max(...lines.map(line => c.measureText(line).width)));
  c.save(); c.globalAlpha *= arrival;
  text(c, lines[0], 120, 368 + y, size, '#f3f6fb', true);
  text(c, lines[1], 120, 465 + y, size, accent, true);
  subtitles.forEach((line, i) => text(c, line, 124, 550 + y + i * 43, 24, '#b2c2d5'));
  c.restore();
}
function brand(c, x, y, size, dt, centered = false) {
  const arrival = ease(dt / 1.25), baseline = y + size * .81;
  c.save(); c.globalAlpha *= arrival;
  c.font = `700 ${size}px "Snap JetBrains Mono"`;
  const labelWidth = c.measureText('Snap').width, gap = size * .25, total = size + gap + labelWidth;
  if (centered) x -= total / 2;
  c.drawImage(images.logo, x, y, size, size);
  text(c, 'Snap', x + size + gap, baseline, size, '#f2f7ff', true); c.restore();
}
function scene(c, index, dt) {
  const span = times[index + 1] - times[index], p = clamp(dt / span);
  const arrival = ease((dt + .6) / 1.5);
  // Very small uninterrupted floating motion, continuous through the crossfades.
  const drift = Math.sin(dt * .45) * 9, camera = mix(.99, 1.018, ease(p));
  c.save(); c.translate(0, drift);
  if (index === 0) {
    brand(c, 960, 189 + mix(25, 0, arrival), 108, dt, true);
    c.save(); c.globalAlpha *= ease((dt - .05) / 1.4);
    text(c, 'Screen recordings.', 960, 414, 58, '#edf6ff', true, 'center');
    text(c, 'With a little direction.', 960, 489, 44, '#adcadd', false, 'center'); c.restore();
    card(c, 'recorder', 280, 606 + mix(62, 0, arrival), 1360, 391, { scale: camera, alpha: ease((dt - .2) / 1.35) });
  } else if (index === 1) {
    heading(c, ['Let the', 'focus flow.'], dt, '#a2e4ff', ['Automatic zoom & pan.', 'Fine-tune it on the timeline.']);
    const image = images.motion;
    // Dwell long enough to read, ease into the real video area, then ease back out.
    // The same C2 envelope controls crop and scale; there is no frame-step snapping.
    const focus = ease((dt - 1) / 1.6) * (1 - ease((dt - 3.65) / 1.6));
    const crop = {
      x: mix(0, 475, focus * .82), y: mix(0, 115, focus * .82),
      w: mix(image.width, 1020, focus * .82), h: mix(image.height, 547, focus * .82),
    };
    card(c, 'motion', 755 + mix(56, 0, arrival), 227, 1055, 565, { crop, scale: camera, angle: mix(.5, -.35, ease(p)) });
    card(c, 'motion', 865, 837 + mix(50, 0, ease((dt - .35) / 1.25)), 880, 55, {
      alpha: ease((dt - .35) / 1.25), crop: { x: 138, y: 907, w: 1760, h: 110 },
    });
    text(c, 'Your camera pass. Still yours to edit.', 1305, 938, 20, '#9fb9cb', false, 'center');
  } else if (index === 2) {
    heading(c, ['Your cursor.', 'Your style.'], dt, '#d6c1ff', ['Custom cursors & click effects.', 'Add depth with 3D tilt.']);
    card(c, 'editor-dark', 783, 247, 1000, 534, { scale: camera, angle: mix(-.5, .6, ease(p)) });
    const cursorArrival = ease((dt - .1) / 1.2), tiltArrival = ease((dt - .8) / 1.25);
    card(c, 'cursor-detail', 860, 570 + mix(50, 0, cursorArrival), 268, 356, { angle: mix(-3, -1.8, ease(p)), alpha: cursorArrival });
    card(c, 'tilt-detail', 1528, 459 + mix(50, 0, tiltArrival), 266, 396, { angle: mix(3, 1.8, ease(p)), alpha: tiltArrival });
  } else if (index === 3) {
    heading(c, ['A look.', 'All your own.'], dt, '#f3d8aa', ['Backgrounds, color & film looks.', 'Text, shapes & six masks.']);
    card(c, 'film-looks', 775, 221, 1020, 543, { scale: camera, angle: mix(.6, -.4, ease(p)) });
    const detailArrival = ease((dt - .25) / 1.3);
    card(c, 'film-looks', 884, 497 + mix(55, 0, detailArrival), 249, 438, {
      alpha: detailArrival, angle: -2, crop: { x: 82, y: 86, w: 340, h: 596 },
    });
    card(c, 'layers', 1479, 516 + mix(70, 0, ease((dt - .85) / 1.3)), 276, 409, {
      alpha: ease((dt - .85) / 1.3), angle: 2, crop: { x: 80, y: 305, w: 347, h: 514 },
    });
  } else if (index === 4) {
    heading(c, ['Sound clear.', 'Read easily.'], dt, '#bae5ce', ['Separate desktop & mic tracks.', 'Voice polish & local captions.']);
    card(c, 'audio', 781, 208, 1030, 550, { scale: camera, angle: -.3 });
    card(c, 'captions', 864, 380 + mix(55, 0, ease((dt - .15) / 1.3)), 293, 521, {
      alpha: ease((dt - .15) / 1.3), angle: -2, crop: cropPanel,
    });
    card(c, 'voice-detail', 1278, 499 + mix(58, 0, ease((dt - .9) / 1.3)), 485, 460, {
      alpha: ease((dt - .9) / 1.3), angle: 2,
    });
  } else if (index === 5) {
    heading(c, ['Made to', 'fit the moment.'], dt, '#a8ddea', ['Landscape, vertical or square.', 'One recording. More possibilities.']);
    card(c, 'layouts', 811, 194 + mix(40, 0, arrival), 900, 676, {
      scale: camera, angle: mix(-.6, .4, ease(p)), crop: { x: 108, y: 130, w: 720, h: 540 },
    });
  } else {
    brand(c, 960, 273 + mix(22, 0, arrival), 127, dt, true);
    text(c, 'Record. Refine. Share.', 960, 557, 65, '#d6edf7', true, 'center');
    text(c, 'Free for Windows.', 960, 666, 32, '#f4f7ff', true, 'center');
    text(c, 'Local-first. No account needed.', 960, 726, 25, '#aabed1', false, 'center');
    text(c, 'snap.venusapp.in', 960, 844, 25, '#9edaf1', false, 'center');
  }
  c.restore();
}
function paintScene(c, index, t) {
  c.resetTransform(); c.globalAlpha = 1;
  c.clearRect(0, 0, width, height);
  scene(c, index, t - times[index]);
}
function render(t) {
  // Integrate a smooth velocity falloff so the final two seconds gently settle.
  const s = clamp((t - 28) / 2);
  const visualTime = t <= 28 ? t : 28 + 2 * (s - s ** 6 + 3 * s ** 5 - 2.5 * s ** 4);
  background(visualTime);
  ctx.resetTransform(); ctx.globalAlpha = 1;
  ctx.drawImage(atmosphere, 0, 0, width, height);
  let boundary = -1;
  for (let i = 1; i < times.length - 1; i++) {
    if (Math.abs(t - times[i]) <= transition / 2) { boundary = i; break; }
  }
  if (boundary !== -1) {
    // Shared-space camera push. Scenes meet edge-to-edge, so titles never ghost
    // over one another and the world-space atmosphere never moves or resets.
    paintScene(outgoingCtx, boundary - 1, visualTime); paintScene(incomingCtx, boundary, visualTime);
    const u = ease((t - times[boundary] + transition / 2) / transition);
    if (boundary % 3 === 0) {
      ctx.drawImage(outgoing, 0, -u * height);
      ctx.drawImage(incoming, 0, (1 - u) * height);
    } else {
      ctx.drawImage(outgoing, -u * width, 0);
      ctx.drawImage(incoming, (1 - u) * width, 0);
    }
  } else {
    let index = 0;
    while (index < times.length - 2 && t >= times[index + 1]) index++;
    scene(ctx, index, visualTime - times[index]);
  }
  // No bottom chapter labels, progress strips, badges or navigation.
  // The final motion and score settle together rather than abruptly cutting off.
  const closing = ease((t - 28.75) / 1.25);
  if (closing > 0) { ctx.globalAlpha = closing * .23; ctx.fillStyle = '#080e18'; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; }
}

const sampleTimes = [2.9, 6.7, 8.5, 12.4, 16.8, 21.4, 25.5, 28.5];
for (const [i, t] of sampleTimes.entries()) {
  render(t); await writeFile(join(qa, `scene-${i + 1}.png`), await canvas.encode('png'));
}
// Inspect every transition midpoint and the opening/closing as well as hero frames.
for (const t of [0, .8, ...times.slice(1, -1), 29.95]) {
  render(t); await writeFile(join(qa, `transition-${t.toFixed(2)}.png`), await canvas.encode('png'));
}
render(2.9);
await sharp(await canvas.encode('png')).resize(1440).webp({ quality: 91 }).toFile(join(output, 'snap-promo-poster.webp'));
const captions = [
  'Snap. Screen recordings. With a little direction.',
  'Let the focus flow. Automatic zoom and pan, editable on the timeline.',
  'Your cursor. Your style. Custom cursors, click effects and 3D tilt.',
  'A look. All your own. Backgrounds, film looks, text, shapes and six masks.',
  'Sound clear. Read easily. Separate audio tracks, voice polish and local captions.',
  'Made to fit the moment. Landscape, vertical and square layouts.',
  'Snap. Record. Refine. Share. Free for Windows. Local-first. snap.venusapp.in',
];
const timestamp = t => `00:${Math.floor(t).toString().padStart(2, '0')}.${Math.round((t % 1) * 1000).toString().padStart(3, '0')}`;
await writeFile(join(output, 'snap-promo.vtt'), 'WEBVTT\n\n' + captions.map((caption, i) => `${timestamp(times[i])} --> ${timestamp(times[i + 1])}\n${caption}\n`).join('\n'));
console.log('Rendered eight feature frames, transition frames, poster and timed titles.');
if (process.argv.includes('--stills')) process.exit(0);

// Supplied OST, trimmed and volume-balanced with fades at both loop edges.
const film = join(output, 'snap-promo.mp4');
const ffmpeg = spawn(process.env.SNAP_FFMPEG || 'ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
  '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0', '-i', productMusic,
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-threads', '4', '-pix_fmt', 'yuv420p', '-af', productAudioFilter, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(duration),
  '-movflags', '+faststart', film,
], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
let stderr = '', pipeError;
ffmpeg.stderr.on('data', chunk => { stderr += chunk; });
ffmpeg.stdin.on('error', error => { pipeError = error; });
const completion = new Promise((resolve, reject) => {
  ffmpeg.on('error', reject);
  ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`)));
});
for (let frame = 0; frame < duration * fps; frame++) {
  if (pipeError) throw pipeError;
  render(frame / fps);
  if (!ffmpeg.stdin.write(canvas.data())) await once(ffmpeg.stdin, 'drain');
  if (frame % (fps * 5) === 0) console.log(`Rendered ${frame / fps}/${duration} seconds`);
}
ffmpeg.stdin.end(); await completion;
console.log(`Created ${film} (${duration}s, ${width}×${height}, ${fps}fps, JetBrains Mono, supplied OST soundtrack).`);
