import test from 'node:test';
import assert from 'node:assert/strict';
import {createMembershipApi} from '../membership-api.mjs';
import {ServiceError} from '../rewards.mjs';
import {normalisePhone,isAdult,pendingResult} from '../membership-source/src/api.js';

const gameId='ab001122-0000-4000-8000-001122334455';
const otherGame='ab001122-0000-4000-8000-001122334456';
const lowerGame='ab001122-0000-4000-8000-001122334457';
const valid={name:'Test Member',leaderboardName:'Test Nickname',email:'test@example.invalid',dateOfBirth:'1990-01-01',city:'Delhi',termsAccepted:true,marketingConsent:false,phoneNumber:'+919876543210',gameId};
process.env.MEMBERSHIP_TERMS_URL='https://example.invalid/terms';
process.env.MEMBERSHIP_PRIVACY_URL='https://example.invalid/privacy';
function setup(options={}) {
 let store={players:{one:{name:'Guest'},two:{name:'Other guest'}},games:{[gameId]:{player:'one',verified:true,score:3205},[otherGame]:{player:'one',verified:true,score:4100},[lowerGame]:{player:'one',verified:true,score:1000}}};
 const calls=[],credited=new Map();let customer='cus_test',timeout=false;
 const provider={request:async()=>({challengeId:'private-provider-id',expiresIn:300}),verify:async ({otp,challengeId})=>{assert.equal(challengeId,'private-provider-id');return {verified:otp==='654321'}}};
 const api=createMembershipApi({getStore:()=>store,commit:change=>{const previous=structuredClone(store);try{change()}catch(error){store=previous;throw error}},phone:value=>{const result=normalisePhone(value);if(!result)throw new ServiceError(400,'Invalid phone');return result},publicPlayer:p=>({member:!!p.profile,display_name:p.name,best_score:p.best??null}),provider:options.provider??provider,authenticate:async()=>({customer_id:customer,created:true,balance:0}),award:async args=>{calls.push({...args});if(!credited.has(args.eventId))credited.set(args.eventId,args.points);if(timeout){timeout=false;throw new ServiceError(503,'Temporary timeout')}return {balance:[...credited.values()].reduce((a,b)=>a+b,0)}}});
 return {api,calls,credited,get store(){return store},setCustomer:value=>customer=value,failNext:()=>timeout=true};
}
async function verified(fixture,id='one',phoneNumber=valid.phoneNumber) {
 const challenge=await fixture.api('/api/membership/otp/request',{phoneNumber},id);
 assert.notEqual(challenge.challengeId,'private-provider-id');
 const result=await fixture.api('/api/membership/otp/verify',{phoneNumber,otp:'654321',challengeId:challenge.challengeId},id);
 assert.equal(result.verified,true);return result.verificationToken;
}
const status=code=>error=>error instanceof ServiceError&&error.status===code;

