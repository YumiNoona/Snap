// 60-second Signal / Flow feature tour. Actual UI captures, deterministic motion.
// --stills produces review frames without encoding; original Flow film is preserved.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Library, Frame, Box, MousePointer2, Keyboard, Layers3, Focus, Palette, AudioLines, Captions } from 'lucide-react';
import { createFlowRuntime } from './flow-film-runtime.mjs';
import { productMusic, createProductAudioFilter } from './product-film-soundtrack.mjs';

const DURATION = 60, FPS = 60, AUDIO_START = 16.6;
const root = fileURLToPath(new URL('../../', import.meta.url));
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const qa = fileURLToPath(new URL('../test-results/feature-film/', import.meta.url));
await mkdir(qa, { recursive: true });
const { canvas, ctx, images, background, energy } = await createFlowRuntime({ duration: DURATION, audioStart: AUDIO_START });
const W = 1920, H = 1080, SW = 1200, SH = 650;
const surface = createCanvas(SW, SH), sc = surface.getContext('2d');
const texture = createCanvas(1100, 590), tc = texture.getContext('2d');
const warped = createCanvas(SW, SH), wc = warped.getContext('2d');
const warpPixels = wc.createImageData(SW, SH);
let texturePixels;
const P = { white: '#f1f6f3', mint: '#bcffd6', blue: '#93b9ff', muted: '#96a8b1', bg: '#070b10' };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x*x*x*(x*(6*x-15)+10); };
const mix = (a,b,p) => a+(b-a)*p;
const ramp = (t,a,b) => ease((t-a)/(b-a));
const env = (t,a,b,d=.55) => ramp(t,a,a+d)*(1-ramp(t,b-d,b));
function alpha(c,a,fn) { if(a<.00001)return; c.save(); c.globalAlpha*=a; fn(); c.restore(); }
function round(c,x,y,w,h,r=20) { c.beginPath();c.roundRect(x,y,w,h,r); }
function box(c,x,y,w,h,color,r=20,stroke) { round(c,x,y,w,h,r);c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.2;c.stroke();} }
function type(c,text,x,y,size=26,color=P.white,align='left',bold=false,max=1750) {
  c.font=`${bold?700:400} ${size}px "Snap Flow Mono"`;c.textAlign=align;c.textBaseline='alphabetic';
  if(c.measureText(text).width>max)throw new Error(`Text overflow: ${text}`);
  c.fillStyle=color;c.fillText(text,x,y);
}
function reveal(text,x,y,size,p,color=P.white,align='center') {
  ctx.save();ctx.beginPath();ctx.rect(60,y-size*1.15,1800,size*1.45);ctx.clip();
  alpha(ctx,p,()=>type(ctx,text,x,y+(1-p)*size*.7,size,color,align,true));ctx.restore();
}
function line(c,points,color=P.mint,width=2) {c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function cursor(c,name,x,y,size=62) {const im=images[name],s=size/Math.max(im.width,im.height);c.drawImage(im,x-10,y-8,im.width*s,im.height*s);}
function code(c,x,y,w,h,zoom=1,focus=.5) {
  const sw=676/zoom,sh=sw*h/w;
  const sx=796+(676-sw)*focus,sy=139+(486-sh)*.42;
  c.drawImage(images.motion,sx,sy,sw,sh,x,y,w,h);
}
const panels = {};
for(const name of ['uploads','media-drop','auto-zoom','motion-blur','camera-curves','cursor','canvas-gradients','canvas-colors','canvas-images','tilt','color-looks','color-correction','rgb-curves','audio','captions','layers','actions','keyframe-graph']) panels[name]=await loadImage(join(pub,'screenshots/tour',`${name}.webp`));
const wallpaper = await loadImage(join(root,'public/Wallpapers/BlueWaves.jpg'));
const tabs = ['Uploads','Canvas','3D Tilt','Cursor','Actions','Layers','Motion','Color','Audio','Captions'];
const icons = await Promise.all([Library,Frame,Box,MousePointer2,Keyboard,Layers3,Focus,Palette,AudioLines,Captions].map(async Icon=>loadImage(Buffer.from(renderToStaticMarkup(createElement(Icon,{size:34,color:P.white,strokeWidth:1.5}))))));
// Each interval has readable dwell time. Feature UI changes fade through the
// fixed panel surface, never cross-dissolve two sets of text over one another.
const scenes = [
  {a:4,b:8.5,tab:0,title:'Start with what you have.',sub:'Drag in media. Drop it into your timeline.',panels:[[0,'uploads']],kind:'import'},
  {a:8.5,b:14.5,tab:6,title:'Let the camera follow.',sub:'Auto zoom · motion blur · camera curves',panels:[[0,'auto-zoom'],[2.1,'motion-blur'],[4,'camera-curves']],kind:'motion'},
  {a:14.5,b:19,tab:3,title:'Give every click character.',sub:'Custom cursors. Smooth paths. Click effects.',panels:[[0,'cursor']],kind:'cursor'},
  {a:19,b:25,tab:1,title:'Make the canvas yours.',sub:'Custom gradients · solid colors · wallpapers',panels:[[0,'canvas-gradients'],[2,'canvas-colors'],[4,'canvas-images']],kind:'canvas'},
  {a:25,b:29.5,tab:2,title:'Add another dimension.',sub:'3D tilt, perspective, and animated poses.',panels:[[0,'tilt']],kind:'tilt'},
  {a:29.5,b:35,tab:7,title:'Find your signature look.',sub:'Film looks · color correction · RGB curves',panels:[[0,'color-looks'],[1.9,'color-correction'],[3.7,'rgb-curves']],kind:'color'},
  {a:35,b:39.5,tab:8,title:'Get the balance right.',sub:'Tune system audio and microphone independently.',panels:[[0,'audio']],kind:'audio'},
  {a:39.5,b:44,tab:9,title:'Put your words on screen.',sub:'Generate local captions. Edit every line.',panels:[[0,'captions']],kind:'captions'},
  {a:44,b:48,tab:5,title:'Point out what matters.',sub:'Text, shapes, spotlights, and masks.',panels:[[0,'layers']],kind:'layers'},
  {a:48,b:51.5,tab:4,title:'Make the steps clear.',sub:'Show recorded keys and clicks as you go.',panels:[[0,'actions']],kind:'actions'},
  {a:51.5,b:56,tab:6,title:'Fine-tune every move.',sub:'Timeline keyframes. Easing. Camera curves.',panels:[[0,'camera-curves']],kind:'keyframes'},
];
function currentScene(t){return scenes.find(s=>t>=s.a&&t<s.b);}
function panel(s,t){
  const local=t-s.a;let n=0;while(n+1<s.panels.length&&local>=s.panels[n+1][0])n++;
  const [start,name]=s.panels[n],next=s.panels[n+1]?.[0]??(s.b-s.a);
  const opacity=env(local,start,next,.28);
  box(ctx,154,292,360,703,'#101614',20,'#caeadc25');
  alpha(ctx,opacity,()=>{ctx.save();round(ctx,154,292,360,703,20);ctx.clip();ctx.drawImage(panels[name],154,292,360,703);ctx.restore();});
}
function rail(s,t){
  box(ctx,65,335,66,604,'#0b1219e8',28,'#bedccc22');
  let selection=s.tab;
  const index=scenes.indexOf(s),prev=scenes[Math.max(0,index-1)].tab;
  selection=mix(prev,s.tab,ramp(t,s.a,s.a+.85));
  box(ctx,74,349+selection*57,48,48,'#bcffd61b',15,'#bcffd65a');
  icons.forEach((im,i)=>alpha(ctx,i===s.tab?1:.36,()=>ctx.drawImage(im,87,362+i*57,22,22)));
  type(ctx,tabs[s.tab],154,265,22,P.mint);
}
function gradient(c,t){const g=c.createLinearGradient(0,0,SW,SH);g.addColorStop(0,'#174b4b');g.addColorStop(.48,`hsl(${166+Math.sin(t*.21)*25} 49% 69%)`);g.addColorStop(1,'#c6ecd4');c.fillStyle=g;c.fillRect(0,0,SW,SH);}
function source(c,t,pad=55,zoom=1){gradient(c,t);c.save();round(c,pad,pad,SW-pad*2,SH-pad*2,18);c.clip();code(c,pad,pad,SW-pad*2,SH-pad*2,zoom);c.restore();}
function wave(c,x,y,w,h,t,color=P.mint){for(let i=0;i<90;i++){const a=energy(t-1.5+i/30);const v=(.16+a*.8)*h*(.55+.45*Math.sin(i*2.7)**2);box(c,x+i*w/90,y-v/2,4,v,color,2);}}
function curve(c,x,y,w,h,p=1){
  for(let i=0;i<=4;i++){line(c,[[x,y+i*h/4],[x+w,y+i*h/4]],'#bde8dd14',1);line(c,[[x+i*w/4,y],[x+i*w/4,y+h]],'#bde8dd14',1);}
  const points=Array.from({length:101},(_,i)=>{const q=i/100*p;return[x+q*w,y+h-ease(q)*h];});line(c,points,P.mint,4);
  const q=p;box(c,x+q*w-7,y+h-ease(q)*h-7,14,14,P.white,7);
}
// Inverse-project once per output pixel. Unlike triangle clipping this has no
// internal seams; bilinear sampling keeps the tilted screenshot continuous.
function projectTexture(c,im,angle){
  if(!texturePixels)texturePixels=tc.getImageData(0,0,im.width,im.height).data;
  const ax=angle*.34,ay=-angle*.48,ca=Math.cos(ay),cb=Math.cos(ax),a10=Math.sin(ax)*Math.sin(ay),a20=-cb*Math.sin(ay)/1700,a21=Math.sin(ax)/1700;
  const dst=warpPixels.data,src=texturePixels,tw=im.width,th=im.height;dst.fill(0);
  for(let py=20;py<SH-20;py++)for(let px=80;px<SW-80;px++){
    const X=px+.5-600,Y=py+.5-315,A=ca-X*a20,B=-X*a21,C=a10-Y*a20,D=cb-Y*a21,det=A*D-B*C;
    const u=((X*D-B*Y)/det/940+.5)*(tw-1),v=((A*Y-X*C)/det/480+.5)*(th-1);
    if(u<0||v<0||u>=tw-1||v>=th-1)continue;
    const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy,off=(iy*tw+ix)*4,to=(py*SW+px)*4;
    for(let k=0;k<4;k++)dst[to+k]=(src[off+k]*(1-fx)+src[off+4+k]*fx)*(1-fy)+(src[off+tw*4+k]*(1-fx)+src[off+(tw+1)*4+k]*fx)*fy;
  }
  wc.putImageData(warpPixels,0,0);c.drawImage(warped,0,0);
}
function demo(s,t){
  const l=t-s.a;sc.resetTransform();sc.globalAlpha=1;sc.fillStyle='#0c1219';sc.fillRect(0,0,SW,SH);
  if(s.kind==='import'){
    source(sc,t);const p=ramp(l,.8,2.5);alpha(sc,1-ramp(l,2.55,3.3),()=>{const x=mix(100,665,p),y=mix(120,450,p);box(sc,x-5,y-5,210,128,'#c9e9df',16);sc.drawImage(wallpaper,x,y,200,118);cursor(sc,'Hornet',x+160,y+90,60);});
    box(sc,65,475,1070,125,'#0a1119ed',18,'#c2e8e72e');
    type(sc,'TIMELINE',87,506,17,P.muted);line(sc,[[88,560],[1110,560]],'#8daaa544',2);
    alpha(sc,ramp(l,2.1,2.8),()=>{box(sc,100,526,980*ramp(l,2.1,3.3),54,'#bcffd628',10,'#bcffd6a0');for(let i=0;i<8;i++)alpha(sc,ramp(l,2.5+i*.06,3.1+i*.06),()=>sc.drawImage(wallpaper,112+i*120,533,108,40));});
  }else if(s.kind==='motion'){
    const z=1+.72*ramp(l,.6,2)*(1-ramp(l,4.4,5.7));source(sc,t,52,z);
    const x=420+300*ramp(l,.3,2.6),y=250-55*Math.sin(l*.8);cursor(sc,'Hornet',x,y,57);
    alpha(sc,env(l,2,4,.35),()=>{for(let j=3;j>0;j--)alpha(sc,.06,()=>cursor(sc,'Hornet',x-j*12,y+j*2,57));});
    alpha(sc,env(l,3.7,6,.4),()=>{box(sc,650,400,485,180,'#081019ed',18,'#c9eee336');curve(sc,680,425,425,125,ramp(l,3.9,5.3));});
    box(sc,78,76,172,49,'#09121bea',12);type(sc,`${z.toFixed(1)}× focus`,164,108,23,P.mint,'center');
  }else if(s.kind==='cursor'){
    source(sc,t);const p=ramp(l,.4,3.4),x=mix(260,920,p),y=280-100*Math.sin(p*Math.PI)+80*p;const flip=ramp(l,1.9,2.4);
    sc.save();sc.translate(x,y);sc.scale(Math.max(.015,Math.abs(Math.cos(flip*Math.PI))),1);cursor(sc,flip<.5?'Hornet':'Bee',0,0,105);sc.restore();
    const click=clamp((l-3.35)/.8);if(click>0&&click<1){sc.beginPath();sc.arc(x,y,15+ease(click)*110,0,Math.PI*2);sc.strokeStyle=`rgba(188,255,214,${1-click})`;sc.lineWidth=3;sc.stroke();}
    box(sc,305,500,590,97,'#081019ed',22,'#c9eee336');['Boo','Bee','Dorito','Knight','Hornet'].forEach((name,i)=>cursor(sc,name,340+i*115,524,58));
  }else if(s.kind==='canvas'){
    gradient(sc,t);alpha(sc,ramp(l,1.7,2.45),()=>{sc.fillStyle='#294840';sc.fillRect(0,0,SW,SH);});alpha(sc,ramp(l,3.7,4.5),()=>sc.drawImage(wallpaper,0,0,SW,SH));
    const pad=54+26*ramp(l,.4,1.6);sc.save();round(sc,pad,pad,SW-pad*2,SH-pad*2,24);sc.clip();code(sc,pad,pad,SW-pad*2,SH-pad*2);sc.restore();
  }else if(s.kind==='tilt'){
    gradient(sc,t);tc.clearRect(0,0,1100,590);tc.save();round(tc,0,0,1100,590,24);tc.clip();code(tc,0,0,1100,590);tc.restore();
    const a=ramp(l,.4,1.9)*(1-ramp(l,3,4.4));projectTexture(sc,texture,a);
    alpha(sc,env(l,.7,4,.4),()=>{box(sc,470,554,260,58,'#09121be8',16);type(sc,'◇  Pose keyframe',600,591,22,P.mint,'center');});
  }else if(s.kind==='color'){
    sc.drawImage(wallpaper,0,0,SW,SH);const p=ramp(l,.6,2.5);sc.fillStyle=`rgba(202,151,100,${p*.2})`;sc.fillRect(0,0,SW,SH);
    // An animated before/after boundary on a real wallpaper, kept separate
    // from text so the color comparison remains clean and legible.
    const split=mix(1000,200,ramp(l,.5,3));sc.save();sc.beginPath();sc.rect(0,0,split,SH);sc.clip();sc.drawImage(wallpaper,0,0,SW,SH);sc.restore();line(sc,[[split,50],[split,600]],'#e8fff1bb',2);
    box(sc,70,70,260,50,'#081019df',14);type(sc,'Original → Graded',200,103,21,P.white,'center');
    alpha(sc,ramp(l,3.3,4),()=>{box(sc,560,295,570,295,'#081019ee',20,'#c9eee336');curve(sc,595,330,500,220,ramp(l,3.5,5));});
  }else if(s.kind==='audio'){
    source(sc,t);sc.fillStyle='#071019c9';sc.fillRect(0,0,SW,SH);
    for(const [i,name]of ['System audio','Microphone'].entries()){
      const y=165+i*220,gain=i?mix(.45,.9,ramp(l,.7,2.5)):mix(.95,.55,ramp(l,.7,2.5));
      type(sc,name,85,y-40,30,P.white);wave(sc,85,y+30,700,95*gain,t+i*3,i?P.mint:P.blue);
      box(sc,865,y-4,230,9,'#b6d8d02b',4);box(sc,865,y-4,230*gain,9,i?P.mint:P.blue,4);box(sc,858+230*gain,y-12,24,24,P.white,12);
      type(sc,`${Math.round(gain*100)}%`,980,y+58,30,P.white,'center');
    }
  }else if(s.kind==='captions'){
    source(sc,t);const words=['Make','every','word','matter.'],pos=[0,143,315,458],width=[118,146,118,200];const q=clamp((l-.8)/.8,0,3),a=Math.floor(q),b=Math.min(a+1,3),p=ease(q-a);
    box(sc,210,460,780,108,'#081019ed',24,'#c9eee336');const x=245+mix(pos[a],pos[b],p),w=mix(width[a],width[b],p)+12;box(sc,x,482,w,62,P.mint,12);
    const wordsDraw=color=>words.forEach((word,i)=>type(sc,word,251+pos[i],528,46,color,'left',true));wordsDraw(P.white);sc.save();round(sc,x,482,w,62,12);sc.clip();wordsDraw('#10231c');sc.restore();
  }else if(s.kind==='layers'){
    source(sc,t);const p=ramp(l,.4,1.4);alpha(sc,.48*p,()=>{sc.fillStyle='#071019';sc.fillRect(0,0,SW,SH);});
    const x=235+60*ramp(l,1.5,2.8);alpha(sc,p,()=>{sc.save();round(sc,x,175,690,230,20);sc.clip();code(sc,55,55,1090,540);sc.restore();round(sc,x,175,690,230,20);sc.strokeStyle=P.mint;sc.lineWidth=3;sc.stroke();});
    alpha(sc,ramp(l,1,1.8),()=>{box(sc,310,470,580,74,'#bcffd6',18);type(sc,'A little more clarity.',600,518,31,'#10231c','center',true);line(sc,[[940,470],[915,420],[880,400]],P.mint,4);});
  }else if(s.kind==='actions'){
    source(sc,t);const active=ramp(l,.55,1.15)*(1-ramp(l,2.5,3.3));
    alpha(sc,active,()=>{box(sc,390,460,420,105,'#081019ed',24,'#c9eee336');box(sc,425,481,165,63,'#bcffd617',12,'#bcffd653');type(sc,'Ctrl',508,524,32,P.white,'center');type(sc,'+',625,523,29,P.muted,'center');box(sc,670,481,99,63,'#bcffd6',12);type(sc,'S',720,524,32,'#10231c','center',true);});
    cursor(sc,'Hornet',810-150*ramp(l,.5,2),240,65);
  }else if(s.kind==='keyframes'){
    sc.drawImage(panels['keyframe-graph'],0,0,SW,SH);
    // Enlarge the editable easing relationship beside its genuine graph UI.
    box(sc,495,100,635,365,'#09121bf5',22,'#c9eee336');type(sc,'Cinematic easing',530,148,25,P.white);curve(sc,535,190,550,220,ramp(l,.35,2.5));
    const x=135+930*ramp(l,.4,3.6);line(sc,[[x,500],[x,610]],P.white,2);
    [135,445,755,1065].forEach(px=>{sc.save();sc.translate(px,550);sc.rotate(Math.PI/4);box(sc,-9,-9,18,18,P.mint,2);sc.restore();});
  }
}
function stage(s,t){
  const opacity=env(t,s.a,s.b,.38);panel(s,t);rail(s,t);
  demo(s,t);const lift=Math.sin(t*.32)*4;
  box(ctx,553,306+lift,1272,696,'#abcbd333',27);box(ctx,559,312+lift,1260,684,'#0a1019',23);
  alpha(ctx,opacity,()=>{ctx.save();round(ctx,565,318+lift,1248,672,18);ctx.clip();ctx.drawImage(surface,565,318+lift,1248,672);ctx.restore();});
}
function render(t){
  ctx.resetTransform();ctx.globalAlpha=1;background(t);
  const s=currentScene(t);
  if(s){
    alpha(ctx,env(t,4,56,.6),()=>stage(s,t));
    const p=ramp(t,s.a,s.a+.65),out=1-ramp(t,s.b-.5,s.b);
    alpha(ctx,out,()=>{reveal(s.title,960,142,65,p,P.white);alpha(ctx,ramp(t,s.a+.15,s.a+.8),()=>type(ctx,s.sub,960,209,25,P.muted,'center'));});
  }
  alpha(ctx,1-ramp(t,3.1,4),()=>{
    alpha(ctx,ramp(t,.1,1),()=>{ctx.drawImage(images.logo,825,185,70,70);type(ctx,'Snap',918,244,65,P.white,'left',true);});
    reveal('Your screen.',960,458,132,ramp(t,.25,1.35));reveal('In full flow.',960,626,132,ramp(t,.6,1.75),P.mint);
    alpha(ctx,ramp(t,1.2,2),()=>type(ctx,'One canvas. So many possibilities.',960,731,28,P.muted,'center'));
  });
  alpha(ctx,ramp(t,56,56.8),()=>{
    ctx.drawImage(images.logo,825,240+Math.sin(t)*3,80,80);type(ctx,'Snap',928,305,78,P.white,'left',true);
    reveal('Make it a Snap.',960,523,112,ramp(t,56.15,57.3));reveal('Every detail. Your way.',960,632,44,ramp(t,56.5,57.6),P.mint);
    alpha(ctx,ramp(t,56.9,58),()=>{box(ctx,733,730,454,74,'#bcffd612',36,'#bcffd65c');type(ctx,'Free for Windows',960,778,28,P.mint,'center',true);type(ctx,'snap.venusapp.in',960,879,27,P.muted,'center');});
  });
  alpha(ctx,ramp(t,59.25,60)*.85,()=>{ctx.fillStyle=P.bg;ctx.fillRect(0,0,W,H);});
}
const times=[2,6.8,10.3,13.5,17.5,20.4,22.3,24.3,27.2,31,34,37.5,42,46,49.7,54,58.3];
const sheet=createCanvas(1920,2160),sheetCtx=sheet.getContext('2d');
for(const [i,t]of times.entries()){render(t);const png=await canvas.encode('png');await writeFile(join(qa,`scene-${String(i+1).padStart(2,'0')}.png`),png);sheetCtx.drawImage(await loadImage(png),i%3*640,Math.floor(i/3)*360,640,360);}
await writeFile(join(qa,'contact-sheet.png'),await sheet.encode('png'));
for(const boundary of [8.5,14.5,19,25,29.5,35,39.5,44,48,51.5,56]){
  const strip=createCanvas(1920,720),c=strip.getContext('2d');for(let i=0;i<6;i++){render(boundary-.5+i*.2);c.drawImage(await loadImage(await canvas.encode('png')),i%3*640,Math.floor(i/3)*360,640,360);}await writeFile(join(qa,`transition-${boundary}.png`),await strip.encode('png'));
}
console.log(`Review frames: ${qa}`);
if(process.argv.includes('--stills'))process.exit(0);
const preview=process.argv.includes('--preview'),fps=preview?30:FPS;
const film=join(preview?qa:join(pub,'media'),preview?'preview.mp4':'snap-features-promo.mp4');
const ffmpeg=spawn(process.env.SNAP_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${W}x${H}`,'-framerate',String(fps),'-i','pipe:0','-i',productMusic,'-map','0:v:0','-map','1:a:0',...(preview?['-vf','scale=1280:720']:[]),'-c:v','libx264','-preset',preview?'veryfast':'medium','-crf',preview?'20':'17','-threads','4','-pix_fmt','yuv420p','-af',createProductAudioFilter(DURATION,AUDIO_START),'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(DURATION),'-movflags','+faststart',film],{windowsHide:true,stdio:['pipe','ignore','pipe']});
let stderr='',pipeError;ffmpeg.stderr.on('data',d=>stderr+=d);ffmpeg.stdin.on('error',e=>pipeError=e);
const done=new Promise((resolve,reject)=>{ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(stderr||`FFmpeg ${code}`)));});done.catch(()=>{});
for(let frame=0;frame<DURATION*fps;frame++){if(pipeError)throw pipeError;render(frame/fps);if(!ffmpeg.stdin.write(canvas.data()))await once(ffmpeg.stdin,'drain');if(frame%(fps*3)===0)console.log(`Rendered ${frame/fps}/${DURATION} seconds`);}
ffmpeg.stdin.end();await done;
if(!preview){
  render(10.3);await sharp(await canvas.encode('png')).resize(1440).webp({quality:94}).toFile(join(pub,'media/snap-features-promo-poster.webp'));
  const captions=[[0,4,'Snap. Your screen. In full flow.'],...scenes.map(s=>[s.a,s.b,`${tabs[s.tab]}. ${s.title} ${s.sub}`]),[56,60,'Make it a Snap. Every detail. Your way. Free for Windows. snap.venusapp.in']];
  const stamp=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}.${Math.round(t%1*1000).toString().padStart(3,'0')}`;
  await writeFile(join(pub,'media/snap-features-promo.vtt'),'WEBVTT\n\n'+captions.map(([a,b,text])=>`${stamp(a)} --> ${stamp(b)}\n${text}\n`).join('\n'));
}
console.log(`Created ${film}: 60s, ${fps}fps, supplied OST + JetBrains Mono.`);
