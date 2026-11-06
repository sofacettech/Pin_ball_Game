import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';

const script=readFileSync(new URL('../assets/page-ready.js',import.meta.url),'utf8');
test('page stays hidden until layout, fonts and the next paint are ready; history restore reveals it',async()=>{
 const events=new Map(),frames=[],root={dataset:{}},layout=[];
 let fontsReady;
 const document={documentElement:root,readyState:'loading',body:{getBoundingClientRect(){layout.push(true)}},fonts:{ready:new Promise(resolve=>{fontsReady=resolve})},addEventListener:(name,fn)=>events.set(name,fn)};
 vm.runInNewContext(script,{document,requestAnimationFrame:fn=>frames.push(fn),addEventListener:(name,fn)=>events.set(name,fn)});
 assert.equal(root.dataset.loaded,'false');events.get('DOMContentLoaded')();frames.shift()();
 assert.equal(layout.length,1);assert.equal(root.dataset.loaded,'false');assert.equal(frames.length,0);
 fontsReady();await new Promise(resolve=>setImmediate(resolve));assert.equal(root.dataset.loaded,'false');frames.shift()();assert.equal(root.dataset.loaded,'true');
 root.dataset.loaded='false';events.get('pageshow')({persisted:true});assert.equal(root.dataset.loaded,'true');
});
test('shared page guard is inserted before styles and remains single after rebuilding',()=>{
 const html=withGameLoader(withGameLoader('<html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"></head><body>Page</body></html>'));
 assert.equal((html.match(/id="page-ready"/g)||[]).length,1);
 assert(html.indexOf('id="page-ready"')<html.indexOf('href="page.css"'));
 assert.match(html,/<head><meta charset="utf-8"><!-- page-ready -->/);
 assert.doesNotMatch(html,/<html[^>]*data-loaded=/,'JavaScript-disabled pages remain visible');
});
test('a failed font load or unavailable font API still reveals the page',async()=>{
 for(const failed of [false,true]){
  const fonts=failed?{ready:Promise.reject(Error('Font unavailable'))}:undefined;
  const frames=[],root={dataset:{}},document={documentElement:root,readyState:'interactive',body:{getBoundingClientRect(){}},fonts};
  vm.runInNewContext(script,{document,requestAnimationFrame:fn=>frames.push(fn),addEventListener(){}});
  frames.shift()();await new Promise(resolve=>setImmediate(resolve));frames.shift()();
  assert.equal(root.dataset.loaded,'true');
 }
});
