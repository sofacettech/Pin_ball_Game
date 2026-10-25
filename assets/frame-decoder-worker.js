// All supplied samples are independent IDR frames. Synthetic timestamps keep
// duplicate/reversed requests distinct while copying outputs off codec surfaces.
let decoder,config,copyCanvas,copyContext,maxPending=4,generation=0,flushTimer,flushing=false,failed=false,diagnostics=false;
const requests=new Map(),timestamps=new Map();
const stats={workerFlushes:0,workerResets:0,workerHardwarePreference:null,workerOutputKind:'bitmap',workerBitmapCopies:0,workerBitmapCopyMs:0,workerBitmapCopyMaxMs:0};
const namedError=(message,name='EncodingError')=>new DOMException(message,name);
const colourMismatch=(expected,image)=>'Worker decoder did not preserve colour metadata: '+JSON.stringify({expected,actual:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))});
function clearFlush(){clearTimeout(flushTimer);flushTimer=undefined}
function stopDecoder(){
 generation++;clearFlush();flushing=false;try{decoder?.close()}catch{}decoder=undefined;
 if(copyCanvas){copyCanvas.width=0;copyCanvas.height=0}copyCanvas=copyContext=undefined;
}
// Transferring a VideoFrame keeps its decoder-owned output surface alive.
// A few cached frames can exhaust a phone's hardware pool and block flush().
// Snapshot into independent canvas storage, then promptly release the codec
// surface. No pixel planes are read back into JavaScript.
function detachFrame(image){
 const started=performance.now();
 try{
  if(!copyCanvas){
   copyCanvas=new OffscreenCanvas(image.displayWidth,image.displayHeight);
   copyContext=copyCanvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
   if(!copyContext)throw namedError('Worker frame copy canvas is unavailable','NotSupportedError');
  }
  copyContext.drawImage(image,0,0,copyCanvas.width,copyCanvas.height);
  const bitmap=copyCanvas.transferToImageBitmap(),elapsed=performance.now()-started;
  stats.workerBitmapCopies++;stats.workerBitmapCopyMs+=elapsed;stats.workerBitmapCopyMaxMs=Math.max(stats.workerBitmapCopyMaxMs,elapsed);
  return bitmap;
 }finally{image.close()}
}
function fatal(error,type='fatal'){
 if(failed)return;
 failed=true;stopDecoder();requests.clear();timestamps.clear();
 self.postMessage({type,name:error.name||'EncodingError',message:error.message||'Worker decoder failed',stats});
}
function armFlush(){
 if(!requests.size){clearFlush();return}
 if(flushing)return;
 if(flushTimer!==undefined){if(requests.size<maxPending)return;clearFlush()}
 // Immediate-output decoders never flush here. Buffered implementations get
 // one bounded batch/idle drain instead of a flush after every decode call.
 flushTimer=setTimeout(flushPending,requests.size>=maxPending?0:8);
}
async function flushPending(){
 flushTimer=undefined;
 if(failed||!requests.size||flushing)return;
 const active=generation,batch=[...requests.keys()];flushing=true;stats.workerFlushes++;
 try{
  await decoder.flush();
  if(active===generation&&batch.some(id=>requests.has(id)))throw namedError('Worker decoder omitted a requested frame');
 }catch(error){if(active===generation)fatal(error)}
 finally{if(active===generation&&!failed){flushing=false;self.postMessage({type:'stats',stats});armFlush()}}
}
function openDecoder(){
 const active=++generation;
 decoder=new VideoDecoder({
  output(image){
   if(active!==generation||failed){image.close();return}
   const outputAt=diagnostics?performance.timeOrigin+performance.now():undefined;
   const id=timestamps.get(image.timestamp),request=requests.get(id);
   if(!request){image.close();return}
   timestamps.delete(request.timestamp);requests.delete(id);
   if(request.cancelled){image.close();self.postMessage({type:'released',id})}
   else if((config.codedWidth&&image.displayWidth!==config.codedWidth)||(config.codedHeight&&image.displayHeight!==config.codedHeight)){
    image.close();fatal(namedError('Worker decoder returned unexpected display dimensions'));return;
   }else if(config.colorSpace&&Object.entries(config.colorSpace).some(([key,value])=>image.colorSpace?.[key]!==value)){
    const message=colourMismatch(config.colorSpace,image);image.close();fatal(namedError(message));return;
   }else{
    const sourceColorSpace=Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]));
    let bitmap;
    try{
     bitmap=detachFrame(image);
     const timing=diagnostics?{received:request.received,output:outputAt,bitmap:performance.timeOrigin+performance.now()}:undefined;
     self.postMessage({type:'frame',timing,id,frame:request.frame,timestamp:request.timestamp,sourceColorSpace,outputKind:'bitmap',image:bitmap,stats},[bitmap]);
    }catch(error){bitmap?.close();fatal(error);return}
   }
   armFlush();
  },
  error(error){if(active===generation)fatal(error)}
 });
 decoder.configure(config);
}
function reset(){
 stopDecoder();
 for(const id of requests.keys())self.postMessage({type:'released',id});
 requests.clear();timestamps.clear();stats.workerResets++;
 openDecoder();self.postMessage({type:'stats',stats});
}
async function initialize(message){
 if(typeof OffscreenCanvas!=='function')throw namedError('Worker frame copying is unavailable','NotSupportedError');
 if(typeof VideoDecoder!=='function'||typeof EncodedVideoChunk!=='function')throw namedError('WebCodecs is unavailable in this worker','NotSupportedError');
 maxPending=message.maxPending;diagnostics=message.diagnostics===true;
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>4)throw new RangeError('Invalid worker queue limit');
 const base={...message.config,optimizeForLatency:true};
 let chosen={...base,hardwareAcceleration:'prefer-hardware'},support;
 try{support=await VideoDecoder.isConfigSupported(chosen)}catch{}
 if(!support?.supported){chosen={...base,hardwareAcceleration:'no-preference'};support=await VideoDecoder.isConfigSupported(chosen)}
 if(!support?.supported)throw namedError('The worker does not support this video configuration','NotSupportedError');
 config=chosen;stats.workerHardwarePreference=config.hardwareAcceleration;
 openDecoder();self.postMessage({type:'ready',stats});
}
self.addEventListener('message',({data})=>{
 if(failed)return;
 if(data?.type==='init'){
  if(config||decoder){fatal(namedError('Worker decoder was initialized twice'));return}
  void initialize(data).catch(error=>fatal(error,'unsupported'));return;
 }
 try{
  if(data?.type==='reset'){reset();return}
  if(data?.type==='cancel'){
   const request=requests.get(data.id);
   if(!request){self.postMessage({type:'released',id:data.id});return}
   request.cancelled=true;
   if([...requests.values()].every(value=>value.cancelled))reset();else armFlush();
   return;
  }
  if(data?.type!=='decode')return;
  if(!decoder||decoder.state!=='configured')throw namedError('Worker decoder is not configured','InvalidStateError');
  if(requests.size>=maxPending)throw namedError('Worker decode queue is full','QuotaExceededError');
  if(requests.has(data.id)||timestamps.has(data.timestamp)||!Number.isSafeInteger(data.id)||!Number.isSafeInteger(data.timestamp))throw namedError('Duplicate or invalid worker request');
  requests.set(data.id,{id:data.id,frame:data.frame,timestamp:data.timestamp,cancelled:false,received:diagnostics?performance.timeOrigin+performance.now():undefined});timestamps.set(data.timestamp,data.id);
  decoder.decode(new EncodedVideoChunk({type:'key',timestamp:data.timestamp,duration:data.duration,data:data.bytes}));
  armFlush();
 }catch(error){fatal(error)}
});
