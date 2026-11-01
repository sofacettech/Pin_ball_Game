import test from 'node:test';
import assert from 'node:assert/strict';
import {createEntranceResolution,entranceResolutionBounds} from '../entrance-source/entrance-resolution.mjs';
function fixture(maxPixelRatio=3,minPixelRatio=2.75){
 let time=0,id=0;const frames=new Map(),changes=[];
 const quality=createEntranceResolution({maxPixelRatio,minPixelRatio,onChange:value=>changes.push(value),now:()=>time,requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:id=>frames.delete(id)});
 function step(ms,moving=true){time+=ms;if(moving)quality.motion();const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));}
 function run(hz,seconds,moving=true){for(let i=0;i<hz*seconds;i++)step(1000/hz,moving);}
 return{quality,changes,step,run,frames};
}
test('start sharp and retain full detail at 30fps or above',()=>{
 for(const hz of [30,45,60,120]){const f=fixture();f.run(hz,8);assert.equal(f.quality.pixelRatio,3);assert.deepEqual(f.changes,[]);}
});
test('sustained sub-30fps movement lowers one tier at a time with a clear minimum',()=>{
 const f=fixture();f.run(20,1.5);assert.equal(f.quality.pixelRatio,3);
 f.run(20,1.5);assert.equal(f.quality.pixelRatio,2.75);
 f.run(20,10);assert.equal(f.quality.pixelRatio,2.75);assert.deepEqual(f.changes,[2.75]);
});
test('a pause restores a sharp still frame and the next swipe reuses the measured budget',()=>{
 const f=fixture();f.run(20,3);assert.equal(f.quality.activePixelRatio,2.75);
 f.run(60,1,false);assert.equal(f.quality.pixelRatio,3);assert.equal(f.frames.size,0);
 f.quality.motion();assert.equal(f.quality.pixelRatio,2.75);assert.equal(f.quality.activePixelRatio,2.75);
 f.quality.pause();f.quality.settle();assert.equal(f.quality.pixelRatio,3);assert.equal(f.frames.size,0);
});
test('sparse input, idle time and a background gap cannot be mistaken for poor rendering',()=>{
 const f=fixture();
 for(let i=0;i<600;i++)f.step(1000/60,i%6===0);
 assert.deepEqual(f.changes,[]);
 f.step(3000,false);f.run(60,2);assert.deepEqual(f.changes,[]);
});
test('one hitch does not blur the scene and sustained headroom recovers detail',()=>{
 const f=fixture();f.run(60,2);f.step(150);f.run(60,2);assert.deepEqual(f.changes,[]);
 f.run(20,3);assert.equal(f.quality.pixelRatio,2.75);
 f.run(60,6);assert.equal(f.quality.pixelRatio,3);
});

test('very slow display opportunities are still measured when the monitor runs before the next draw',()=>{
 const f=fixture();
 for(let i=0;i<40;i++){f.quality.motion();f.step(160,false);}
 assert.equal(f.quality.activePixelRatio,2.75);assert.equal(f.quality.pixelRatio,2.75);
});
test('paused and disposed monitors stop requesting frames',()=>{
 const f=fixture(1,1);f.run(20,5);assert.equal(f.quality.pixelRatio,1);assert.deepEqual(f.changes,[]);
 f.quality.pause();assert.equal(f.frames.size,0);
 f.quality.motion();assert.equal(f.frames.size,1);
 f.quality.dispose();f.quality.motion();assert.equal(f.frames.size,0);
});


test('all portrait and landscape viewports retain the Full HD floor, independent of screen density',()=>{
 for(const [width,height] of [[393,735],[390,664],[375,812],[360,540],[852,393],[1280,720],[1920,1080]])for(const devicePixelRatio of [1,2,3]){
  const bounds=entranceResolutionBounds({width,height,devicePixelRatio}),portrait=height>=width;
  const f=fixture(bounds.maxPixelRatio,bounds.minPixelRatio);f.run(15,15);
  assert.ok(Math.floor(width*f.quality.pixelRatio)>=(portrait?1080:1920));
  assert.ok(Math.floor(height*f.quality.pixelRatio)>=(portrait?1920:1080));
 }
});

test('changing orientation updates the floor without recursive resize notifications',()=>{
 const f=fixture();f.run(20,3);const changes=f.changes.length;
 const bounds=entranceResolutionBounds({width:390,height:600,devicePixelRatio:3});
 f.quality.setBounds(bounds);assert.equal(f.changes.length,changes);
 assert.equal(f.quality.pixelRatio,3.2);f.run(20,8);assert.equal(f.quality.pixelRatio,3.2);
});
