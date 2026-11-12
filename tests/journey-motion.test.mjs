import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceJourneyFrame,createVideoJourneyClock,VIDEO_FRAME_INTERVAL_MS} from '../entrance-source/journey-motion.mjs';

test('a swipe to the end plays the whole video at its capped speed across refresh rates',()=>{
 for(const hz of [30,60,120]){
  const clock=createVideoJourneyClock(334);let frame=334,time=0,changes=0;
  while(frame!==2164&&time<65000){
   const next=clock.advance(time,2164);
   assert.ok(next-frame>=0&&next-frame<=2,'no jump over a room, even on a fast swipe');
   if(next!==frame)changes++;
   frame=next;time+=1000/hz;
  }
  assert.equal(frame,2164);assert.equal(changes,915);
  assert.ok(time>=30500&&time<31000,'the 60 Hz source keeps normal playback speed at 30 fps');
 }
});

test('a slow decode or background pause cannot accumulate a skip over unfinished video',()=>{
 const clock=createVideoJourneyClock(334);
 clock.advance(0,2164);
 assert.equal(clock.advance(40,2164),336);
 assert.equal(clock.advance(5000,2164,{settled:false}),336);
 assert.equal(clock.advance(10000,2164,{settled:false}),336);
 assert.equal(clock.advance(10001,2164),338,'resume with only the next presentation step');
 clock.suspend();
 assert.equal(clock.advance(60000,2164),338);
 assert.equal(clock.advance(60000+VIDEO_FRAME_INTERVAL_MS,2164),340);
});

test('video reversals follow the latest scroll destination without playing an old queue',()=>{
 const clock=createVideoJourneyClock(1000);
 clock.advance(0,2164);
 assert.equal(clock.advance(40,2164),1002);
 assert.equal(clock.advance(80,334),1000);
 assert.equal(clock.advance(120,999.5),999.5,'stop at a nearby destination without overshooting');
 assert.equal(clock.advance(10000,999.5),999.5);
 assert.equal(clock.advance(10040,2164),1001.5);
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
