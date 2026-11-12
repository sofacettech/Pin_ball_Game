import test from 'node:test';import assert from 'node:assert/strict';
import {withRewardsSite,member,registration} from './helpers/rewards-fixture.mjs';
import {routeDocuments,canonicalHref,setScreenRoute} from '../site-routes.js';

test('public URLs serve the existing documents, including direct refresh and HEAD',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const [route,document] of Object.entries(routeDocuments))for(const method of ['GET','HEAD']){
   const response=await fetch(origin+route,{method,redirect:'manual'});
   assert.equal(response.status,route==='/404'?404:200,route);
   assert.match(response.headers.get('content-type'),/text\/html/,route);
   assert.equal(response.headers.get('location'),null,route);
   if(method==='GET')assert.match(await response.text(),/<html/i,document);
  }
  for(const [old,current] of [['/play.html','/game'],['/account.html?view=signin','/sign-in'],['/membership.html?from=score','/claim'],['/exit','/notify'],['/membership.html?from=collective','/join'],['/faq.html','/how-coins-work'],['/terms/','/terms']]){
   const response=await fetch(origin+old,{redirect:'manual'});assert.equal(response.status,308,old);assert.equal(response.headers.get('location'),current);
  }
  assert.equal((await fetch(origin+'/site-routes.js')).status,200);
 });
});
test('Launching opens Notify only for an active sign-in and keeps game navigation context',async()=>{
 await withRewardsSite(async({origin,request})=>{
  const launch=(path,method='GET')=>fetch(origin+path,{method,headers:{Cookie:'sofacet_pinball_player='+member},redirect:'manual'});
  const guest=await launch('/launch');
  assert.equal(guest.status,200);
  assert.equal(guest.headers.get('cache-control'),'no-store');
  assert.match(await guest.text(),/id="launch-root"/);
  const sent=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber});
  assert.equal(sent.status,200);
  const verified=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,challengeId:sent.data.challengeId,otp:'012345'});
  assert.equal(verified.status,200);
  for(const [path,destination] of [['/launch','/notify'],['/launch?nav=game','/notify?nav=game']])for(const method of ['GET','HEAD']){
   const response=await launch(path,method);
   assert.equal(response.status,302);
   assert.equal(response.headers.get('location'),destination);
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal((await request('/api/account/signout',{})).status,200);
  assert.equal((await launch('/launch')).status,200);
 },{returningMember:true});
});
test('legacy fragments map to distinct screens and game history updates the outer address',t=>{
 assert.equal(canonicalHref('/play.html#leaderboard'),'/leaderboard');
 assert.equal(canonicalHref('/faq.html#contact'),'/contact');
 assert.equal(canonicalHref('/membership.html?from=account'),'/join?from=account');
 assert.equal(canonicalHref('//other.example/path'),'//other.example/path');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),calls=[];
 const host={location:{pathname:'/game',search:'',hash:''},history:{state:{sofacetGame:true},pushState:(state,_,url)=>calls.push({state,url}),replaceState:(state,_,url)=>calls.push({state,url})}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{top:host,name:'',frameElement:null}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window});
 setScreenRoute('/reward',{replace:false});
 assert.deepEqual(calls,[{state:{sofacetGame:true},url:'/reward'}]);
});
test('unknown document URLs render the React 404 page; missing assets and API errors keep their errors',async()=>{
 await withRewardsSite(async({origin})=>{
  for(const path of ['/missing-page','/some/deep/path/missing.html','/404'])for(const method of ['GET','HEAD']){
   const response=await fetch(origin+path,{method,headers:{Accept:'text/html'},redirect:'manual'});assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('content-type'),/text\/html/);
   const html=await response.text();
   if(method==='HEAD')assert.equal(html,'');
   else{assert.match(html,/id="not-found-root"/);assert.match(html,/src="\/assets\/sofacet-not-found-[^"]+\.js"/);assert.match(html,/name="robots" content="noindex, follow"/)}
  }
  const asset=await fetch(origin+'/assets/missing.js');assert.equal(asset.status,404);
  const api=await fetch(origin+'/api/not-a-route',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(api.status,404);assert.match(api.headers.get('content-type'),/application\/json/);
  const faq=await fetch(origin+'/how-coins-work',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(faq.status,200);assert.match(faq.headers.get('content-type'),/text\/html/);
 });
});
