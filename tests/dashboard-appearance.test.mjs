import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fileURLToPath} from 'node:url';
const main=readFileSync(new URL('../account-source/src/main.jsx',import.meta.url),'utf8');

test('saved points and account score use the share card with the right totals',async()=>{
 const auth=readFileSync(new URL('../collective-source/AuthFlow.jsx',import.meta.url),'utf8');
 assert.match(auth,/ShareScoreDialog score=\{saved\.savedPoints\} dialogRef=\{shareDialog\} sharePoints/);
 assert.match(main,/ShareScoreDialog score=\{account\.bestPoints\}/);
 const server=await createServer({root:fileURLToPath(new URL('../shared/',import.meta.url)),server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
 try{
  const {default:ShareScoreDialog}=await server.ssrLoadModule('/ShareScoreDialog.jsx');
  const markup=renderToStaticMarkup(React.createElement(ShareScoreDialog,{score:3205,dialogRef:{current:null}}));
  assert.match(markup,/Share your score/);
  assert.match(markup,/3,205/);
  assert.match(markup,/Copy score &amp; link/);
  const pointsMarkup=renderToStaticMarkup(React.createElement(ShareScoreDialog,{score:3200,dialogRef:{current:null},sharePoints:true}));
  assert.match(pointsMarkup,/Share your points/);assert.match(pointsMarkup,/I have 3,200 SO\/ COINS/);assert.match(pointsMarkup,/Copy points &amp; link/);
  for(const name of ['whatsapp','telegram','x','gmail'])assert.match(markup,new RegExp('/assets/share-icons/'+name+'\\.svg'));
 }finally{await server.close()}
});

test('the dashboard mesh supports a pure black surface while existing meshes retain their background',()=>{
 const topology=JSON.parse(readFileSync(new URL('../game-source/src/score-mesh-topology.json',import.meta.url),'utf8'));
 const source=readFileSync(new URL('../game-source/src/score-mesh.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
 for(const custom of [false,true]){
  const frames=new Map(),fills=[],arcs=[];let id=0,now=0,radials=0;
  const gradient={addColorStop(){}};
  const context=()=>new Proxy({fillStyle:'',setTransform(){},fillRect(){fills.push(this.fillStyle)},createRadialGradient(){radials++;return gradient},createLinearGradient:()=>gradient,arc(x,y){arcs.push([x,y])}},{get:(object,key)=>key in object?object[key]:()=>{}});
  const display=context(),background=context();
  const canvas={getContext:()=>display,addEventListener(){},style:{}},surface={querySelector:()=>canvas,clientWidth:1440,clientHeight:1200};
  const document={hidden:false,createElement:()=>({getContext:()=>background}),addEventListener(){}};
  const sandbox={referenceMesh:topology,document,AbortController,devicePixelRatio:1,performance:{now:()=>now},matchMedia:()=>({matches:false,addEventListener(){}}),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)};
  vm.runInNewContext(source+';this.mesh=mountScoreMesh(surface,()=>{},options)',Object.assign(sandbox,{surface,options:custom?{backgroundColor:'#000',ambient:false}:undefined}));
  assert.equal(fills[0],custom?'#000':'#08040c');assert.equal(radials,custom?0:2);
  sandbox.mesh.start(960,350,'opening');now=200;
  for(const [key,render]of [...frames]){frames.delete(key);render(now)}
  assert.deepEqual(arcs[0],[960,350]);
  now=4000;for(const [key,render]of [...frames]){frames.delete(key);render(now)}
  assert.equal(frames.size,0,'The mesh stops rendering after the wave fades');sandbox.mesh.dispose();
 }
});
