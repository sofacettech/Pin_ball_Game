import assert from 'node:assert/strict';
import {build} from 'esbuild-wasm';
import {createRequire} from 'node:module';
const {chromium,webkit}=createRequire(import.meta.url)(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as THREE from 'three';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {cacheAreaLighting,canShareAreaCoat} from './entrance-source/area-light-cache.mjs';
RectAreaLightUniformsLib.init();
const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true,antialias:false});
renderer.setSize(128,128);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,100);
camera.position.set(0,0,4);camera.lookAt(0,0,0);
const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,48,32));scene.add(mesh);
const lights=[];for(let i=0;i<7;i++){const light=new THREE.RectAreaLight(0xffffff,2,.8,1.1);const angle=i*Math.PI*2/7;light.position.set(Math.sin(angle)*2,Math.cos(angle)*2,1.8);light.lookAt(0,0,0);scene.add(light);lights.push(light);}
const gl=renderer.getContext(),capture=()=>{renderer.render(scene,camera);const pixels=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
window.results=[];
for(const metalness of [0,1])for(const coat of [0,.18,.3])for(const count of [0,1,3,7])for(const reverse of [false,true]){
 lights.forEach((light,i)=>{light.visible=i<count;light.lookAt(0,0,reverse?6:0)});
 const original=new THREE.MeshPhysicalMaterial({color:0x9871a8,metalness,roughness:.18,clearcoat:coat?1:0,clearcoatRoughness:coat});
 const cached=original.clone(),share=canShareAreaCoat(cached);cached.onBeforeCompile=shader=>cacheAreaLighting(shader,share);cached.customProgramCacheKey=()=>String(share);
 mesh.material=original;const a=capture();mesh.material=cached;const b=capture();let error=0,max=0,energy=0;
 for(let i=0;i<a.length;i++){if(i%4===3)continue;const d=Math.abs(a[i]-b[i]);error+=d;max=Math.max(max,d);energy+=a[i];}
 results.push({metalness,coat,count,reverse,share,mean:error/(128*128*3),max,energy});original.dispose();cached.dispose();
}
window.done=true;
`},bundle:true,write:false,format:'esm',target:'es2022'});
const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('http://area-light.test/',r=>r.fulfill({contentType:'text/html',body:'<script type="module" src="/test.js"></script>'}));
 await page.route('http://area-light.test/test.js',r=>r.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
 await page.goto('http://area-light.test/');await page.waitForFunction(()=>window.done,null,{timeout:120000});
 const results=await page.evaluate(()=>window.results);
 assert.deepEqual(errors,[]);
 for(const result of results){assert.ok(result.mean<.04,JSON.stringify(result));assert.ok(result.max<=3,JSON.stringify(result));}
 assert.ok(results.some(r=>r.share&&r.energy>10000));assert.ok(results.some(r=>!r.share&&r.coat&&r.energy>10000));
 console.log(JSON.stringify({engine,cases:results.length,maxMean:Math.max(...results.map(r=>r.mean)),maxChannelError:Math.max(...results.map(r=>r.max)),result:'Original and cached area lighting match across diffuse, metal, clearcoat and emitter orientations'}));
}finally{await browser.close();}
