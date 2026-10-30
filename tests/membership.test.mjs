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
 const calls=[],credited=new Map();let customer='cus_test',timeout=false,clock=Date.now(),central={customer_id:'cus_test',phone:valid.phoneNumber,profile_complete:false};
 const provider={request:async()=>({challengeId:'private-provider-id',expiresIn:300,resendAfter:60,deliveryChannel:'whatsapp'}),verify:async ({otp,challengeId})=>{assert.equal(challengeId,'private-provider-id');return otp==='654321'?{verified:true,token:'private-jwt',customer_id:customer,expiresAt:clock+30*60000}: {verified:false}}};
 const api=createMembershipApi({getStore:()=>store,commit:change=>{const previous=structuredClone(store);try{change()}catch(error){store=previous;throw error}},phone:value=>{const result=normalisePhone(value);if(!result)throw new ServiceError(400,'Invalid phone');return result},publicPlayer:p=>({member:!!p.profile,display_name:p.name,best_score:p.best??null}),provider:options.provider??provider,now:()=>clock,profile:options.profile??(async(token,values)=>{assert.equal(token,'private-jwt');if(values)central={...central,...values,profile_complete:true};return central}),score:options.score??(async token=>{assert.equal(token,'private-jwt');return {balance:0,lifetime_earned:0,rank:null}}),award:async args=>{assert.equal(args.token,'private-jwt');calls.push({...args});if(!credited.has(args.eventId))credited.set(args.eventId,args.points);if(timeout){timeout=false;throw new ServiceError(503,'Temporary timeout')}return {balance:[...credited.values()].reduce((a,b)=>a+b,0)}}});
 return {api,calls,credited,get store(){return store},get central(){return central},setCustomer:value=>customer=value,failNext:()=>timeout=true,advance:ms=>clock+=ms};
}
async function verified(fixture,id='one',phoneNumber=valid.phoneNumber,details=valid) {
 const challenge=await fixture.api('/api/membership/otp/request',{phoneNumber,name:details.name,consent:true,...(details.dateOfBirth?{dateOfBirth:details.dateOfBirth}:{})},id);
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
test('unconfigured OTP cannot create an account or credits',async()=>{
 const f=setup({provider:{request:null,verify:null}});
 assert.equal((await f.api('/api/membership/config',{},'one')).otpAvailable,false);
 await assert.rejects(f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one'),status(503));
 await assert.rejects(f.api('/api/membership',valid,'one'),status(503));assert.equal(f.store.players.one.profile,undefined);assert.equal(f.calls.length,0);
});
test('OTP proof is scoped to the player and phone; resend and attempt limits apply',async()=>{
 const f=setup();const challenge=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one');
 await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,otp:'654321',challengeId:challenge.challengeId},'two'),status(410));
 await assert.rejects(f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one'),status(429));
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
 assert.equal(result.savedPoints,3200);assert.equal(result.remainingPoints,5);assert.equal(result.bestPoints,3205);assert.equal(f.calls[0].points,320);assert.equal(result.player.display_name,'Test Nickname');assert.equal(f.central.marketing_consent,false);
 await f.api('/api/membership',payload,'one');assert.equal(f.calls.length,1);
 await Promise.all([f.api('/api/membership',{...payload,gameId:otherGame},'one'),f.api('/api/membership',{...payload,gameId:otherGame},'one')]);assert.equal(f.calls.length,2);assert.equal(f.calls[1].points,90);assert.equal([...f.credited.values()].reduce((a,b)=>a+b,0),410);
 const lower=await f.api('/api/membership',{...payload,gameId:lowerGame},'one');assert.equal(lower.savedPoints,4100);assert.equal(f.calls.length,2);
 f.store.games[gameId].rewardCustomer='cus_other';await assert.rejects(f.api('/api/membership',payload,'one'),status(409));
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

test('single-screen sign-up accepts only the collected details and preserves consent, OTP and reward checks',async()=>{
 const f=setup(),{dateOfBirth,city,...details}=valid,verificationToken=await verified(f,'one',valid.phoneNumber,details),payload={...details,verificationToken};
 for(const change of [{termsAccepted:false},{marketingConsent:null},{email:''},{verificationToken:'invalid'},{points:999999}])await assert.rejects(f.api('/api/membership',{...payload,...change},'one'),status(change.verificationToken?401:400));
 assert.equal(f.store.players.one.profile,undefined);assert.equal(f.calls.length,0);
 const result=await f.api('/api/membership',payload,'one');
 assert.equal(result.player.member,true);assert.equal(result.savedPoints,3200);assert.equal(f.calls[0].points,320);
 assert.equal(f.central.email,valid.email);assert.equal(f.central.marketing_consent,false);
 assert.equal('email' in f.store.players.one.profile,false);assert.equal('city' in f.store.players.one.profile,false);
 f.central.dob='1990-01-01';f.central.city='Delhi';
 await f.api('/api/membership',payload,'one');assert.equal(f.calls.length,1);
 assert.equal(f.central.dob,'1990-01-01');assert.equal(f.central.city,'Delhi');
});

test('registered sessions save verified later games without registering or requesting OTP again',async()=>{
 const f=setup();const verificationToken=await verified(f),payload={...valid,verificationToken};delete payload.gameId;await f.api('/api/membership',payload,'one');
 const first=await f.api('/api/membership/rewards',{gameId},'one');assert.equal(first.pointsSaved,true);assert.equal(first.savedPoints,3200);assert.equal(f.calls.length,1);
 await f.api('/api/membership/rewards',{gameId},'one');assert.equal(f.calls.length,1);
 await Promise.all([f.api('/api/membership/rewards',{gameId:otherGame},'one'),f.api('/api/membership/rewards',{gameId:otherGame},'one')]);assert.equal(f.calls.length,2);assert.equal(f.calls[1].points,90);
 const lower=await f.api('/api/membership/rewards',{gameId:lowerGame},'one');assert.equal(lower.savedPoints,4100);assert.equal(f.calls.length,2);
});
test('registered reward requests require the session member and its own verified game',async()=>{
 const f=setup();
 await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(401));
 const verificationToken=await verified(f),payload={...valid,verificationToken};delete payload.gameId;await f.api('/api/membership',payload,'one');
 for(const data of [{},{gameId:'bad'},{gameId,score:99999},{gameId,customerId:'other'}])await assert.rejects(f.api('/api/membership/rewards',data,'one'),status(400));
 f.store.games[gameId].player='two';await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));
 f.store.games[gameId].player='one';f.store.games[gameId].verified=false;await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));
 f.store.games[gameId].verified=true;f.store.games[gameId].rewardCustomer='other';await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(409));assert.equal(f.calls.length,0);
});
test('a returning member can retry saving points after a lost response without duplicate credit',async()=>{
 const f=setup();const verificationToken=await verified(f),payload={...valid,verificationToken};delete payload.gameId;await f.api('/api/membership',payload,'one');f.failNext();
 await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),status(503));const result=await f.api('/api/membership/rewards',{gameId},'one');assert.equal(result.savedPoints,3200);assert.equal(f.calls[0].eventId,f.calls[1].eventId);assert.equal(f.credited.size,1);
});

