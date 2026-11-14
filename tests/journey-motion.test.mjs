import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceJourneyFrame,createJourneyCompletion} from '../entrance-source/journey-motion.mjs';

test('a bottom swipe presents the last approach over time and waits for decoded pictures',()=>{
 const end=createJourneyCompletion(2164);let shown=1800;
 const step=now=>end.advance(2164,{target:2164,presented:shown,now});
 assert.equal(step(0),2000,'enter the final approach instead of jumping to the impact');
 assert.equal(step(500),2000,'a pending decode must not advance the completion clock');
 shown=2000;assert.equal(step(1000),2000);
 assert.equal(step(1017),2001);assert.equal(step(1900),2001,'keep one requested picture while decoding');
 shown=2001;assert.equal(step(2000),2005,'even a long decoder stall cannot skip the ending');
 for(let now=2017;shown<2164&&now<6000;now+=17){shown=step(now);}
 assert.equal(shown,2164);
});

test('completion keeps initial movement direct, cancels on reversal and honors reduced motion',()=>{
 const end=createJourneyCompletion(2164);
 assert.equal(end.advance(1100,{target:1100,presented:334,now:0}),1100);
 assert.equal(end.advance(2164,{target:2164,presented:1800,now:10}),2000);
 assert.equal(end.advance(1900,{target:1900,presented:2000,now:20}),1900);
 assert.equal(end.advance(2164,{target:2164,presented:2100,now:30}),2100,'resume from the visible pose, without rewinding');
 assert.equal(end.advance(2164,{target:2164,presented:2100,now:40,reducedMotion:true}),2164);
});

test('the faster ending finishes in about 1.82 seconds without widening its decoded-picture steps',()=>{
 for(const hz of [30,60,120]){
  const end=createJourneyCompletion(2164);let shown=2000,time=0;
  while(shown<2164&&time<3000){
   const next=end.advance(2164,{target:2164,presented:shown,now:time});
   assert.ok(next>=shown&&next-shown<=4,'every request stays close to the painted frame');
   shown=next;time+=1000/hz;
  }
  assert.equal(shown,2164);assert.ok(time>=1800&&time<1900,`${hz} Hz ending took ${time} ms`);
 }
});

test('background and BFCache time do not speed up the remaining approach or consume its final hold',()=>{
 const end=createJourneyCompletion(2164);
 assert.equal(end.advance(2164,{target:2164,presented:2000,now:100}),2000);
 assert.equal(end.advance(2164,{target:2164,presented:2000,now:117}),2001);
 end.suspend(120);end.suspend(121);
 assert.equal(end.resume(5120),5000,'visibility and pagehide must not double count the pause');
 assert.equal(end.resume(5121),0,'pageshow and visibility resume must be idempotent');
 assert.equal(end.advance(2164,{target:2164,presented:2001,now:5134}),2003,'resume at the visible-time rate');
 let finalPresentedAt=6000;
 end.suspend(6020);finalPresentedAt+=end.resume(11020);
 assert.equal(11020-finalPresentedAt,20,'the final hold excludes time spent offscreen');
});

test('large forward and reverse scrolls show intermediate doorway poses on touch and desktop',()=>{
 for(const coarse of [false,true])for(const [start,target] of [[1400,1700],[1700,1400],[1000,2000],[2000,1000]]){
  let frame=start,time=0,inside=0;const direction=Math.sign(target-start);
  while(frame!==target&&time<5000){
   const next=advanceJourneyFrame(frame,target,1000/60,{coarse});
   assert.ok((next-frame)*direction>=0);assert.ok((target-next)*direction>=0);
   if(frame>=1400&&frame<=1640&&next>=1400&&next<=1640){assert.ok(Math.abs(next-frame)<=6.001);inside++;}
   frame=next;time+=1000/60;
  }
  assert.equal(frame,target);assert.ok(inside>=35,'do not skip the doorway');
  assert.ok(time>=650&&time<3000);
 }
});

test('the crossing follows elapsed time at 30, 60 and 120 Hz',()=>{
 const durations=[];
 for(const hz of [30,60,120]){
  let frame=1400,time=0;
  while(frame!==1640&&time<3000){frame=advanceJourneyFrame(frame,1640,1000/hz,{coarse:true});time+=1000/hz;}
  assert.equal(frame,1640);durations.push(time);
 }
 assert.ok(Math.max(...durations)-Math.min(...durations)<35);
});

test('reversing a swipe takes effect immediately without finishing an old queued movement',()=>{
 const forward=advanceJourneyFrame(1510,1800,16.67,{coarse:true});
 const reverse=advanceJourneyFrame(forward,1450,16.67,{coarse:true});
 assert.ok(forward>1510);assert.ok(reverse<forward);assert.ok(reverse>1450);
 assert.equal(advanceJourneyFrame(reverse,reverse,16.67,{coarse:true}),reverse);
});

test('stalls do not teleport the ball, and reduced motion and ordinary touch tracking remain direct',()=>{
 assert.ok(advanceJourneyFrame(1500,1900,1000,{coarse:true})-1500<=18.001);
 assert.equal(advanceJourneyFrame(1500,1900,16.67,{reducedMotion:true}),1900);
 assert.equal(advanceJourneyFrame(800,900,16.67,{coarse:true}),900);
 assert.equal(advanceJourneyFrame(1800,2000,16.67,{coarse:true}),2000);
 assert.equal(advanceJourneyFrame(1500,1600,0),1500);
});
