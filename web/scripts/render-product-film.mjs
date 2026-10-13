// Deterministic 25-second, 1920×1080/30fps screenshot-based product film.
// npm --prefix web run promo:render (requires FFmpeg on PATH).
// --stills produces QA keyframes only; --fps=60 renders a 60fps variant.
// All UI pixels come from supplied screenshots; no UI or artwork is invented.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const output=join(publicDir,'media'), qa=resolve('test-results/product-film');
await mkdir(output,{recursive:true});await mkdir(qa,{recursive:true});
for(const [file,name] of [['C:/Windows/Fonts/segoeui.ttf','Snap Regular'],['C:/Windows/Fonts/seguisb.ttf','Snap Semibold']]){
  if(existsSync(file))GlobalFonts.registerFromPath(file,name);
}
const width=1920,height=1080,duration=25,fps=process.argv.includes('--fps=60')?60:30;
const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
const images={};
for(const name of ['editor-dark','editor-light','motion','cursor-detail','tilt-detail','film-looks','voice-detail','layouts','captions','recorder'])images[name]=await loadImage(join(publicDir,`screenshots/${name}.webp`));
images.logo=await loadImage(join(publicDir,'snap-logo.png'));
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*v*(v*(v*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;
const times=[0,3.8,8.2,12.6,17,21.8,25];
const titles=['Capture','Camera','Cursor','Looks','Refine','Share'];

function round(x,y,w,h,r=24){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function text(value,x,y,size=30,color='#edf3fb',weight='regular',align='left'){
  ctx.fillStyle=color;ctx.font=`${weight==='bold'?'700':'400'} ${size}px "${weight==='bold'?'Snap Semibold':'Snap Regular'}", sans-serif`;
  ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.letterSpacing=weight==='bold'&&size>60?'-2px':'0px';ctx.fillText(value,x,y);ctx.letterSpacing='0px';
}
function glow(x,y,r,color){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);}
function chip(label,x,y,accent='#a2dffa'){
  ctx.font='400 24px "Snap Regular",sans-serif';const w=ctx.measureText(label).width+42;
  ctx.fillStyle='#ffffff0c';round(x,y,w,48,24);ctx.fill();ctx.strokeStyle='#ffffff23';ctx.lineWidth=1;ctx.stroke();
  text(label,x+21,y+32,24,accent);return w;
}
function card(name,x,y,w,h,{angle=0,scale=1,alpha=1,crop}={}){
  const image=images[name];ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x+w/2,y+h/2);ctx.rotate(angle*Math.PI/180);ctx.scale(scale,scale);
  x=-w/2;y=-h/2;ctx.shadowColor='#0009';ctx.shadowBlur=48;ctx.shadowOffsetY=23;
  ctx.fillStyle='#0c0f14';round(x,y,w,h,22);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.save();round(x,y,w,h,22);ctx.clip();
  if(crop)ctx.drawImage(image,crop.x,crop.y,crop.w,crop.h,x,y,w,h);
  else{
    const s=Math.min(w/image.width,h/image.height),iw=image.width*s,ih=image.height*s;
    ctx.drawImage(image,x+(w-iw)/2,y+(h-ih)/2,iw,ih);
  }
  ctx.restore();ctx.strokeStyle='#ffffff27';ctx.lineWidth=1.5;round(x+.75,y+.75,w-1.5,h-1.5,22);ctx.stroke();ctx.restore();
}
function heading(lines,dt,accent,subtitles=[]){
  const e=ease((dt+.3)/.85),y=mix(35,0,e);ctx.save();ctx.globalAlpha*=e;
  text(lines[0],128,324+y,82,'#f2f5fa','bold');text(lines[1],128,418+y,82,accent,'bold');
  subtitles.forEach((line,i)=>text(line,132,504+y+i*42,27,'#a7b4c8'));
  ctx.restore();
}
function scene(index,dt){
  const span=times[index+1]-times[index],p=clamp(dt/span),enter=ease((dt+.25)/.95);
  if(index===0){
    const y=mix(40,0,enter);ctx.save();ctx.globalAlpha*=enter;
    ctx.drawImage(images.logo,751,210+y,116,116);text('Snap',897,301+y,122,'#f1f7fc','bold');
    text('Screen recordings. A little direction.',960,402+y,48,'#b9c9de','regular','center');ctx.restore();
    card('recorder',280,545+mix(95,0,ease((dt-.35)/1.1)),1360,391,{scale:mix(.94,1,enter),alpha:ease((dt-.35)/1.1)});
  }else if(index===1){
    heading(['Guide','the focus.'],dt,'#9cdfff',['Smooth camera motion.','Editable zoom regions.']);
    const image=images.motion,full={x:0,y:0,w:image.width,h:image.height},focus={x:480,y:122,w:1020,h:547};
    const z=ease((dt-1.1)/2.35),crop={};for(const key of ['x','y','w','h'])crop[key]=mix(full[key],focus[key],z*.92);
    card('motion',712+mix(90,0,enter),236,1100,589,{angle:mix(1.3,-.35,p),scale:mix(.96,1.02,p),alpha:enter,crop});
    chip('Zoom & pan',132,628);
    ctx.save();ctx.globalAlpha*=ease((dt-1.75)/.65)*(1-ease((dt-3)/.7));ctx.strokeStyle='#abe7ff';ctx.lineWidth=2.5;
    round(1235,410,380,213,16);ctx.stroke();ctx.restore();
  }else if(index===2){
    heading(['Make it','feel like you.'],dt,'#c8b5fa',['Custom cursors. Click effects.','A new perspective.']);
    card('editor-dark',766,224,1020,545,{angle:mix(-1.2,.35,p),scale:mix(.96,1,p),alpha:enter});
    const rise=ease((dt-.45)/.9);card('cursor-detail',1110,490+mix(70,0,rise),280,372,{angle:-3.5,alpha:rise});
    const tilt=ease((dt-1.4)/.9);card('tilt-detail',1517,305+mix(80,0,tilt),259,387,{angle:3.2,alpha:tilt});
    chip('Make your mark',132,628,'#d8c8ff');
  }else if(index===3){
    heading(['Find your','signature look.'],dt,'#e3c59c',['Film looks. Color. Canvas styling.','Small changes, a different feeling.']);
    card('film-looks',735,214+mix(70,0,enter),1075,569,{angle:mix(.9,-.7,p),scale:mix(.96,1.025,p),alpha:enter});
    card('film-looks',838,420,252,442,{angle:-4,alpha:ease((dt-.7)/.9),crop:{x:82,y:86,w:340,h:596}});
    let x=1165;for(const label of ['Film looks','Color','Canvas'])x+=chip(label,x,837,'#ead6b5')+12;
  }else if(index===4){
    heading(['Finish the','little things.'],dt,'#bfe0c7',['Independent audio. Local captions.','Layouts that fit.']);
    card('captions',825,241+mix(65,0,enter),300,533,{angle:-2,alpha:enter,crop:{x:76,y:70,w:352,h:626}});
    card('voice-detail',1234,183+mix(90,0,ease((dt-.4)/1)),472,447,{angle:2.3,alpha:ease((dt-.4)/1)});
    card('layouts',1274,600+mix(60,0,ease((dt-1.2)/1)),405,382,{angle:-2.5,alpha:ease((dt-1.2)/1),crop:{x:108,y:130,w:720,h:680}});
    chip('Ready to share',132,628,'#c7e9ce');
  }else{
    card('editor-dark',110,178,590,315,{angle:-7,alpha:.18*(1-p)});
    card('editor-light',1330,618,610,326,{angle:7,alpha:.13*(1-p)});
    const y=mix(25,0,enter);ctx.save();ctx.globalAlpha*=enter;
    ctx.drawImage(images.logo,737,256+y,130,130);text('Snap',899,361+y,135,'#f5f8ff','bold');
    text('Record. Refine. Share.',960,542+y,83,'#c8e4f3','bold','center');
    ctx.fillStyle='#edf3f8';round(729,655+y,462,76,38);ctx.fill();text('Free for Windows',960,706+y,33,'#141a22','bold','center');
    text('Local-first. No account needed.',960,800+y,28,'#96a7bd','regular','center');ctx.restore();
  }
}
function render(t){
  ctx.resetTransform();ctx.globalAlpha=1;ctx.fillStyle='#0b0e15';ctx.fillRect(0,0,width,height);
  glow(1250+Math.sin(t*.2)*170,420,900,'#28475b6b');glow(500,800+Math.cos(t*.25)*60,760,'#382a556b');
  ctx.strokeStyle='#ffffff04';ctx.lineWidth=1;for(let x=0;x<width;x+=96){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  for(let i=0;i<times.length-1;i++){
    const dt=t-times[i],span=times[i+1]-times[i];
    if(dt<-.4||dt>span+.35)continue;
    const alpha=(i===0?1:ease((dt+.4)/.7))*(i===5?1:1-ease((dt-span+.4)/.7));
    ctx.save();ctx.globalAlpha=alpha;scene(i,dt);ctx.restore();
  }
  ctx.drawImage(images.logo,128,64,33,33);text('Snap',174,92,28,'#e0e9f5','bold');
  text('SCREEN RECORDER + EDITOR',1792,89,18,'#76869d','regular','right');
  for(let i=0;i<6;i++){
    const x=128+i*283,active=t>=times[i]&&t<times[i+1];ctx.fillStyle='#ffffff13';round(x,1040,258,3,1.5);ctx.fill();
    const p=clamp((t-times[i])/(times[i+1]-times[i]));if(p>0){ctx.fillStyle=active?'#abdff9':'#ffffff58';round(x,1040,258*p,3,1.5);ctx.fill();}
    text(titles[i],x,1025,16,active?'#c8dfed':'#617086');
  }
}

const sampleTimes=[2.6,5.8,7.4,10.5,15,19.2,23.6];
for(const [i,t] of sampleTimes.entries()){render(t);await writeFile(join(qa,`scene-${i+1}.png`),await canvas.encode('png'));}
// The poster shows the actual studio UI; the play overlay has clear space.
render(2.6);await sharp(await canvas.encode('png')).resize(1440).webp({quality:91}).toFile(join(output,'snap-promo-poster.webp'));
console.log('Rendered seven QA frames and the film poster.');
if(process.argv.includes('--stills'))process.exit(0);

// Original ambient score, synthesized here. No external music or narration.
const sampleRate=48000,samples=sampleRate*duration,audio=Buffer.alloc(44+samples*4);
audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(2,22);audio.writeUInt32LE(sampleRate,24);audio.writeUInt32LE(sampleRate*4,28);audio.writeUInt16LE(4,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*4,40);
const notes=[261.626,329.628,391.995,493.883,440,391.995,329.628,293.665],beat=60/92;
let seed=7;
for(let n=0;n<samples;n++){
  const t=n/sampleRate,fade=ease(t/1.2)*(1-ease((t-23.2)/1.8)),b=t%beat,k=Math.floor(t/beat),env=Math.min(1,b/.015)*Math.exp(-b*6);
  const pad=[130.813,164.814,195.998,246.942].reduce((sum,f,i)=>sum+Math.sin(2*Math.PI*f*t+i)*.015,0);
  const ping=(Math.sin(2*Math.PI*notes[k%8]*t)+.2*Math.sin(4*Math.PI*notes[k%8]*t))*env*.045;
  const kick=Math.sin(2*Math.PI*(47*b+9*(1-Math.exp(-b*14))))*Math.exp(-b*17)*.035;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;
  let sweep=0;for(const boundary of times.slice(1,-1)){const d=t-boundary;if(d>-.28&&d<.35)sweep+=Math.sin(Math.PI*(d+.28)/.63)**2*.017;}
  for(let ch=0;ch<2;ch++){const shimmer=Math.sin(2*Math.PI*(ch?523.5:523.25)*t)*.009;const value=clamp((pad+ping+kick+shimmer+noise*sweep)*fade,-1,1);audio.writeInt16LE(Math.round(value*32767),44+n*4+ch*2);}
}
const soundtrack=join(qa,'original-ambient-score.wav');await writeFile(soundtrack,audio);
const film=join(output,'snap-promo.mp4');
const ffmpeg=spawn(process.env.SNAP_FFMPEG || 'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-i',soundtrack,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',film],{stdio:['pipe','ignore','pipe'],windowsHide:true});
let stderr='',pipeError;ffmpeg.stderr.on('data',chunk=>{stderr+=chunk;});ffmpeg.stdin.on('error',error=>{pipeError=error;});
const completion=new Promise((resolve,reject)=>{ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(stderr || `FFmpeg exited ${code}`)));});
for(let frame=0;frame<duration*fps;frame++){
  if(pipeError)throw pipeError;render(frame/fps);
  if(!ffmpeg.stdin.write(canvas.data()))await once(ffmpeg.stdin,'drain');
  if(frame%(fps*5)===0)console.log(`Rendered ${frame/fps}/${duration} seconds`);
}
ffmpeg.stdin.end();await completion;
console.log(`Created ${film} (${duration}s, ${width}×${height}, ${fps}fps, original ambient audio).`);