test('resend replaces prior registration and proof, expiry rejects verification, and profile edits require a new code',async()=>{
 const f=setup();
 const first=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true,dateOfBirth:valid.dateOfBirth},'one');
 assert.equal(first.resendAfter,60);f.advance(60001);
 const next=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true,dateOfBirth:valid.dateOfBirth},'one');
 await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,challengeId:first.challengeId,otp:'654321'},'one'),status(410));
 const proof=await f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,challengeId:next.challengeId,otp:'654321'},'one');
 await assert.rejects(f.api('/api/membership',{...valid,name:'Changed Name',verificationToken:proof.verificationToken},'one'),status(400));
 f.advance(60001);await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one');
 await assert.rejects(f.api('/api/membership',{...valid,verificationToken:proof.verificationToken},'one'),status(401));
 f.advance(300001);
 await assert.rejects(f.api('/api/membership/otp/verify',{phoneNumber:valid.phoneNumber,challengeId:next.challengeId,otp:'654321'},'one'),status(410));
 assert.equal(f.calls.length,0);assert.equal(f.store.players.one.profile,undefined);
});

test('expired JWT requires new verification and retries the pending award using its original event key',async()=>{
 const f=setup(),verificationToken=await verified(f);f.failNext();
 await assert.rejects(f.api('/api/membership',{...valid,verificationToken},'one'),status(503));
 const eventId=f.calls[0].eventId;f.advance(31*60000);
 await assert.rejects(f.api('/api/membership/rewards',{gameId},'one'),error=>error.status===401&&error.code==='rewards_verification_required');
 assert.equal(f.calls.length,1);
 const fresh=await verified(f);const result=await f.api('/api/membership',{...valid,verificationToken:fresh},'one');
 assert.equal(result.savedPoints,3200);assert.equal(f.calls[1].eventId,eventId);assert.equal(f.credited.size,1);
});

test('a successful OTP exchange survives a transient score lookup failure without consuming the code again',async()=>{
 let verifies=0,lookups=0;
 const provider={request:async()=>({challengeId:'private',expiresIn:300}),verify:async()=>{verifies++;return {verified:true,token:'private-jwt',customer_id:'cus_test',expiresAt:Date.now()+1800000}}};
 const f=setup({provider,score:async()=>{if(++lookups===1)throw new ServiceError(503,'Unavailable');return {balance:0}}});
 const sent=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one');
 const data={phoneNumber:valid.phoneNumber,challengeId:sent.challengeId,otp:'654321'};
 await assert.rejects(f.api('/api/membership/otp/verify',data,'one'),status(503));
 assert.equal((await f.api('/api/membership/otp/verify',data,'one')).verified,true);assert.equal(verifies,1);assert.equal(lookups,2);
 await assert.rejects(f.api('/api/membership/otp/verify',data,'one'),status(410));
});

test('concurrent verification only exchanges a code once and grants no access until the provider confirms it',async()=>{
 let resolveVerification,verifies=0;
 const provider={request:async()=>({challengeId:'private',expiresIn:300}),verify:async()=>{verifies++;return new Promise(resolve=>{resolveVerification=resolve})}};
 const f=setup({provider});const sent=await f.api('/api/membership/otp/request',{phoneNumber:valid.phoneNumber,name:valid.name,consent:true},'one');
 const data={phoneNumber:valid.phoneNumber,challengeId:sent.challengeId,otp:'654321'};
 const pending=f.api('/api/membership/otp/verify',data,'one');
 await assert.rejects(f.api('/api/membership/otp/verify',data,'one'),status(409));
 assert.equal(f.calls.length,0);assert.equal(f.store.players.one.profile,undefined);
 resolveVerification({verified:true,token:'private-jwt',customer_id:'cus_test',expiresAt:Date.now()+1800000});
 assert.equal((await pending).verified,true);assert.equal(verifies,1);
});
