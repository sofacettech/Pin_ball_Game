import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameCache} from '../assets/frame-cache.js';
import {createFramePacer} from '../assets/frame-pacing.js';
import {createBufferPacingController,getBufferPacingLimits} from '../assets/buffer-pacing.js';

// Keep the actual encoded sizes around the doorway (frames 840–959 are
// heavier), but use logical samples/images. This measures scheduling under
// finite delivery, not browser FPS, GPU performance, or actual phone bandwidth.
const sizes=JSON.parse(readFileSync(new URL('../assets/journey-index.json',import.meta.url))).frames.slice(600,1250).map(frame=>frame[1]);
const profiles={
 desktop:{network:3,batch:24,decoded:4,ahead:192,behind:40,prefetch:256,preparationFrames:57,compressedBytes:24*1024*1024},
 phone:{network:2,batch:24,decoded:4,ahead:80,behind:40,prefetch:128,preparationFrames:57,compressedBytes:16*1024*1024},
};

async function simulate(t,profile,managed,latencyPhase=0){
 const config=profiles[profile],downloads=new Set(),controller=createBufferPacingController(),pacer=createFramePacer({responsive:true});
 let now=0,motionAt=Infinity,cache,alive=0,pending=0,peakResources=0,peakBytes=0,limited=0,recovering=0,slowedWithCoverage=0,lowestScale=1;
 t.mock.timers.enable({apis:['setTimeout']});const time=t.mock.method(performance,'now',()=>now);
 const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve()};
 const source={mode:'worker',decodeConcurrency:4,stats:{},frameBytes:frame=>sizes[frame],fallback:()=>false,destroy(){},
  loadFrames(frames,signal,_budget,onFrame){return new Promise((resolve,reject)=>{
   const job={frames:[...frames].sort((a,b)=>a-b),at:now+30+((frames[0]+latencyPhase)%5)*10,cursor:0,received:0,result:new Map(),resolve,onFrame,signal};
   job.abort=()=>{downloads.delete(job);reject(new DOMException('Cancelled','AbortError'))};
   signal.addEventListener('abort',job.abort,{once:true});downloads.add(job);
  })},
  decode(frame){pending++;peakResources=Math.max(peakResources,alive+pending);return new Promise(resolve=>setTimeout(()=>{
   pending--;alive++;let closed=false;resolve({frame,close(){assert.equal(closed,false);closed=true;alive--}});
  },4))},
 };
 function bounds(){
  const stats=cache.stats;peakBytes=Math.max(peakBytes,stats.compressedBytes+stats.reservedBytes);
  assert.ok(peakBytes<=config.compressedBytes);assert.ok(stats.decoded+stats.decoding<=4);assert.ok(alive+pending<=4);assert.ok(stats.network<=config.network);
 }
 async function advance(ms){
  for(let elapsed=0;elapsed<ms;elapsed+=5){
   now+=5;t.mock.timers.tick(5);await drain();
   const elapsedMotion=now-motionAt;
   // Both variants share aggregate delivery; request count never multiplies it.
   // The slow segment is temporary: no buffer can cure indefinite under-supply.
   const rate=elapsedMotion>=1800&&elapsedMotion<2300?0:elapsedMotion>=1000&&elapsedMotion<3500?12:32;
   const ready=[...downloads].filter(job=>job.at<=now),share=ready.length?rate*1024*1024*.005/ready.length:0;
   for(const job of ready){
    let budget=share;
    while(budget>0&&downloads.has(job)){
     const frame=job.frames[job.cursor],take=Math.min(budget,sizes[frame]-job.received);job.received+=take;budget-=take;
     if(job.received>=sizes[frame]){
      const bytes={byteLength:sizes[frame]};job.result.set(frame,bytes);job.received=0;job.cursor++;job.onFrame(frame,bytes);
      if(downloads.has(job)&&job.cursor===job.frames.length){downloads.delete(job);job.signal.removeEventListener('abort',job.abort);job.resolve(job.result)}
     }
     await drain();bounds();
    }
   }
   await drain();bounds();
  }
 }
 cache=createFrameCache({count:sizes.length,source,onReady(){},onError:error=>{throw error},config});
 let displayed=0;
 async function travel(destination,reverse=false){
  const started=now,origin=displayed;let lastDraw=started,maxGap=0,draws=0,firstSecondFrame=origin;
  for(let tick=1;tick<=900;tick++){
   await advance(20);
   const desired=reverse?Math.max(destination,origin-Math.round(tick*.02*200)):Math.min(destination,origin+Math.round(tick*.02*240));
   const direction=Math.sign(desired-displayed),coverage=cache.coverage(displayed,direction,config.ahead);
   const state=controller.update({delta:.02,bufferedFrames:coverage.available,remainingFrames:coverage.remaining,direction,
    desiredDistance:Math.abs(desired-displayed),consumptionSpeed:180,capacityFrames:config.ahead});
   if(state.limited)limited++;if(state.state==='recovering')recovering++;lowestScale=Math.min(lowestScale,state.scale);
   if(coverage.available>0&&state.scale<.9)slowedWithCoverage++;
   const limits=managed?getBufferPacingLimits(state,{bufferedFrames:coverage.available,retainedBehindFrames:config.behind}):undefined;
   const target=pacer.next(displayed,desired,.02,displayed,limits);
   if(managed){
    assert.ok(Math.abs(target-displayed)<=coverage.available,'The next request stays within consecutive ready coverage');
    assert.ok(Math.abs(target-displayed)<=config.behind,'The pending request cannot evict the ready corridor behind it');
   }
   cache.request(target,desired,displayed);
   const next=cache.get(target)?target:cache.closest(target,displayed);
   if(next!==undefined&&next!==displayed){
    assert.ok(reverse?next<displayed:next>displayed,'Travel cannot reverse while its destination is unchanged');
    assert.ok(reverse?next>=destination:next<=destination,'Travel cannot overshoot the endpoint');
    displayed=next;maxGap=Math.max(maxGap,now-lastDraw);lastDraw=now;draws++;
   }
   bounds();
   if(tick===50)firstSecondFrame=displayed;
   if(displayed===destination)return{maxGap,draws,elapsed:now-started,firstSecondFrame};
  }
  assert.fail(`The ${profile} ${reverse?'reverse':'forward'} journey did not reach frame ${destination}`);
 }
 try{
  for(let waited=0;waited<5000&&!cache.preparation.ready;waited+=5)await advance(5);
  assert.equal(cache.preparation.ready,true);await advance(500);motionAt=now;
  const forward=await travel(sizes.length-1);
  assert.equal(displayed,sizes.length-1);await advance(1000);
  const reverse=await travel(0,true);assert.equal(displayed,0);
  return{forward,reverse,limited,recovering,slowedWithCoverage,lowestScale,peakResources,peakBytes};
 }finally{
  cache.destroy();await advance(20);assert.equal(downloads.size,0);assert.equal(alive,0);assert.equal(pending,0);
  t.mock.timers.reset();time.mock.restore();
 }
}

