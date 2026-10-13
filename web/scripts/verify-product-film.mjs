// Offline checks for the final encoded movie, not just canvas stills.
// node web/scripts/verify-product-film.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { productMusic, createProductAudioFilter } from './product-film-soundtrack.mjs';

const filmOption = process.argv.find(value => value.startsWith('--film='))?.slice(7);
const film = filmOption ? resolve(filmOption) : fileURLToPath(new URL('../public/media/snap-promo.mp4', import.meta.url));
const duration = Number(process.argv.find(value => value.startsWith('--duration='))?.slice(11) || 30);
assert.ok(Number.isInteger(duration) && duration > 0 && duration <= 120, 'Expected duration must be 1–120 whole seconds');
const audioStart = Number(process.argv.find(value => value.startsWith('--audio-start='))?.slice(14) ?? 0);
assert.ok(Number.isFinite(audioStart) && audioStart >= 0, 'Expected audio start must be a non-negative number of seconds');
const productAudioFilter = createProductAudioFilter(duration, audioStart);
const probe = spawnSync(process.env.SNAP_FFPROBE || 'ffprobe', [
  '-v', 'error', '-show_streams', '-show_format', '-of', 'json', film,
], { encoding: 'utf8', windowsHide: true });
assert.equal(probe.status, 0, probe.stderr || String(probe.error));
const { streams, format } = JSON.parse(probe.stdout);
const video = streams.find(stream => stream.codec_type === 'video');
const audio = streams.find(stream => stream.codec_type === 'audio');
assert.equal(video.codec_name, 'h264');
assert.deepEqual([video.width, video.height, video.pix_fmt], [1920, 1080, 'yuv420p']);
assert.equal(video.avg_frame_rate, '60/1');
assert.equal(Number(video.nb_frames), duration * 60);
assert.ok(Math.abs(Number(format.duration) - duration) < .01);
assert.deepEqual([audio.codec_name, Number(audio.sample_rate), audio.channels], ['aac', 48000, 2]);
console.log(`PASS ${duration}.000 seconds, 1080p, 60 fps, ${duration * 60} H.264 frames and stereo AAC`);

if (existsSync(productMusic)) {
  const decodeAudio = (path, filter) => {
    const result = spawnSync(process.env.SNAP_FFMPEG || 'ffmpeg', [
      '-v', 'error', '-i', path, '-map', '0:a:0', '-af', filter,
      '-t', String(duration), '-ar', '48000', '-ac', '2', '-f', 'f32le', 'pipe:1',
    ], { maxBuffer: Math.ceil(duration * 48000 * 2 * 4 * 1.1), windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString() || String(result.error));
    return result.stdout;
  };
  const reference = decodeAudio(productMusic, productAudioFilter);
  const actual = decodeAudio(film, `atrim=duration=${duration}`);
  const samples = Math.min(reference.length, actual.length) / 4;
  assert.ok(samples >= 48000 * 2 * (duration - .1), 'The complete soundtrack is present');
  let dot = 0, referenceEnergy = 0, actualEnergy = 0, peak = 0;
  for (let i = 0; i < samples; i++) {
    const a = actual.readFloatLE(i * 4), b = reference.readFloatLE(i * 4);
    dot += a * b; referenceEnergy += b * b; actualEnergy += a * a; peak = Math.max(peak, Math.abs(a));
  }
  const correlation = dot / Math.sqrt(referenceEnergy * actualEnergy);
  assert.ok(correlation > .95, `The embedded track must match OST.mp3, not the previous music (${correlation})`);
  assert.ok(peak < 1, 'The AAC soundtrack must not clip');
  console.log(`PASS supplied OST soundtrack, balanced volume and fades; waveform correlation ${correlation.toFixed(5)}, peak ${peak.toFixed(3)}`);
} else {
  console.log('SKIP source-music comparison: the original OST.mp3 is intentionally local-only');
}

// Decode the entire file and measure consecutive-frame luma changes. This
// catches a one-frame scene reset/flash that keyframe-only review would miss.
const decoder = spawn(process.env.SNAP_FFMPEG || 'ffmpeg', [
  '-hide_banner', '-v', 'error', '-i', film,
  '-vf', 'tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
  '-an', '-f', 'null', '-',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let measurements = '', errors = '';
decoder.stdout.on('data', chunk => { measurements += chunk; });
decoder.stderr.on('data', chunk => { errors += chunk; });
await new Promise((resolve, reject) => {
  decoder.on('error', reject);
  decoder.on('close', code => code === 0 ? resolve() : reject(new Error(errors)));
});
assert.equal(errors.trim(), '', 'No decode errors');
const changes = [...measurements.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(match => Number(match[1]));
assert.equal(changes.length, duration * 60 - 1, 'All adjacent encoded frames were measured');
const peak = Math.max(...changes);
assert.ok(peak < 20, `Abrupt frame change: mean luma difference ${peak}`);
assert.ok(changes.slice(60, (duration - 3) * 60).every(value => value > 0), 'Motion continues across the feature sequence');
console.log(`PASS full decode and frame continuity; largest adjacent luma change ${peak.toFixed(3)}/255`);
