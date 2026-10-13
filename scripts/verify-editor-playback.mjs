// Real Edge/Chromium media + paused-canvas regression. Generate the fixture:
// ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 600 -c:v libx264
//   -preset ultrafast -crf 35 -g 60 -movflags +faststart test-results/playback-ten-minutes.mp4
// Run against npm run dev. Backend calls are mocked; no user media is modified.
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const file='test-results/playback-ten-minutes.mp4';
const { size }=await stat(file), cap=32*1024*1024;
let releaseCursor;
const cursorGate=new Promise(resolve=>{releaseCursor=resolve;});
const requests=[];
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.url==='/cursor.svg'){
    await cursorGate;
    res.setHeader('Content-Type','image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff00ff"/></svg>'); return;
  }
  if(req.url!=='/video.mp4'){res.writeHead(404).end();return;}
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start=range?Number(range[1]):0,end=Math.min(size-1,start+cap-1,range?.[2]?Number(range[2]):Infinity);
  requests.push({start,end});
  res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file,{start,end});res.on('close',()=>stream.destroy());stream.pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const media=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(process.env.SNAP_PLAYWRIGHT_MODULE?pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.SNAP_TEST_BROWSER || 'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1120,height:680}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(base=>{
    globalThis.testMedia=base;
    globalThis.__TAURI_INTERNALS__={invoke:async command=>{
      if(command==='list_cursor_packs')return [{name:'test',label:'Test magenta',pointer_url:`${base}/cursor.svg`,states:[]}];
      if(command==='read_input_log')return [{type:'meta',source:'desktop',x:0,y:0,w:640,h:360,ts:0},{type:'mousemove',ts:0,x:320,y:180},{type:'mousemove',ts:600000,x:320,y:180}];
      if(command==='get_system_cursor')throw new Error('Neutral fallback in browser test');
      return [];
    }};
    const original=HTMLMediaElement.prototype.load;
    globalThis.testLoads=0;
    HTMLMediaElement.prototype.load=function(){if(this.id==='preview-video')testLoads++;return original.call(this);};
  },media);
  await page.goto(`${process.env.SNAP_TEST_URL || 'http://127.0.0.1:1420'}/?window=donate`);
  await page.evaluate(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js');
    const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
    const {default:Preview}=await import('/src/components/Editor/Preview/index.tsx');
    const {default:Panels}=await import('/src/components/Editor/Panels/index.tsx');
    const {usePlaybackController}=await import('/src/components/Editor/hooks/usePlaybackController.ts');
    const {DEFAULT_EDITOR_CONFIG}=await import('/src/lib/types.ts');
    const noop=()=>{},tracks=[],keys=[];
    document.body.replaceChildren();document.body.style.cssText='margin:0;background:#111;color:white';
    const host=document.createElement('div');document.body.append(host);
    function Harness(){
      const [config,setConfig]=React.useState({...structuredClone(DEFAULT_EDITOR_CONFIG),bgType:'color',backgroundColor:'#111',padding:0,borderRadius:0,shadow:{enabled:false},zoomEnabled:false,trimEnd:600,cursorStyle:{...DEFAULT_EDITOR_CONFIG.cursorStyle,size:40}});
      const controller=usePlaybackController({videoPath:`${testMedia}/video.mp4`,duration:600,trimStart:0,trimEnd:600,playbackRate:1,audioTracks:tracks,audioMix:config.audio});
      globalThis.testController=controller;globalThis.testConfig=config;
      return React.createElement('div',{style:{display:'flex',height:640,gap:20}},
        React.createElement('div',{style:{width:350}},React.createElement(Panels,{config,inputLogPath:'test-events',duration:600,currentTime:0,onConfigChange:setConfig,layers:tracks,selectedLayerId:null,activeTab:'cursor',audioTracks:tracks,captionTracks:tracks,onAddLayer:noop,onSelectLayer:noop,onAddManualZoom:noop,onRegenerateAutoZoom:noop,onZoomModeChange:noop,onSelectedZoomChange:noop,onClearSelectedZoom:noop,onDeleteSelectedZoom:noop,onAddAudio:noop,onAddAudioSources:noop,onAddMediaToTimeline:noop,onAddManualCaption:noop,onAudioTracksChange:noop,onCaptionTracksChange:noop,onSelectCaption:noop,onSelectAction:noop,onSnapLayerToAction:noop})),
        React.createElement('div',{style:{width:720,height:640}},React.createElement(Preview,{videoPath:`${testMedia}/video.mp4`,inputLogPath:'test-events',config,keyframes:keys,onKeyframesChange:noop,playing:controller.playing,onDuration:noop,onMediaElementChange:controller.setMediaElement,preserveProjectKeyframes:true})),
        React.createElement('button',{onClick:controller.togglePlay},'Test play'));
    }
    ReactDOM.createRoot(host).render(React.createElement(Harness));
    globalThis.magentaPixels=()=>{const canvas=document.querySelector('.preview-canvas');if(!canvas?.width)return 0;const pixels=canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,12,12).data;let matches=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>245&&pixels[i+1]<10&&pixels[i+2]>245)matches++;return matches;};
  });
  await page.waitForFunction(()=>document.querySelector('#preview-video')?.readyState>=3&&document.querySelector('.preview-canvas')?.style.visibility==='visible');
  assert.equal(Math.round(await page.locator('#preview-video').evaluate(video=>video.duration)),600);
  await page.getByRole('button',{name:'Test magenta cursor',exact:true}).click();
  assert.equal(await page.evaluate(()=>testConfig.cursorStyle.pack.id),'test');
  releaseCursor();
  await page.waitForFunction(()=>magentaPixels()>80,{},{timeout:8000});
  assert.equal(await page.locator('#preview-video').evaluate(video=>video.paused),true);
  console.log('PASS one-click cursor selection repaints the paused preview after delayed image decode');
  await page.getByRole('button',{name:'Default cursor',exact:true}).click();
  await page.waitForFunction(()=>magentaPixels()<10);
  await page.getByRole('button',{name:'Test magenta cursor',exact:true}).click();
  await page.waitForFunction(()=>magentaPixels()>80);
  console.log('PASS cached one-click switching between the native/default cursor and custom bitmap');
  await page.getByRole('button',{name:'Test play',exact:true}).click();
  await page.waitForFunction(()=>testController.playing);
  await page.waitForTimeout(10_000);
  assert.ok(await page.locator('#preview-video').evaluate(video=>video.currentTime)>8);
  for(const target of [120,118,122,120,300,298,302,300,580,578,582,580]){
    await page.evaluate(time=>testController.seekTo(time),target);
    await page.waitForFunction(time=>testController.playing&&Math.abs(document.querySelector('#preview-video').currentTime-time)<1,target);
    await page.waitForTimeout(120);
  }
  const before=await page.locator('#preview-video').evaluate(video=>video.currentTime);
  await page.waitForTimeout(10_000);
  const after=await page.locator('#preview-video').evaluate(video=>video.currentTime);
  assert.ok(after-before>8,'Playback must continue after repeated short backwards/forwards seeks');
  assert.equal(await page.evaluate(()=>testLoads),0,'No decoder reloads during ordinary playback/seeking');
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(requests.every(r=>r.end-r.start+1<=cap));
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/editor-playback.png'});
  console.log(JSON.stringify({pass:true,fixtureSeconds:600,fixtureBytes:size,mediaRequests:requests.length,maxReadAheadBytes:cap,decoderReloads:0,seekChecks:12,continuousPlaybackSeconds:after-before}));
}finally{releaseCursor();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
