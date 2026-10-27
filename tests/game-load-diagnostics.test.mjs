import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('game startup reports accept only categories without creating player records',async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'sofacet-load-report-')),origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let logs='';child.stderr.on('data',data=>{logs+=data});
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')})]);
  const report={phase:'physics',code:'memory',embedded:true};
  const send=(data=report,from=origin)=>fetch(origin+'/api/game-load-failure',{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const response=await send();assert.equal(response.status,202);assert.equal(response.headers.get('set-cookie'),null);
  assert.equal((await send(report,'https://other.example')).status,403);
  for(const invalid of [null,{...report,phase:'arbitrary'},{...report,code:'arbitrary'},{...report,embedded:1},{...report,message:'private data'}])assert.equal((await send(invalid)).status,400);
  assert.equal((await send({...report,message:'x'.repeat(1024)})).status,413);
  assert.deepEqual(logs.trim().split('\n').map(line=>JSON.parse(line)),[{event:'game-load-failure',...report}]);
  await assert.rejects(readFile(join(directory,'players.json')),{code:'ENOENT'});
 }finally{child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})}
});
