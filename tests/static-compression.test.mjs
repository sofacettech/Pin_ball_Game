import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {brotliCompressSync} from 'node:zlib';

test('HTTP model compression preserves bytes, progress length, HEAD, ranges and identity clients',async()=>{
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const assets=await mkdtemp(new URL('../assets/compression-test-',import.meta.url));
 const data=await mkdtemp(join(tmpdir(),'sofacet-compression-'));
 const payload=Buffer.from('A model buffer with repeated geometry metadata.\n'.repeat(100));
 const encoded=brotliCompressSync(payload),file=join(assets,'model.glb');
 await writeFile(file,payload);await writeFile(file+'.br',encoded);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit'),url=`http://127.0.0.1:${port}/assets/${basename(assets)}/model.glb`;
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')})]);
  const compressed=await fetch(url,{headers:{'Accept-Encoding':'br, gzip'}});
  assert.equal(compressed.headers.get('content-encoding'),'br');
  assert.equal(compressed.headers.get('content-length'),String(encoded.length));
  assert.equal(compressed.headers.get('x-uncompressed-length'),String(payload.length));
  assert.equal(compressed.headers.get('vary'),'Accept-Encoding');
  assert.deepEqual(Buffer.from(await compressed.arrayBuffer()),payload);
  const head=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':'br'}});
  assert.equal(head.headers.get('content-length'),String(encoded.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(url,{headers:{'Accept-Encoding':'br',Range:'bytes=5-19'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-encoding'),null);assert.equal(range.headers.get('content-range'),`bytes 5-19/${payload.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),payload.subarray(5,20));
  for(const encoding of ['identity','gzip','br;q=0, gzip']){
   const original=await fetch(url,{headers:{'Accept-Encoding':encoding}});
   assert.equal(original.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await original.arrayBuffer()),payload);
  }
  await utimes(file+'.br',new Date(0),new Date(0));
  const stale=await fetch(url,{headers:{'Accept-Encoding':'br'}});
  assert.equal(stale.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await stale.arrayBuffer()),payload);
 }finally{child.kill('SIGTERM');await exited;await rm(assets,{recursive:true,force:true});await rm(data,{recursive:true,force:true});}
});
