import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveResolution,gameRenderResolution,parseGameQuality} from '../game-source/src/render-resolution.ts';

function frames(controller,ms,count,start=0){
  let now=start,changes=0;
  for(let i=0;i<count;i++){now+=ms;if(controller.sample(now))changes++}
  return {now,changes};
}

test('new visitors and invalid saved preferences use Auto',()=>{
  for(const value of [null,undefined,'',42,'high','auto'])assert.equal(parseGameQuality(value),'auto');
  assert.equal(parseGameQuality('full'),'full');assert.equal(parseGameQuality('low'),'low');
  assert.equal(new AdaptiveResolution().mode,'auto');
});

test('Auto starts with less than half the full-resolution pixels on a retina phone',()=>{
  const auto=gameRenderResolution('auto',2,390,700,3),full=gameRenderResolution('full',2,390,700,3);
  assert.equal(auto.pixelRatio,1);assert.equal(full.pixelRatio,1.5);
  assert.ok(auto.pixelRatio**2/full.pixelRatio**2<.45);
  assert.equal(auto.samples,0);assert.equal(auto.transmissionScale,.5);
  assert.equal(full.samples,2);assert.equal(full.transmissionScale,1);
});

test('large desktop buffers are bounded, and low-density displays are never supersampled in Auto',()=>{
  for(let level=0;level<=3;level++){
    const p=gameRenderResolution('auto',level,3840,2160,2);
    assert.ok(3840*2160*p.pixelRatio**2<=1_250_000+.001);
    assert.ok(gameRenderResolution('auto',level,800,600,1).pixelRatio<=1);
  }
  const low=gameRenderResolution('low',3,1920,1080,3);
  assert.ok(1920*1080*low.pixelRatio**2<=450_000+.001);
});

test('invalid DPR and hidden viewports produce finite positive resolutions',()=>{
  for(const dpr of [0,-1,NaN,Infinity]){
    const p=gameRenderResolution('auto',2,0,0,dpr);
    assert.ok(Number.isFinite(p.pixelRatio)&&p.pixelRatio>0&&p.pixelRatio<=1);
  }
});

test('sustained 30fps lowers resolution, severe stalls reach the lowest tier promptly',()=>{
  const slow=new AdaptiveResolution();
  const first=frames(slow,1000/30,65);
  assert.equal(slow.level,1);assert.equal(first.changes,1);
  frames(slow,1000/30,65,first.now);assert.equal(slow.level,0);
  const severe=new AdaptiveResolution();frames(severe,100,22);assert.equal(severe.level,0);
  assert.equal(frames(severe,100,50,2200).changes,0);
});

test('a brief hitch does not lower resolution or cause repeated resizing',()=>{
  const c=new AdaptiveResolution();let {now}=frames(c,1000/60,150);
  c.sample(now+=90);frames(c,1000/60,100,now);
  assert.equal(c.level,2);
});

test('recovery needs sustained 60fps, and the middle band does not oscillate',()=>{
  const c=new AdaptiveResolution();let r=frames(c,100,22);assert.equal(c.level,0);
  r=frames(c,1000/60,300,r.now);assert.equal(c.level,0);
  r=frames(c,1000/60,300,r.now);assert.equal(c.level,1);
  r=frames(c,20,500,r.now);assert.equal(c.level,1);assert.equal(r.changes,0);
});

test('idle gaps, hidden tabs and explicit resets preserve the selected tier',()=>{
  const c=new AdaptiveResolution();let {now}=frames(c,1000/60,100);
  c.sample(now+=30_000);frames(c,1000/60,100,now);assert.equal(c.level,2);
  for(let i=0;i<200;i++){c.resetTiming();c.sample(i*500)}assert.equal(c.level,2);
});

test('manual Full and Low remain fixed, returning to Auto clears old slow samples',()=>{
  const c=new AdaptiveResolution();frames(c,100,22);assert.equal(c.level,0);
  for(const mode of ['full','low']){c.setMode(mode);assert.equal(frames(c,100,200).changes,0);assert.equal(c.mode,mode)}
  c.setMode('auto');assert.equal(c.level,2);
  frames(c,1000/60,120);assert.equal(c.level,2);
});
