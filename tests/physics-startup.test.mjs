import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PinballPhysics} from '../game-source/src/physics.ts';
import {packInput} from '../game-source/src/simulation.ts';
import {verifyGame} from '../verify-game.mjs';

const asset=name=>new URL('../assets/'+name,import.meta.url);
const json=name=>JSON.parse(readFileSync(asset(name),'utf8'));
const binary=name=>{const data=readFileSync(asset(name));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};
const manifest=json('manifest.json'),vertices=new Float32Array(binary('collision-vertices.bin')),
 indices=new Uint32Array(binary('collision-indices.bin')),obstacles=json('collider-entities.json');
const create=()=>PinballPhysics.create(manifest,vertices,indices,obstacles);

test('the inactive preview world starts the same seeded game as a fresh replay world',async()=>{
 const prepared=await create();let fresh;
 try{
  const initial=prepared.pose();
  // The table can be displayed, inspected and paused before its first Play.
  // Inputs during that preview must not advance Rapier or consume game randomness.
  for(let tick=0;tick<600;tick++){
   prepared.setPaused(tick%120>=60);
   prepared.tick({left:tick%2===0,right:tick%2===1,space:tick%3===0});
   prepared.pose();
  }
  prepared.setPaused(false);
  assert.equal(prepared.active,false);
  assert.deepEqual(prepared.pose(),initial);

  fresh=await create();
  const seed=12345,inputs=[];
  prepared.start(seed);fresh.start(seed);
  assert.deepEqual(prepared.pose(),fresh.pose());
  for(let tick=0;tick<60000&&prepared.state!=='finished';tick++){
   const controls={
    left:tick<400&&tick%86<43,
    right:tick<400&&tick%86>=43,
    space:prepared.state==='charging'||prepared.state==='launcher'&&tick%120!==0,
   };
   const bits=packInput(controls),last=inputs.at(-1);
   if(last?.[0]===bits)last[1]++;else inputs.push([bits,1]);
   prepared.tick(controls);fresh.tick(controls);
   assert.deepEqual(prepared.pose(),fresh.pose(),'simulation tick '+tick);
  }
  assert.equal(prepared.state,'finished');
  assert.equal(prepared.drains,3);
  assert.equal(prepared.lives,0);
  const verified=await verifyGame(seed,inputs);
  assert.equal(verified.score,prepared.score);
 }finally{prepared.dispose();fresh?.dispose()}
});
