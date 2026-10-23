import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

async function materialize(t,corrupt=false){
 const root=await mkdtemp(join(tmpdir(),'sofacet-media-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'scripts'));await mkdir(join(root,'assets'));
 await copyFile(new URL('../scripts/materialize-video.mjs',import.meta.url),join(root,'scripts/materialize-video.mjs'));
 const bytes=Buffer.from('verified video fixture');
 const pointer=`version https://git-lfs.github.com/spec/v1\noid sha256:${createHash('sha256').update(bytes).digest('hex')}\nsize ${bytes.length}\n`;
 const video=join(root,'assets/sofacet-experience.mp4');await writeFile(video,pointer);
 const mock=join(root,'fetch-fixture.mjs');
 await writeFile(mock,`import assert from 'node:assert/strict';
globalThis.fetch=async url=>{
 assert.equal(url,'https://media.githubusercontent.com/media/sofacettech/Pin_ball_Game/f9ffafaa7bf3e4a11438b25945857a41f2229cad/assets/sofacet-experience.mp4');
 return new Response(Buffer.from(${JSON.stringify((corrupt?Buffer.alloc(bytes.length):bytes).toString('base64'))},'base64'));
};`);
 const result=spawnSync(process.execPath,['--import',mock,join(root,'scripts/materialize-video.mjs')],{
  env:{...process.env,RAILWAY_GIT_COMMIT_SHA:'0'.repeat(40)},encoding:'utf8',timeout:10000,
 });
 assert.ifError(result.error);
 return{result,video,bytes,pointer};
}

test('ZIP video materialization uses the approved mirror revision even for a different deployment commit',async t=>{
 const {result,video,bytes}=await materialize(t);
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(await readFile(video),bytes);
 await assert.rejects(stat(video+'.download'),{code:'ENOENT'});
});

test('a corrupt mirror response leaves the committed LFS pointer intact',async t=>{
 const {result,video,pointer}=await materialize(t,true);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/does not match the committed LFS size and SHA-256/);
 assert.equal(await readFile(video,'utf8'),pointer);
 await assert.rejects(stat(video+'.download'),{code:'ENOENT'});
});