test('bounded buffer pacing crosses the heavier entrance and returns to the exact start',async t=>{
 for(const latencyPhase of [0,2]){
  const baseline=await simulate(t,'desktop',false,latencyPhase),managed=await simulate(t,'desktop',true,latencyPhase);
  assert.equal(managed.forward.firstSecondFrame,baseline.forward.firstSecondFrame,'Healthy fast travel must preserve the responsive control before delivery slows');
  assert.ok(baseline.forward.maxGap>=100,'The unchanged control must encounter finite-delivery pressure');
  assert.ok(managed.forward.maxGap<baseline.forward.maxGap,'Ready-coverage pacing must reduce the longest forward hold');
  assert.ok(managed.limited>0&&managed.lowestScale<.8,'Constrained delivery must slow source-frame travel');
  assert.ok(managed.slowedWithCoverage>0,'Travel must slow while usable frames still remain');
  assert.ok(managed.recovering>0,'Restored coverage must exercise gradual recovery');
  assert.ok(managed.peakResources<=4);assert.ok(managed.peakBytes<=profiles.desktop.compressedBytes);
 }
});

test('the smaller phone buffer retains coverage and resource bounds through forward and reverse travel',async t=>{
 const baseline=await simulate(t,'phone',false),managed=await simulate(t,'phone',true);
 // The smaller runway can still run dry; require improvement over identical
 // delivery, not a claim that finite buffering eliminates every interruption.
 assert.ok(baseline.forward.maxGap>=100);
 assert.ok(managed.forward.maxGap<baseline.forward.maxGap,'The phone controller must shorten the delivery-induced hold');
 assert.ok(managed.limited>0&&managed.lowestScale<.8);assert.ok(managed.recovering>0);assert.ok(managed.slowedWithCoverage>0);
 assert.ok(managed.peakResources<=4);assert.ok(managed.peakBytes<=profiles.phone.compressedBytes);
});
