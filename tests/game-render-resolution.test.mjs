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

test('Auto starts as sharp as Full on retina phones and Full HD desktops',()=>{
  const c=new AdaptiveResolution();
  for(const [w,h,dpr] of [[390,700,3],[1920,1080,2]]){
    const auto=gameRenderResolution('auto',c.level,w,h,dpr),full=gameRenderResolution('full',c.level,w,h,dpr);
    assert.equal(auto.pixelRatio,full.pixelRatio);assert.equal(auto.pixelRatio,1.5);
  }
  const auto=gameRenderResolution('auto',c.level,390,700,3),full=gameRenderResolution('full',c.level,390,700,3);
  assert.equal(auto.samples,0);assert.equal(auto.transmissionScale,.5);
  assert.equal(full.samples,2);assert.equal(full.transmissionScale,1);
});

test('every Auto tier preserves CSS-pixel detail through 4K without supersampling low-density displays',()=>{
  for(let level=0;level<=3;level++){
    for(const [w,h] of [[390,700],[1920,1080],[2560,1440],[3840,2160]]){
      const p=gameRenderResolution('auto',level,w,h,3);
      assert.ok(p.pixelRatio>=1,`${w}x${h}, tier ${level}`);
      assert.ok(w*h*p.pixelRatio**2<=3840*2160+.001);
    }
    assert.ok(gameRenderResolution('auto',level,800,600,1).pixelRatio<=1);
  }
});

test('Auto uses small monotonic steps and bounds unusually large buffers',()=>{
  const ratios=[0,1,2,3].map(level=>gameRenderResolution('auto',level,1920,1080,2).pixelRatio);
  for(let i=1;i<ratios.length;i++)assert.ok(ratios[i]>ratios[i-1]&&ratios[i]-ratios[i-1]<=.21);
  const huge=gameRenderResolution('auto',3,7680,4320,3);
  assert.ok(7680*4320*huge.pixelRatio**2<=3840*2160+.001);
});

test('the explicit Low mode retains its reduced pixel budget',()=>{
  const low=gameRenderResolution('low',3,1920,1080,3);
  assert.ok(1920*1080*low.pixelRatio**2<=450_000+.001);
  assert.equal(gameRenderResolution('low',3,390,700,3).pixelRatio,.65);
});

test('invalid DPR and hidden viewports produce finite positive resolutions',()=>{
  for(const dpr of [0,-1,NaN,Infinity]){
    const p=gameRenderResolution('auto',2,0,0,dpr);
    assert.ok(Number.isFinite(p.pixelRatio)&&p.pixelRatio>0&&p.pixelRatio<=1);
  }
  assert.ok(Number.isFinite(gameRenderResolution('auto',NaN,390,700,3).pixelRatio));
});

test('sustained 30fps lowers resolution gradually and never crosses the sharpness floor',()=>{
  const slow=new AdaptiveResolution();
  let r=frames(slow,1000/30,90);
  assert.equal(slow.level,2);assert.equal(r.changes,1);
  r=frames(slow,1000/30,90,r.now);assert.equal(slow.level,1);assert.equal(r.changes,1);
  r=frames(slow,1000/30,90,r.now);assert.equal(slow.level,0);
  assert.equal(frames(slow,1000/30,90,r.now).changes,0);
  assert.equal(gameRenderResolution('auto',slow.level,1920,1080,2).pixelRatio,1);
});

test('severe sustained stalls step down promptly without skipping quality tiers',()=>{
  const c=new AdaptiveResolution();const r=frames(c,100,22);
  assert.equal(c.level,2);assert.equal(r.changes,1);
  frames(c,100,80,r.now);assert.equal(c.level,0);
});

test('a brief hitch does not lower resolution or cause repeated resizing',()=>{
  const c=new AdaptiveResolution();let {now}=frames(c,1000/60,150);
  c.sample(now+=90);frames(c,1000/60,100,now);
  assert.equal(c.level,3);
});

test('a smooth 45fps device keeps maximum detail instead of being downgraded',()=>{
  const c=new AdaptiveResolution();assert.equal(frames(c,1000/45,600).changes,0);assert.equal(c.level,3);
});

test('recovery restores detail after sustained headroom, and the middle band does not oscillate',()=>{
  const c=new AdaptiveResolution();let r=frames(c,100,80);assert.equal(c.level,0);c.resetTiming();
  r=frames(c,1000/60,240,r.now);assert.equal(c.level,0);
  r=frames(c,1000/60,180,r.now);assert.equal(c.level,1);
  r=frames(c,1000/45,500,r.now);assert.equal(c.level,1);assert.equal(r.changes,0);
  frames(c,1000/60,900,r.now);assert.equal(c.level,3);
});

test('idle gaps, hidden tabs and explicit resets preserve the selected tier',()=>{
  const c=new AdaptiveResolution();let {now}=frames(c,1000/60,100);
  c.sample(now+=30_000);frames(c,1000/60,100,now);assert.equal(c.level,3);
  for(let i=0;i<200;i++){c.resetTiming();c.sample(i*500)}assert.equal(c.level,3);
});

test('manual Full and Low remain fixed, returning to Auto clears old slow samples',()=>{
  const c=new AdaptiveResolution();frames(c,100,80);assert.equal(c.level,0);
  for(const mode of ['full','low']){c.setMode(mode);assert.equal(frames(c,100,200).changes,0);assert.equal(c.mode,mode)}
  c.setMode('auto');assert.equal(c.level,3);
  frames(c,1000/60,120);assert.equal(c.level,3);
});
