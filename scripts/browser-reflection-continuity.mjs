import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const require=createRequire(import.meta.url),{webkit,chromium,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit',origin=process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8885/';
const browser=await ({webkit,chromium}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{}),scroll=createJourneyScrollMap();
await mkdir('work/reflections',{recursive:true});
try{
 const page=await browser.newPage({...devices['iPhone 13'],viewport:{width:393,height:735}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/THREE\.WebGLProgram|GL_INVALID_|shader.*error/i.test(m.text()))errors.push(m.text())});
 const url=new URL(origin);url.hash='experience';await page.goto(url.href);await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:120000});
 await page.evaluate(()=>{
  const renderer=window.entrancePreview.renderer,draw=renderer.render.bind(renderer);
  renderer.render=(scene,camera)=>{
   if(scene.type==='Scene'&&scene.children.length>4&&renderer.getRenderTarget()?.height===renderer.domElement.height){window.reflectionReviewScene=scene;window.reflectionReviewCamera=camera;}
   return draw(scene,camera);
  };
 });
 const results=[];
 for(const viewport of [{width:393,height:735},{width:852,height:393}]){
  await page.setViewportSize(viewport);
  for(const frame of [1260,1300,1340,1380,1420,1440,1420,1380,1340,1300,1260]){
   await page.evaluate(y=>scrollTo(0,y),scroll.scrollAtFrame(frame));await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.2,frame);
   const result=await page.evaluate(()=>{
    let floor;window.reflectionReviewScene.traverse(o=>{if(o.material?.name==='Reflective floor')floor=o;});
    const shader={uniforms:{},vertexShader:'',fragmentShader:''};floor.material.onBeforeCompile(shader);
    const matrix=shader.uniforms.uChamberMatrix.value,camera=window.reflectionReviewCamera,points=[];
    for(const y of [-.9,-.6])for(const x of [-.8,0,.8]){
     const direction=camera.position.clone().set(x,y,.5).unproject(camera).sub(camera.position).normalize(),distance=(4.05-camera.position.y)/direction.y;
     if(distance<=0)continue;
     const point=direction.multiplyScalar(distance).add(camera.position),uv=point.applyMatrix4(matrix);
     points.push({uv:uv.toArray(),expected:[(1-x)/2,(1+y)/2]});
    }
    const renderer=window.entrancePreview.renderer;
    return{frame:window.entrancePreview.frame,points,draws:renderer.info.render.calls,triangles:renderer.info.render.triangles,buffer:[renderer.domElement.width,renderer.domElement.height]};
   });
   assert.ok(result.points.length>=3,'sample the visible floor');
   for(const {uv,expected} of result.points){assert.ok(uv[0]>0&&uv[0]<1&&uv[1]>0&&uv[1]<1,`reflection cutoff at frame ${frame}: ${uv}`);assert.ok(Math.abs(uv[0]-expected[0])<.001&&Math.abs(uv[1]-expected[1])<.001,'capture follows the current phone crop');}
   if(frame===1380)await page.screenshot({path:`work/reflections/${engine}-${viewport.width}-1380.png`});
   results.push({viewport,frame,draws:result.draws,triangles:result.triangles,buffer:result.buffer});
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,result:'Reflection stays in bounds through the reported section, reverse scroll and rotation',samples:results}));
}finally{await browser.close()}
