const namedError=(message,name='EncodingError')=>new DOMException(message,name);
const colourMismatch=(expected,image)=>'Worker decoder did not preserve colour metadata: '+JSON.stringify({expected,actual:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))});
const cancelled=()=>namedError('Frame decoding cancelled','AbortError');

// Returned ImageBitmaps belong to the caller and do not retain codec surfaces.
// Message timestamps identify requests; source indices identify journey frames.
export async function createWorkerFrameDecoder(config,{fps=60,maxPending=4,WorkerClass=globalThis.Worker,startupTimeout=5000,decodeTimeout=8000}={}){
 if(!Number.isFinite(fps)||fps<=0||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>4||!Number.isFinite(startupTimeout)||startupTimeout<=0||!Number.isFinite(decodeTimeout)||decodeTimeout<=0)throw new RangeError('Invalid worker decoder limits');
 if(typeof WorkerClass!=='function')throw namedError('Module workers are unavailable','NotSupportedError');
 const started=performance.now(),worker=new WorkerClass(new URL('./frame-decoder-worker.js?v=frames-ba9f4c7055b9',import.meta.url),{type:'module',name:'sofacet-frame-decoder'});
 const jobs=new Map(),duration=Math.max(1,Math.round(1e6/fps));
 const counters={workerRequests:0,workerCompleted:0,workerCancelled:0,workerTimeouts:0,workerPeakPending:0,workerDecodeMs:0,workerDecodeTotalMs:0,workerStartupMs:0,workerFlushes:0,workerResets:0,workerHardwarePreference:null,workerOutputKind:null,workerBitmapCopies:0,workerBitmapCopyMs:0,workerBitmapCopyMaxMs:0};
 let nextId=0,destroyed=false,failure,startupTimer,resolveStartup,rejectStartup;
 const startup=new Promise((resolve,reject)=>{resolveStartup=resolve;rejectStartup=reject});
 function release(job){clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);jobs.delete(job.id)}
 function fail(error){
  if(failure||destroyed)return;
  failure=error;clearTimeout(startupTimer);rejectStartup(error);
  for(const job of jobs.values()){release(job);job.reject(error)}
  worker.terminate();
 }
 function post(message,transfer){try{worker.postMessage(message,transfer)}catch(error){fail(error)}}
 worker.addEventListener('error',event=>{event.preventDefault?.();fail(namedError(event.message||'Worker decoder failed'))});
 worker.addEventListener('messageerror',()=>fail(namedError('Worker frame transfer failed','DataCloneError')));
 worker.addEventListener('message',({data})=>{
  const image=data?.image;
  if(failure||destroyed){image?.close();return}
  if(data?.stats)for(const key of ['workerFlushes','workerResets','workerHardwarePreference','workerOutputKind','workerBitmapCopies','workerBitmapCopyMs','workerBitmapCopyMaxMs'])if(key in data.stats)counters[key]=data.stats[key];
  if(data?.type==='ready'){clearTimeout(startupTimer);counters.workerStartupMs=performance.now()-started;resolveStartup();return}
  if(data?.type==='unsupported'||data?.type==='fatal'){image?.close();fail(namedError(data.message||'Worker decoding is unavailable',data.name||'NotSupportedError'));return}
  if(data?.type==='released'){const job=jobs.get(data.id);if(job?.cancelled){release(job);job.reject(cancelled())}return}
  if(data?.type!=='frame'){image?.close();return}
  const job=jobs.get(data.id);
  if(!job||job.cancelled){image?.close();if(job){release(job);job.reject(cancelled())}return}
  if(!image||typeof image.close!=='function'||data.outputKind!=='bitmap'||data.timestamp!==job.timestamp||data.frame!==job.frame){image?.close();fail(namedError('Worker returned an unexpected frame'));return}
  if((config.codedWidth&&image.width!==config.codedWidth)||(config.codedHeight&&image.height!==config.codedHeight)){image.close();fail(namedError('Worker decoder returned unexpected display dimensions'));return}
  if(config.colorSpace&&Object.entries(config.colorSpace).some(([key,value])=>data.sourceColorSpace?.[key]!==value)){
   const message=colourMismatch(config.colorSpace,{colorSpace:data.sourceColorSpace});image.close();fail(namedError(message));return;
  }
  release(job);counters.workerCompleted++;counters.workerDecodeMs=performance.now()-job.started;counters.workerDecodeTotalMs+=counters.workerDecodeMs;
  job.resolve(image);
 });
 startupTimer=setTimeout(()=>{counters.workerTimeouts++;fail(namedError('Worker decoder startup timed out','TimeoutError'))},startupTimeout);
 post({type:'init',config,fps,maxPending});
 await startup;
 return{
  decode(frame,bytes,signal){
   if(destroyed)return Promise.reject(cancelled());
   if(failure)return Promise.reject(failure);
   if(signal?.aborted)return Promise.reject(cancelled());
   if(!Number.isSafeInteger(frame)||frame<0)return Promise.reject(new RangeError('Invalid source frame'));
   // Cancelled submissions still occupy a slot until the worker releases their
   // decoder resources. Rapid reversals cannot create an unbounded codec queue.
   if(jobs.size>=maxPending)return Promise.reject(namedError('Worker decode queue is full','QuotaExceededError'));
   let copy;
   if(bytes instanceof ArrayBuffer)copy=bytes.slice(0);
   else if(ArrayBuffer.isView(bytes))copy=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength).slice().buffer;
   else return Promise.reject(new TypeError('A compressed frame sample is required'));
   if(!copy.byteLength)return Promise.reject(new TypeError('The compressed frame sample is empty'));
   const id=++nextId,timestamp=id*duration;
   return new Promise((resolve,reject)=>{
    const job={id,frame,timestamp,resolve,reject,signal,started:performance.now(),cancelled:false};
    job.abort=()=>{
     if(!jobs.has(id)||job.cancelled)return;
     job.cancelled=true;counters.workerCancelled++;signal?.removeEventListener('abort',job.abort);post({type:'cancel',id});
    };
    job.timer=setTimeout(()=>{counters.workerTimeouts++;fail(namedError('Worker frame decoding timed out','TimeoutError'))},decodeTimeout);
    jobs.set(id,job);signal?.addEventListener('abort',job.abort,{once:true});
    counters.workerRequests++;counters.workerPeakPending=Math.max(counters.workerPeakPending,jobs.size);
    post({type:'decode',id,frame,timestamp,duration,bytes:copy},[copy]);
   });
  },
  suspend(){
   if(destroyed||failure)return;
   // The reset acknowledgment closes codec resources and any transferred
   // outputs before a quick hide/show can reuse their reserved slots.
   for(const job of jobs.values()){
    if(!job.cancelled)counters.workerCancelled++;
    job.cancelled=true;job.signal?.removeEventListener('abort',job.abort);
   }
   post({type:'reset'});
  },
  destroy(){
   if(destroyed)return;
   destroyed=true;clearTimeout(startupTimer);
   for(const job of jobs.values()){release(job);if(!job.cancelled)counters.workerCancelled++;job.reject(cancelled())}
   worker.terminate();
  },
  get stats(){return{...counters,workerPending:jobs.size,workerReady:!destroyed&&!failure,workerFailure:failure?.name??null}}
 };
}
