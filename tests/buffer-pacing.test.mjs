import test from 'node:test';
import assert from 'node:assert/strict';
import {createBufferPacingController, getBufferPacingLimits} from '../assets/buffer-pacing.js';
import {createFramePacer} from '../assets/frame-pacing.js';

const input = overrides => ({delta:1/60, bufferedFrames:192, remainingFrames:1800,
  direction:1, desiredDistance:300, consumptionSpeed:180, capacityFrames:192, ...overrides});
function advance(controller, seconds, overrides = {}, hz = 60) {
  let result;
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) result = controller.update(input({...overrides, delta:1/hz}));
  return result;
}

test('healthy coverage preserves normal speed in either direction', () => {
  for (const direction of [-1,1]) {
    const controller = createBufferPacingController(), result = advance(controller, 1, {direction});
    assert.equal(result.scale, 1);assert.equal(result.limited, false);assert.equal(result.state, 'healthy');
    assert.equal(result.lowWatermark, 108);assert.equal(result.recoveryWatermark, 172.8);
  }
});

test('low coverage eases toward three-quarter speed and hysteresis prevents range-by-range chatter', () => {
  const controller = createBufferPacingController();
  const first = controller.update(input({bufferedFrames:90}));
  assert.ok(first.scale < 1 && first.scale > .9);
  const low = advance(controller, .4, {bufferedFrames:90});
  assert.ok(low.scale <= .752 && low.scale >= .75);assert.equal(low.targetScale, .75);
  const partial = advance(controller, .4, {bufferedFrames:130});
  assert.equal(partial.state, 'limited');assert.equal(partial.scale, .75);
  const recovery = controller.update(input({bufferedFrames:180}));
  assert.equal(recovery.state, 'recovering');assert.ok(recovery.scale > .75 && recovery.scale < .77);
  const continued = controller.update(input({bufferedFrames:130}));
  assert.equal(continued.state, 'recovering');assert.ok(continued.scale > recovery.scale);
  assert.equal(advance(controller, 5, {bufferedFrames:180}).scale, 1);
});

test('critical depletion lowers speed without crossing the positive-coverage floor', () => {
  const controller = createBufferPacingController();
  const result = advance(controller, 1, {bufferedFrames:1});
  assert.ok(result.scale >= .25 && result.scale < .3);
  const empty = controller.update(input({bufferedFrames:0}));
  assert.equal(empty.scale, 0);assert.equal(empty.state, 'depleted');
  const resumed = controller.update(input({bufferedFrames:1}));
  assert.ok(resumed.scale >= .25 && resumed.scale < .3);
});

test('phone capacity has reachable recovery watermarks at high source-frame speed', () => {
  const controller = createBufferPacingController();
  const low = advance(controller, .5, {bufferedFrames:30, capacityFrames:80, consumptionSpeed:360});
  assert.equal(low.lowWatermark, 64);assert.equal(low.recoveryWatermark, 72);assert.equal(low.limited, true);
  const recovered = advance(controller, 5, {bufferedFrames:80, capacityFrames:80, consumptionSpeed:360});
  assert.equal(recovered.scale, 1);assert.equal(recovered.limited, false);
});

test('a small desired distance does not discard pressure, but a fully buffered sequence ending recovers', () => {
  const controller = createBufferPacingController();advance(controller, .5, {bufferedFrames:70});
  const nearTarget = advance(controller, .5, {bufferedFrames:70, desiredDistance:1});
  assert.equal(nearTarget.state, 'limited');assert.equal(nearTarget.targetScale, .75);
  const ending = controller.update(input({bufferedFrames:8, remainingFrames:8, desiredDistance:8}));
  assert.equal(ending.state, 'recovering');assert.equal(ending.targetScale, 1);
  const end = controller.update(input({bufferedFrames:0, remainingFrames:0, desiredDistance:0}));
  assert.equal(end.scale, 1);assert.equal(end.state, 'end');assert.equal(end.limited, false);
});

