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

test('background and BFCache time do not speed up the remaining approach or consume its final hold',()=>{
 const end=createJourneyCompletion(2164);
 assert.equal(end.advance(2164,{target:2164,presented:2000,now:100}),2000);
 assert.equal(end.advance(2164,{target:2164,presented:2000,now:117}),2001);
 end.suspend(120);end.suspend(121);
 assert.equal(end.resume(5120),5000,'visibility and pagehide must not double count the pause');
 assert.equal(end.resume(5121),0,'pageshow and visibility resume must be idempotent');
 assert.equal(end.advance(2164,{target:2164,presented:2001,now:5134}),2002,'resume at the visible-time rate');
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
   if(frame>=1400&&frame<=1640&&next>=1400&&next<=1640){assert.ok(Math.abs(next-frame)<=4.001);inside++;}
   frame=next;time+=1000/60;
  }
  assert.equal(frame,target);assert.ok(inside>=55,'do not skip the doorway');
  assert.ok(time>=1000&&time<4000);
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
 assert.ok(advanceJourneyFrame(1500,1900,1000,{coarse:true})-1500<=12.001);
 assert.equal(advanceJourneyFrame(1500,1900,16.67,{reducedMotion:true}),1900);
 assert.equal(advanceJourneyFrame(800,900,16.67,{coarse:true}),900);
 assert.equal(advanceJourneyFrame(1800,2000,16.67,{coarse:true}),2000);
 assert.equal(advanceJourneyFrame(1500,1600,0),1500);
});

test('touch and desktop land on their destination with a steady glide, not a sub-frame crawl',()=>{
 for(const coarse of [true,false]){
  let frame=1000;const target=1010,steps=[];
  for(let i=0;i<60&&frame!==target;i++){const next=advanceJourneyFrame(frame,target,1000/60,{coarse});steps.push(next-frame);frame=next;}
  assert.equal(frame,target);
  // every tick before landing moves at least ~1 frame, so no 50-100 ms stalls
  assert.ok(steps.slice(0,-1).every(step=>step>=.99),JSON.stringify(steps));
 }
});

import {createTouchGlide} from '../entrance-source/journey-motion.mjs';
test('touch glide aims short of the predicted rest point after release and never while touching or idle',()=>{
 const g=createTouchGlide(),bounds={first:0,last:2000};
 // finger down: raw target is returned
 g.touch(true);for(let i=0;i<8;i++)g.push(100+i*5,i*16);
 assert.equal(g.target(135,112,bounds),135);
 // released while moving ~312 frames/s: aim ahead, within the reach limit
 g.touch(false);const ahead=g.target(135,114,bounds);
 assert.ok(ahead>135&&ahead<=135+312*.6+1,String(ahead));
 // a slow crawl with no earlier fast release is followed 1:1
 const slow=createTouchGlide();slow.push(100,0);slow.push(100.5,100);
 assert.equal(slow.target(100.5,110,bounds),100.5);
 // scroll events stop with the ball ahead: the page is committed to the ball, never pulled back
 const settled=g.target(150,2000,bounds);
 assert.ok(settled>150&&settled===g.takeCommit());assert.equal(g.takeCommit(),null);
 assert.equal(g.target(150,2001,bounds),settled,'holds the committed point until the page catches up');
 g.push(settled,2002);assert.equal(g.target(settled,2003,bounds),settled);
 // after a normal stop at the predicted point nothing is committed
 const quiet=createTouchGlide();quiet.push(10,0);assert.equal(quiet.target(10,1000,bounds),10);assert.equal(quiet.takeCommit(),null);
 // reversal and bounds
 const h=createTouchGlide();for(let i=0;i<8;i++)h.push(1990+i*5,i*16);
 assert.equal(h.target(1995,112,bounds),2000);
 const r=createTouchGlide();for(let i=0;i<8;i++)r.push(500-i*5,i*16);
 assert.ok(r.target(465,112,bounds)<465);
});
