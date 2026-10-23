import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual Canvas controller's integrator without a browser or GPU.
const source=readFileSync(new URL('../assets/game-loader.js',import.meta.url),'utf8');
const integrator=source.slice(source.indexOf('function advance(dt)'),source.indexOf('function tick(now)'));
function simulation(initial={}){
 const sandbox={initial};
 vm.runInNewContext(`let {width=320,height=480,radius=10,x=160,y=240,vx=320,vy=240}=initial;let time=0,points=[],impacts=[];${integrator};this.step=advance;this.state=()=>({x,y,vx,vy,time,points,impacts,width,height,radius})`,sandbox);
 return sandbox;
}
test('ball motion is refresh-rate independent, radius-aware, and keeps bounded history',()=>{
 const sixty=simulation(),fast=simulation();
 for(let i=0;i<600;i++){sixty.step(1/60);const p=sixty.state();assert.ok(p.x>=p.radius-1e-8&&p.x<=p.width-p.radius+1e-8);assert.ok(p.y>=p.radius-1e-8&&p.y<=p.height-p.radius+1e-8);assert.ok(p.points.length<=240&&p.impacts.length<=8)}
 for(let i=0;i<1440;i++)fast.step(1/144);
 const a=sixty.state(),b=fast.state();assert.ok(Math.abs(a.x-b.x)<1e-6&&Math.abs(a.y-b.y)<1e-6);
});
test('corner contacts reflect both axes once, with exact edge positions',()=>{
 const motion=simulation({width:100,height:100,radius:10,x:50,y:50,vx:40,vy:40});motion.step(1);
 const contact=motion.state();assert.equal(contact.x,90);assert.equal(contact.y,90);assert.equal(contact.vx,-40);assert.equal(contact.vy,-40);assert.equal(contact.impacts.length,2);
 assert.equal(contact.impacts[0].x,100);assert.equal(contact.impacts[1].y,100);assert.equal(contact.points.at(-1).x,90);
 motion.step(1/144);assert.equal(motion.state().impacts.length,2);
 motion.step(.5);assert.equal(motion.state().impacts.length,0);
});
test('trail records the reflection vertex instead of cutting across a bounce',()=>{
 const motion=simulation({width:100,height:100,radius:10,x:85,y:50,vx:40,vy:20});motion.step(.25);
 const {points,x,vx}=motion.state();assert.equal(points.length,2);assert.equal(points[0].x,90);assert.equal(points[0].y,52.5);assert.equal(x,85);assert.equal(vx,-40);
});
