import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const {chromium,webkit,devices}=createRequire(import.meta.url)(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit',url=new URL(process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8892/');url.hash='experience';
const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{}),map=createJourneyScrollMap(),results=[];
await mkdir('work/entrance-preparation',{recursive:true});
try{
 const page=await browser.newPage({...devices['iPhone 13'],viewport:{width:360,height:640}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/THREE\.WebGLProgram|GL_INVALID_|shader.*error/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>{
  window.gpuPreparation={};
  for(const name of ['createProgram','linkProgram','bufferData','texImage2D','texStorage2D']){
   const original=WebGL2RenderingContext.prototype[name];
   WebGL2RenderingContext.prototype[name]=function(...args){window.gpuPreparation[name]=(window.gpuPreparation[name]||0)+1;return original.apply(this,args);};
  }
 });
 await page.goto(url.href);await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:120000});
 const state=()=>page.evaluate(()=>{const p=window.entrancePreview,r=p.renderer;return{frame:p.frame,counts:{...window.gpuPreparation},programs:r.info.programs.length,memory:{...r.info.memory},buffer:[r.domElement.width,r.domElement.height]};});
 const initial=await state();
 // Cover both sides of every light, transmission and environment-map change,
 // including fractional doorway poses and reverse travel after the last room.
 const frames=[500,561,680,720,779,781,850,928,941,1000,1380,1479,1481,1521,1600,1640,1655,1661,1680,1800,2080,2140];
 for(const frame of [...frames,...frames.toReversed()]){
  const y=await page.evaluate(y=>{scrollTo(0,y);return scrollY;},map.scrollAtFrame(frame));
  await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.02,map.frameAtScroll(y));
  const current=await state();results.push(current);
  assert.deepEqual(current.counts,initial.counts,`GPU resources must be prepared before scrolling, frame ${frame}`);
  assert.deepEqual(current.memory,initial.memory);assert.deepEqual(current.buffer,[1080,1920]);
 }
 assert.deepEqual(errors,[]);
 await writeFile(`work/entrance-preparation/${engine}.json`,JSON.stringify({initial,results},null,2));
 console.log(JSON.stringify({engine,samples:results.length,programs:initial.programs,result:'Full HD forward/reverse journey uses only shader programs, geometry and texture allocations prepared before ready'}));
}finally{await browser.close();}
