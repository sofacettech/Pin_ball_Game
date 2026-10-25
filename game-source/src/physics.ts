import {BALL_MOTION_RATE} from './motion.ts';
import {seededRandom} from './simulation.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import type {Manifest,XYZ} from './types.ts';
import {LetterTargets} from './targets.ts';
import {outline,sweepCircle} from './bumper-sweep.ts';
import type {Outline} from './bumper-sweep.ts';
import {overlapCircle,closestTriangle} from './geometry.ts';
import {RailTravel} from './rail.ts';
export const DT=1/120;
export const MAX_SPEED=2;
export const BUMPER_SPEED_GAIN_FACTOR=.85;
export const BUMPER_IMPACT_MULTIPLIER=.8;
export const DRUM_IMPACT_MULTIPLIER=.8;
export const CAVE_POST_REBOUND_MULTIPLIER=1.21;
export const COLLISION_SPEED_MULTIPLIER=1.10;
export const PADDLE_PUSH_MULTIPLIER=1.6698*1.05*1.10*1.25; // Stronger powered stroke; released paddles stay passive.
export const HELD_PADDLE_PUSH_MULTIPLIER=4.7;
export const HELD_PADDLE_MAX_SPEED=1.6;
export const PADDLE_RESTITUTION=.05;
export const PADDLE_HOLD_SECONDS=1;
const PADDLE_HOLD_TICKS=Math.round(PADDLE_HOLD_SECONDS/DT);
export const RING_SCORE=50;
export const TRIANGLE_SCORE=100;
export const LAUNCHER_SCORE=0;
export const CAVE_SCORE=700;
export const CAVE_CHARGE_SECONDS=1;
export const CAVE_RELEASE_SPEED=1.5; // Fixed fast release, independent of entry speed.
export const BUMPER_REBOUND_MULTIPLIER=1.10;
export const FLOOR_MAX_SPEED=1.5;
export const RAPID_REBOUND_WINDOW=.22;
export const RAPID_REBOUND_CAP=.85;
export const RAPID_REBOUND_LOSS=.88;
export const RAPID_REBOUND_SETTLE=.4;
export const HIGH_CHARGE_EXIT_FACTOR=.9;
const SUBSTEPS=4;
// Clears the measured 0.19 mm simplification error without visible floor hopping.
export const ROLL_CLEARANCE=.00025;
// Menu input can preserve a partly charged spring until a fresh Space press.
export type Input={left:boolean;right:boolean;space:boolean;holdCharge?:boolean};
export type State='launcher'|'charging'|'playing'|'spring_return'|'draining'|'resetting'|'finished';
export type Obstacle={id:string;role:string;hull_world:number[];score_delta:number};
type Paddle={id:string;body:RAPIER.RigidBody;up:number;angle:number;local:Outline;omega:number;held:boolean;holdTicks:number};
type CaveCharge={phase:'entering'|'charging'|'ejecting';elapsed:number;entrySpeed:number;from:[number,number];distance:number};
export class PinballPhysics {
 readonly manifest:Manifest;
 readonly world:RAPIER.World;readonly ball:RAPIER.RigidBody;
 readonly targets:LetterTargets;targetPasses=0;
 rail:RailTravel|null=null;railCollected=0;railRequired=3;railTrips=0;transportGeneration=0;
 private random:()=>number=Math.random;
 private pendingRail=false;private pendingFloorReturn=false;private floorTriangles:XYZ[][]=[];private barriers:XYZ[][]=[];
 private barrierCells=new Map<string,XYZ[][]>();private caveRestTime=0;private caveCheeks:Outline[]=[];private caveWalls:XYZ[][]=[];
 readonly paddles:Paddle[]=[];
 state:State='launcher';lives=3;charge=0;springCompression=0;score=0;hits=0;launches=0;drains=0;laneExited=false;
 ballMode:'floor'|'rail'='floor';lastHit:{id:string;delta:number;speedBefore:number;speedAfter:number;normal:XYZ;rapidRebound:boolean}|null=null;
 active=false;paused=false;time=0;resetTimer=0;private spaceMustRelease=true;
 private bumpers=new Map<number,Obstacle>();private lastBump=new Map<number,number>();private touching=new Set<number>();private ballCollider:RAPIER.Collider;
 private events=new RAPIER.EventQueue(true);
 onHit?:(id:string,delta:number)=>void;
 onTarget?:(id:string)=>void;
 onTransport?:(source:XYZ)=>void;
 private spawn:XYZ;private floorY:number;private laneY:number;private falling=false;private tableLocked=false;
 private laneSurface:[number,number][]=[];
 private lanePoints:XYZ[]=[];private laneCrest=0;
 private launchCharge=0;private springReturnTime=0;private springReturnPeak=0;private springReturnX=0;
 private drainZ:number;private drainWidth:number;
 private bumperOutlines=new Map<number,Outline>();
 private triangleBodies=new Map<number,{id:string;shape:Outline}>();private lastTriangleHit=new Map<string,number>();
 private pocketBlockers:(Outline&{id:string;exit:[XYZ,XYZ];rebound?:XYZ})[]=[];private postPocketRebounds=new Set<string>();private drainTransfer:{from:XYZ;elapsed:number;duration:number}|null=null;
 private lastReboundTime=-Infinity;private rapidReboundUntil=-Infinity;private reboundTicks=new Map<number|string,number>();
 private cave:CaveCharge|null=null;private caveArmed=true;private launchBoostSpeed=0;private launchBoostUntil=-Infinity;caveEntries=0;
 private sceneMinX:number;private sceneMaxX:number;private collectorWidth:number;private lastSupported:XYZ;recoveries=0;
 constructor(manifest:Manifest,vertices:Float32Array,indices:Uint32Array,obstacles:Obstacle[]){
  this.manifest=manifest;
  const [gx,gy,gz]=manifest.calibration.gravity_runtime;
  this.world=new RAPIER.World({x:gx,y:gy,z:gz});this.world.timestep=DT*BALL_MOTION_RATE/SUBSTEPS;
  this.world.integrationParameters.numSolverIterations=8;this.world.integrationParameters.maxCcdSubsteps=4;
  this.world.integrationParameters.normalizedAllowedLinearError=.0001;
  this.world.integrationParameters.normalizedPredictionDistance=.001;
  const laneNames=new Set(['Continuous main lane | ONE connected floor','Continuous main lane | Inner solid wall','Continuous main lane | Outer solid wall','FACET Tunnel | tunnel only collision shell']);
  const fieldIndices:number[]=[],laneIndices:number[]=[],caveIndices:number[]=[],triangleIndices=[[],[]] as number[][];
  for(const range of manifest.static_collision_ranges.filter(r=>/^Cave \| (left|right) tapered side cheek$/.test(r.name))){
   const points:number[]=[];for(const index of new Set(indices.slice(range.start*3,(range.start+range.count)*3)))points.push(...vertices.slice(index*3,index*3+3));
   this.caveCheeks.push(outline(points));
  }
  for(const range of manifest.static_collision_ranges){const side=range.name.startsWith('Left triangle |')?0:range.name.startsWith('Right triangle |')?1:-1,destination=laneNames.has(range.name)?laneIndices:range.name.startsWith('Cave |')?caveIndices:fieldIndices;for(let i=range.start*3;i<(range.start+range.count)*3;i+=3){if(side>=0){triangleIndices[side].push(indices[i],indices[i+1],indices[i+2])}destination.push(indices[i],indices[i+1],indices[i+2])}}
  this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,new Uint32Array(fieldIndices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.16).setRestitution(.12));
  this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,new Uint32Array(laneIndices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max));
  if(caveIndices.length)this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,new Uint32Array(caveIndices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.02).setRestitution(.18).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min));
  for(let i=0;i<caveIndices.length;i+=3){const tri=caveIndices.slice(i,i+3).map(j=>[vertices[j*3],vertices[j*3+1],vertices[j*3+2]] as XYZ),[a,b,c]=tri;
   const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
   if(Math.abs(ny)<Math.hypot(nx,ny,nz)*.7)this.caveWalls.push(tri);
  }
  if(!manifest.launcher_route?.points?.length||manifest.launcher_route.edges?.length!==2||manifest.launcher_route.source_sha256!==(manifest as any).source_sha256)throw new Error('The matching main-lane route and edges are missing.');
  this.lanePoints=manifest.launcher_route.points;this.laneCrest=this.lanePoints.reduce((best,p,i)=>p[2]<this.lanePoints[best][2]?i:best,0);
  for(const [side,list] of triangleIndices.entries())this.triangleBodies.set(side,{id:side===0?'triangle_left':'triangle_right',shape:outline(list.flatMap(i=>Array.from(vertices.slice(i*3,i*3+3))))});
  for(const o of obstacles){
   const hull=RAPIER.ColliderDesc.convexHull(new Float32Array(o.hull_world));if(!hull)throw new Error('Invalid obstacle hull: '+o.id);
   const expected=o.id.startsWith('bumper_neutral_')?TRIANGLE_SCORE:o.role==='bumper_plus'?500:o.role==='drum_base_bumper'?250:o.role==='bumper_minus'?-500:0;
   if(o.score_delta!==expected)throw new Error('Invalid bumper score: '+o.id);
   hull.setFriction(.12).setRestitution(.7).setCollisionGroups(0x00020001).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
   if(o.role==='drum_base_bumper')hull.setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
   const c=this.world.createCollider(hull);this.bumpers.set(c.handle,o);this.bumperOutlines.set(c.handle,outline(o.hull_world));
  }
  const s=manifest.scale;const p=manifest.calibration.authored_ball_spawn;
  const floor=manifest.static_collision_objects.find(o=>o.source_name.startsWith('Flooring | reference polygon plate'));
  const lane=manifest.static_collision_objects.find(o=>o.source_name==='Continuous main lane | ONE connected floor');
  if(!floor||!lane)throw new Error('Playfield or launcher floor mapping is missing.');
  this.floorY=floor.world_bounds[1][2]*s+manifest.ball_diameter/2+ROLL_CLEARANCE;
  this.laneY=lane.world_bounds[1][2]*s+manifest.ball_diameter/2+ROLL_CLEARANCE;
  const laneTop=lane.world_bounds[1][2]*s;
  const laneRange=manifest.static_collision_ranges.find(r=>r.name==='Continuous main lane | ONE connected floor')!;
  for(let i=laneRange.start*3;i<(laneRange.start+laneRange.count)*3;i+=3){
   const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
   const area=(vertices[b]-vertices[a])*(vertices[c+2]-vertices[a+2])-(vertices[b+2]-vertices[a+2])*(vertices[c]-vertices[a]);
   if(Math.abs(area)>1e-10&&[a,b,c].every(v=>Math.abs(vertices[v+1]-laneTop)<.0002))this.laneSurface.push([vertices[a],vertices[a+2]],[vertices[b],vertices[b+2]],[vertices[c],vertices[c+2]]);
  }
  if(!this.laneSurface.length)throw new Error('Launcher support surface is missing.');
  this.spawn=[p[0]*s,this.laneY,-p[1]*s];
  const bed=manifest.static_collision_objects.find(o=>o.source_name==='Playfield | dark purple metal bed')!;
  this.drainZ=-bed.world_bounds[0][1]*s;
  this.sceneMinX=Math.min(bed.world_bounds[0][0],lane.world_bounds[0][0])*s-.4*s-manifest.ball_diameter/2;
  this.sceneMaxX=Math.max(bed.world_bounds[1][0],lane.world_bounds[1][0])*s+.4*s+manifest.ball_diameter/2;
  this.drainWidth=.8*s;
  this.collectorWidth=Math.max(...manifest.calibration.paddles.map(p=>Math.abs(p.pivot_blender[0])*s))+manifest.ball_diameter/2;
  this.lastSupported=[...this.spawn];
  for(const block of manifest.passive_blockers){
   const shape={...outline(block.hull_world),id:block.id,exit:block.escape_edge_world,rebound:block.rebound_direction_world};this.pocketBlockers.push(shape);
   if(!block.collision_in_static_mesh)this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(block.hull_world),new Uint32Array(block.triangles)).setFriction(.16).setRestitution(block.restitution??.12));
  }
  for(const range of manifest.static_collision_ranges){
   const support=range.name.startsWith('Flooring | reference polygon plate');
   if(!support&&range.name==='Playfield | dark purple metal bed')continue;
   for(let i=range.start*3;i<(range.start+range.count)*3;i+=3){
    const tri=[indices[i],indices[i+1],indices[i+2]].map(j=>[vertices[j*3],vertices[j*3+1],vertices[j*3+2]] as XYZ);
    if(support){if(tri.every(v=>Math.abs(v[1]-(this.floorY-manifest.ball_diameter/2-ROLL_CLEARANCE))<.00001))this.floorTriangles.push(tri)}
    else {
     this.barriers.push(tri);
     const size=manifest.ball_diameter*2,r=manifest.ball_diameter/2;
     if(Math.min(...tri.map(p=>p[1]))>this.floorY+r+.002)continue;
     const x0=Math.floor(Math.min(...tri.map(p=>p[0]))/size),x1=Math.floor(Math.max(...tri.map(p=>p[0]))/size),z0=Math.floor(Math.min(...tri.map(p=>p[2]))/size),z1=Math.floor(Math.max(...tri.map(p=>p[2]))/size);
     for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=this.barrierCells.get(key)||[];list.push(tri);this.barrierCells.set(key,list)}
    }
   }
  }
  if(!manifest.rail_route?.points.length||!this.floorTriangles.length)throw new Error('Rail route or floor support data is missing.');
  this.targets=new LetterTargets(manifest.target_gameplay||[],manifest.ball_diameter/2);
  this.ball=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...this.spawn).setCcdEnabled(true).setLinearDamping(.025).setAngularDamping(.12));
  this.ballCollider=this.world.createCollider(RAPIER.ColliderDesc.ball(manifest.ball_diameter/2).setMass(.08).setFriction(.16).setRestitution(.25).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),this.ball);
  for(const paddle of manifest.calibration.paddles){
   const p=paddle.pivot_blender;const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0]*s,p[2]*s,-p[1]*s));
   const vertices=new Float32Array(paddle.collider_hull_vertices_local.flatMap(p=>[p[0]*s,p[2]*s,-p[1]*s]));
   const hull=RAPIER.ColliderDesc.convexHull(vertices);if(!hull)throw new Error('Invalid paddle hull.');
   this.world.createCollider(hull.setFriction(.35).setRestitution(PADDLE_RESTITUTION).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(0x00040001),body);
   this.paddles.push({id:paddle.game_id,body,up:paddle.up_angle_degrees*Math.PI/180,angle:0,local:outline(Array.from(vertices)),omega:0,held:false,holdTicks:0});
  }
 }
 static async create(manifest:Manifest,vertices:Float32Array,indices:Uint32Array,obstacles:Obstacle[]){await RAPIER.init();return new PinballPhysics(manifest,vertices,indices,obstacles)}
 start(seed?:number){this.random=seed===undefined?Math.random:seededRandom(seed);this.targets.random=this.random;this.caveEntries=0;this.lastTriangleHit.clear();this.postPocketRebounds.clear();this.drainTransfer=null;this.recoveries=0;this.pendingFloorReturn=false;this.rail=null;this.pendingRail=false;this.railCollected=0;this.railRequired=3+Math.floor(this.random()*3);this.railTrips=0;this.transportGeneration++;this.active=true;this.paused=false;this.state='launcher';this.lives=3;this.charge=0;this.springCompression=0;this.score=0;this.hits=0;this.lastHit=null;this.ballMode='floor';this.launches=0;this.drains=0;this.laneExited=false;this.falling=false;this.springReturnTime=0;this.time=0;this.resetTimer=0;this.spaceMustRelease=true;this.lastBump.clear();this.touching.clear();this.park();this.targetPasses=0;this.targets.reset(this.spawn);for(const p of this.paddles){p.angle=0;p.omega=0;p.held=false;p.holdTicks=0;p.body.setRotation({x:0,y:0,z:0,w:1},true);p.body.setNextKinematicRotation({x:0,y:0,z:0,w:1})}}
 park(){this.caveRestTime=0;this.cave=null;this.caveArmed=true;this.launchBoostUntil=-Infinity;this.ball.resetForces(true);this.ball.setGravityScale(1,true);this.resetRebounds();this.postPocketRebounds.clear();this.launchCharge=0;this.drainTransfer=null;this.lastSupported=[...this.spawn];this.ballMode='floor';this.rail=null;this.pendingRail=false;this.falling=false;this.tableLocked=false;this.laneExited=false;this.ballCollider.setEnabled(true);this.ball.setAdditionalMass(0,true);this.ball.setEnabledTranslations(true,true,true,true);this.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);this.ball.setTranslation({x:this.spawn[0],y:this.spawn[1],z:this.spawn[2]},true);this.ball.setNextKinematicTranslation({x:this.spawn[0],y:this.spawn[1],z:this.spawn[2]});this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);this.ball.setRotation({x:0,y:0,z:0,w:1},true)}
 setPaused(value:boolean){this.paused=value}
 launch(){if(this.state!=='launcher'&&this.state!=='charging')return;
  this.launchCharge=this.charge;
  this.ball.setBodyType(RAPIER.RigidBodyType.Dynamic,true);this.ball.setLinvel({x:0,y:0,z:-(.6+1.4*this.charge)},true);
  this.ball.setAngvel({x:-100*this.charge,y:0,z:0},true);this.state='playing';this.launches++;this.charge=0;
 }
 tick(input:Input){
  if(!this.active||this.paused||this.state==='finished')return;
  // Keep the raw hold latched past the limit; only release permits another stroke.
  // This shared tick-based gate also runs in the server's replay worker.
  for(const paddle of this.paddles){const pressed=paddle.id==='flipper_left'?input.left:input.right;paddle.holdTicks=pressed?Math.min(PADDLE_HOLD_TICKS+1,paddle.holdTicks+1):0}
  this.time+=DT;
  if(!input.space&&!input.holdCharge){if(this.spaceMustRelease&&this.state==='charging')this.state='launcher';this.spaceMustRelease=false}
  if(this.state==='spring_return'){
   this.springReturnTime+=DT*BALL_MOTION_RATE;const t=Math.min(1,this.springReturnTime/.32);
   this.springCompression=this.springReturnPeak*Math.sin(Math.PI*t)**2;
   const spring=this.manifest.calibration.spring,stroke=(spring.front_blender[1]-spring.rear_anchor_blender[1])*this.manifest.scale*(1-spring.minimum_length_ratio)*this.springCompression;
   const x=this.spawn[0]+(this.springReturnX-this.spawn[0])*(1-t);
   this.ball.setNextKinematicTranslation({x,y:this.spawn[1],z:this.spawn[2]+stroke});
   if(t===1){this.park();this.state='launcher';this.springCompression=0;this.spaceMustRelease=true}
  }else if(this.state==='resetting'){
   this.resetTimer-=DT;if(this.resetTimer<=0){this.park();this.state='launcher';this.spaceMustRelease=true}
  }else if(this.state==='launcher'||this.state==='charging'){
   if(!input.holdCharge&&input.space&&!this.spaceMustRelease){this.state='charging';this.charge=Math.min(1,this.charge+DT/1.35);if(this.charge>=1)this.launch()}
   else if(!input.holdCharge&&!input.space&&this.state==='charging'){
    // Proposed partial-release default from the PRD; full charge always auto-launches.
    if(this.charge>.08)this.launch();else{this.charge=0;this.state='launcher'}
   }
  }
  if(this.state!=='spring_return')this.springCompression=this.state==='charging'||this.state==='launcher'?this.charge:Math.max(0,this.springCompression-DT*10);
  // Rearm separated rings once per tick; duplicate CCD/overlap callbacks in
  // the same physics frame still represent the same scoring contact.
  const ringPosition=this.ball.translation();
  for(const handle of this.touching)if(!overlapCircle(this.bumperOutlines.get(handle)!,[ringPosition.x,ringPosition.y,ringPosition.z],this.manifest.ball_diameter/2+.0003))this.touching.delete(handle);
  for(let step=0;step<SUBSTEPS;step++){
   const dt=DT/SUBSTEPS,motionDt=dt*BALL_MOTION_RATE;
   const sweptPaddles=this.paddles.map(paddle=>{
    const pressed=paddle.id==='flipper_left'?input.left:input.right,held=pressed&&paddle.holdTicks<=PADDLE_HOLD_TICKS,target=held?paddle.up:0,old=paddle.angle;
    paddle.held=held;
    paddle.angle+=Math.sign(target-old)*Math.min(Math.abs(target-old),(held?18:12)*dt);paddle.omega=(paddle.angle-old)/dt;
    paddle.body.setNextKinematicRotation({x:0,y:Math.sin(paddle.angle/2),z:0,w:Math.cos(paddle.angle/2)});
    const points=[...this.paddleShape(paddle,old).points,...this.paddleShape(paddle,paddle.angle).points];
    return {paddle,shape:outline(points.flatMap(p=>[p[0],0,p[1]]))};
   });
   if(this.state==='playing'&&this.rail){this.advanceRail(dt);this.world.step(this.events);this.events.clear();continue}
   if(this.state==='playing'&&this.cave){this.advanceCave(dt);this.world.step(this.events);this.events.clear();continue}
   if(this.state==='playing'){this.limitSpeed();this.constrainToTable();if(this.state==='playing'){this.guideLauncher();this.clearPocketBlockers();this.clearCaveApproach(dt)}}
   if(this.state==='draining'){this.advanceDrain(dt);this.world.step(this.events);this.events.clear();continue}
   const previous={...this.ball.translation()},rotationBefore={...this.ball.rotation()},incoming={...this.ball.linvel()},recoveryBefore=this.recoveries;
   this.ballCollider.setCollisionGroups(this.ballMode==='floor'?0x00010001:0x00010007);
   let hit:{handle?:number;paddle?:Paddle;triangle?:string;time:number;normal:XYZ;position:XYZ}|null=null;
   if(this.state==='playing'&&this.ballMode==='floor'&&!this.falling){
    for(const [handle,shape] of this.bumperOutlines){const h=sweepCircle(shape,[previous.x,previous.y,previous.z],[incoming.x,0,incoming.z],this.manifest.ball_diameter/2,motionDt);if(h&&(!hit||h.time<hit.time))hit={handle,...h}}
    for(const {paddle,shape} of sweptPaddles){const h=sweepCircle(shape,[previous.x,previous.y,previous.z],[incoming.x,0,incoming.z],this.manifest.ball_diameter/2+.00004,motionDt);if(h&&(!hit||h.time<hit.time))hit={paddle,...h}}
    if(this.laneExited&&this.supportHeight(previous.x,previous.z)===this.floorY)for(const triangle of this.triangleBodies.values()){const h=sweepCircle(triangle.shape,[previous.x,previous.y,previous.z],[incoming.x,0,incoming.z],this.manifest.ball_diameter/2,motionDt);if(h&&(!hit||h.time<hit.time))hit={triangle:triangle.id,...h}}
    if(hit){const blocker=this.world.castShape(previous,this.ball.rotation(),incoming,new RAPIER.Ball(this.manifest.ball_diameter/2),.00003,hit.time,false,undefined,undefined,this.ballCollider,this.ball,c=>!this.bumpers.has(c.handle)&&!this.paddles.some(p=>c.parent()?.handle===p.body.handle));
     if(blocker&&-(incoming.x*blocker.normal1.x+incoming.y*blocker.normal1.y+incoming.z*blocker.normal1.z)>.001)hit=null}
   }
   this.world.step(this.events);
   const physicalEnd={...this.ball.translation()};
   if(this.tryEnterCave(previous,physicalEnd,incoming)){this.events.clear();continue}
   if(hit){
    const [x,y,z]=hit.position,[nx,,nz]=hit.normal,now=this.ball.translation();
    if((now.x-x)*nx+(now.z-z)*nz<.0001)this.ball.setTranslation({x:x+nx*.0001,y,z:z+nz*.0001},true);
    if(hit.handle!==undefined)this.applyBumper(hit.handle,hit.normal,incoming,previous);
    else if(hit.triangle){
     // The housing remains a passive barrier: lose normal speed on contact,
     // award once per genuine hit, and keep the strips' powered response.
     const v=this.ball.linvel(),inward=v.x*nx+v.z*nz;if(inward<0)this.ball.setLinvel({x:v.x-inward*nx*1.185,y:0,z:v.z-inward*nz*1.185},true);
     if(this.triangleContact(hit.triangle)){const out=this.ball.linvel();this.score+=TRIANGLE_SCORE;this.hits++;this.lastHit={id:hit.triangle,delta:TRIANGLE_SCORE,speedBefore:Math.hypot(incoming.x,incoming.z),speedAfter:Math.hypot(out.x,out.z),normal:hit.normal,rapidRebound:this.rapidRebound()};this.onHit?.(hit.triangle,TRIANGLE_SCORE)}
    }else this.applyPaddle(hit.paddle!,hit.normal,[x,y,z],incoming);
   }
   this.events.clear();
   if(this.state!=='playing')continue;
   this.clearPocketBlockers();
   if(this.ballMode==='floor'&&!this.falling){
    // A rotating tip can sweep into a resting sphere. Resolve this overlap using
    // the actual final paddle outline, even when the sphere had zero velocity.
    for(const paddle of this.paddles){const q=this.ball.translation(),p:XYZ=[q.x,q.y,q.z],overlap=overlapCircle(this.paddleShape(paddle,paddle.angle),p,this.manifest.ball_diameter/2);
     if(overlap){const n=overlap.normal;this.ball.setTranslation({x:p[0]+n[0]*(overlap.depth+.00005),y:p[1],z:p[2]+n[2]*(overlap.depth+.00005)},true);this.applyPaddle(paddle,n,p)}
    }
   }
   if(this.ballMode==='floor'&&!this.falling){
    for(const [handle,shape] of this.bumperOutlines){
     const q=this.ball.translation(),p:XYZ=[q.x,q.y,q.z],penetration=overlapCircle(shape,p,this.manifest.ball_diameter/2-.00001);
     if(penetration){const n=penetration.normal;this.ball.setTranslation({x:p[0]+n[0]*(penetration.depth+.00005),y:p[1],z:p[2]+n[2]*(penetration.depth+.00005)},true);this.applyBumper(handle,n,this.ball.linvel(),q)}
    }
   }
   this.limitSpeed();this.constrainToTable();
   if(this.state!=='playing')continue;
   if(this.ballMode==='floor'&&!this.falling&&this.recoveries===recoveryBefore){
    const dx=physicalEnd.x-previous.x,dz=physicalEnd.z-previous.z;
    // Roll over the actual solver movement, excluding overlap/recovery jumps.
    if(Math.hypot(dx,dz)<=Math.max(MAX_SPEED,this.time<this.launchBoostUntil?this.launchBoostSpeed:0)*motionDt+.0003)this.rollBall(dx,dz,rotationBefore);
   }
   const p=this.ball.translation(),s=this.manifest.scale;
   // The wider lane's exit moves horizontally. Detect departure from its
   // actual raised support rather than the old model's fixed rectangle.
   if(!this.laneExited&&this.exitDistance(p.x,p.z)>.00005&&p.z<-2*s&&this.supportHeight(p.x,p.z)!==this.laneY){
    // Release along the authored mouth tangent, preserving speed after wall bounces.
    const end=this.lanePoints.at(-1)!,before=this.lanePoints.at(-2)!,dx=end[0]-before[0],dz=end[2]-before[2],length=Math.hypot(dx,dz),exitVelocity=this.ball.linvel();
    if(exitVelocity.x*dx+exitVelocity.z*dz>0){const speed=Math.hypot(exitVelocity.x,exitVelocity.z);this.ball.setLinvel({x:dx/length*speed,y:exitVelocity.y,z:dz/length*speed},true)}
    this.laneExited=true;this.ball.resetForces(true);this.ball.setGravityScale(1,true);this.limitSpeed();
    // Keep spring power for the complete lane journey; soften only its first
    // exit at >=90% charge, never subsequent bumper/paddle contacts.
    if(this.launchCharge>=.9){const v=this.ball.linvel();this.ball.setLinvel({x:v.x*HIGH_CHARGE_EXIT_FACTOR,y:v.y*HIGH_CHARGE_EXIT_FACTOR,z:v.z*HIGH_CHARGE_EXIT_FACTOR},true)}
   }
   const returning=this.ballMode==='floor'&&Math.abs(p.x-this.spawn[0])<.65*s&&incoming.z>0;
   if(returning&&previous.z<=this.spawn[2]+.001&&p.z>=this.spawn[2]){this.catchAtSpring(incoming.z,p.x);return}
   // An actual fall below the opening takes priority over target/transport events.
   if(this.ballMode==='floor'&&this.falling&&p.y<.007){this.drain();return}
   // A recovery/projection jump is not a ball passage. Launcher shots also
   // cannot collect floor targets until they have really left the lane.
   const travel=Math.hypot(physicalEnd.x-previous.x,physicalEnd.y-previous.y,physicalEnd.z-previous.z);
   if(!this.falling&&this.laneExited&&this.recoveries===recoveryBefore&&travel<=Math.max(MAX_SPEED,this.time<this.launchBoostUntil?this.launchBoostSpeed:0)*motionDt+.0003)
    this.targets.passage([previous.x,previous.y,previous.z],[physicalEnd.x,physicalEnd.y,physicalEnd.z],this.ballMode,id=>this.collectTarget(id));
   if(this.pendingRail){this.enterRail();break}
  }
 }
 private paddleShape(paddle:Paddle,angle:number){
  const pivot=paddle.body.translation(),c=Math.cos(angle),s=Math.sin(angle);
  const points=paddle.local.points.map(([x,z])=>[pivot.x+x*c+z*s,pivot.z-x*s+z*c] as [number,number]);
  return {points,bounds:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]} as Outline;
 }
 private caveLocal(p:RAPIER.Vector):[number,number]{
  const m=this.manifest.cave!.matrix_inverse,s=this.manifest.scale,x=p.x/s,y=-p.z/s;
  return [m[0][0]*x+m[0][1]*y+m[0][3],m[1][0]*x+m[1][1]*y+m[1][3]];
 }
 private cavePoint(x:number,y:number,depth=0):XYZ{
  const m=this.manifest.cave!.root_matrix,s=this.manifest.scale,bx=(m[0][0]*x+m[0][1]*y+m[0][3])*s,bz=-(m[1][0]*x+m[1][1]*y+m[1][3])*s;
  return [bx,this.supportHeight(bx,bz)-depth,bz];
 }
 private tryEnterCave(previous:RAPIER.Vector,end:RAPIER.Vector,incoming:RAPIER.Vector){
  const def=this.manifest.cave;
  if(!def||this.state!=='playing'||!this.laneExited||this.ballMode!=='floor'||this.falling||this.cave)return false;
  const a=this.caveLocal(previous),b=this.caveLocal(end),r=this.manifest.ball_diameter/2/(def.world_scale*this.manifest.scale);
  if(!this.caveArmed){if(b[1]>def.approach_front+r+.04)this.caveArmed=true;return false}
  const direction=this.caveDirection(),inward=-(incoming.x*direction[0]+incoming.z*direction[2]);
  // Engage at the sphere's leading edge, before the lip's CCD contact can stop it.
  const gate=Math.max(def.entry_plane,def.approach_front+r+.06);
  if(inward<=.001||Math.min(a[1],b[1])>gate||b[1]<def.hold_local)return false;
  const t=a[1]>gate&&b[1]<a[1]?(a[1]-gate)/(a[1]-b[1]):1,x=a[0]+(b[0]-a[0])*t;
  if(Math.abs(x)>def.capture_half_width_local)return false;
  const speed=Math.hypot(incoming.x,incoming.z);if(speed<.001)return false;
  this.cave={phase:'entering',elapsed:0,entrySpeed:speed,from:b,distance:def.hold_local};this.caveArmed=false;this.caveEntries++;
  this.launchBoostUntil=-Infinity;this.resetRebounds();this.ball.resetForces(true);this.ball.setEnabledTranslations(true,true,true,true);this.tableLocked=false;
  this.ballCollider.setEnabled(false);this.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
  this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);this.placeRail(this.cavePoint(...b));
  this.score+=CAVE_SCORE;this.hits++;this.lastHit={id:'cave',delta:CAVE_SCORE,speedBefore:speed,speedAfter:CAVE_RELEASE_SPEED,normal:direction,rapidRebound:false};this.onHit?.('cave',CAVE_SCORE);
  return true;
 }
 private caveDirection():XYZ{const m=this.manifest.cave!.root_matrix,n=Math.hypot(m[0][1],m[1][1]);return [m[0][1]/n,0,-m[1][1]/n]}
 private clearCaveApproach(dt:number){
  const def=this.manifest.cave;if(!def||!this.laneExited||this.ballMode!=='floor'||this.falling||this.cave){this.caveRestTime=0;return}
  // A sphere constrained to the floor cannot climb the sloped decorative cheek.
  // Resolve its whole footprint, including old overlaps, instead of letting
  // opposing triangle normals hold the ball inside the side housing.
  const radius=this.manifest.ball_diameter/2,margin=.00035;
  const rebound=(normal:XYZ,depth:number)=>{
   const q=this.ball.translation(),v=this.ball.linvel(),inward=v.x*normal[0]+v.z*normal[2];
   if(depth>0)this.ball.setTranslation({x:q.x+normal[0]*(depth+.00005),y:q.y,z:q.z+normal[2]*(depth+.00005)},true);
   // Keep tangential motion. A tiny outward component clears resting contact;
   // already separating balls receive no repeated kick or scoring event.
   if(inward<.045){const outward=Math.max(.045,-inward*.18),change=outward-inward;this.ball.setLinvel({x:v.x+normal[0]*change,y:0,z:v.z+normal[2]*change},true)}
  };
  for(const cheek of this.caveCheeks){const q=this.ball.translation(),hit=overlapCircle(cheek,[q.x,q.y,q.z],radius+margin);if(hit)rebound(hit.normal,Math.max(0,hit.depth-margin))}
  // Use actual wall triangles for the enclosed hood; its convex footprint would
  // incorrectly fill the open entrance and the inner corridor.
  for(const tri of this.caveWalls){const q=this.ball.translation(),point=closestTriangle([q.x,q.y,q.z],tri[0],tri[1],tri[2]),dx=q.x-point[0],dy=q.y-point[1],dz=q.z-point[2],distance=Math.hypot(dx,dy,dz),horizontal=Math.hypot(dx,dz);
   if(distance>radius+margin||horizontal<radius*.65)continue;
   rebound([dx/horizontal,0,dz/horizontal],Math.max(0,radius-distance));
  }
  const p=this.caveLocal(this.ball.translation()),v=this.ball.linvel();
  if(p[1]<def.hold_local||p[1]>def.approach_front+.65||Math.abs(p[0])>.95||Math.hypot(v.x,v.z)>.025){this.caveRestTime=0;return}
  this.caveRestTime+=dt;if(this.caveRestTime<.3)return;
  // Clear the outside of each cheek away from its solid side, toward the open lip.
  // This is a local recovery, with no points or extra cave activation.
  const d=this.caveDirection(),m=def.root_matrix,side=Math.sign(p[0]),n=Math.hypot(m[0][0],m[1][0]);
  this.ball.setLinvel({x:d[0]*.12+side*m[0][0]/n*.10,y:0,z:d[2]*.12-side*m[1][0]/n*.10},true);this.caveRestTime=0;
 }
 private advanceCave(dt:number){
  const cave=this.cave!,def=this.manifest.cave!,drop=this.manifest.ball_diameter*1.25;cave.elapsed+=dt;
  if(cave.phase==='entering'){
   // Roll through the mouth before dropping fully out of sight inside the hood.
   const t=Math.min(1,cave.elapsed/.32),u=t*t*(3-2*t),fall=Math.max(0,(t-.55)/.45);
   this.placeRail(this.cavePoint(cave.from[0]*(1-u),cave.from[1]+(def.hold_local-cave.from[1])*u,drop*fall*fall*(3-2*fall)));
   if(t===1){cave.phase='charging';cave.elapsed=0}return;
  }
  if(cave.phase==='charging'){
   this.placeRail(this.cavePoint(0,def.hold_local,drop));this.ball.setAngvel({x:0,y:0,z:0},true);
   if(cave.elapsed>=CAVE_CHARGE_SECONDS){cave.phase='ejecting';cave.elapsed=0}return;
  }
  const speed=CAVE_RELEASE_SPEED,s=this.manifest.scale,r=this.manifest.ball_diameter/2/(def.world_scale*s),end=def.approach_front+r+.06;
  cave.distance=Math.min(end,cave.distance+speed*dt*BALL_MOTION_RATE/(def.world_scale*s));
  const rise=Math.min(1,(cave.distance-def.hold_local)/Math.max(r,def.entry_plane-r-def.hold_local));
  this.placeRail(this.cavePoint(0,cave.distance,drop*(1-rise*rise*(3-2*rise))));
  if(cave.distance<end)return;
  this.cave=null;this.launchBoostSpeed=speed;this.launchBoostUntil=this.time+.5;this.ballCollider.setEnabled(true);
  this.ball.setBodyType(RAPIER.RigidBodyType.Dynamic,true);this.ball.setEnabledTranslations(true,true,true,true);this.tableLocked=false;this.ball.setGravityScale(1,true);
  const direction=this.caveDirection();this.ball.setLinvel({x:direction[0]*speed,y:0,z:direction[2]*speed},true);this.constrainToTable();
 }
 private exitDistance(x:number,z:number){const end=this.lanePoints.at(-1)!,before=this.lanePoints.at(-2)!,dx=end[0]-before[0],dz=end[2]-before[2];return((x-end[0])*dx+(z-end[2])*dz)/Math.hypot(dx,dz)}
 private guideLauncher(){
  this.ball.resetForces(true);
  if(this.laneExited||this.ballMode!=='floor'||this.falling){this.ball.setGravityScale(1,true);return}
  const p=this.ball.translation(),v=this.ball.linvel();let nearest=Infinity,index=0,tangent:XYZ=[0,0,-1];
  for(let i=1;i<this.lanePoints.length;i++){const a=this.lanePoints[i-1],b=this.lanePoints[i],dx=b[0]-a[0],dz=b[2]-a[2],l2=dx*dx+dz*dz;if(!l2)continue;const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[2])*dz)/l2)),distance=(p.x-a[0]-dx*t)**2+(p.z-a[2]-dz*t)**2;if(distance<nearest){nearest=distance;index=i;const length=Math.sqrt(l2);tangent=[dx/length,0,dz/length]}}
  if(nearest>(this.manifest.launcher_route.width_metres/2+this.manifest.ball_diameter/2)**2){this.ball.setGravityScale(1,true);return}
  const gravity=this.world.gravity;let downhill=gravity.x*tangent[0]+gravity.z*tangent[2];
  // At a nearly horizontal crest, provide a tiny fall-line grade. It changes
  // acceleration, never position or speed directly.
  if(Math.hypot(gravity.x,gravity.z)>.01&&Math.abs(downhill)<.06&&Math.hypot(v.x,v.z)<.12)downhill=index<this.laneCrest?-.06:.06;
  this.ball.setGravityScale(0,true);const mass=this.ball.mass();this.ball.addForce({x:downhill*tangent[0]*mass,y:gravity.y*mass,z:downhill*tangent[2]*mass},true);
 }
 private applyPaddle(paddle:Paddle,normal:XYZ,p:XYZ,incoming?:RAPIER.Vector){
  this.launchBoostUntil=-Infinity;
  const pivot=paddle.body.translation(),surface:XYZ=[paddle.omega*(p[2]-pivot.z),0,-paddle.omega*(p[0]-pivot.x)],v=incoming??this.ball.linvel();
  const inward=-((v.x-surface[0])*normal[0]+(v.z-surface[2])*normal[2]);if(inward<=.001)return;
  // An engaged upper face also kicks a ball arriving from the lower guide.
  // Released paddles remain passive; use the pre-solver velocity for CCD hits.
  const powered=surface[0]*normal[0]+surface[2]*normal[2]>.001||paddle.held&&normal[2]<-.15;
  const heldStrike=paddle.held&&Math.abs(paddle.omega)<.001&&normal[2]<-.15;
  const repeated=this.noteRebound(paddle.id),factor=powered&&!repeated?COLLISION_SPEED_MULTIPLIER*(this.rapidRebound()?RAPID_REBOUND_LOSS:1):1;
  const impulse=inward*(powered?1.65:1+PADDLE_RESTITUTION)*(powered&&!repeated?(heldStrike?HELD_PADDLE_PUSH_MULTIPLIER:PADDLE_PUSH_MULTIPLIER):1);
  let x=(v.x+normal[0]*impulse)*factor,z=(v.z+normal[2]*impulse)*factor;
  if(powered&&!repeated){
   // Retain a controlled stroke through the uphill flight, until another obstacle
   // absorbs it. A gentle incoming ball must still get a useful powered hit.
   const speed=Math.hypot(x,z),outgoing=Math.min(HELD_PADDLE_MAX_SPEED,Math.max(1.35,speed));
   if(speed>0){x*=outgoing/speed;z*=outgoing/speed}
   this.launchBoostSpeed=outgoing;this.launchBoostUntil=this.time+2;
  }
  this.ball.setLinvel({x,y:0,z},true);this.limitSpeed();
 }
 private resetRebounds(){this.lastReboundTime=-Infinity;this.rapidReboundUntil=-Infinity;this.reboundTicks.clear()}
 private triangleContact(id:string){if(this.time-(this.lastTriangleHit.get(id)??-Infinity)<.08)return false;this.lastTriangleHit.set(id,this.time);return true}
 private rapidRebound(){return this.ballMode==='floor'&&this.laneExited&&this.time<this.rapidReboundUntil}
 private noteRebound(key:number|string){
  if(this.ballMode!=='floor'||!this.laneExited)return false;
  // CCD and overlap correction can resolve the same impact more than once.
  // Count an object only once per tick and never power its duplicate response.
  if(this.reboundTicks.get(key)===this.time)return true;
  this.reboundTicks.set(key,this.time);
  if(this.time-this.lastReboundTime<=RAPID_REBOUND_WINDOW)this.rapidReboundUntil=this.time+RAPID_REBOUND_SETTLE;
  this.lastReboundTime=this.time;return false;
 }
 private limitSpeed(){
  const v=this.ball.linvel(),speed=Math.hypot(v.x,v.y,v.z),ordinary=this.rapidRebound()?RAPID_REBOUND_CAP:this.laneExited?FLOOR_MAX_SPEED:MAX_SPEED,cap=this.time<this.launchBoostUntil?Math.max(ordinary,this.launchBoostSpeed):ordinary;
  if(speed>cap)this.ball.setLinvel({x:v.x*cap/speed,y:v.y*cap/speed,z:v.z*cap/speed},true);
 }
 private drain(){
  if(this.state!=='playing'&&this.state!=='draining')return;
  this.cave=null;this.launchBoostUntil=-Infinity;this.drainTransfer=null;this.pendingRail=false;this.pendingFloorReturn=false;this.rail=null;
  // Stop the lost ball now. The reset delay is a camera transition, not extra
  // unbounded simulation of a body with its collider disabled.
  const p=this.ball.translation();this.ball.setBodyType(RAPIER.RigidBodyType.Fixed,true);
  this.ball.setNextKinematicTranslation(p);this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);
  this.ballCollider.setEnabled(false);this.ball.setAdditionalMass(0,true);
  this.lives--;this.drains++;this.charge=0;this.springCompression=0;this.spaceMustRelease=true;this.lastBump.clear();this.touching.clear();
  if(this.lives===0)this.state='finished';
  else{this.state='resetting';this.resetTimer=1.2}
 }
 private collectTarget(id:string){
  this.score+=this.targets.definitions.find(d=>d.id===id)!.score;this.targetPasses++;this.onTarget?.(id);
  if(!this.rail&&!this.pendingRail){this.railCollected++;if(this.railCollected>this.railRequired)this.pendingRail=true}
 }
 private enterRail(fraction?:number){
  // Explicit fractions are diagnostic fixtures; automatic transport must be earned.
  if(fraction===undefined&&(!this.pendingRail||this.railCollected<=this.railRequired||this.ballMode!=='floor'||!this.laneExited||this.state!=='playing'))return;
  const source=this.pose().position,route=this.manifest.rail_route;this.resetRebounds();
  fraction??=route.entry_fractions[Math.floor(this.random()*route.entry_fractions.length)];
  this.pendingFloorReturn=false;this.rail=new RailTravel(route,fraction);this.pendingRail=false;this.railTrips++;this.ballMode='rail';this.falling=false;this.tableLocked=false;this.lastBump.clear();this.touching.clear();
  this.ballCollider.setEnabled(false);this.ball.setAdditionalMass(0,true);this.ball.setEnabledTranslations(true,true,true,true);this.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
  this.placeRail(this.rail.sample().position);this.transportGeneration++;this.onTransport?.(source);
 }
 private rollBall(dx:number,dz:number,q=this.ball.rotation()){
  const length=Math.hypot(dx,dz),r=this.manifest.ball_diameter/2;
  if(length<=1e-12||length>=.03){this.ball.setRotation(q,true);return}
  const angle=length/r/2,s=Math.sin(angle),ax=dz/length*s,az=-dx/length*s,c=Math.cos(angle);
  this.ball.setRotation({x:c*q.x+ax*q.w-az*q.y,y:c*q.y+az*q.x-ax*q.z,z:c*q.z+az*q.w+ax*q.y,w:c*q.w-ax*q.x-az*q.z},true);
 }
 private placeRail(p:XYZ){
  const old=this.ball.translation();this.rollBall(p[0]-old.x,p[2]-old.z);
  this.ball.setTranslation({x:p[0],y:p[1],z:p[2]},true);this.ball.setNextKinematicTranslation({x:p[0],y:p[1],z:p[2]});this.ball.setLinvel({x:0,y:0,z:0},true);
 }
 private advanceRail(dt:number){
  if(this.pendingFloorReturn){this.returnToFloor();return}
  const rail=this.rail!,p=this.ball.translation(),old:XYZ=[p.x,p.y,p.z];
  const g=this.world.gravity,pose=rail.advance(dt,[g.x,g.y,g.z]);this.placeRail(pose.position);
  // Only genuine motion on this rail participates in rail target passages.
  this.targets.passage(old,pose.position,'rail',id=>this.collectTarget(id));
  if(rail.arrivalSeconds===null)return;
  if(rail.arrivalSeconds<this.manifest.rail_route.exit_threshold_seconds){this.pendingFloorReturn=true;this.returnToFloor();return}
  const r=this.manifest.ball_diameter/2;
  for(const tri of this.manifest.rail_route.exit_contact_triangles){
   const q=closestTriangle(pose.position,...tri),d=Math.hypot(...pose.position.map((v,i)=>v-q[i]));
   if(d>r+.00002||d<1e-12)continue;
   const normal=pose.position.map((v,i)=>(v-q[i])/d) as XYZ;
   const velocity=pose.tangent.map(v=>v*rail.speed) as XYZ;
   if(velocity.reduce((sum,v,i)=>sum+v*normal[i],0)>=0)continue;
   const handle=[...this.bumpers].find(([,o])=>o.id===this.manifest.rail_route.exit_cyan_bumper_id)![0];
   this.applyBumper(handle,normal,{x:velocity[0],y:velocity[1],z:velocity[2]},{x:pose.position[0],y:pose.position[1],z:pose.position[2]});
   this.pendingFloorReturn=true;this.returnToFloor();return;
  }
  // A moved bumper can leave the rail end uncovered. Drop once the ball clears
  // the end rather than extrapolating the final rail segment forever.
  if(rail.distance>=rail.length+this.manifest.ball_diameter){this.pendingFloorReturn=true;this.returnToFloor()}
 }
 private returnToFloor(){
  const r=this.manifest.ball_diameter/2;
  let destination:XYZ|undefined;
  // Sample the modeled floor faces independently of the restricted letter spots.
  for(let trial=0;trial<600&&!destination;trial++){
   const tri=this.floorTriangles[Math.floor(this.random()*this.floorTriangles.length)],u=Math.sqrt(this.random()),v=this.random();
   const p:XYZ=[(1-u)*tri[0][0]+u*(1-v)*tri[1][0]+u*v*tri[2][0],this.floorY,(1-u)*tri[0][2]+u*(1-v)*tri[1][2]+u*v*tri[2][2]];
   if(p[2]>1*this.manifest.scale||this.supportHeight(p[0],p[2])!==this.floorY)continue;
   if(this.pocketBlockers.some(shape=>overlapCircle(shape,p,r+.002)))continue;
   if([...this.bumperOutlines.values()].some(shape=>overlapCircle(shape,p,r+.002)))continue;
   if(this.paddles.some(paddle=>overlapCircle(this.paddleShape(paddle,paddle.angle),p,r+.002)))continue;
   if(this.targets.poses.some(t=>{const d=this.targets.definitions.find(d=>d.id===t.id)!;return p.every((v,i)=>v>=t.position[i]+d.bounds_local[0][i]-r-.002&&v<=t.position[i]+d.bounds_local[1][i]+r+.002)}))continue;
   if(this.blockedFloorReturn(p,r+.002))continue;
   destination=p;
  }
  if(!destination){this.placeRail(this.rail!.sample(this.rail!.length).position);return}
  const source=this.pose().position;this.resetRebounds();
  this.pendingFloorReturn=false;this.rail=null;this.ballMode='floor';this.ballCollider.setEnabled(true);this.ball.setBodyType(RAPIER.RigidBodyType.Dynamic,true);this.ball.setTranslation({x:destination[0],y:destination[1],z:destination[2]},true);
  this.ball.setLinvel({x:(this.random()-.5)*.12,y:0,z:.12},true);this.ball.setAngvel({x:0,y:0,z:0},true);this.laneExited=true;this.tableLocked=false;this.falling=false;this.railCollected=0;this.railRequired=3+Math.floor(this.random()*3);this.lastBump.clear();this.touching.clear();this.constrainToTable();this.transportGeneration++;this.onTransport?.(source);
 }
 private applyBumper(handle:number,normal:XYZ,incoming:RAPIER.Vector,previous:RAPIER.Vector){
  this.launchBoostUntil=-Infinity;
  const obstacle=this.bumpers.get(handle)!;
  if(obstacle.role==='drum_base_bumper'&&(this.ballMode!=='floor'||Math.abs(normal[1])>.5||previous.y>.65*this.manifest.scale))return;
  if(this.ballMode==='floor'){const length=Math.hypot(normal[0],normal[2]);if(length<.00001)return;normal=[normal[0]/length,0,normal[2]/length]}
  const [nx,ny,nz]=normal,inward=-(incoming.x*nx+incoming.y*ny+incoming.z*nz);if(inward<=.001)return;
  // Always resolve a physical impact; debounce applies only to score, sound and glow.
  const repeated=this.noteRebound(handle),rapidRebound=this.rapidRebound();
  const v=this.ball.linvel(),outward=v.x*nx+v.y*ny+v.z*nz,extra=Math.max(0,Math.max(.12,inward*.85)-outward);
  let x=v.x+nx*extra,y=v.y+ny*extra,z=v.z+nz*extra;
  // Boost each genuine floor response by 10%, then enforce its speed cap.
  // Duplicate correction and the rail endpoint never receive another boost.
  const speedBefore=Math.hypot(incoming.x,incoming.y,incoming.z),cap=rapidRebound?RAPID_REBOUND_CAP:this.laneExited?FLOOR_MAX_SPEED:MAX_SPEED;
  const ordinary=Math.min(cap,speedBefore+Math.max(0,Math.min(cap,Math.max(Math.hypot(x,y,z),speedBefore*1.015+.015))-speedBefore)*BUMPER_SPEED_GAIN_FACTOR);
  const boost=this.ballMode==='floor'?COLLISION_SPEED_MULTIPLIER:1;
  let target=repeated?Math.min(cap,speedBefore):Math.min(cap,(rapidRebound?speedBefore*RAPID_REBOUND_LOSS:ordinary)*boost);
  const length=Math.hypot(x,y,z);
  if(length>.00001){
   x*=target/length;y*=target/length;z*=target/length;
   if(this.ballMode==='floor'&&!repeated){
    // Strengthen only the outward contact response. Burst damping still owns
    // its original speed budget, and every response keeps the existing cap.
    const kick=Math.max(0,x*nx+y*ny+z*nz)*(BUMPER_REBOUND_MULTIPLIER-1),budget=rapidRebound?target:cap;
    x+=nx*kick;y+=ny*kick;z+=nz*kick;
    const speed=Math.hypot(x,y,z);target=Math.min(budget,speed);
    if(speed>budget){x*=budget/speed;y*=budget/speed;z*=budget/speed}
   }
   // Soften each genuine bumper rebound once, including capped fast impacts.
   if(!repeated){const impact=BUMPER_IMPACT_MULTIPLIER*(obstacle.role==='drum_base_bumper'?DRUM_IMPACT_MULTIPLIER:1)*(obstacle.id==='post_08'?CAVE_POST_REBOUND_MULTIPLIER:1);x*=impact;y*=impact;z*=impact;target*=impact}
   this.ball.setLinvel({x,y,z},true);
  }
  const ring=obstacle.id.startsWith('ring_');
  if(ring){if(this.touching.has(handle))return;this.touching.add(handle)}
  else if(this.time-(this.lastBump.get(handle)??-Infinity)<.08)return;
  if(obstacle.id.startsWith('bumper_neutral_')&&!this.triangleContact(obstacle.id.includes('_left_')?'triangle_left':'triangle_right'))return;
  const delta=ring?RING_SCORE:obstacle.score_delta;
  this.lastBump.set(handle,this.time);this.score+=delta;this.hits++;this.lastHit={id:obstacle.id,delta,speedBefore,speedAfter:target,normal,rapidRebound};this.onHit?.(obstacle.id,delta);
 }
 private blockedFloorReturn(p:XYZ,r:number){
  const size=this.manifest.ball_diameter*2,x0=Math.floor((p[0]-r)/size),x1=Math.floor((p[0]+r)/size),z0=Math.floor((p[2]-r)/size),z1=Math.floor((p[2]+r)/size);
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const tri of this.barrierCells.get(x+','+z)||[]){
   if([0,1,2].some(i=>p[i]<Math.min(...tri.map(v=>v[i]))-r||p[i]>Math.max(...tri.map(v=>v[i]))+r))continue;
   const q=closestTriangle(p,...tri as [XYZ,XYZ,XYZ]);if(Math.hypot(...p.map((v,i)=>v-q[i]))<r)return true;
  }
  return false;
 }
 private catchAtSpring(speed:number,x:number){
  this.state='spring_return';this.springReturnTime=0;this.springReturnPeak=Math.min(.18,Math.max(.05,speed*.15));this.springReturnX=x;
  this.charge=0;this.springCompression=0;this.spaceMustRelease=true;this.laneExited=false;this.falling=false;this.tableLocked=false;this.touching.clear();
  this.ball.setEnabledTranslations(true,true,true,true);this.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
  this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);
  this.ball.setTranslation({x,y:this.spawn[1],z:this.spawn[2]},true);this.ball.setNextKinematicTranslation({x,y:this.spawn[1],z:this.spawn[2]});
 }
 private constrainToTable(){
  const p=this.ball.translation(),s=this.manifest.scale;
  // The bottom opening still allows a real fall. Only rail mode permits elevated travel.
  const bed=this.manifest.static_collision_objects.find(o=>o.source_name==='Playfield | dark purple metal bed')!,r=this.manifest.ball_diameter/2;
  const inScene=[p.x,p.y,p.z].every(Number.isFinite)&&p.x>this.sceneMinX&&p.x<this.sceneMaxX&&p.z>-bed.world_bounds[1][1]*s-r&&p.z<this.drainZ+s+r;
  if(this.ballMode==='floor'&&!this.falling&&!inScene){
   const [x,y,z]=this.lastSupported;this.ball.setTranslation({x,y,z},true);this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);this.recoveries++;return;
  }
  if(this.ballMode==='floor'&&!this.falling&&Math.abs(p.x)<this.collectorWidth&&p.z>this.drainZ){
   this.beginDrain();return;
  }
  if(this.ballMode==='floor'&&!this.falling&&p.z<=this.drainZ)this.lastSupported=[p.x,this.laneExited?this.supportHeight(p.x,p.z):this.laneY,p.z];
  // Once inside the drain sensor, decorative recess/rim meshes cannot catch the ball.
  if(this.ballCollider.isEnabled()===this.falling){this.ballCollider.setEnabled(!this.falling);this.ball.setAdditionalMass(this.falling?.08:0,true)}
  const rolling=this.ballMode==='floor'&&!this.falling;
  if(rolling!==this.tableLocked){this.ball.setEnabledTranslations(true,!rolling,true,true);this.tableLocked=rolling}
  if(!rolling)return;
  const v=this.ball.linvel(),y=this.laneExited?this.supportHeight(p.x,p.z):this.laneY;
  this.ball.setLinearDamping(y===this.laneY?0:.025);this.ball.setAngularDamping(y===this.laneY?0:.12);
  this.ball.setTranslation({x:p.x,y,z:p.z},true);this.ball.setLinvel({x:v.x,y:0,z:v.z},true);
  if(!this.laneExited||y===this.laneY)this.keepInsideLauncher();
  // A sphere constrained to its support plane still rolls, including after a rebound.
  const rollingVelocity=this.ball.linvel();this.ball.setAngvel({x:rollingVelocity.z/r,y:0,z:-rollingVelocity.x/r},true);
 }
 private keepInsideLauncher(){
  const p=this.ball.translation(),edges=this.manifest.launcher_route.edges,r=this.manifest.ball_diameter/2+.0001;
  // Only the raised lane is guarded. Its mouth stays open to normal floor play.
  let nearest=Infinity,index=0;
  for(let i=1;i<this.lanePoints.length;i++){const a=this.lanePoints[i-1],b=this.lanePoints[i],x=b[0]-a[0],z=b[2]-a[2],t=Math.max(0,Math.min(1,((p.x-a[0])*x+(p.z-a[2])*z)/(x*x+z*z))),d=(p.x-a[0]-x*t)**2+(p.z-a[2]-z*t)**2;if(d<nearest){nearest=d;index=i}}
  if(nearest>(this.manifest.launcher_route.width_metres/2+r)**2||index===this.lanePoints.length-1&&this.exitDistance(p.x,p.z)>0)return;
  let x=p.x,z=p.z;const v=this.ball.linvel();let vx=v.x,vz=v.z,corrected=false;
  // Resolve the whole circle against the authored wall faces, including curved
  // joints. Reflect the normal component elastically; wall contacts preserve speed.
  for(let pass=0;pass<2;pass++)for(const edge of edges){
   let distance2=Infinity,dx=0,dz=0,nx=0,nz=0;
   for(let i=1;i<edge.length;i++){const a=edge[i-1],b=edge[i],ex=b[0]-a[0],ez=b[2]-a[2],length2=ex*ex+ez*ez;if(!length2)continue;
    const t=Math.max(0,Math.min(1,((x-a[0])*ex+(z-a[2])*ez)/length2)),qx=x-a[0]-ex*t,qz=z-a[2]-ez*t,d2=qx*qx+qz*qz;
    if(d2<distance2){distance2=d2;dx=qx;dz=qz;nx=-ez;nz=ex;const centre=this.lanePoints[i];if((centre[0]-b[0])*nx+(centre[2]-b[2])*nz<0){nx=-nx;nz=-nz}}
   }
   const d=Math.sqrt(distance2),length=Math.hypot(nx,nz);nx/=length;nz/=length;
   const side=dx*nx+dz*nz;if(side>=0&&d>=r)continue;
   const depth=side<0?r-side:r-d;if(side>=0&&d>1e-12){nx=dx/d;nz=dz/d}
   x+=nx*depth;z+=nz*depth;const inward=vx*nx+vz*nz;if(inward<0){vx-=2*inward*nx;vz-=2*inward*nz}corrected=true;
  }
  if(corrected){this.ball.setTranslation({x,y:this.laneY,z},true);this.ball.setLinvel({x:vx,y:0,z:vz},true)}
 }
 private beginDrain(){
  const p=this.ball.translation(),drain=this.manifest.entities.find(e=>e.game_id==='drain_main')!.anchor_world,s=this.manifest.scale;
  const distance=Math.hypot(p.x-drain[0]*s,p.z+drain[1]*s);
  this.drainTransfer={from:[p.x,p.y,p.z],elapsed:0,duration:Math.max(.12,distance/.20)};
  this.state='draining';this.falling=false;this.tableLocked=false;this.pendingRail=false;
  this.ballCollider.setEnabled(false);this.ball.setAdditionalMass(0,true);this.ball.setEnabledTranslations(true,true,true,true);
  this.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);this.ball.setNextKinematicTranslation(p);
  this.ball.setLinvel({x:0,y:0,z:0},true);this.ball.setAngvel({x:0,y:0,z:0},true);
 }
 private advanceDrain(dt:number){
  if(this.drainTransfer){
   const transfer=this.drainTransfer;transfer.elapsed+=dt*BALL_MOTION_RATE;const u=Math.min(1,transfer.elapsed/transfer.duration);
   const drain=this.manifest.entities.find(e=>e.game_id==='drain_main')!.anchor_world,s=this.manifest.scale,from=transfer.from;
   this.placeRail([from[0]+(drain[0]*s-from[0])*u,this.floorY,from[2]+(-drain[1]*s-from[2])*u]);
   if(u===1){this.drainTransfer=null;this.falling=true;this.ball.setBodyType(RAPIER.RigidBodyType.Dynamic,true);this.ball.setAdditionalMass(.08,true);this.ball.setLinvel({x:0,y:0,z:0},true)}
  }else if(this.falling&&this.ball.translation().y<.007)this.drain();
 }
 private clearPocketBlockers(){
  // A launch-lane ball can brush the back of a wedge through the thin wall.
  // Only playfield balls should be cleared through its open face.
  if(!this.laneExited||this.ballMode!=='floor'||this.falling)return;
  const supported=this.ball.translation();if(this.supportHeight(supported.x,supported.z)>this.floorY+.0001)return;
  for(const shape of this.pocketBlockers){const p=this.ball.translation(),r=this.manifest.ball_diameter/2,isPost=shape.id==='left_lane_post_pocket'||!!shape.rebound,overlap=overlapCircle(shape,[p.x,p.y,p.z],r);
   // Rapier holds a touching ball outside the mesh, so overlap alone misses the
   // real resting contact. A 0.35 mm contact margin covers that solver gap.
   // Re-arm after leaving the pocket; repeated resting contacts cannot keep
   // kicking the ball back toward the wall.
   if(isPost&&!overlapCircle(shape,[p.x,p.y,p.z],r+.012))this.postPocketRebounds.delete(shape.id);
   if(!overlap&&!(isPost&&overlapCircle(shape,[p.x,p.y,p.z],r+.00035)))continue;
   // Recover old/injected wedge overlaps through its beveled open face, so the
   // nearest side cannot push a ball behind the decorative playfield border.
   const [a,b]=shape.exit,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),n:XYZ=[-dz/length,0,dx/length];
   const distance=(p.x-a[0])*n[0]+(p.z-a[2])*n[2],depth=this.manifest.ball_diameter/2-distance;
   // A shallow touch must leave through its closest face. Using the distant
   // open face on a back-side contact pushed inward and doubled each correction.
   const shallow=overlap&&overlap.depth<=r+.00001,contact=shallow?overlap.normal:n;
   const v=this.ball.linvel(),inward=v.x*contact[0]+v.z*contact[2];
   if(overlap){const correction=(shallow?overlap.depth:Math.max(0,depth))+.00005;this.ball.setTranslation({x:p.x+contact[0]*correction,y:p.y,z:p.z+contact[2]*correction},true)}
   if(inward<0)this.ball.setLinvel({x:v.x-inward*contact[0]*1.12,y:0,z:v.z-inward*contact[2]*1.12},true);
   if(isPost&&inward<.03&&!this.postPocketRebounds.has(shape.id)){
    // Give each post guide one gentle diagonal rebound per visit. The right
    // guide points lower-left; both use 0.10 m/s and add no bumper event.
    const x=shape.rebound?.[0]??dx/length+n[0]*.65,z=shape.rebound?.[2]??dz/length+n[2]*.65,d=Math.hypot(x,z);
    this.ball.setLinvel({x:x/d*.10,y:0,z:z/d*.10},true);this.postPocketRebounds.add(shape.id);
   }
  }
 }
 private supportHeight(x:number,z:number){
  for(const support of this.manifest.additional_supports||[]){
   const m=support.matrix_inverse,s=this.manifest.scale,bx=x/s,by=-z/s;
   const u=m[0][0]*bx+m[0][1]*by+m[0][3],v=m[1][0]*bx+m[1][1]*by+m[1][3];
   if(Math.abs(u)<=support.width/2&&v>=support.rear&&v<=support.front){
    const t=Math.max(0,(v-support.flat_end)/(support.front-support.flat_end));return this.floorY+(support.height*(1-t)+support.lip*t)*s;
   }
  }
  const distance=this.exitDistance(x,z),end=this.lanePoints.at(-1)!,mouth=this.manifest.launcher_route.width_metres;
  if(distance>0&&distance<this.manifest.ball_diameter*1.5&&Math.hypot(x-end[0],z-end[2])<mouth){const u=distance/(this.manifest.ball_diameter*1.5);return this.laneY+(this.floorY-this.laneY)*u*u*(3-2*u)}
  // Read the raised lane footprint from the exported faces, including later re-entry.
  for(let i=0;i<this.laneSurface.length;i+=3){const a=this.laneSurface[i],b=this.laneSurface[i+1],c=this.laneSurface[i+2];
   const u=(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]),v=(c[0]-b[0])*(z-b[1])-(c[1]-b[1])*(x-b[0]),w=(a[0]-c[0])*(z-c[1])-(a[1]-c[1])*(x-c[0]);
   if((u>=-1e-10&&v>=-1e-10&&w>=-1e-10)||(u<=1e-10&&v<=1e-10&&w<=1e-10))return this.laneY;
  }
  return this.floorY;
 }
 pose(){const p=this.ball.translation();return{position:[p.x,p.y,p.z] as XYZ,rotation:this.ball.rotation(),paddles:this.paddles.map(p=>({id:p.id,angle:p.angle})),state:this.state,lives:this.lives,charge:this.charge,springCompression:this.springCompression,score:this.score,hits:this.hits,lastHit:this.lastHit,paused:this.paused,launches:this.launches,drains:this.drains,laneExited:this.laneExited,targetPasses:this.targetPasses,ballVisible:this.state!=='resetting'&&this.state!=='finished'&&this.cave?.phase!=='charging',recoveries:this.recoveries,ballMode:this.ballMode,caveEntries:this.caveEntries,cave:this.cave?{phase:this.cave.phase,progress:this.cave.phase==='charging'?Math.min(1,this.cave.elapsed/CAVE_CHARGE_SECONDS):0,entrySpeed:this.cave.entrySpeed}:null,railCollected:this.railCollected,railRequired:this.railRequired,railTrips:this.railTrips,rail:this.rail?{distance:this.rail.distance,length:this.rail.length,elapsed:this.rail.elapsed,arrivalSeconds:this.rail.arrivalSeconds}:null,transportGeneration:this.transportGeneration,targets:this.targets.poses.map(t=>({...t,position:[...t.position] as XYZ}))}}
 dispose(){this.events.free();this.world.free()}
}
