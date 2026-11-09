import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../account-source/src/main.jsx',import.meta.url),'utf8');

test('Share my score copies the personal best and reports clipboard success or failure',async()=>{
 const source=main.slice(main.indexOf(' const shareText='),main.indexOf(' const signingIn='));
 for(const rejected of [false,true]){
  let copied,notice;
  await vm.runInNewContext(source+';copy()',{
   account:{bestPoints:3205},number:new Intl.NumberFormat('en-IN'),location:{origin:'https://example.test'},
   navigator:{clipboard:{async writeText(text){if(rejected)throw Error('Clipboard blocked');copied=text}}},
   setNotice:value=>{notice=value}
  });
  if(rejected){assert.equal(copied,undefined);assert.equal(notice,'Automatic copy is unavailable. Select and copy the score text below.')}
  else{assert.equal(copied,'I scored 3,205 SO/ COINS on SO/ FACET pinball.\nWhat’s yours?\nhttps://example.test/');assert.equal(notice,'Your score was copied.')}
 }
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
