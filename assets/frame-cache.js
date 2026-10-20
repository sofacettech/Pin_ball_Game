export const FRAME_CACHE_DEFAULTS={behind:12,ahead:24,prefetch:56,network:3,decoded:8,compressedBytes:8*1024*1024,idleMs:100};

export function createFrameCache({count,source,onReady,onError,config={}}){
 const settings={...FRAME_CACHE_DEFAULTS,...config},compressed=new Map(),decoded=new Map(),active=new Map(),failures=new Map();
 for(const name of ['behind','ahead','prefetch','network','decoded','compressedBytes','idleMs'])if(!Number.isSafeInteger(settings[name])||settings[name]<(name==='behind'||name==='ahead'?0:1))throw RangeError('Invalid frame cache setting: '+name);
 let target=0,lead=0,direction=1,order=[],timer,decoding=false,suspended=false,destroyed=false,bytes=0,lastChange=0,requestedAt=0;
 const counters={hits:0,decodedTotal:0,evictions:0,cancelled:0,peakDecoded:0,peakNetwork:0,latencyMs:0};
 const touch=(map,key,value)=>{map.delete(key);map.set(key,value)};
 function plan(){
  const result=new Set([target,lead]);
  const valid=frame=>frame>=0&&frame<count,add=frame=>{if(valid(frame))result.add(frame)},limit=Math.min(settings.prefetch,count);
  for(let i=1;i<=Math.max(settings.ahead,settings.behind);i++){if(i<=settings.ahead)add(target+i*direction);if(i<=settings.behind)add(target-i*direction)}
  for(let i=settings.ahead+1;result.size<limit&&valid(target+i*direction);i++)add(target+i*direction);
  for(let i=settings.behind+1;result.size<limit&&valid(target-i*direction);i++)add(target-i*direction);
  order=[...result].slice(0,settings.prefetch);
 }
 function trim(){
  while(compressed.size>settings.prefetch||bytes>settings.compressedBytes){const key=compressed.keys().next().value;bytes-=compressed.get(key)?.byteLength||0;compressed.delete(key)}
  while(decoded.size>settings.decoded){const key=[...decoded.keys()].find(key=>key!==target);decoded.get(key).close();decoded.delete(key);counters.evictions++}
 }
 function arm(){clearTimeout(timer);if(!suspended&&!destroyed)timer=setTimeout(pump,settings.idleMs)}
 function fail(error,frame,transient=false){
  if(destroyed||suspended||error.name==='AbortError')return;
  if(!transient&&source.fallback()){for(const controller of active.values())controller.abort();for(const image of decoded.values())image.close();decoded.clear();compressed.clear();bytes=0;failures.clear();onReady();arm();return}
  failures.set(frame,Date.now()+1000);if(frame===target)onError(error,frame);clearTimeout(timer);timer=setTimeout(pump,1000);
 }
 function pump(){
  if(destroyed||suspended)return;
  const quiet=performance.now()-lastChange>=settings.idleMs,video=source.mode==='video';
  const downloads=quiet&&!video?order:[target,lead];
  for(const frame of downloads){
   if(active.size>=(video?1:settings.network))break;
   if(compressed.has(frame)||decoded.has(frame)||active.has(frame)||(failures.get(frame)||0)>Date.now())continue;
   if(frame!==target&&frame!==lead&&bytes+256*1024>settings.compressedBytes)break;
   const controller=new AbortController();active.set(frame,controller);counters.peakNetwork=Math.max(counters.peakNetwork,active.size);
   source.load(frame,controller.signal,settings.compressedBytes).then(data=>{
    if(destroyed||suspended||controller.signal.aborted)return;
    if(data?.byteLength>settings.compressedBytes)throw Error('A compressed frame exceeds the cache budget');
    if(order.includes(frame)){compressed.set(frame,data);bytes+=data?.byteLength||0;trim()}
   }).catch(error=>fail(error,frame,['TypeError','NetworkError','TimeoutError'].includes(error.name))).finally(()=>{active.delete(frame);pump()});
  }
  if(decoding)return;
  const warm=source.stats.decodeMs>16?1:Math.floor(settings.decoded/2);
  const near=quiet&&!video?order.filter(frame=>Math.abs(frame-target)<=warm).slice(0,settings.decoded):[target];
  const next=near.find(frame=>!decoded.has(frame)&&compressed.has(frame)&&(failures.get(frame)||0)<=Date.now());
  if(next===undefined){
   if(!active.size){const retry=Math.min(...downloads.map(frame=>failures.get(frame)||Infinity).filter(time=>time>Date.now()));if(Number.isFinite(retry)){clearTimeout(timer);timer=setTimeout(pump,Math.max(1,retry-Date.now()))}}
   return;
  }
  decoding=true;
  source.decode(next,compressed.get(next)).then(image=>{
   if(destroyed||suspended||!order.includes(next)){image.close();return}
   if(image.transient&&next!==target){onReady(next,image);return}
   decoded.set(next,image);trim();counters.decodedTotal++;counters.peakDecoded=Math.max(counters.peakDecoded,decoded.size);
   if(next===target)counters.latencyMs=performance.now()-requestedAt;
   onReady(next,image);
  }).catch(error=>fail(error,next)).finally(()=>{decoding=false;pump()});
 }
 function request(frame,next=frame){
  if(!Number.isInteger(frame)||frame<0||frame>=count||!Number.isInteger(next)||next<0||next>=count)throw RangeError('Frame is outside the source sequence');
  if(order.length&&target===frame&&lead===next)return;
  if(next!==lead)direction=Math.sign(next-lead);
  target=frame;lead=next;requestedAt=lastChange=performance.now();plan();
  for(const [frame,image] of decoded)if(image.transient&&frame!==target)decoded.delete(frame);
  for(const [frame,data] of compressed)if(!order.includes(frame)){bytes-=data?.byteLength||0;compressed.delete(frame)}
  for(const [frame,controller] of active)if(!order.includes(frame)&&!controller.signal.aborted){controller.abort();counters.cancelled++}
  if(decoded.has(frame)){counters.hits++;counters.latencyMs=0}
  pump();arm();
 }
 request(0);
 return{request,get(frame){const image=decoded.get(frame);if(image)touch(decoded,frame,image);return image},
  get stats(){return{...counters,target,direction,decoded:decoded.size,decodedBytes:decoded.size*1920*1080*4,compressed:compressed.size,compressedBytes:bytes,pending:active.size+(decoding?1:0),network:active.size,queued:(source.mode==='video'?[...new Set([target,lead])]:order).filter(i=>!compressed.has(i)&&!decoded.has(i)&&!active.has(i)).length,settings,...source.stats}},
  suspend(){suspended=true;clearTimeout(timer);for(const controller of active.values())controller.abort();for(const [frame,image] of decoded)if(image.transient)decoded.delete(frame);source.suspend?.()},
  resume(){if(!destroyed){suspended=false;pump();arm()}},
  destroy(){destroyed=true;clearTimeout(timer);for(const controller of active.values())controller.abort();for(const image of decoded.values())image.close();decoded.clear();compressed.clear();bytes=0;source.destroy()}};
}
