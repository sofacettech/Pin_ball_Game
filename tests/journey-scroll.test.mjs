import test from 'node:test';
import assert from 'node:assert/strict';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';

test('the empty chessboard needs half the scrolling while the other sections retain their pacing',()=>{
 const map=createJourneyScrollMap();
 assert.equal(map.scrollAtFrame(1560), (1560-240)*8);
 assert.equal(map.scrollAtFrame(2000)-map.scrollAtFrame(1560), (2000-1560)*4);
 assert.equal(map.scrollAtFrame(2164)-map.scrollAtFrame(2000), (2164-2000)*8);
 assert.equal(map.travel,13632);
});

test('forward and reverse scrolling keep continuous, reversible poses through both chess boundaries',()=>{
 const map=createJourneyScrollMap();let previous=240;
 for(let y=0;y<=map.travel;y+=7.3){
  const frame=map.frameAtScroll(y);
  assert.ok(frame>=previous);assert.ok(Math.abs(map.scrollAtFrame(frame)-y)<1e-8);previous=frame;
 }
 for(const frame of [240,680,1559.99,1560,1560.01,1800,1999.99,2000,2000.01,2070,2164]){
  assert.ok(Math.abs(map.frameAtScroll(map.scrollAtFrame(frame))-frame)<1e-8);
 }
});

test('overscroll clamps to the initial pose and exact game-handoff frame',()=>{
 const map=createJourneyScrollMap();
 assert.equal(map.frameAtScroll(-100),240);assert.equal(map.frameAtScroll(map.travel),2164);
 assert.equal(map.frameAtScroll(map.travel+100),2164);assert.equal(map.scrollAtFrame(0),0);
 assert.equal(map.scrollAtFrame(3000),map.travel);
});
