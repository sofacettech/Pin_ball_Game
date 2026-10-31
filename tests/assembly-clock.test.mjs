import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyClock} from '../entrance-source/assembly-clock.mjs';

test('the authored assembly advances in real time and settles at the journey boundary',()=>{
 const clock=createAssemblyClock();assert.equal(clock.frame,1);
 assert.equal(clock.advance(100),1);assert.equal(clock.advance(1100),61);
 assert.equal(clock.advance(4100),240);assert.equal(clock.active,false);
 assert.equal(clock.advance(10000),240);
});

test('background time cannot skip the 3D assembly on return',()=>{
 const clock=createAssemblyClock();clock.advance(100);clock.advance(1100);clock.suspend();
 assert.equal(clock.advance(60000),61);assert.equal(clock.advance(61000),121);
});

test('direct scrolling can finish assembly and reduced motion begins at the assembled pose',()=>{
 const clock=createAssemblyClock();clock.advance(100);clock.advance(600);
 assert.equal(clock.finish(),240);assert.equal(clock.active,false);assert.equal(clock.advance(1000),240);
 const reduced=createAssemblyClock({reducedMotion:true});assert.equal(reduced.frame,240);assert.equal(reduced.active,false);
});
