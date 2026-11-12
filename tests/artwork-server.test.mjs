import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {collectArtwork} from '../scripts/artwork-manifest.mjs';

async function withServer(base, check) {
  const directory=await mkdtemp(join(tmpdir(),'sofacet-artwork-server-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),
    env:{...process.env,DATA_DIR:directory,PORT:'0',HOST:'127.0.0.1',ARTWORK_CDN_BASE_URL:base},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',data=>{logs+=data;});
  const exited=once(child,'exit');
  try {
    const origin=await Promise.race([
      new Promise(resolve=>{let output='';child.stdout.on('data',data=>{output+=data;const url=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];if(url)resolve(url);});}),
      exited.then(()=>{throw Error('Artwork fixture stopped: '+logs);})
    ]);
    await check(origin);
  } finally {child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true});}
}

test('runtime artwork configuration reaches HTML and HEAD without changing document caching or error status',async()=>{
  await withServer('https://media.sofacet.com/',async origin=>{
    const get=await fetch(origin+'/'),body=await get.text();
    assert.equal(get.status,200);
    assert.equal(get.headers.get('cache-control'),'no-cache');
    assert.equal((body.match(/name="sofacet-artwork-cdn"/g)||[]).length,1);
    assert.ok(body.includes('content="https://media.sofacet.com"'));
    assert.equal(Number(get.headers.get('content-length')),Buffer.byteLength(body));
    const head=await fetch(origin+'/',{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(head.headers.get('content-length'),get.headers.get('content-length'));
    assert.equal(await head.text(),'');
    const config=await fetch(origin+'/api/media-config');
    assert.equal(config.headers.get('cache-control'),'no-store');
    assert.equal((await config.json()).artworkBaseURL,'https://media.sofacet.com');
    const missing=await fetch(origin+'/artwork-page-that-does-not-exist',{headers:{Accept:'text/html'}});
    assert.equal(missing.status,404);
    assert.equal(missing.headers.get('cache-control'),'no-store');
    const object=(await collectArtwork()).find(object=>object.file.endsWith('.webp'));
    assert.ok(object,'the upload inventory must include the optimized WebP artwork');
    const image=await fetch(origin+'/'+object.file,{method:'HEAD'});
    assert.equal(image.status,200);
    assert.equal(image.headers.get('content-type'),'image/webp');
    assert.equal(image.headers.get('cache-control'),'public, max-age=31536000, immutable');
    assert.equal(Number(image.headers.get('content-length')),object.bytes);
  });
});

test('empty or invalid CDN configuration retains local-only HTML delivery',async()=>{
  for(const base of ['', 'https://user:secret@media.example.test'])await withServer(base,async origin=>{
    const html=await (await fetch(origin+'/')).text();
    assert.equal(html.includes('name="sofacet-artwork-cdn"'),false);
    assert.equal((await (await fetch(origin+'/api/media-config')).json()).artworkBaseURL,'');
  });
});

test('an unset artwork URL uses the verified production CDN',async()=>{
  await withServer(undefined,async origin=>{
    const config=await (await fetch(origin+'/api/media-config')).json();
    assert.equal(config.artworkBaseURL,'https://media.sofacet.com');
  });
});
