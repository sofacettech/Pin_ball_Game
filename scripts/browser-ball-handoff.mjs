import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const {webkit,chromium,devices}=createRequire(import.meta.url)(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit',url=new URL(process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8890/');url.hash='experience';
const browser=await ({webkit,chromium}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{}),scroll=createJourneyScrollMap(),results=[];
await mkdir('work/ball-handoff',{recursive:true});
try{
 for(const [name,options] of [['desktop',{viewport:{width:1440,height:810}}],['mobile',{...devices['iPhone 13'],viewport:{width:393,height:735}}]]){
  const page=await browser.newPage(options),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/THREE\.WebGLProgram|GL_INVALID_|shader.*error/i.test(m.text()))errors.push(m.text());});
  await page.goto(url.href);await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:120000});
  await page.evaluate(()=>{
   const r=window.entrancePreview.renderer,draw=r.render.bind(r);
   r.render=(scene,camera)=>{if(scene.type==='Scene'&&scene.children.length>4&&Math.floor(r.getRenderTarget()?.height)===r.domElement.height){window.handoffScene=scene;window.handoffCamera=camera;}return draw(scene,camera);};
  });
  let previous;
  for(const frame of [924,925,925.5,926,927,928,929,930,930.5,930.99,931,932,940,932,931,930.99,930,929,928,927,926,925.5,925,924]){
   // WebKit rounds scroll offsets to CSS pixels. Wait for the achievable
   // source frame rather than demanding an unrepresentable fractional pose.
   const y=await page.evaluate(y=>{scrollTo(0,y);return scrollY;},scroll.scrollAtFrame(frame));
   await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.02,scroll.frameAtScroll(y));
   const state=await page.evaluate(()=>{
    const balls=[],parts={exterior:[],interior:[]};
    window.handoffScene.traverse(object=>{
     const name=object.userData.source_name||'';const group=name.startsWith('Travel exterior ball |')?'exterior':name.startsWith('Same starting ball |')?'interior':null;
     if(!group)return;parts[group].push(object.scale.x);
     if(name.endsWith('InnerCore')){
      const point=window.handoffCamera.position.clone().setFromMatrixPosition(object.matrixWorld).project(window.handoffCamera);
      balls.push({group,scale:object.scale.x,position:object.position.toArray(),screen:point.toArray()});
     }
    });
    const r=window.entrancePreview.renderer;
    return{frame:window.entrancePreview.frame,balls,parts,batching:window.entrancePreview.batching,buffer:[r.domElement.width,r.domElement.height]};
   });
   const visible=state.balls.filter(ball=>ball.scale>.01);assert.equal(visible.length,1,`one complete ball at ${frame}: ${JSON.stringify(state.balls)}`);
   const ball=visible[0];assert.ok(ball.scale>1&&ball.scale<1.2,`no collapse at ${frame}`);
   assert.ok(ball.position[0]>23&&ball.position[0]<25&&ball.position[2]>-4&&ball.position[2]<-1,`no storage-position interpolation at ${frame}`);
   assert.ok(Math.abs(ball.screen[0])<.95&&Math.abs(ball.screen[1])<.95,`ball stays in view at ${frame}`);
   assert.equal(state.parts[ball.group].length,44);assert.ok(state.parts[ball.group].every(scale=>scale>.9),'all facets remain assembled');
   assert.ok(state.parts[ball.group==='exterior'?'interior':'exterior'].every(scale=>Math.abs(scale)<.001),'hidden copy cannot ghost into view');
   if(previous){assert.ok(Math.hypot(ball.screen[0]-previous.screen[0],ball.screen[1]-previous.screen[1])<.06,`continuous screen position at ${frame}`);assert.ok(Math.abs(ball.scale/previous.scale-1)<.05,`continuous size at ${frame}`);}
   previous=ball;results.push({name,frame,ball,batching:state.batching,buffer:state.buffer});
   if(frame===926||frame===931)await page.screenshot({path:`work/ball-handoff/${engine}-${name}-${frame}.png`});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 await writeFile(`work/ball-handoff/${engine}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({engine,result:'Ball position, size and all 44 facets stay continuous in forward and reverse doorway scrolling',samples:results.length,batching:[...new Set(results.map(r=>r.batching))]}));
}finally{await browser.close();}
