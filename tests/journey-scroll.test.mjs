import test from 'node:test';
import assert from 'node:assert/strict';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';

test('the closer spawn and both empty approaches need less scrolling without speeding up the rooms',()=>{
 const map=createJourneyScrollMap();
 assert.equal(map.scrollAtFrame(334),0);
 assert.equal(map.scrollAtFrame(700),(700-334)*4);
 assert.equal(map.scrollAtFrame(1480)-map.scrollAtFrame(860),(1480-860)*8);
 assert.equal(map.scrollAtFrame(1920)-map.scrollAtFrame(1640), (1920-1640)*4);
 assert.equal(map.scrollAtFrame(2164)-map.scrollAtFrame(2080), (2164-2080)*8);
 assert.equal(map.travel,11096);
});

test('equal scroll inputs accelerate gradually across each section boundary',()=>{
 const map=createJourneyScrollMap(),speed=y=>map.frameAtScroll(y+.5)-map.frameAtScroll(y-.5);
 for(const boundary of [780,1560,2000]){
  const center=map.scrollAtFrame(boundary);
  assert.ok(Math.abs(speed(center-.5)-speed(center+.5))<.001,'no abrupt 2x speed change');
  for(let frame=boundary-90;frame<boundary+90;frame++){
   const y=map.scrollAtFrame(frame),a=speed(y),b=speed(y+1);
   assert.ok(a>=.125-1e-8&&a<=.25+1e-8);
   assert.ok(Math.abs(b-a)<.001,'speed blends throughout the transition');
  }
 }
});

test('forward and reverse scrolling keep continuous, reversible poses through both chess boundaries',()=>{
 const map=createJourneyScrollMap();let previous=334;
 for(let y=0;y<=map.travel;y+=7.3){
  const frame=map.frameAtScroll(y);
  assert.ok(frame>=previous);assert.ok(Math.abs(map.scrollAtFrame(frame)-y)<1e-8);previous=frame;
 }
 for(const frame of [334,680,779.99,780,780.01,1000,1559.99,1560,1560.01,1800,1999.99,2000,2000.01,2070,2164]){
  assert.ok(Math.abs(map.frameAtScroll(map.scrollAtFrame(frame))-frame)<1e-8);
 }
});

test('overscroll clamps to the initial pose and exact game-handoff frame',()=>{
 const map=createJourneyScrollMap();
 assert.equal(map.frameAtScroll(-100),334);assert.equal(map.frameAtScroll(map.travel),2164);
 assert.equal(map.frameAtScroll(map.travel+100),2164);assert.equal(map.scrollAtFrame(0),0);
 assert.equal(map.scrollAtFrame(3000),map.travel);
});