test('reversal and visibility reset discard stale pressure without carrying elapsed time', () => {
  const controller = createBufferPacingController();advance(controller, 1, {bufferedFrames:1});
  assert.equal(controller.update(input({direction:-1})).scale, 1);
  advance(controller, 1, {direction:-1, bufferedFrames:1});controller.reset();
  assert.equal(controller.update(input()).scale, 1);
  const a = createBufferPacingController(), b = createBufferPacingController();
  advance(a, 1, {bufferedFrames:30});advance(b, 1, {bufferedFrames:30});
  assert.deepEqual(a.update(input({delta:20})), b.update(input({delta:.1})));
  assert.deepEqual(a.update(input()), b.update(input()), 'No hidden elapsed time remains for a later burst');
});

test('constant coverage responds equally at 30, 60, and 120 updates per second', () => {
  const results = [30,60,120].map(hz => {
    const controller = createBufferPacingController();advance(controller, 1, {bufferedFrames:90}, hz);
    return advance(controller, 1, {bufferedFrames:192}, hz).scale;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-10);
});

test('a half-second delivery interruption slows travel before consuming the ready runway', () => {
  for (const direction of [-1,1]) {
    const controller = createBufferPacingController();let buffered = 72, position = 0, minimum = buffered, lowestScale = 1;
    for (let tick = 0; tick < 30; tick++) {
      const result = controller.update(input({direction, bufferedFrames:buffered}));
      const consumed = 180 * result.scale / 60;
      assert.ok(consumed <= buffered, 'The modeled interruption must not exhaust ready frames');
      position += consumed;buffered -= consumed;minimum = Math.min(minimum, buffered);lowestScale = Math.min(lowestScale, result.scale);
    }
    assert.ok(position < 72 && position > 40);assert.ok(minimum > 0);assert.ok(lowestScale < .75);
    // Deliver faster than the limited travel rate until the runway recovers.
    for (let tick = 0; tick < 420; tick++) {
      buffered = Math.min(192, buffered + 240 / 60);
      const result = controller.update(input({direction, bufferedFrames:buffered}));buffered -= 180 * result.scale / 60;
    }
    assert.equal(controller.update(input({direction, bufferedFrames:buffered})).scale, 1);
  }
});

test('invalid timing cannot create non-finite output or a saved catch-up interval', () => {
  const controller = createBufferPacingController();
  for (const delta of [-1,NaN,Infinity]) {
    const result = controller.update(input({delta, bufferedFrames:90}));
    assert.equal(result.scale, 1);assert.equal(result.targetScale, .75);
  }
  const result = controller.update(input({bufferedFrames:NaN, consumptionSpeed:NaN}));
  assert.equal(result.scale, 0);assert.equal(result.bufferedFrames, 0);assert.equal(result.runwayMs, 0);
});


test('speed limits restore healthy catch-up without exceeding the retained corridor', () => {
  assert.deepEqual(getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:192}), {scale:1,maxSpeed:720,maxAdvance:40});
  assert.deepEqual(getBufferPacingLimits({scale:.75,targetScale:.75,bufferedFrames:80}), {scale:.75,maxSpeed:135,maxAdvance:40});
  assert.deepEqual(getBufferPacingLimits({scale:.25,targetScale:.25,bufferedFrames:1}), {scale:.25,maxSpeed:45,maxAdvance:1});
  assert.deepEqual(getBufferPacingLimits({scale:0,targetScale:0,bufferedFrames:0}), {scale:0,maxSpeed:0,maxAdvance:0});
  assert.equal(getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:192},{retainedBehindFrames:12}).maxAdvance,12);
  assert.equal(getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:192},{retainedBehindFrames:0}).maxAdvance,0);
  assert.equal(getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:192},{bufferedFrames:3}).maxAdvance,3);
});

