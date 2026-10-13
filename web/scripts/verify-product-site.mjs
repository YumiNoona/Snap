// Optional real-browser QA: run the web dev/start server first.
// SNAP_PLAYWRIGHT_MODULE may point at a bundled Playwright index.mjs.
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.SNAP_PLAYWRIGHT_MODULE?pathToFileURL(process.env.SNAP_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.SNAP_TEST_BROWSER || 'msedge'});
const url=process.env.SNAP_TEST_URL || 'http://127.0.0.1:3000';
const output='test-results/product-site';await mkdir(output,{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],broken=[],videoRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400 && /screenshots|media\//.test(response.url()))broken.push(response.url());});
  page.on('request',request=>{if(request.url().includes('snap-promo.mp4'))videoRequests.push(request.url());});
  await page.goto(url,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Pause screenshot rotation',exact:true}).click();
  assert.equal(videoRequests.length,0,'Film must not download before an explicit play');
  assert.equal(await page.locator('video').getAttribute('preload'),'none');
  const labels=['Editor','Camera','Cursor','Layers','Looks','Audio','Captions','3D tilt','Light mode'];
  for(const label of labels){
    await page.getByRole('tab',{name:label,exact:true}).click();
    await page.waitForFunction(()=>{const image=document.querySelector('.showcase-slide.is-active');return image?.complete&&image.naturalWidth>0;});
    assert.equal(await page.getByRole('tab',{name:label,exact:true}).getAttribute('aria-selected'),'true');
    assert.ok(await page.locator('.showcase-slide').count()<=2,'Only active/previous screenshots mount');
  }
  await page.getByRole('tab',{name:'Light mode',exact:true}).press('Home');
  assert.equal(await page.getByRole('tab',{name:'Editor',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Editor',exact:true}).press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Camera',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Editor',exact:true}).click();
  await page.waitForTimeout(850);
  for(const image of await page.locator('.real-workflow-image img').all()){
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(async element=>{await element.decode();});
  }
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${output}/desktop.png`,fullPage:true});
  console.log('PASS nine actual screenshots, keyboard tabs, pause control and lazy film loading');
  if(!process.argv.includes('--layout-only')){
    await page.getByRole('button',{name:'Play Snap product film',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('video').currentTime>2,{}, {timeout:15000});
    const metadata=await page.locator('video').evaluate(video=>({duration:video.duration,width:video.videoWidth,height:video.videoHeight,muted:video.muted,controls:video.controls}));
    assert.ok(Math.abs(metadata.duration-25)<.1);assert.deepEqual([metadata.width,metadata.height],[1920,1080]);
    assert.equal(metadata.muted,true);assert.equal(metadata.controls,true);
    await page.locator('video').evaluate(video=>{video.pause();video.currentTime=15;});
    await page.waitForFunction(()=>!document.querySelector('video').seeking);
    assert.equal((await page.request.get(`${url}/media/snap-promo.vtt`)).status(),200);
    await page.locator('#film').screenshot({path:`${output}/film.png`});
    console.log('PASS real 25-second 1080p playback, seek, native controls, muted start and captions');
  }
  await page.setViewportSize({width:390,height:844});await page.goto(url,{waitUntil:'networkidle'});
  await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow on mobile');
  await page.getByRole('tab',{name:'Captions',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'Captions',exact:true}).getAttribute('aria-selected'),'true');
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'networkidle'});
  const selected=await page.locator('[role="tab"][aria-selected="true"]').textContent();
  await page.waitForTimeout(5200);
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').textContent(),selected,'Reduced motion disables automatic screenshot rotation');
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(broken.length,0,broken.join('\n'));
  console.log('PASS responsive layout, mobile tabs, reduced motion and no broken media/page errors');
}finally{await browser.close();}
