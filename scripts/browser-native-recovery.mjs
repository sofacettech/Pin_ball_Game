import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['webkit','chromium'].includes(engine),'Use a supported mobile browser');
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const port=process.env.SOFACET_RECOVERY_PORT||'8773';
const url=`http://127.0.0.1:${port}`;
let server,browser,data,page;
try{
 data=await mkdtemp(join(tmpdir(),'sofacet-native-recovery-'));
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port,HOST:'127.0.0.1',DATA_DIR:data},stdio:'inherit'});
 let started=false;
 for(let i=0;i<100&&!started;i++){
  try{started=(await fetch(url+'/health')).ok}catch{}
  if(server.exitCode!==null)throw Error('The recovery test server exited before startup');
  if(!started)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(started,'Preview server did not start');
 browser=await browserType.launch();
 const context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7']});
 page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  globalThis.VideoDecoder=undefined;
  const play=HTMLMediaElement.prototype.play;
  window.nativePlaybackTest={allowed:false,denied:0,grantedByTrustedClick:false};
  // Reproduce decoded data without playback permission. Only the visible
  // recovery control's real trusted input unlocks this test's journey video.
  document.addEventListener('click',event=>{
   if(event.isTrusted&&event.target.closest?.('#journey-resume')){
    window.nativePlaybackTest.allowed=true;
    window.nativePlaybackTest.grantedByTrustedClick=true;
   }
  },true);
  HTMLMediaElement.prototype.play=function(){
   if(this.id==='journey'&&!window.nativePlaybackTest.allowed){
    window.nativePlaybackTest.denied++;
    return Promise.reject(new DOMException('Playback requires a user gesture','NotAllowedError'));
   }
   return play.call(this);
  };
 });
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.sofacetPreview&&(
  document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden||!document.querySelector('#journey-resume').hidden),{},{timeout:60000});
 if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
 await page.waitForFunction(()=>document.body.dataset.phase==='idle'||!document.querySelector('#journey-resume').hidden,{},{timeout:30000});
 if(!await page.locator('#journey-resume').isVisible())await page.evaluate(()=>window.scrollTo(0,1200*8));
 await page.locator('#journey-resume').waitFor({state:'visible',timeout:10000});
 const blocked=await page.evaluate(()=>({stats:window.sofacetPreview.sequence.stats,ready:document.querySelector('#journey').readyState,test:window.nativePlaybackTest}));
 assert.ok(blocked.ready>=2,'Recovery must work even after the video has decoded data');
 assert.equal(blocked.stats.nativePlaybackBlocked,true);
 assert.equal(blocked.stats.nativePlaybackActivated,false,'Decoded readiness must not imply permission to play');
 assert.ok(blocked.test.denied>0,'The scenario must actually exercise denied playback');
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>window.nativePlaybackTest.denied),blocked.test.denied,'A blocked journey must wait for input instead of retrying play in a loop');
 assert.equal(await page.locator('#game-page').getAttribute('src'),null,'Blocked confirmation must not load the game');
 await page.locator('#journey-resume').tap();
 await page.waitForFunction(()=>window.sofacetPreview.sequence.stats.nativePlaybackActivated,{},{timeout:10000});
 await page.locator('#journey-resume').waitFor({state:'hidden'});
 await page.waitForFunction(()=>['idle','journey'].includes(document.body.dataset.phase),{},{timeout:10000});
 await page.evaluate(()=>window.scrollTo(0,1200*8));
 await page.waitForFunction(()=>{
  const sequence=window.sofacetPreview.sequence;
  return sequence.displayedFrame===1200&&sequence.stats.presentedFrame===1200&&sequence.stats.pending===0;
 },{},{timeout:10000});
 const recovered=await page.evaluate(()=>({stats:window.sofacetPreview.sequence.stats,test:window.nativePlaybackTest}));
 assert.equal(recovered.test.grantedByTrustedClick,true);
 assert.equal(recovered.stats.nativePlaybackBlocked,false);
 assert.ok(recovered.stats.nativeCaptures>0,'Recovery must capture a timestamp-confirmed frame');
 assert.equal(recovered.stats.sourceWidth,1920);assert.equal(recovered.stats.sourceHeight,1080);
 await page.evaluate(()=>window.scrollTo(0,window.sofacetPreview.sequence.travel));
 await page.waitForFunction(()=>document.body.dataset.game==='visible',{},{timeout:15000});
 const final=await page.evaluate(()=>({frame:window.sofacetPreview.sequence.displayedFrame,end:window.sofacetPreview.sequence.frameCount-1,stats:window.sofacetPreview.sequence.stats}));
 assert.equal(final.frame,final.end);
 assert.equal(final.stats.presentedFrame,final.end,'Game handoff requires the actual final video timestamp');
 assert.deepEqual(errors,[]);
 console.log('Native playback recovery passed',JSON.stringify({engine,deniedAttempts:blocked.test.denied,readyBeforeTap:blocked.ready,confirmedFrame:recovered.stats.presentedFrame,finalFrame:final.frame,captures:final.stats.nativeCaptures}));
 await context.close();
}catch(error){
 if(page&&!page.isClosed())console.error('Native recovery browser state',await page.evaluate(()=>({phase:document.body.dataset.phase,prompt:!document.querySelector('#journey-resume')?.hidden,test:window.nativePlaybackTest,stats:window.sofacetPreview?.sequence?.stats})));
 throw error;
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
