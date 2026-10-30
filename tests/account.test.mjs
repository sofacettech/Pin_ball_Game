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
  const sent=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber},other);
  assert.equal(sent.status,200); assert.equal(sent.data.deliveryChannel,'whatsapp');
  const verified=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,challengeId:sent.data.challengeId,otp:'012345'},other);
  assert.deepEqual(verified.data,{verified:true});
  const account=(await request('/api/account',undefined,other)).data;
  assert.equal(account.name,'Central Member');assert.equal(account.email,'central@example.invalid');assert.equal(account.savedPoints,0);
  assert.deepEqual((await readStore()).players[other].profile,{customerId:'cus_fixture',phone:registration.phoneNumber});
  assert.equal((await request('/api/account',undefined,member)).status,401,'a different cookie must still authenticate');
  const signedOut=await request('/api/account/signout',{},other);
  assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await request('/api/account',undefined,other)).status,401,'even a stale cookie cannot reuse the signed-out JWT');
  assert.equal((await request('/api/account/signout',{},other,{Origin:'https://example.invalid'})).status,403);
  assert.equal(events.filter(e=>e.path==='/rewards/points').length,0);
 },{returningMember:true});
});
