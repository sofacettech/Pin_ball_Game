import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkAssetURL, normaliseArtworkCDNBase, decodeArtworkImages} from '../shared/artwork-assets.js';
import {collectArtwork} from '../scripts/artwork-manifest.mjs';

test('artwork CDN URLs accept public HTTPS bases and restrict rewriting to hashed raster files', () => {
  const image = '/assets/collective/99e9c8ee37d7118ed1f7.png';
  assert.equal(artworkAssetURL(image,'https://media.sofacet.com/'), 'https://media.sofacet.com/artwork/collective/99e9c8ee37d7118ed1f7.png');
  for (const value of ['', 'http://media.example.test', 'https://user:password@media.example.test', 'https://media.example.test/?token=x', 'javascript:alert(1)']) {
    assert.equal(normaliseArtworkCDNBase(value), '');
    assert.equal(artworkAssetURL(image,value), image);
  }
  for (const path of ['/assets/collective/styles/claim.css', '/assets/collective/meshes/account.html', '/api/account/session', '/assets/collective/../private.png']) {
    assert.equal(artworkAssetURL(path,'https://media.sofacet.com'), path);
  }
});

test('visible artwork becomes eager and decodes without waiting for the hidden responsive composition', async () => {
  const decoded = [];
  const image = (name, width) => ({loading:'lazy', dataset:{}, closest:() => ({offsetWidth:width}), decode:async () => {decoded.push(name);}});
  const mobile=image('mobile',320), desktop=image('desktop',0);
  await decodeArtworkImages({querySelectorAll:() => [mobile,desktop]});
  assert.deepEqual(decoded,['mobile']);
  assert.equal(mobile.loading,'eager');
  assert.equal(desktop.loading,'lazy');
});

test('a failed CDN decode retries the image after its local fallback starts', async () => {
  let calls=0;
  const image={dataset:{},closest:()=>null,decode:async () => {
    if (++calls===1) {image.dataset.artworkFallback='true';throw Error('CDN offline');}
  }};
  await decodeArtworkImages({querySelectorAll:()=>[image]});
  assert.equal(calls,2);
});

test('the upload inventory validates every referenced artwork hash before uploads begin', async () => {
  const objects=await collectArtwork();
  assert.ok(objects.length>30);
  assert.equal(new Set(objects.map(object=>object.key)).size,objects.length);
  for(const object of objects){
    assert.equal(object.key,object.file.replace(/^assets\//,'artwork/'));
    assert.ok(object.bytes>0);
    assert.ok(object.file.includes('/'+object.sha256.slice(0,20)+'.'));
  }
});
