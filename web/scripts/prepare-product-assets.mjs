// Preserve the originals; produce web-sized derivatives of user-supplied UI.
// node web/scripts/prepare-product-assets.mjs "C:/.../Screenshots"
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source=resolve(process.argv[2] || '');
if(!process.argv[2])throw new Error('Pass the folder containing the supplied screenshots.');
const output=fileURLToPath(new URL('../public/screenshots/',import.meta.url));
await mkdir(output,{recursive:true});
const shots={
  'editor-dark':'141822','editor-light':'141947','motion':'141840','cursor':'141822',
  'cursor-detail':'141829','layers':'141835','film-looks':'141854','audio':'141900',
  'captions':'141905','tilt':'141802','tilt-detail':'141809','player':'141958',
  'player-blue':'130142','editor-blue':'130127','voice':'141920','voice-detail':'141924',
  'layouts':'141929','clip-settings':'141912','teleprompter':'123607','media-import':'123554','recorder':'123322',
};
for(const [name,time] of Object.entries(shots)){
  const input=join(source,`Screenshot 2026-10-13 ${time}.png`);
  const {width,height}=await sharp(input).metadata();
  await sharp(input).resize({width:1920,withoutEnlargement:true}).webp({quality:91,effort:5}).toFile(join(output,`${name}.webp`));
  console.log(`${name}: ${width} × ${height}`);
}
// Existing orange-pointer screenshot intentionally isn't used: it predates
// the system-cursor fix and would misrepresent the current default pointer.
console.log('Prepared 21 screenshot assets without modifying their originals.');
