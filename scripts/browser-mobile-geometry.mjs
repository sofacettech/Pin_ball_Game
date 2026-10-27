import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const url=process.env.SOFACET_VIDEO_URL||'http://127.0.0.1:8768';
const browser=await browserType.launch();
try {
 for (const native of [false,true]) {
  const context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7']});
  try {
   const page=await context.newPage(),errors=[],timingRequests=[];
   page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/frame-timing.js'))timingRequests.push(request.url())});
   page.on('pageerror',error=>errors.push(error.message));
   if(native)await page.addInitScript(()=>{globalThis.VideoDecoder=undefined});
   const pageURL=new URL(url);if(pageURL.pathname==='/')pageURL.pathname='/video';if(native)pageURL.searchParams.set('renderer','native');pageURL.hash='experience';
   await page.goto(pageURL.href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.sofacetPreview&&(
    document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),null,{timeout:60000});
   if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
   await page.waitForFunction(()=>document.body.dataset.phase==='idle',null,{timeout:60000});
   await page.touchscreen.tap(195,422);
   await page.evaluate(()=>window.scrollTo(0,1600));
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200,null,{timeout:30000});
   const chromeResize=await page.evaluate(async()=>{
    const main=document.querySelector('main'),stage=document.querySelector('#scene-frame');
    const before=stage.getBoundingClientRect();
    try {
     main.style.bottom='100px';
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const after=stage.getBoundingClientRect();
     const {width,height}=window.sofacetPreview.renderer.domElement;
     return {before:[before.width,before.height],after:[after.width,after.height],width,height};
    } finally {main.style.removeProperty('bottom')}
   });
   assert.deepEqual(chromeResize.before,chromeResize.after,'Browser bars must not rescale the ball');
   assert.ok(chromeResize.width<=1920&&chromeResize.height<=1080,'The cropped WebGL buffer must not exceed Full HD');
   for(const viewport of [{width:390,height:700},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(()=>{
     const stage=document.querySelector('#scene-frame').getBoundingClientRect();
     return Math.abs(stage.width/stage.height-16/9)<.005;
    });
    const geometry=await page.evaluate(()=>{
     const rect=element=>{const bounds=element.getBoundingClientRect();return bounds.width/bounds.height};
     const video=document.querySelector('#journey');
     return {stage:rect(document.querySelector('#scene-frame')),
      canvases:[...document.querySelectorAll('#scene-frame canvas')].filter(element=>element.getBoundingClientRect().width>0).map(rect),
      video:video.classList.contains('native-renderer')?rect(video):null,
      fit:getComputedStyle(video).objectFit};
    });
    for(const aspect of [geometry.stage,...geometry.canvases,...(geometry.video?[geometry.video]:[])])
     assert.ok(Math.abs(aspect-16/9)<.005,'Portrait and landscape must preserve the original aspect ratio');
    if(geometry.video)assert.equal(geometry.fit,'contain');
   }
   assert.deepEqual(errors,[]);
   assert.deepEqual(timingRequests,[],'Normal visits must not load worker diagnostics');
   console.log(JSON.stringify({engine,native,chromeResize,result:'Mobile geometry checks passed'}));
  } finally {await context.close()}
 }
} finally {await browser.close()}