test('Indian phone validation, age boundaries and untrusted pending context',()=>{
 assert.equal(normalisePhone('98765 43210'),'+919876543210');assert.equal(normalisePhone('+91 (98765) 43210'),'+919876543210');assert.equal(normalisePhone('09876543210'),'+919876543210');assert.equal(normalisePhone('+12025550123'),null);
 assert.equal(isAdult('2008-10-19',new Date(2026,9,19)),true);assert.equal(isAdult('2008-10-20',new Date(2026,9,19)),false);assert.equal(isAdult('2000-02-30'),false);
 assert.equal(pendingResult({points:3200,rewardValue:999,completedAt:Date.now(),status:'completed'}),null);
 assert.equal(pendingResult({points:3200,rewardValue:320,completedAt:Date.now(),status:'completed',gameId}).points,3200);
});
test('production OTP hooks stay blank, and no account or credits are fabricated',async()=>{
 const f=setup({provider:{request:null,verify:null}});
 assert.equal((await f.api('/api/membership/config',{},'one')).otpAvailable,false);
 await assert.rejects(f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber},'one'),status(503));
 await assert.rejects(f.api('/api/membership',valid,'one'),status(503));assert.equal(f.store.players.one.profile,undefined);assert.equal(f.calls.length,0);
});
test('OTP proof is scoped to the player and phone; resend and attempt limits apply',async()=>{
 const f=setup();const challenge=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber},'one');
 await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,otp:'654321',challengeId:challenge.challengeId},'two'),status(410));
 await assert.rejects(f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber},'one'),status(429));
 for(let i=0;i<5;i++)await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,otp:'000000',challengeId:challenge.challengeId},'one'),status(400));
 await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,otp:'654321',challengeId:challenge.challengeId},'one'),status(429));
 const next=setup(),proof=await verified(next);
 await assert.rejects(next.api('/api/membership',{...valid,verificationToken:proof},'two'),status(401));
 await assert.rejects(next.api('/api/membership',{...valid,verificationToken:proof,phoneNumber:'+919876543211'},'one'),status(401));
});
test('server validates details and ignores no client-supplied score or reward',async()=>{
 const f=setup(),verificationToken=await verified(f),payload={...valid,verificationToken};
 for(const change of [{termsAccepted:false},{dateOfBirth:'2020-01-01'},{dateOfBirth:'2000-02-30'},{email:'bad'},{city:''},{leaderboardName:'x'.repeat(31)},{score:999999},{points:999999},{rewardValue:999999}])await assert.rejects(f.api('/api/membership',{...payload,...change},'one'),status(400));
 const policy=process.env.MEMBERSHIP_TERMS_URL;delete process.env.MEMBERSHIP_TERMS_URL;try{await assert.rejects(f.api('/api/membership',payload,'one'),status(503))}finally{process.env.MEMBERSHIP_TERMS_URL=policy}
 f.store.games[gameId].verified=false;await assert.rejects(f.api('/api/membership',payload,'one'),status(409));assert.equal(f.calls.length,0);
});
test('verified scores credit 10 game points per ₹1, once; improvements grant only the difference',async()=>{
 const f=setup(),verificationToken=await verified(f),payload={...valid,verificationToken};
 const result=await f.api('/api/membership',payload,'one');
 assert.equal(result.savedPoints,3200);assert.equal(result.remainingPoints,5);assert.equal(result.bestPoints,3205);assert.equal(f.calls[0].points,320);assert.equal(result.player.display_name,'Test Nickname');assert.equal(f.store.players.one.profile.marketingConsent,false);
 await f.api('/api/membership',payload,'one');assert.equal(f.calls.length,1);
 await Promise.all([f.api('/api/membership',{...payload,gameId:otherGame},'one'),f.api('/api/membership',{...payload,gameId:otherGame},'one')]);assert.equal(f.calls.length,2);assert.equal(f.calls[1].points,90);assert.equal([...f.credited.values()].reduce((a,b)=>a+b,0),410);
 const lower=await f.api('/api/membership',{...payload,gameId:lowerGame},'one');assert.equal(lower.savedPoints,4100);assert.equal(f.calls.length,2);
 f.setCustomer('cus_other');await assert.rejects(f.api('/api/membership',payload,'one'),status(409));
});
test('a lost upstream response retries the persisted idempotency key without double credit',async()=>{
 const f=setup(),verificationToken=await verified(f),payload={...valid,verificationToken};f.failNext();
 await assert.rejects(f.api('/api/membership',payload,'one'),status(503));assert.ok(f.store.rewardAccounts.cus_test.pending);
 const result=await f.api('/api/membership',payload,'one');assert.equal(result.savedPoints,3200);assert.equal(f.calls[0].eventId,f.calls[1].eventId);assert.equal(f.credited.size,1);assert.equal(f.store.rewardAccounts.cus_test.pending,undefined);
});
test('membership without a completed game never invents reward credits',async()=>{
 const f=setup(),verificationToken=await verified(f),payload={...valid,verificationToken};delete payload.gameId;
 const result=await f.api('/api/membership',payload,'one');assert.equal(result.pointsSaved,false);assert.equal(result.player.member,true);assert.equal(f.calls.length,0);
});

test('registered sessions save verified later games without registering or requesting OTP again',async()=>{
 const f=setup({provider:{request:null,verify:null}});f.store.players.one.profile={customerId:'cus_test',phone:valid.phoneNumber};
 const first=await f.api('/api/membership/rewards',{gameId},'one');assert.equal(first.pointsSaved,true);assert.equal(first.savedPoints,3200);assert.equal(f.calls.length,1);
 await f.api('/api/membership/rewards',{gameId},'one');assert.equal(f.calls.length,1);
 await Promise.all([f.api('/api/membership/rewards',{gameId:otherGame},'one'),f.api('/api/membership/rewards',{gameId:otherGame},'one')]);assert.equal(f.calls.length,2);assert.equal(f.calls[1].points,90);
 const lower=await f.api('/api/membership/rewards',{gameId:lowerGame},'one');assert.equal(lower.savedPoints,4100);assert.equal(f.calls.length,2);
});
test('registered reward requests require the session member and its own verified game',async()=>{
 const f=setup({provider:{request:null,verify:null}});
 await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(401));
 f.store.players.one.profile={customerId:'cus_test',phone:valid.phoneNumber};
 for(const data of [{},{gameId:'bad'},{gameId,score:99999},{gameId,customerId:'other'}])await assert.rejects(f.api('/api/membership/rewards',data,'one'),status(400));
 f.store.games[gameId].player='two';await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));
 f.store.games[gameId].player='one';f.store.games[gameId].verified=false;await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));
 f.store.games[gameId].verified=true;f.store.games[gameId].rewardCustomer='other';await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));assert.equal(f.calls.length,0);
});
test('a returning member can retry saving points after a lost response without duplicate credit',async()=>{
 const f=setup({provider:{request:null,verify:null}});f.store.players.one.profile={customerId:'cus_test',phone:valid.phoneNumber};f.failNext();
 await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(503));const result=await f.api('/api/membership/rewards',{gameId},'one');assert.equal(result.savedPoints,3200);assert.equal(f.calls[0].eventId,f.calls[1].eventId);assert.equal(f.credited.size,1);
});
