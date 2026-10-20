import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {PinballPhysics} from '../game-source/src/physics.ts';
import {LetterTargets} from '../game-source/src/targets.ts';
import {seededRandom} from '../game-source/src/simulation.ts';
import {overlapCircle} from '../game-source/src/geometry.ts';
const asset=name=>new URL('../assets/'+name,import.meta.url),json=name=>JSON.parse(readFileSync(asset(name),'utf8'));
const binary=name=>{const b=readFileSync(asset(name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const manifest=json('manifest.json'),pool=json('target-slot-pool.json'),ids=new Set(pool.slots.map(s=>s.slot_id));
let physics;
before(async()=>{physics=await PinballPhysics.create(manifest,new Float32Array(binary('collision-vertices.bin')),new Uint32Array(binary('collision-indices.bin')),json('collider-entities.json'));physics.world.step()});
after(()=>physics?.dispose());

test('only the nine new marked slots are eligible, with one elevated rail slot',()=>{
 assert.equal(ids.size,9);assert.equal(pool.slots.filter(s=>s.surface_type==='floor').length,8);assert.equal(pool.slots.filter(s=>s.surface_type==='rail').length,1);
 assert.equal(manifest.target_gameplay.length,7);
 for(const target of manifest.target_gameplay){
  assert.equal(target.placements.length,9);assert.deepEqual(new Set(target.placements.map(p=>p.slot)),ids);assert.ok(target.placements.every(p=>p.safe&&p.slot.startsWith('target_20261020_')));assert.equal(target.score,1000);
  const initial=target.placements.find(p=>p.slot===target.initial_slot);assert.ok(initial);assert.deepEqual(target.initial_position,initial.position);
 }
 assert.equal(manifest.asset_checksums['target-slot-pool.json'],createHash('sha256').update(readFileSync(asset('target-slot-pool.json'))).digest('hex'));
});

test('marked floor spots support each letter and clear the existing bumpers, walls and paddles',()=>{
 const floor=physics.floorY-manifest.ball_diameter/2-.00025;
 for(const slot of pool.slots.filter(s=>s.surface_type==='floor')){
  const [x,,z]=slot.position_runtime;
  const hit=physics.world.castRay(new RAPIER.Ray({x,y:.04,z},{x:0,y:-1,z:0}),.1,true);assert.ok(hit&&Math.abs(.04-hit.timeOfImpact-floor)<.0006,slot.slot_id+' lacks floor support');
  for(const target of manifest.target_gameplay){
   const placement=target.placements.find(p=>p.slot===slot.slot_id),[a,b]=target.bounds_local,radius=Math.hypot(b[0]-a[0],b[2]-a[2])/2;
   assert.ok(Math.abs(placement.position[1]+a[1]-slot.position_runtime[1])<1e-12);
   const point=[x,physics.floorY,z];assert.equal(physics.blockedFloorReturn(point,radius),false,slot.slot_id+' touches a wall');
   for(const [handle,outline] of physics.bumperOutlines)assert.equal(overlapCircle(outline,point,radius),null,slot.slot_id+' touches '+physics.bumpers.get(handle).id);
   for(const shape of physics.pocketBlockers)assert.equal(overlapCircle(shape,point,radius),null,slot.slot_id+' touches '+shape.id);
   for(const paddle of physics.paddles)for(const angle of [0,paddle.up])assert.equal(overlapCircle(physics.paddleShape(paddle,angle),point,radius),null,slot.slot_id+' touches a paddle');
  }
 }
});

test('seven distinct letters spawn and relocate using only the new nine spots',()=>{
 for(let seed=1;seed<=1000;seed++){
  const targets=new LetterTargets(manifest.target_gameplay,manifest.ball_diameter/2);targets.random=seededRandom(seed);targets.reset([9,9,9]);
  assert.equal(new Set(targets.poses.map(p=>p.slot)).size,7);assert.ok(targets.poses.every(p=>ids.has(p.slot)));
  const t=targets.poses[seed%7],slot=t.slot,target=targets.definitions.find(d=>d.id===t.id),y=t.position[1]+(target.bounds_local[0][1]+target.bounds_local[1][1])/2;let hits=0;
  targets.passage([t.position[0]-.045,y,t.position[2]],[t.position[0]+.045,y,t.position[2]],t.surface,id=>{if(id===t.id)hits++});
  assert.equal(hits,1);assert.notEqual(t.slot,slot);assert.ok(targets.poses.every(p=>ids.has(p.slot)));assert.equal(new Set(targets.poses.map(p=>p.slot)).size,7);
 }
});

test('every letter can be collected at every new slot, with the correct surface filter',()=>{
 for(const definition of manifest.target_gameplay)for(const placement of definition.placements){
  const targets=new LetterTargets([definition],manifest.ball_diameter/2);targets.random=seededRandom(123);targets.poses.splice(0,targets.poses.length,{id:definition.id,slot:placement.slot,surface:placement.surface,position:[...placement.position]});
  const [x,y,z]=placement.position,cy=y+(definition.bounds_local[0][1]+definition.bounds_local[1][1])/2;let score=0;
  targets.passage([x-.045,cy,z],[x+.045,cy,z],placement.surface==='floor'?'rail':'floor',()=>score+=definition.score);assert.equal(score,0);
  targets.passage([x-.045,cy,z],[x+.045,cy,z],placement.surface,()=>score+=definition.score);assert.equal(score,1000,definition.id+' at '+placement.slot);assert.notEqual(targets.poses[0].slot,placement.slot);
 }
});

test('the left-drum slot is between the raised rails and is collected by actual rail travel',()=>{
 const slot=pool.slots.find(s=>s.surface_type==='rail'),routePoint=manifest.rail_route.points[slot.rail_route_index],support=slot.position_runtime;
 assert.equal(slot.source_mark_index,2);assert.ok(support[1]>.04);assert.equal(support[0],routePoint[0]);assert.equal(support[2],routePoint[2]);assert.ok(Math.abs(support[1]-(routePoint[1]-manifest.rail_route.sphere_support_height_metres+manifest.rail_route.tube_radius_metres+.0001))<1e-12);
 physics.start(123);const target=manifest.target_gameplay.find(t=>t.id==='target_s'),placement=target.placements.find(p=>p.slot===slot.slot_id);
 physics.targets.poses.find(p=>p.id===target.id).slot=slot.slot_id;Object.assign(physics.targets.poses.find(p=>p.id===target.id),{surface:'rail',position:[...placement.position]});
 let hits=0;physics.targets.passage([support[0]-.045,physics.floorY,support[2]],[support[0]+.045,physics.floorY,support[2]],'floor',id=>{if(id==='target_s')hits++});assert.equal(hits,0);
 physics.targets.poses.splice(0,physics.targets.poses.length,{id:target.id,slot:slot.slot_id,surface:'rail',position:[...placement.position]});physics.state='playing';physics.laneExited=true;physics.enterRail(0);
 for(let tick=0;tick<240&&physics.targetPasses===0;tick++)physics.tick({left:false,right:false,space:false});
 assert.equal(physics.targetPasses,1);assert.equal(physics.score,1000);assert.notEqual(physics.targets.poses[0].slot,slot.slot_id);
});
