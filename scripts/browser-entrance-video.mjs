import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:browserType}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const base=process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8766/';
const option=process.env.SOFACET_ENTRANCE_OPTION||'default';
const expectedWidth=Number(process.env.SOFACET_EXPECT_ENTRANCE_WIDTH||1920);
const output=new URL(`../work/entrance-video${option==='3'?'-4k':''}/`,import.meta.url);
await mkdir(output,{recursive:true});
const scroll=createJourneyScrollMap(),report=[];
const browser=await browserType.launch({...engine==='chromium'&&process.platform==='darwin'?{args:['--enable-gpu']}:{}});
try{
  for(const [name,viewport,reducedMotion] of [['desktop',{width:1440,height:900},'no-preference'],['phone',{width:393,height:852},'reduce']]){
    const context=await browser.newContext({viewport,reducedMotion,...name==='phone'?{isMobile:true,hasTouch:true}:{}});
    const page=await context.newPage(),requests=[],errors=[];
    page.on('request',request=>requests.push(request.url()));
    page.on('pageerror',error=>errors.push(error.message));
    const url=new URL(base);url.searchParams.delete('entrance');url.searchParams.delete('version');
    if(option!=='default')url.searchParams.set(process.env.SOFACET_ENTRANCE_PARAMETER||'entrance',option);
    url.hash='experience';
    await page.goto(url.href);
    await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:180000});
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
    let openingResponse;
    for(const frame of [850,1100,1840,1000,334]){
      const started=await page.evaluate(y=>{
        const start={at:performance.now(),from:window.entrancePreview.displayedFrame};
        scrollTo(0,y);return start;
      },scroll.scrollAtFrame(frame));
      await page.waitForFunction(frame=>Math.abs(window.entrancePreview.frame-frame)<.2&&window.entrancePreview.settled&&Math.abs(window.entrancePreview.displayedFrame-frame)<1,frame,{timeout:60000});
      if(frame===850){
        openingResponse=await page.evaluate(start=>({from:start.from,to:850,elapsedMs:performance.now()-start.at}),started);
        assert.equal(openingResponse.from,334,'Measure the first scroll from the opening journey picture');
        assert.ok(openingResponse.elapsedMs<3000,`The opening scroll must respond within 3 seconds, without a full-video playback cap (took ${Math.round(openingResponse.elapsedMs)} ms)`);
      }
    }
    await page.setViewportSize({width:viewport.height,height:viewport.width});
    await page.evaluate(y=>scrollTo(0,y),scroll.scrollAtFrame(1840));
    await page.waitForFunction(()=>window.entrancePreview.displayedFrame===1840&&window.entrancePreview.settled,null,{timeout:60000});
    await page.screenshot({path:new URL(`${engine}-${name}-chess.png`,output).pathname});
    const quality=await page.evaluate(()=>window.entrancePreview.quality);
    assert.equal(quality.preloaded,true);assert.equal(quality.preview,false);
    assert.equal(quality.sourceWidth,expectedWidth,'The resting frame must decode at the selected resolution');
    assert.equal(quality.sourceHeight,expectedWidth*9/16);
    if(process.env.SOFACET_EXPECT_ENTRANCE_SEGMENTS==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.segmented),true,'The complete journey must keep using buffered sections');
    if(process.env.SOFACET_EXPECT_ENTRANCE_STREAMING==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.streaming),true,'The complete journey must keep using streamed decoding');
    const completion=await page.evaluate(y=>new Promise((resolve,reject)=>{
      const start=performance.now(),initialFrame=window.entrancePreview.displayedFrame;
      let lastVisibleFrame=initialFrame,maxFrameStep=0;
      const timer=setTimeout(()=>reject(Error('Video completion timed out')),60000);
      function sample(now){
        const state=window.entrancePreview;
        if(document.body.hasAttribute('data-game-loading')||state.gameVisible){
          clearTimeout(timer);resolve({initialFrame,lastVisibleFrame,maxFrameStep,elapsedMs:now-start});return;
        }
        maxFrameStep=Math.max(maxFrameStep,Math.abs(state.displayedFrame-lastVisibleFrame));
        lastVisibleFrame=state.displayedFrame;requestAnimationFrame(sample);
      }
      scrollTo(0,y);requestAnimationFrame(sample);
    }),scroll.travel);
    assert.equal(completion.lastVisibleFrame,2164,'The final decoded picture must appear before the cards');
    // The original loader owns the reward story and actual game readiness.
    await page.waitForFunction(()=>window.entrancePreview.gameVisible,null,{timeout:60000});
    if(process.env.SOFACET_EXPECT_ENTRANCE_CDN)assert.equal(requests.some(url=>/\/assets\/entrance-video\/(opening|journey)\.mp4/.test(url)),false,'The complete journey must stay on CDN media');
    assert.deepEqual(errors,[]);
    report.push({name,engine,option,quality,openingResponse,completion,noModelDownload:true,forwardReverseAndRotation:true,gameHandoff:true,cdn:process.env.SOFACET_EXPECT_ENTRANCE_CDN||null,errors});
    await context.close();
  }
  // The explicit live 3D alternative must not prefetch video media.
  const context=await browser.newContext();const page=await context.newPage(),requested=[];
  page.on('request',request=>requested.push(request.url()));
  const modelRequested=page.waitForRequest(request=>request.url().includes('journey-compact.glb'));
  const liveURL=new URL(base);liveURL.searchParams.set('entrance','1');
  await page.goto(liveURL.href);
  await modelRequested;
  assert.equal(requested.some(url=>url.includes('/assets/entrance-video/')),false);
  await context.close();
  await writeFile(new URL(`${engine}-browser-report.json`,output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close()}
