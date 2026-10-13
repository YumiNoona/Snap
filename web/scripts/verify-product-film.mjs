// Offline checks for the final encoded movie, not just canvas stills.
// node web/scripts/verify-product-film.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const film = fileURLToPath(new URL('../public/media/snap-promo.mp4', import.meta.url));
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
assert.equal(Number(video.nb_frames), 1800);
assert.ok(Math.abs(Number(format.duration) - 30) < .01);
assert.deepEqual([audio.codec_name, Number(audio.sample_rate), audio.channels], ['aac', 48000, 2]);
console.log('PASS 30.000 seconds, 1080p, 60 fps, 1800 H.264 frames and stereo AAC');

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
assert.equal(changes.length, 1799, 'All adjacent encoded frames were measured');
const peak = Math.max(...changes);
assert.ok(peak < 20, `Abrupt frame change: mean luma difference ${peak}`);
assert.ok(changes.slice(60, 1600).every(value => value > 0), 'Motion continues across the feature sequence');
console.log(`PASS full decode and frame continuity; largest adjacent luma change ${peak.toFixed(3)}/255`);
