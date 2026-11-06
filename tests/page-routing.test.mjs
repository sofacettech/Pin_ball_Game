import test from 'node:test';import assert from 'node:assert/strict';
import {withRewardsSite} from './helpers/rewards-fixture.mjs';
test('unknown document URLs return visitors Home; missing assets and API errors keep their errors',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const method of ['GET','HEAD']){
   const response=await fetch(origin+'/missing-page',{method,headers:{Accept:'text/html'},redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');assert.equal(await response.text(),'');
  }
  const asset=await fetch(origin+'/assets/missing.js');assert.equal(asset.status,404);
  const api=await fetch(origin+'/api/not-a-route',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(api.status,404);assert.match(api.headers.get('content-type'),/application\/json/);
  const faq=await fetch(origin+'/faq.html',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(faq.status,200);assert.match(faq.headers.get('content-type'),/text\/html/);
 });
});
