import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {AdaptiveResolution,gameRenderResolution,parseGameQuality} from '../game-source/src/render-resolution.ts';

function frames(controller,ms,count,start=0){
  let now=start,changes=0;
  for(let i=0;i<count;i++){now+=ms;if(controller.sample(now))changes++}
  return {now,changes};
}

test('new visitors start at Full while explicit saved preferences are respected',()=>{
  for(const value of [null,undefined,'',42,'high','full'])assert.equal(parseGameQuality(value),'full');
  assert.equal(parseGameQuality('auto'),'auto');assert.equal(parseGameQuality('low'),'low');
  assert.equal(new AdaptiveResolution().mode,'full');
});

test('Auto starts as sharp as Full on retina phones and Full HD desktops',()=>{
  const c=new AdaptiveResolution('auto');
  for(const [w,h,dpr] of [[390,700,3],[1920,1080,2]]){
    const auto=gameRenderResolution('auto',c.level,w,h,dpr),full=gameRenderResolution('full',c.level,w,h,dpr);
    assert.equal(auto.pixelRatio,full.pixelRatio);assert.equal(auto.pixelRatio,1.5);
  }
  const auto=gameRenderResolution('auto',c.level,390,700,3),full=gameRenderResolution('full',c.level,390,700,3);
  assert.equal(auto.samples,0);assert.equal(auto.transmissionScale,.5);
  assert.equal(full.samples,2);assert.equal(full.transmissionScale,1);
});

