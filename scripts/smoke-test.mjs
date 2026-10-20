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
 for(const path of ['/','/play.html']){
  const res=await request(path);
  assert.equal(res.status,200,path);
  const html=await res.text();
  assert.match(html,/<html/i,path);
  const resources=[...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match=>match[1]);
  for(const resource of resources){
   if(/^https?:\/\//.test(resource))continue;
   const asset=await request(new URL(resource,new URL(path,origin)).pathname,{method:'HEAD'});
   assert.equal(asset.status,200,resource);
  }
 }
 const video=await request('/assets/sofacet-experience.mp4',{headers:{Range:'bytes=0-31'}});
 assert.equal(video.status,206,'Video byte-range support');
 assert.match(video.headers.get('content-type'),/^video\/mp4/);
 assert.match(video.headers.get('content-range'),/^bytes 0-31\/[1-9]\d{7,}$/,'Video must be materialized, not an LFS pointer');
 assert.equal((await video.arrayBuffer()).byteLength,32);
 for(const path of ['/.env','/data/players.json','/server.mjs'])assert.equal((await request(path)).status,404,path);
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
