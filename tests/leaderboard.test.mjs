import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

const member='a'.repeat(64),guest='b'.repeat(64),other='c'.repeat(64);
async function withServer(mode,check){
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'sofacet-board-'));
 await writeFile(join(directory,'players.json'),JSON.stringify({players:{[member]:{name:'Asha K.',profile:{customerId:'fixture-member'},best:41000,bestVerified:true,bestAt:1},[guest]:{name:'Player BBBB',best:8050,bestVerified:true,bestAt:2},[other]:{name:'Noor S.',profile:{customerId:'fixture-other'},best:49500,bestVerified:true,bestAt:3}},games:{}}));
 const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:origin,LEADERBOARD_MODE:mode,REWARDS_API_KEY:'',REWARDS_ADMIN_SECRET:''},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture server timeout')),10000);timer.unref()})]);
  await check(async(path,id)=>fetch(origin+path,{headers:id?{Cookie:'sofacet_pinball_player='+id}:{}}));
 }finally{child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})}
}
test('guests cannot request either leaderboard; members see unmasked names and the same scores/ranks',async()=>{
 await withServer('game',async request=>{
  for(const id of [undefined,guest])for(const path of ['/api/leaderboard','/api/rewards/leaderboard']){
   const response=await request(path,id),body=await response.json();assert.equal(response.status,403);assert.equal(body.message,'Please register to view the leaderboard.');assert.equal(body.entries,undefined);assert.ok(!JSON.stringify(body).includes('Asha'));
  }
  const response=await request('/api/leaderboard',member),board=await response.json();assert.equal(response.status,200);assert.equal(board.locked,undefined);
  assert.deepEqual(board.entries.map(row=>[row.rank,row.display_name,row.points]),[[1,'Noor S.',49500],[2,'Asha K.',41000],[3,'Player BBBB',8050]]);
  assert.deepEqual(board.me,{rank:2,display_name:'Asha K.',points:41000,is_you:true});
 });
});
test('rewards mode refuses guests before making an upstream request',async()=>{
 await withServer('rewards',async request=>{const response=await request('/api/leaderboard',guest);assert.equal(response.status,403);assert.equal((await response.json()).entries,undefined)});
});
