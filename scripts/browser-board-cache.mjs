import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,webkit,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit';
const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{});
try{
 const context=await browser.newContext({...devices['iPhone 13'],reducedMotion:'no-preference'});
 await context.addInitScript(()=>localStorage.setItem('sofacet.controls-practised.v1','done'));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/THREE\.WebGLProgram|GL_INVALID_/i.test(m.text()))errors.push(m.text())});
 await page.goto(process.env.SOFACET_GAME_DEV_URL||'http://127.0.0.1:5174/');
 await page.waitForFunction(()=>window.__facet?.ready(),null,{timeout:120000});await page.locator('#start').click();
 await page.waitForFunction(()=>window.__facet.physics.active);
 await page.waitForFunction(()=>!window.__facet.view.cameraTransition.active);
 const results=await page.evaluate(()=>{
  const {view,physics}=window.__facet;physics.setPaused(true);
  const pass=view.renderPass,renderer=view.renderer,gl=renderer.getContext(),results=[];
  let enabled=false;Object.defineProperty(pass,'cacheEnabled',{configurable:true,get:()=>enabled,set:()=>{}});
  const capture=()=>{view.render();const pixels=new Uint8Array(view.canvas.width*view.canvas.height*4);gl.readPixels(0,0,view.canvas.width,view.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return{pixels,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}};
  const compare=name=>{
   // Read the existing cache after each mutation; rebuilding first would hide
   // a moving part accidentally classified as static.
   enabled=true;capture();capture();const cached=capture();enabled=false;const normal=capture();
   enabled=true;capture();
   let max=0,sum=0,visible=0;for(let i=0;i<normal.pixels.length;i++){const d=Math.abs(normal.pixels[i]-cached.pixels[i]);max=Math.max(max,d);sum+=d;if(i%4!==3)visible+=normal.pixels[i];}
   results.push({name,max,visible,mean:sum/normal.pixels.length,normal:{calls:normal.calls,triangles:normal.triangles},cached:{calls:cached.calls,triangles:cached.triangles},buffer:[view.canvas.width,view.canvas.height],cache:{...pass.cacheStats}});
  };
  const cameraBefore=view.activeCamera.matrixWorld.clone();
  for(const focus of ['launcher','cave'])for(let i=0;i<120;i++)view.follow([.08,.008,-.03],1/60,'playing','floor',focus);
  results.push({name:'steady phone camera',restored:view.activeCamera.matrixWorld.equals(cameraBefore)});
  compare('launcher');
  view.updateBall([0,.008,0],{x:0,y:0,z:0,w:1},true);compare('ball on floor');
  view.updateBall([.08,.04,-.03],{x:0,y:.7,z:0,w:.7},true);compare('raised ball and rail glass');
  view.updatePaddle('flipper_left',.6);view.updatePaddle('flipper_right',-.6);compare('moving flippers');
  const bumper=[...view.glow.keys()][0];view.hit(bumper);view.updateFeedback(.04);compare('bumper flash');
  view.updateCaveCharge(.8,true);compare('cave charge');
  view.updateSpring(1);compare('compressed spring');
  const target=view.manifest.target_gameplay[0];view.updateTarget(target.id,[...target.initial_position].map((v,i)=>v+(i===0?.004:0)));compare('moving target');
  for(const quality of ['low','auto','full']){view.setQuality(quality);compare('quality '+quality);}
  enabled=true;const before=pass.cacheStats.fallbacks;view.activeCamera.position.x+=.002;capture();
  results.push({name:'camera invalidation',fallbacks:pass.cacheStats.fallbacks-before});compare('changed camera');
  const masks=pass.objects.map(o=>o.layers.mask);capture();results.push({name:'layer restoration',restored:pass.objects.every((o,i)=>o.layers.mask===masks[i])});
  return results;
 });
 console.log(JSON.stringify({engine,results}));
 // Rewriting sampled depth can round a few edge pixels differently; bound both
 // the worst channel and the mean so an occlusion or color regression fails.
 for(const r of results){if('max' in r){assert.ok(r.visible>10000,`${r.name}: compare actual rendered board pixels`);assert.ok(r.max<=4&&r.mean<.001,`${r.name}: cached color/depth differ: ${JSON.stringify(r)}`);assert.ok(r.cached.triangles<r.normal.triangles*.3,`${r.name}: stationary geometry must be reused`);}else if(r.name==='camera invalidation')assert.equal(r.fallbacks,1);else assert.equal(r.restored,true);}
 assert.deepEqual(errors,[]);
 await context.close();
}finally{await browser.close()}
