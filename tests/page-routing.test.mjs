import test from 'node:test';import assert from 'node:assert/strict';
import {withRewardsSite} from './helpers/rewards-fixture.mjs';
test('unknown document URLs render the React 404 page; missing assets and API errors keep their errors',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const path of ['/missing-page','/some/deep/path/missing.html','/404.html'])for(const method of ['GET','HEAD']){
   const response=await fetch(origin+path,{method,headers:{Accept:'text/html'},redirect:'manual'});assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('content-type'),/text\/html/);
   const html=await response.text();
   if(method==='HEAD')assert.equal(html,'');
   else{assert.match(html,/id="not-found-root"/);assert.match(html,/src="\/assets\/sofacet-not-found-[^"]+\.js"/);assert.match(html,/name="robots" content="noindex, follow"/)}
  }
  const asset=await fetch(origin+'/assets/missing.js');assert.equal(asset.status,404);
  const api=await fetch(origin+'/api/not-a-route',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(api.status,404);assert.match(api.headers.get('content-type'),/application\/json/);
  const faq=await fetch(origin+'/faq.html',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(faq.status,200);assert.match(faq.headers.get('content-type'),/text\/html/);
 });
});
