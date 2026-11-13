import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
import {readVideoCropGeometry,assertVideoCropGeometry,assertVideoStartupPolicy} from './browser-video-crop-checks.mjs';
import {verifyVideoCropPixels} from './browser-video-crop-fidelity.mjs';
const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:browserType}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const base=process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8766/';
const option=process.env.SOFACET_ENTRANCE_OPTION||'default';
const expectedWidth=Number(process.env.SOFACET_EXPECT_ENTRANCE_WIDTH||1920);
const cropOnly=process.env.SOFACET_VIDEO_CROP_ONLY==='1';
const output=new URL(`../work/entrance-video${option==='3'?'-4k':''}/`,import.meta.url);
await mkdir(output,{recursive:true});
const scroll=createJourneyScrollMap(),report=[];
const framing=JSON.parse(await readFile(new URL('../assets/ball-framing.json',import.meta.url)));
const browser=await browserType.launch({...engine==='chromium'&&process.platform==='darwin'?{args:['--enable-gpu']}:{}});
try{
  const pixelFidelity=await verifyVideoCropPixels(browser);
  const cases=cropOnly?[['phone',{width:393,height:852},'reduce']]:[['desktop',{width:1440,height:900},'no-preference'],['phone',{width:393,height:852},'reduce']];
  for(const [name,viewport,reducedMotion] of cases){
    const context=await browser.newContext({viewport,reducedMotion,...name==='phone'?{isMobile:true,hasTouch:true}:{}});
    const page=await context.newPage(),requests=[],errors=[];
    await page.addInitScript({content:`window.__readVideoCropGeometry=${readVideoCropGeometry.toString()};`});
    page.on('request',request=>requests.push(request.url()));
    page.on('pageerror',error=>errors.push(error.message));
    const url=new URL(base);url.searchParams.delete('entrance');url.searchParams.delete('version');
    if(option!=='default')url.searchParams.set(process.env.SOFACET_ENTRANCE_PARAMETER||'entrance',option);
    url.hash='experience';
    // Returning visitors skip the reveal but still need the logo while the
    // complete video buffers. Hold real media requests to observe that state.
    let releaseMedia;
    const mediaGate=new Promise(resolve=>{releaseMedia=resolve});
    const mediaPattern=/(?:\/assets\/entrance-video\/(?:opening|journey)\.mp4|\/entrance-(?:opening|journey)-[a-f0-9]+\.mp4)/;
    await page.route(mediaPattern,async route=>{await mediaGate;await route.continue()});
    let loadingLogo;
    try{
      await page.goto(url.href);
      await page.locator('#site-loader[data-preparing][data-waiting]').waitFor();
      assert.equal(await page.locator('#site-loader #scene').isVisible(),true,'Skipped intro must retain its static logo during video preparation');
      loadingLogo=await page.evaluate(()=>({visible:getComputedStyle(document.querySelector('#site-loader #scene')).visibility,
        phase:document.querySelector('#loading-stage').dataset.phase??null,audioPaused:document.querySelector('#introAudio').paused}));
      assert.equal(loadingLogo.phase,null,'Do not replay the intro on return');
      assert.equal(loadingLogo.audioPaused,true,'Static loading must not start intro audio');
      await page.screenshot({path:new URL(`${engine}-${name}-loading-logo.png`,output).pathname});
    }finally{releaseMedia();}
    await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:180000});
    const startup=await page.evaluate(()=>({quality:window.entrancePreview.quality,scripts:Array.from(document.scripts,s=>s.src).filter(src=>src.includes('/assets/entrance-3d/entry-')),atMs:performance.now()}));
    assertVideoStartupPolicy(startup.quality);
    assert.equal(startup.quality.sourceWidth,expectedWidth,'The first ready picture must preserve the selected source width');
    assert.equal(startup.quality.sourceHeight,expectedWidth*9/16,'The first ready picture must preserve the selected source height');
    assert.equal(await page.locator('body').getAttribute('data-error'),null);
    assert.equal(await page.evaluate(()=>window.entrancePreview.batching),'video');
    if(reducedMotion==='no-preference'){
      await page.waitForFunction(()=>window.entrancePreview.phase==='idle',null,{timeout:10000});
    }
    await page.screenshot({path:new URL(`${engine}-${name}-opening.png`,output).pathname});
    assert.equal(requests.some(url=>/\.glb(?:\?|$)|camera-motion\.json/.test(url)),false,'Video entrance must not download a 3D model');
    if(process.env.SOFACET_EXPECT_ENTRANCE_CDN){
      const origin=new URL(process.env.SOFACET_EXPECT_ENTRANCE_CDN).origin;
      for(const kind of ['opening','journey'])assert.ok(requests.some(url=>new URL(url).origin===origin&&new URL(url).pathname.includes(`entrance-${kind}-`)),`Expected ${kind} from the configured CDN`);
      assert.equal(requests.some(url=>/\/assets\/entrance-video\/(opening|journey)\.mp4/.test(url)),false,'A healthy CDN must not fall back to local video');
    }
    let openingResponse,coldJump;
    const geometry=[];
    async function captureGeometry(label){
      const result=await page.evaluate(readVideoCropGeometry,framing);
      assertVideoCropGeometry(result,expectedWidth,`${name} ${label}`);geometry.push({label,...result});
    }
    await captureGeometry('opening');
    for(const frame of cropOnly?[1840,1000,334,850,1100,2163,334]:[850,1100,1840,1000,334]){
      const started=await page.evaluate(({y,framing,captureTransition})=>{
        const start={at:performance.now(),from:window.entrancePreview.displayedFrame};
        if(captureTransition){
          window.__cropTransitionSamples=[];window.__cropSampling=true;
          const sample=()=>{
            if(!window.__cropSampling)return;
            const p=window.entrancePreview;
            if(Math.abs(p.frame-p.displayedFrame)>1&&window.__cropTransitionSamples.length<120)window.__cropTransitionSamples.push(window.__readVideoCropGeometry(framing));
            requestAnimationFrame(sample);
          };requestAnimationFrame(sample);
        }
        scrollTo(0,y);return start;
      },{y:scroll.scrollAtFrame(frame),framing,captureTransition:frame===850});
      await page.waitForFunction(frame=>Math.abs(window.entrancePreview.frame-frame)<.2&&window.entrancePreview.settled&&Math.abs(window.entrancePreview.displayedFrame-frame)<1,frame,{timeout:60000});
      if(cropOnly&&frame===1840&&!coldJump)coldJump=await page.evaluate(start=>({from:start.from,to:1840,elapsedMs:performance.now()-start.at,quality:window.entrancePreview.quality}),started);
      if(frame===850){
        openingResponse=await page.evaluate(start=>({from:start.from,to:850,elapsedMs:performance.now()-start.at}),started);
        assert.equal(openingResponse.from,334,'Measure the first scroll from the opening journey picture');
        assert.ok(openingResponse.elapsedMs<3000,`The opening scroll must respond within 3 seconds, without a full-video playback cap (took ${Math.round(openingResponse.elapsedMs)} ms)`);
        const pending=await page.evaluate(()=>{window.__cropSampling=false;return window.__cropTransitionSamples});
        for(const sample of pending)assertVideoCropGeometry(sample,expectedWidth,`${name} decoding transition`);
        openingResponse.pendingCropSamples=pending.length;
      }
      await captureGeometry(`frame-${frame}`);
    }
    await page.evaluate(y=>scrollTo(0,y),scroll.scrollAtFrame(1840));
    await page.waitForFunction(()=>window.entrancePreview.displayedFrame===1840&&window.entrancePreview.settled,null,{timeout:60000});
    await captureGeometry('before-rotation');
    await page.setViewportSize({width:viewport.height,height:viewport.width});
    await page.waitForFunction(framing=>window.entrancePreview.displayedFrame===1840&&window.entrancePreview.settled&&window.__readVideoCropGeometry(framing).projectionErrorPx<.1,framing,{timeout:60000});
    await captureGeometry('rotated');
    await page.screenshot({path:new URL(`${engine}-${name}-chess.png`,output).pathname});
    await page.setViewportSize(viewport);
    await page.waitForFunction(framing=>window.entrancePreview.displayedFrame===1840&&window.entrancePreview.settled&&window.__readVideoCropGeometry(framing).projectionErrorPx<.1,framing,{timeout:60000});
    await captureGeometry('rotation-restored');
    const quality=await page.evaluate(()=>window.entrancePreview.quality);
    assertVideoStartupPolicy(quality);assert.equal(quality.preview,false);
    assert.equal(quality.sourceWidth,expectedWidth,'The resting frame must decode at the selected resolution');
    assert.equal(quality.sourceHeight,expectedWidth*9/16);
    if(process.env.SOFACET_EXPECT_ENTRANCE_SEGMENTS==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.segmented),true,'The complete journey must keep using buffered sections');
    if(process.env.SOFACET_EXPECT_ENTRANCE_STREAMING==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.streaming),true,'The complete journey must keep using streamed decoding');
    const completion=cropOnly?null:await page.evaluate(y=>new Promise((resolve,reject)=>{
      const start=performance.now(),initialFrame=window.entrancePreview.displayedFrame;
      let lastVisibleFrame=initialFrame,maxFrameStep=0,approachPictures=0,maxApproachStep=0,impactAt=null;
      const timer=setTimeout(()=>reject(Error('Video completion timed out')),60000);
      function sample(now){
        const state=window.entrancePreview;
        if(document.body.hasAttribute('data-game-loading')||state.gameVisible){
          clearTimeout(timer);resolve({initialFrame,lastVisibleFrame,maxFrameStep,approachPictures,maxApproachStep,impactHoldMs:impactAt===null?0:now-impactAt,elapsedMs:now-start});return;
        }
        maxFrameStep=Math.max(maxFrameStep,Math.abs(state.displayedFrame-lastVisibleFrame));
        if(state.displayedFrame>=2000&&state.displayedFrame!==lastVisibleFrame){
          approachPictures++;
          if(lastVisibleFrame>=2000)maxApproachStep=Math.max(maxApproachStep,state.displayedFrame-lastVisibleFrame);
        }
        if(state.displayedFrame===2164&&impactAt===null)impactAt=now;
        lastVisibleFrame=state.displayedFrame;requestAnimationFrame(sample);
      }
      scrollTo(0,y);requestAnimationFrame(sample);
    }),scroll.travel);
    if(completion){
      assert.equal(completion.lastVisibleFrame,2164,'The final decoded picture must appear before the cards');
      assert.ok(completion.impactHoldMs>=175,'The impact must remain visible before the opaque cards');
      if(reducedMotion==='no-preference'){
        assert.ok(completion.approachPictures>=40,'A fast final swipe must still show the ball approach, not one final still');
        assert.ok(completion.maxApproachStep<=8,'The ending must not skip over decoded approach poses');
      }
    }
    // The original loader owns the reward story and actual game readiness.
    if(!cropOnly)await page.waitForFunction(()=>window.entrancePreview.gameVisible,null,{timeout:60000});
    if(process.env.SOFACET_EXPECT_ENTRANCE_CDN)assert.equal(requests.some(url=>/\/assets\/entrance-video\/(opening|journey)\.mp4/.test(url)),false,'The complete journey must stay on CDN media');
    assert.deepEqual(errors,[]);
    report.push({name,engine,option,loadingLogo,startup,quality,openingResponse,coldJump,completion,geometry,...name==='desktop'||cropOnly?{pixelFidelity}:{},noModelDownload:true,forwardReverseAndRotation:true,gameHandoff:!cropOnly,cdn:process.env.SOFACET_EXPECT_ENTRANCE_CDN||null,errors});
    await context.close();
  }
  // The explicit live 3D alternative must not prefetch video media.
  if(!cropOnly){const context=await browser.newContext();const page=await context.newPage(),requested=[];
  page.on('request',request=>requested.push(request.url()));
  const modelRequested=page.waitForRequest(request=>request.url().includes('journey-compact.glb'));
  const liveURL=new URL(base);liveURL.searchParams.set('entrance','1');
  await page.goto(liveURL.href);
  await modelRequested;
  assert.equal(requested.some(url=>url.includes('/assets/entrance-video/')),false);
  await context.close();}
  await writeFile(new URL(`${engine}-browser-report.json`,output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close()}
