import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTransferPolicy} from '../entrance-source/video-transfer-policy.mjs';

const total=200000000;
const sample=(now,bytes,extra={})=>({now,bytes,startedAt:0,active:1,loaded:bytes,total,...extra});
function observeUntil(policy,end,bytesAt,extraAt=()=>({}),start=0){
  const decisions=[];
  for(let now=start;now<=end;now+=250){
    const result=policy.observe(sample(now,bytesAt(now),extraAt(now)));
    if(result)decisions.push({now,...result});
  }
  return decisions;
}

test('fast transfers retain 4K and report the recent network speed',()=>{
  const policy=createVideoTransferPolicy();
  assert.deepEqual(observeUntil(policy,4000,now=>now*20000),[]);
  assert.equal(policy.diagnostic.mbps,160);
  assert.equal(policy.diagnostic.observedMs,2000);
});

test('a sustained slow transfer downgrades at two seconds and emits only once',()=>{
  const policy=createVideoTransferPolicy();
  const decisions=observeUntil(policy,4000,now=>now*1000);
  assert.equal(decisions.length,1);
  assert.deepEqual(decisions[0],{now:2000,reason:'slow-network',mbps:8,observedMs:2000,
    estimatedRemainingMs:198000,remainingBytes:198000000,discardedBytes:2000000});
});

test('a brief dip in an otherwise fast transfer does not restart the download',()=>{
  const policy=createVideoTransferPolicy();
  const bytesAt=now=>now<=2000?now*20000:now<=2500?40000000:40000000+(now-2500)*20000;
  assert.deepEqual(observeUntil(policy,5000,bytesAt),[]);
});

test('rolling throughput detects a later slowdown despite a fast opening',()=>{
  const policy=createVideoTransferPolicy();
  const decisions=observeUntil(policy,6000,now=>now<=3000?now*20000:60000000+(now-3000)*1000);
  assert.equal(decisions.length,1);
  assert.equal(decisions[0].now,5000);
  assert.equal(decisions[0].mbps,8);
  assert.equal(decisions[0].remainingBytes,138000000);
});

test('nearly complete 4K is retained when restarting HD would cost more bytes',()=>{
  const policy=createVideoTransferPolicy();
  assert.deepEqual(observeUntil(policy,4000,now=>now*1000,now=>({loaded:130000000+now*1000})),[]);
});

test('remaining bytes must strictly exceed the fallback safety margin',()=>{
  const policy=createVideoTransferPolicy({fallbackBytes:50000000});
  assert.deepEqual(observeUntil(policy,2000,now=>now*1000,now=>({loaded:138000000+now*1000})),[]);
  assert.equal(policy.diagnostic.remainingBytes,60000000);
});

test('an all-cached preload and idle network never produce a downgrade',()=>{
  const policy=createVideoTransferPolicy();
  for(const now of [0,2000,10000])assert.equal(policy.observe(sample(now,0,{loaded:total,active:0,startedAt:null})),null);
  assert.equal(policy.diagnostic,null);
});

test('partial cache hits reduce remaining bytes without inflating measured Mbps',()=>{
  const policy=createVideoTransferPolicy();
  const [decision]=observeUntil(policy,2000,now=>now*1000,now=>({loaded:100000000+now*1000}));
  assert.equal(decision.mbps,8);
  assert.equal(decision.remainingBytes,98000000);
  assert.equal(decision.discardedBytes,2000000);
});

test('a time-to-first-byte stall includes the first network request time',()=>{
  const policy=createVideoTransferPolicy();
  assert.equal(policy.observe(sample(1500,0)),null);
  const decision=policy.observe(sample(2000,0));
  assert.equal(decision.reason,'slow-network');
  assert.equal(decision.mbps,0);
  assert.equal(decision.observedMs,2000);
  assert.equal(decision.estimatedRemainingMs,Infinity);
});

test('observations before the first uncached request do not lose its TTFB baseline',()=>{
  const policy=createVideoTransferPolicy();
  assert.equal(policy.observe(sample(0,0,{active:0,startedAt:null,loaded:50000000})),null);
  assert.equal(policy.observe(sample(1750,0,{startedAt:250,loaded:50000000})),null);
  assert.equal(policy.observe(sample(2250,0,{startedAt:250,loaded:50000000})).reason,'slow-network');
});

test('explicit reset rebases at current progress instead of the original request time',()=>{
  const policy=createVideoTransferPolicy();
  observeUntil(policy,1500,now=>now*1000);
  policy.reset();
  const decisions=observeUntil(policy,4000,now=>now*1000,()=>({}),1750);
  assert.equal(decisions[0].now,3750);
});

