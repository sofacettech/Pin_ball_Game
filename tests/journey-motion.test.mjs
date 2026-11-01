import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceJourneyFrame} from '../entrance-source/journey-motion.mjs';

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
