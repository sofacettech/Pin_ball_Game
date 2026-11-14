// Observe only network bytes while the initial loader is still preparing video.
// A downgrade is emitted once; explicit resets start a fresh observation period.
export function createVideoTransferPolicy({fallbackBytes=61882825,windowMs=2000,sampleMs=1500,slowForMs=500,maxRemainingMs=20000}={}){
  if(![fallbackBytes,windowMs,sampleMs,maxRemainingMs].every(value=>Number.isFinite(value)&&value>0)||
    !Number.isFinite(slowForMs)||slowForMs<0||sampleMs>windowMs)throw new RangeError('Invalid video transfer policy');
  let history=[],previous=null,badSince=null,initial=true,emitted=false,diagnostic=null;
  function reset(){history=[];previous=null;badSince=null;initial=false;emitted=false;diagnostic=null;}
  function valid(sample){
    return sample&&Number.isFinite(sample.now)&&sample.now>=0&&
      ['bytes','loaded','total','active'].every(key=>Number.isSafeInteger(sample[key])&&sample[key]>=0)&&
      sample.total>0&&sample.bytes<=sample.loaded&&sample.loaded<=sample.total&&
      (sample.active===0||Number.isFinite(sample.startedAt)&&sample.startedAt>=0&&sample.startedAt<=sample.now);
  }
  function rebase(sample,fromStart=false){
    history=[{now:fromStart?sample.startedAt:sample.now,bytes:fromStart?0:sample.bytes}];
    previous={now:sample.now,bytes:sample.bytes,loaded:sample.loaded,total:sample.total,startedAt:sample.startedAt};
    initial=false;badSince=null;diagnostic=null;
  }
  function observe(sample){
    if(sample?.hidden){reset();return null;}
    if(!valid(sample)){reset();return null;}
    if(sample.active===0){if(previous)reset();return null;}
    if(emitted)return null;
    // Cached/idle periods, background throttling and replaced preload instances
    // must never make a new download look like a sustained network stall.
    if(previous&&(sample.now<previous.now||sample.now-previous.now>1250||sample.bytes<previous.bytes||
      sample.loaded<previous.loaded||sample.total!==previous.total||sample.startedAt!==previous.startedAt)){
      reset();rebase(sample);return null;
    }
    if(!previous)rebase(sample,initial);
    const point={now:sample.now,bytes:sample.bytes},last=history.at(-1);
    if(last.now===point.now)last.bytes=point.bytes;else history.push(point);
    // Snapshot counters: callers may reuse their progress object on the next tick.
    previous={now:sample.now,bytes:sample.bytes,loaded:sample.loaded,total:sample.total,startedAt:sample.startedAt};
    const cutoff=sample.now-windowMs;
    while(history.length>1&&history[1].now<=cutoff)history.shift();
    const first=history[0],next=history[1];
    let start=first.now,startBytes=first.bytes;
    if(next&&start<cutoff){
      startBytes+=(next.bytes-first.bytes)*(cutoff-start)/(next.now-start);
      start=cutoff;
    }
    const observedMs=sample.now-start,received=sample.bytes-startBytes,remainingBytes=sample.total-sample.loaded;
    const mbps=observedMs>0?received*8/(observedMs*1000):0;
    const estimatedRemainingMs=remainingBytes===0?0:received>0?remainingBytes*observedMs/received:Infinity;
    const bad=observedMs>=sampleMs&&remainingBytes>fallbackBytes*1.2&&estimatedRemainingMs>maxRemainingMs;
    if(!bad)badSince=null;else if(badSince===null)badSince=sample.now;
    diagnostic={mbps,observedMs,estimatedRemainingMs,remainingBytes,discardedBytes:sample.bytes,
      slowForMs:badSince===null?0:sample.now-badSince};
    if(!bad||sample.now-badSince<slowForMs)return null;
    emitted=true;
    return {reason:'slow-network',mbps,observedMs,estimatedRemainingMs,remainingBytes,discardedBytes:sample.bytes};
  }
  return {observe,reset,get diagnostic(){return diagnostic?{...diagnostic}:null;}};
}
