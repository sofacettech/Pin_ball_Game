import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {selectMediaVariant,mediaURL} from '../assets/media-delivery.js';

test('phones, tablets, limited memory and data-saving connections use the mobile profile',()=>{
 for(const device of [{width:390},{width:1024},{width:1440,coarse:true},{width:1440,saveData:true},{width:1440,memory:4},{width:1440,effectiveType:'slow-2g'}]){
  assert.equal(selectMediaVariant(device),'mobile');
 }
 assert.equal(selectMediaVariant({width:1440,memory:8}),'desktop');
});

test('media URLs use the exact content-addressed R2 object and retain local fallback',()=>{
 const asset={file:'journey.mp4',key:'videos/abc/journey.mp4'},local=new URL('https://app.example/assets/');
 assert.equal(mediaURL(asset,'https://media.example',local),'https://media.example/videos/abc/journey.mp4');
 assert.equal(mediaURL(asset,'https://media.example/release/',local),'https://media.example/release/videos/abc/journey.mp4');
 assert.equal(mediaURL(asset,'',local),'https://app.example/assets/journey.mp4');
 for(const base of ['http://media.example','https://user:secret@media.example','https://media.example?x=1']){
  assert.throws(()=>mediaURL(asset,base,local),/Invalid media CDN/);
 }
});

test('each published variant matches its own byte index and preserves the full timeline',async()=>{
 const base=new URL('../assets/',import.meta.url),manifest=JSON.parse(await readFile(new URL('video-manifest.json',base),'utf8'));
 const indexes=[];
 for(const variant of Object.values(manifest.variants)){
  const movie=variant.journey,index=JSON.parse(await readFile(new URL(movie.index,base),'utf8'));
  indexes.push(index);
  assert.equal(index.sha256,movie.sha256);assert.equal(index.bytes,movie.bytes);
  assert.equal(index.source,'./'+movie.file);
  assert.equal(index.width,movie.width);assert.equal(index.height,movie.height);
  assert.equal(index.frameCount,index.frames.length);
  assert.equal(index.fps,60);assert.ok(index.frameCount>=1925);
  for(const asset of [movie,variant.opening]){
   assert.equal((await stat(new URL(asset.file,base))).size,asset.bytes);
   assert.equal(asset.key,`videos/${asset.sha256}/${asset.file}`);
  }
 }
 assert.equal(indexes[0].frameCount,indexes[1].frameCount);
 // Quality must never silently drop on phones: both profiles use the same approved encode.
 assert.deepEqual(manifest.variants.mobile,manifest.variants.desktop);
 assert.deepEqual([indexes[1].width,indexes[1].height],[1920,1080]);
 assert.equal(indexes[1].sha256,'b68fb0f2edd851e63ea4cb66708af840316cc7e91ea56beb15e790b4db3e4ff2');
});
