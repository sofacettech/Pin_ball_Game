import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout} from 'node:timers/promises';

const remote=process.argv[2];
const origin=remote||'http://127.0.0.1:18766';
let server,dir;
const request=(path,options={})=>fetch(new URL(path,origin),{...options,signal:AbortSignal.timeout(15_000)});
try{
 if(!remote){
  dir=await mkdtemp(join(tmpdir(),'pinball-smoke-'));
  server=spawn(process.execPath,['server.mjs'],{stdio:'inherit',env:{...process.env,HOST:'127.0.0.1',PORT:'18766',APP_ORIGIN:origin,DATA_DIR:dir}});
 }
 let healthy=false;
 for(let attempt=0;attempt<30;attempt++){
  if(server?.exitCode!==null&&server?.exitCode!==undefined)throw new Error('Server exited before it was ready.');
  try{const res=await request('/health');healthy=res.ok&&(await res.json()).status==='ok';}catch{}
  if(healthy)break;
  await setTimeout(1000);
 }
 assert.ok(healthy,'Health check did not become ready.');
 for(const path of ['/','/index.html','/play.html','/entrance-3d','/entrance-3d/','/video','/video/','/launching-soon.html','/first-cuts-confirmation.html']){
  const res=await request(path);
  assert.equal(res.status,200,path);
  const html=await res.text();
  assert.match(html,/<html/i,path);
  if(path==='/'||path==='/index.html'||path.startsWith('/entrance-3d')){
   assert.match(html,/\/assets\/entrance-3d\//,'Default route serves the Three.js entrance');
   assert.doesNotMatch(html,/node_modules|\/work\/|\/experiments\//,'3D route uses deployable assets only');
  }else if(path.startsWith('/video')){
   assert.match(html,/<base href="\/">/,'Video aliases resolve relative assets from the site root');
   assert.match(html,/id="story-copy"/,'Shared video presentation remains available');
   assert.doesNotMatch(html,/\/assets\/entrance-3d\//,'Video comparison does not download the 3D world');
  }
  const resources=[...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match=>match[1]);
  for(const resource of resources){
   if(/^https?:\/\//.test(resource))continue;
   const asset=await request(new URL(resource,origin).pathname,{method:'HEAD'});
   assert.equal(asset.status,200,resource);
  }
 }
 const model=await request('/assets/entrance-3d/journey-compact.glb',{headers:{Range:'bytes=0-11'}});
 assert.equal(model.status,206,'3D model byte-range support');
 assert.equal(model.headers.get('content-type'),'model/gltf-binary');
 const glb=new DataView(await model.arrayBuffer());
 assert.equal(glb.getUint32(0,true),0x46546c67,'3D model is a real GLB');
 assert.equal(glb.getUint32(4,true),2,'GLB version');
 assert.equal(model.headers.get('content-range'),`bytes 0-11/${glb.getUint32(8,true)}`);
 const video=await request('/assets/sofacet-experience.mp4',{headers:{Range:'bytes=0-31'}});
 assert.equal(video.status,206,'Video byte-range support');
 assert.match(video.headers.get('content-type'),/^video\/mp4/);
 assert.match(video.headers.get('content-range'),/^bytes 0-31\/[1-9]\d{7,}$/,'Video must be materialized, not an LFS pointer');
 assert.equal((await video.arrayBuffer()).byteLength,32);
 const config=await request('/api/media-config');
 assert.equal(config.status,200);assert.equal(config.headers.get('set-cookie'),null);
 const {baseURL}=await config.json(),manifest=await(await request('/assets/video-manifest.json')).json();
 for(const variant of Object.values(manifest.variants)){
  const index=await(await request('/assets/'+variant.journey.index)).json();
  assert.equal(index.sha256,variant.journey.sha256);
  for(const asset of [variant.journey,variant.opening]){
   const url=baseURL?new URL(asset.key,baseURL.replace(/\/?$/,'/')).href:'/assets/'+asset.file;
   const response=await request(url,{headers:{Range:'bytes=0-31',Origin:origin}});
   assert.equal(response.status,206,url);
   assert.equal(response.headers.get('content-range'),`bytes 0-31/${asset.bytes}`);
   assert.equal((await response.arrayBuffer()).byteLength,32);
   if(baseURL){
    assert.ok(['*',origin].includes(response.headers.get('access-control-allow-origin')),'Video CDN CORS');
    assert.match(response.headers.get('access-control-expose-headers')||'',/content-range/i,'Frame decoder must read Content-Range');
   }
  }
 }
 for(const path of ['/.env','/data/players.json','/server.mjs','/entrance-source/entrance.mjs','/work/threejs-scene/journey-compact.glb'])assert.equal((await request(path)).status,404,path);
 if(!remote){
  const player=await request('/api/player');
  assert.equal(player.status,200);
  const cookie=player.headers.get('set-cookie').split(';')[0];
  const started=await request('/api/games/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
  assert.equal(started.status,201);
  assert.ok((await started.json()).id);
  const rejected=await request('/api/games/start',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(rejected.status,403,'Game sessions require the configured origin');
 }
 console.log(`Smoke checks passed: ${origin}`);
}finally{
 if(server&&server.exitCode===null){const closed=once(server,'exit');server.kill('SIGTERM');await closed;}
 if(dir)await rm(dir,{recursive:true,force:true});
}