test('recovery raises the speed ceiling smoothly instead of switching to a catch-up burst', () => {
  const controller=createBufferPacingController();advance(controller,1,{bufferedFrames:90});
  let previous=getBufferPacingLimits(controller.update(input({bufferedFrames:90}))).maxSpeed;
  assert.equal(previous,135);
  for(let i=0;i<120;i++){
    const current=getBufferPacingLimits(controller.update(input())).maxSpeed;
    assert.ok(current>=previous);assert.ok(current-previous<15);
    previous=current;
  }
  assert.ok(previous>680&&previous<720);
  assert.equal(getBufferPacingLimits(advance(controller,5)).maxSpeed,720);
  const below=getBufferPacingLimits({scale:.75-1e-8,targetScale:1,bufferedFrames:80}).maxSpeed;
  const above=getBufferPacingLimits({scale:.75+1e-8,targetScale:1,bufferedFrames:80}).maxSpeed;
  assert.ok(above-below<.0001,'The mapping is continuous at the pressure threshold');
});

test('fully supplied large jumps settle within five seconds even at ten presentations per second', () => {
  for(const hz of [10,30,60,120])for(const direction of [-1,1]){
    const controller=createBufferPacingController(),pacer=createFramePacer({responsive:true});
    let displayed=direction>0?100:1500;const desired=direction>0?1500:100;
    pacer.reset(displayed);let ticks=0;
    while(displayed!==desired&&ticks<hz*5){
      const pacing=controller.update(input({delta:1/hz,direction,desiredDistance:Math.abs(desired-displayed)}));
      const next=pacer.next(displayed,desired,1/hz,displayed,getBufferPacingLimits(pacing));
      assert.ok(Math.abs(next-displayed)<=40,'Cache recentering must retain the entire pending corridor');
      assert.ok((next-displayed)*direction>=0);displayed=next;ticks++;
    }
    assert.equal(displayed,desired,`${hz} Hz direction ${direction} settles`);
    assert.ok(ticks/hz<4.5,`${hz} Hz does not inherit the former unconditional180-frame/s delay`);
  }
});

test('ready-corridor limits hold at holes and reverse without carrying a stale pending target', () => {
  const pacer=createFramePacer({responsive:true});let displayed=100;
  const healthy=getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:192});
  const pending=pacer.next(displayed,1500,.1,displayed,healthy);
  assert.equal(pending,140);
  assert.equal(pacer.next(displayed,1500,.1,displayed,getBufferPacingLimits({scale:0,targetScale:0,bufferedFrames:0})),100);
  const reverse=pacer.next(displayed,0,1/60,displayed,getBufferPacingLimits({scale:1,targetScale:1,bufferedFrames:2}));
  assert.equal(reverse,98);
  displayed=reverse;
  const resumed=pacer.next(displayed,0,1/60,displayed,healthy);
  assert.ok(resumed<displayed&&resumed>=displayed-12);
});


test('thin runway and reversal suppress catch-up boost throughout a delivery interruption', () => {
  for(const direction of [-1,1]){
    const controller=createBufferPacingController(),pacer=createFramePacer({responsive:true});
    controller.update(input({direction:-direction}));
    let displayed=500,buffered=72;
    for(let tick=0;tick<30;tick++){
      const pacing=controller.update(input({direction,bufferedFrames:buffered}));
      const limits=getBufferPacingLimits(pacing);
      assert.ok(limits.maxSpeed<=180,'Pressure disables the boost even while scale is easing down');
      const next=pacer.next(displayed,displayed+direction*1000,1/60,displayed,limits);
      const consumed=Math.abs(next-displayed);
      assert.ok(consumed<=buffered);buffered-=consumed;displayed=next;
    }
    assert.ok(buffered>0,'A half-second outage does not exhaust the initial72-frame runway');
    assert.ok(Math.abs(displayed-500)>40,'Pressure retains useful movement instead of freezing');
  }
});
