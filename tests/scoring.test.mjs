import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PinballPhysics,RING_SCORE,TRIANGLE_SCORE,LAUNCHER_SCORE,CAVE_SCORE} from '../game-source/src/physics.ts';
import {REPLAY_VERSION,packInput} from '../game-source/src/simulation.ts';
import {verifyGame} from '../verify-game.mjs';

const asset=name=>new URL('../assets/'+name,import.meta.url);
const json=name=>JSON.parse(readFileSync(asset(name),'utf8'));
const binary=name=>{const b=readFileSync(asset(name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const manifest=json('manifest.json'),obstacles=json('collider-entities.json');
let physics;
before(async()=>{physics=await PinballPhysics.create(manifest,new Float32Array(binary('collision-vertices.bin')),new Uint32Array(binary('collision-indices.bin')),obstacles)});
after(()=>physics?.dispose());

test('all seven SOFACET targets award 1,000 points each',()=>{
 assert.equal(manifest.target_gameplay.length,7);
 for(const target of manifest.target_gameplay){
  physics.start(123);physics.collectTarget(target.id);
  assert.equal(physics.score,1000,target.id);
  assert.equal(manifest.entities.find(e=>e.game_id===target.id).score_delta,1000);
 }
});

test('actual bumper impacts use the requested scores and keep contact debounce',()=>{
 for(const [handle,obstacle] of physics.bumpers){
  physics.start(123);physics.charge=.5;physics.launch();physics.score=0;physics.time=1;
  const incoming={x:-.4,y:0,z:0};physics.ball.setLinvel(incoming,true);
  const expected=obstacle.id.startsWith('ring_')?50:obstacle.id.startsWith('bumper_neutral_')?100:obstacle.role==='bumper_plus'?500:obstacle.role==='drum_base_bumper'?250:obstacle.role==='bumper_minus'?-500:0;
  physics.applyBumper(handle,[1,0,0],incoming,{x:0,y:physics.floorY,z:0});
  assert.equal(physics.score,expected,obstacle.id);assert.equal(physics.lastHit.delta,expected,obstacle.id);
  physics.time+=.01;physics.applyBumper(handle,[1,0,0],incoming,{x:0,y:physics.floorY,z:0});
  assert.equal(physics.score,expected,obstacle.id+' repeat contact');
 }
 assert.equal(RING_SCORE,50);assert.equal(TRIANGLE_SCORE,100);assert.equal(CAVE_SCORE,700);
});

test('manual and automatic launches award zero points, as does an unlaunched charge',()=>{
 assert.equal(LAUNCHER_SCORE,0);
 const idle={left:false,right:false,space:false},held={...idle,space:true};
 physics.start(123);physics.tick(idle);for(let i=0;i<30;i++)physics.tick(held);physics.tick(idle);
 assert.equal(physics.launches,1);assert.equal(physics.score,0);physics.launch();assert.equal(physics.score,0);
 physics.start(123);physics.tick(idle);for(let i=0;i<200&&physics.launches===0;i++)physics.tick(held);
 assert.equal(physics.launches,1);assert.equal(physics.score,0);
 physics.start(123);physics.tick(idle);physics.tick(held);physics.tick(idle);
 assert.equal(physics.launches,0);assert.equal(physics.score,0);
});

test('runtime scoring data agrees with entity declarations and its cache checksum',()=>{
 for(const o of obstacles){
  const e=manifest.entities.find(e=>e.game_id===o.id);assert.ok(e,o.id);assert.equal(e.score_delta,o.score_delta,o.id);
 }
 assert.equal(manifest.entities.find(e=>e.role==='launcher').score_delta,0);
 assert.equal(manifest.asset_checksums['collider-entities.json'],createHash('sha256').update(readFileSync(asset('collider-entities.json'))).digest('hex'));
 assert.equal(REPLAY_VERSION,19);
});

test('a complete three-ball game has the same score in the server replay worker',async()=>{
 const seed=12345,inputs=[];physics.start(seed);
 for(let ticks=0;ticks<60000&&physics.state!=='finished';ticks++){
  const controls={left:false,right:false,space:physics.state==='charging'||physics.state==='launcher'&&!physics.spaceMustRelease};
  const bits=packInput(controls),last=inputs.at(-1);if(last?.[0]===bits)last[1]++;else inputs.push([bits,1]);physics.tick(controls);
 }
 assert.equal(physics.state,'finished');assert.equal(physics.drains,3);assert.equal(physics.lives,0);assert.ok(physics.launches>=3);
 const score=physics.score,result=await verifyGame(seed,inputs);assert.equal(result.score,score);
});


test('a valid cave entry awards 700 once and duplicate capture adds no points',()=>{
 physics.start(123);physics.charge=.5;physics.launch();physics.laneExited=true;
 const def=manifest.cave,r=manifest.ball_diameter/2/(def.world_scale*manifest.scale),gate=Math.max(def.entry_plane,def.approach_front+r+.06);
 const vector=p=>({x:p[0],y:p[1],z:p[2]}),from=vector(physics.cavePoint(0,gate+.1)),to=vector(physics.cavePoint(0,gate-.01)),direction=physics.caveDirection(),incoming={x:-direction[0]*.5,y:0,z:-direction[2]*.5};
 assert.equal(physics.tryEnterCave(from,to,incoming),true);assert.equal(physics.score,700);assert.equal(physics.caveEntries,1);
 assert.equal(physics.tryEnterCave(from,to,incoming),false);assert.equal(physics.score,700);
});
