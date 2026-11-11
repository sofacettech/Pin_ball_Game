import {withRewardsSite,member,other,registration} from './helpers/rewards-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {brandParts} from '../shared/brand-text.ts';

test('brand font matches only written brand names, preserving surrounding copy and email addresses',()=>{
 const text='About SO/FACET. Your So / Facet points. SOFACET membership. hello@sofacet.com';
 const parts=brandParts(text);assert.equal(parts.map(p=>p.text).join(''),'About SO/ FACET. Your SO/ FACET points. SO/ FACET membership. hello@sofacet.com');assert.deepEqual(parts.filter(p=>p.brand).map(p=>p.text),['SO/ FACET','SO/ FACET','SO/ FACET']);
 assert.equal(brandParts('Welcome back.')[0].brand,false);
});
test('account sign-in reads the Medusa profile and sign-out invalidates the server token',async()=>{
 await withRewardsSite(async({request,state,events,readStore})=>{
  state.profile.name='Central Member'; state.profile.email='central@example.invalid';
  assert.equal((await request('/api/account')).status,401);
  assert.deepEqual((await request('/api/account/session',undefined,member)).data,{signedIn:false,expiresIn:null},'a saved member profile does not establish a session');
  const sent=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber},other);
  assert.equal(sent.status,200); assert.equal(sent.data.deliveryChannel,'whatsapp');
  const verified=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,challengeId:sent.data.challengeId,otp:'012345'},other);
  assert.deepEqual(verified.data,{verified:true});
  const session=(await request('/api/account/session',undefined,other)).data;
  assert.equal(session.signedIn,true);
  assert.ok(session.expiresIn>0);
  const account=(await request('/api/account',undefined,other)).data;
  assert.equal(account.name,'Central Member');assert.equal(account.email,'central@example.invalid');assert.equal(account.savedPoints,0);
  assert.deepEqual((await readStore()).players[other].profile,{customerId:'cus_fixture',phone:registration.phoneNumber});
  assert.equal((await request('/api/account',undefined,member)).status,401,'a different cookie must still authenticate');
  const signedOut=await request('/api/account/signout',{},other);
  assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await request('/api/account',undefined,other)).status,401,'even a stale cookie cannot reuse the signed-out JWT');
  assert.deepEqual((await request('/api/account/session',undefined,other)).data,{signedIn:false,expiresIn:null});
  assert.equal((await request('/api/account/signout',{},other,{Origin:'https://example.invalid'})).status,403);
  assert.equal(events.filter(e=>e.path==='/rewards/points').length,0);
 },{returningMember:true});
});

test('signed-in leaderboard name edits use the existing account details API',async()=>{
 await withRewardsSite(async({request,state,events})=>{
  const sent=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber});
  assert.equal(sent.status,200);
  const verified=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,challengeId:sent.data.challengeId,otp:'012345'});
  assert.equal(verified.status,200);
  const account=(await request('/api/account')).data;
  const saved=await request('/api/account/details',{name:account.name,leaderboardName:'Chanda R.',email:account.email,phoneNumber:account.phoneNumber,marketingConsent:account.marketingConsent});
  assert.equal(saved.status,200);assert.equal(saved.data.success,true);
  assert.equal((await request('/api/account')).data.leaderboardName,'Chanda R.');
  assert.equal(state.profile.leaderboard_name,'Chanda R.');
  assert(events.some(event=>event.path==='/rewards/profile'&&event.body?.leaderboard_name==='Chanda R.'));
 },{returningMember:true});
});
