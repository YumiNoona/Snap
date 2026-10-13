// The source MP3 stays local; only its 30-second mix is embedded in the film.
import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const productMusic = fileURLToPath(new URL('../public/media/OST.mp3', import.meta.url));
export const productAudioFilter = [
  'atrim=start=0:end=30', 'asetpts=PTS-STARTPTS',
  'loudnorm=I=-18:TP=-1.5:LRA=11',
  'afade=t=in:st=0:d=0.8', 'afade=t=out:st=28.5:d=1.5',
  'apad', 'atrim=duration=30', 'aresample=48000',
].join(',');

const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.env.SNAP_FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error || `FFmpeg exited ${code}`)));
});

const videoHash = path => run(['-v', 'error', '-i', path, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);

export async function replaceProductSoundtrack(film, qa) {
  await mkdir(qa, { recursive: true });
  const temporary = join(qa, 'snap-promo-ost.mp4');
  const before = await videoHash(film);
  await run([
    '-hide_banner', '-v', 'error', '-y', '-i', film, '-i', productMusic,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', productAudioFilter,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '30',
    '-movflags', '+faststart', temporary,
  ]);
  if (await videoHash(temporary) !== before) throw new Error('Soundtrack replacement unexpectedly changed the video stream.');
  // The completed, verified artifact replaces the public copy; the original
  // video remains recoverable in Git and the source MP3 is never modified.
  await copyFile(temporary, film);
  console.log('Embedded OST.mp3 with balanced volume and edge fades; the video stream is bit-for-bit unchanged.');
}