test('handheld Full preserves density without allocating multisampled HDR targets',()=>{
  for(const [w,h,dpr] of [[390,700,3],[844,390,3],[1024,1366,2]]){
    const phone=gameRenderResolution('full',3,w,h,dpr,true);
    const desktop=gameRenderResolution('full',3,w,h,dpr,false);
    assert.equal(phone.pixelRatio,desktop.pixelRatio);
    assert.equal(phone.samples,0);assert.equal(desktop.samples,2);
    assert.equal(phone.transmissionScale,.5);
    for(let tier=0;tier<=3;tier++){
      const auto=gameRenderResolution('auto',tier,w,h,dpr,true);
      assert.ok(auto.pixelRatio>=1&&auto.pixelRatio<=phone.pixelRatio);
    }
  }
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

test('Auto lowers resolution gradually at sustained 30fps and never crosses the sharpness floor',()=>{
  const slow=new AdaptiveResolution('auto');
  let r=frames(slow,1000/30,90);
  assert.equal(slow.level,2);assert.equal(r.changes,1);
  r=frames(slow,1000/30,90,r.now);assert.equal(slow.level,1);assert.equal(r.changes,1);
  r=frames(slow,1000/30,90,r.now);assert.equal(slow.level,0);
  assert.equal(frames(slow,1000/30,90,r.now).changes,0);
  assert.equal(gameRenderResolution('auto',slow.level,1920,1080,2).pixelRatio,1);
});

test('severe sustained stalls step down promptly without skipping quality tiers',()=>{
  const c=new AdaptiveResolution('auto');const r=frames(c,100,22);
  assert.equal(c.level,2);assert.equal(r.changes,1);
  frames(c,100,80,r.now);assert.equal(c.level,0);
});

test('a brief hitch does not lower resolution or cause repeated resizing',()=>{
  const c=new AdaptiveResolution('auto');let {now}=frames(c,1000/60,150);
  c.sample(now+=90);frames(c,1000/60,100,now);
  assert.equal(c.level,3);
});

test('a smooth 45fps device keeps maximum detail instead of being downgraded',()=>{
  const c=new AdaptiveResolution('auto');assert.equal(frames(c,1000/45,600).changes,0);assert.equal(c.level,3);
});

test('recovery restores detail after sustained headroom, and the middle band does not oscillate',()=>{
  const c=new AdaptiveResolution('auto');let r=frames(c,100,80);assert.equal(c.level,0);c.resetTiming();
  r=frames(c,1000/60,240,r.now);assert.equal(c.level,0);
  r=frames(c,1000/60,180,r.now);assert.equal(c.level,1);
  r=frames(c,1000/45,500,r.now);assert.equal(c.level,1);assert.equal(r.changes,0);
  frames(c,1000/60,900,r.now);assert.equal(c.level,3);
});

test('idle gaps, hidden tabs and explicit resets preserve the selected tier',()=>{
  const c=new AdaptiveResolution('auto');let {now}=frames(c,1000/60,100);
  c.sample(now+=30_000);frames(c,1000/60,100,now);assert.equal(c.level,3);
  for(let i=0;i<200;i++){c.resetTiming();c.sample(i*500)}assert.equal(c.level,3);
});

test('manual Low remains fixed, returning to Auto clears old slow samples',()=>{
  const c=new AdaptiveResolution('auto');frames(c,100,80);assert.equal(c.level,0);
  c.setMode('low');assert.equal(frames(c,100,200).changes,0);assert.equal(c.mode,'low');
  c.setMode('auto');assert.equal(c.level,3);
  frames(c,1000/60,120);assert.equal(c.level,3);
});

test('Full keeps maximum detail at 30fps or faster',()=>{
  for(const fps of [30,35,45,60,120]){
    const c=new AdaptiveResolution();assert.equal(frames(c,1000/fps,fps*12).changes,0);
    assert.equal(c.mode,'full');assert.equal(c.level,3);
  }
});

test('sustained sub-30fps switches Full to Auto one tier at a time',()=>{
  for(const fps of [29,24,10]){
    const c=new AdaptiveResolution();const r=frames(c,1000/fps,fps*2);
    assert.equal(c.mode,'full','warmup and a short slow spell must not reduce detail');
    frames(c,1000/fps,fps*2,r.now);
    assert.equal(c.mode,'auto');assert.equal(c.level,2);
  }
});

test('a brief hitch or an interrupted slow spell cannot trigger the Full fallback',()=>{
  const c=new AdaptiveResolution();let r=frames(c,1000/60,180);
  c.sample(r.now+=120);r=frames(c,1000/60,180,r.now);assert.equal(c.mode,'full');
  r=frames(c,40,35,r.now);assert.equal(c.mode,'full');
  c.resetTiming();r=frames(c,40,60,r.now);assert.equal(c.mode,'full');
  r=frames(c,1000/60,240,r.now);assert.equal(c.mode,'full');
  frames(c,40,35,r.now);assert.equal(c.mode,'full');
});

test('Auto restores sharpness without switching back and forth between settings',()=>{
  const c=new AdaptiveResolution();const r=frames(c,40,100);assert.equal(c.mode,'auto');
  frames(c,1000/60,900,r.now);assert.equal(c.level,3);assert.equal(c.mode,'auto');
  c.setMode('full');assert.equal(c.level,3);assert.equal(c.mode,'full');
});

test('only active unobstructed ball play can activate Auto and update the setting',()=>{
  const source=readFileSync(new URL('../game-source/src/main.ts',import.meta.url),'utf8');
  const canTouch=source.match(/^const canTouch=.*$/m)[0].replace("(control:'paddle'|'launch')",'(control)');
  const sample=source.slice(source.indexOf('function sampleGameplayPerformance('),source.indexOf('function frame(now:number)')).replace('(now:number)','(now)');
  const blocked=[c=>c.loaded=false,c=>c.starting=true,c=>c.physics.active=false,c=>c.physics.paused=true,c=>c.physics.state='launcher',c=>c.physics.state='finished',c=>c.tutorial={active:true},c=>c.inspecting=true,c=>c.menu.hidden=false,c=>c.navOpen=true,c=>c.registration.open=true,c=>c.rewards.dialog.open=true,c=>c.leaderboard.dialog.open=true];
  for(const block of [null,...blocked]){
    const controller=new AdaptiveResolution();
    const context={loaded:true,starting:false,physics:{active:true,paused:false,state:'playing'},tutorial:undefined,inspecting:false,menu:{hidden:true},registration:{open:false},rewards:{dialog:{open:false}},leaderboard:{dialog:{open:false}},navOpen:false,quality:{value:'full'},
      navToggle:{getAttribute:()=>String(context.navOpen)},
      view:{resetPerformanceSampling:()=>controller.resetTiming(),adaptResolution(now){const before=controller.mode;controller.sample(now);return before!==controller.mode},get quality(){return controller.mode}},
    };
    block?.(context);vm.createContext(context);vm.runInContext(canTouch+'\n'+sample+';this.sample=sampleGameplayPerformance',context);
    for(let i=0;i<180;i++)context.sample(i*40);
    assert.equal(context.quality.value,block?'full':'auto');assert.equal(controller.mode,block?'full':'auto');
  }
});
