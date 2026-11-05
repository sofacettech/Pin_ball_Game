import test from 'node:test';import assert from 'node:assert/strict';import {withRewardsSite} from './helpers/rewards-fixture.mjs';
test('First Cut signup persists required details and consent once, without changing accounts or sending OTPs',async()=>{
 await withRewardsSite(async({request,readStore,events})=>{
  const valid={fullName:'Test Member',phoneNumber:'9876543210',email:'Join@Example.invalid',adultPrivacyAccepted:true,marketingConsent:true};
  for(const invalid of [{...valid,adultPrivacyAccepted:false},{...valid,marketingConsent:false},{...valid,email:'invalid'},{...valid,phoneNumber:'123'},{...valid,fullName:'<script>'},{...valid,unexpected:true}])assert.equal((await request('/api/first-cuts',invalid)).status,400);
  assert.equal((await readStore()).firstCuts,undefined);
  assert.equal((await request('/api/first-cuts',valid)).status,200);assert.equal((await request('/api/first-cuts',valid)).status,200);
  const saved=Object.values((await readStore()).firstCuts);assert.equal(saved.length,1);assert.equal(saved[0].fullName,'Test Member');assert.equal(saved[0].email,'join@example.invalid');assert.equal(saved[0].phoneNumber,'+919876543210');assert.equal(saved[0].adultPrivacyAccepted,true);assert.equal(saved[0].marketingConsent,true);assert.ok(saved[0].joinedAt>Date.now()-10000);assert.equal(events.length,0);
 });
});