test('hide and resume discard the interrupted speed sample',()=>{
  const policy=createVideoTransferPolicy();
  observeUntil(policy,1500,now=>now*1000);
  assert.equal(policy.observe(sample(1750,1750000,{hidden:true})),null);
  const decisions=observeUntil(policy,4250,now=>now*1000,()=>({}),2000);
  assert.equal(decisions[0].now,4000);
});

test('a long observer gap does not count as a slow network window',()=>{
  const policy=createVideoTransferPolicy();
  observeUntil(policy,1500,now=>now*1000);
  const decisions=observeUntil(policy,5250,now=>now*1000,()=>({}),3000);
  assert.equal(decisions[0].now,5000);
});

test('an idle interval resets the sample before another network transfer',()=>{
  const policy=createVideoTransferPolicy();
  observeUntil(policy,1500,now=>now*1000);
  assert.equal(policy.observe(sample(1750,1500000,{active:0,loaded:50000000})),null);
  const decisions=observeUntil(policy,4250,now=>1500000+(now-2000)*1000,now=>({loaded:50000000+(now-2000)*1000}),2000);
  assert.equal(decisions[0].now,4000);
});

test('regressing network counters rebase without interpreting old bytes as a stall',()=>{
  const policy=createVideoTransferPolicy();
  observeUntil(policy,1500,now=>now*1000);
  const decisions=observeUntil(policy,4000,now=>10+(now-1750)*1000,()=>({}),1750);
  assert.equal(decisions[0].now,3750);
});

test('backwards time and changed preload totals start a fresh observation period',()=>{
  for(const extra of [{now:1250},{total:210000000},{startedAt:500},{loaded:1400000,bytes:1400000}]){
    const policy=createVideoTransferPolicy();
    observeUntil(policy,1500,now=>now*1000);
    assert.equal(policy.observe(sample(1750,1750000,extra)),null);
    assert.equal(policy.diagnostic,null);
  }
});

test('invalid samples are rejected and cannot leave a pending downgrade armed',()=>{
  for(const extra of [{bytes:NaN},{now:Infinity},{active:-1},{loaded:total+1},{startedAt:2000},{bytes:2000000,loaded:1000000}]){
    const policy=createVideoTransferPolicy();
    observeUntil(policy,1500,now=>now*1000);
    assert.equal(policy.observe(sample(1750,1750000,extra)),null);
    assert.equal(policy.diagnostic,null);
    const decisions=observeUntil(policy,4250,now=>now*1000,()=>({}),2000);
    assert.equal(decisions[0].now,4000);
  }
});

test('caller-owned sample objects and returned diagnostics cannot mutate history',()=>{
  const policy=createVideoTransferPolicy(),progress=sample(0,0);
  assert.equal(policy.observe(progress),null);
  Object.assign(progress,sample(1500,1500000));
  // The observer gap is too long, so establish a new baseline here.
  assert.equal(policy.observe(progress),null);
  for(const now of [1750,2000,2250,2500,2750,3000]){
    Object.assign(progress,sample(now,now*1000));assert.equal(policy.observe(progress),null);
  }
  policy.diagnostic.slowForMs=99999;
  Object.assign(progress,sample(3250,3250000));assert.equal(policy.observe(progress),null);
  Object.assign(progress,sample(3500,3500000));assert.equal(policy.observe(progress).reason,'slow-network');
});

test('a reused sample object still detects a regression immediately after rebasing',()=>{
  const policy=createVideoTransferPolicy(),progress=sample(0,0);
  policy.observe(progress);
  Object.assign(progress,sample(1500,1500000));policy.observe(progress);
  Object.assign(progress,sample(1750,100));
  assert.equal(policy.observe(progress),null);
  assert.equal(policy.diagnostic,null);
});

test('custom observation and persistence periods control the earliest decision',()=>{
  const policy=createVideoTransferPolicy({windowMs:1000,sampleMs:1000,slowForMs:250});
  const decisions=observeUntil(policy,1500,now=>now*1000);
  assert.equal(decisions[0].now,1250);
  assert.equal(decisions[0].observedMs,1000);
});

test('configuration rejects impossible observation windows',()=>{
  for(const options of [{windowMs:0},{sampleMs:2500},{fallbackBytes:-1},{slowForMs:-1},{maxRemainingMs:Infinity}])
    assert.throws(()=>createVideoTransferPolicy(options),RangeError);
});
