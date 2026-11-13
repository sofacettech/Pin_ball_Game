import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {parseArgs} from 'node:util';

// This isolates seeking/decoding with the real bounded production source.
// It is not a whole-page FPS test, a phone result, or a network benchmark.
const {values}=parseArgs({options:{manifest:{type:'string',default:'work/entrance-encoding/manifest.json'},browser:{type:'string',default:'chromium'},rounds:{type:'string',default:'3'}}});
const manifestPath=resolve(values.manifest),directory=dirname(manifestPath),rounds=Number(values.rounds),engine=values.browser;
if(!['chromium','webkit'].includes(engine)||!Number.isInteger(rounds)||rounds<1||rounds>10)throw Error('Choose chromium/webkit and 1–10 rounds');
const manifestText=await readFile(manifestPath,'utf8'),manifest=JSON.parse(manifestText);
if(!manifest.complete||manifest.samples.length!==3)throw Error('Finish the encode matrix first');
const source=await readFile(new URL('../entrance-source/streamed-video.mjs',import.meta.url));
const media=new Map();
for(const sample of manifest.samples)for(const variant of sample.variants){
  assert.equal(basename(variant.file),variant.file);
  media.set('/'+variant.file,await readFile(resolve(directory,variant.file)));
}
const server=createServer((request,response)=>{
  if(request.url==='/'){response.setHeader('Content-Type','text/html');return response.end('<canvas width="1160" height="2160"></canvas>');}
  if(request.url==='/source.mjs'){response.setHeader('Content-Type','text/javascript');return response.end(source);}
  const bytes=media.get(request.url);if(!bytes){response.writeHead(404);return response.end();}
  response.setHeader('Content-Type','video/mp4');response.setHeader('Content-Length',bytes.length);response.end(bytes);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const { [engine]:type }=createRequire(import.meta.url)(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
let browser;
try{
  browser=await type.launch(engine==='chromium'?{args:['--enable-gpu']}:{});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results=await page.evaluate(async({samples,rounds,settings})=>{
    const {createStreamedVideoSource}=await import('/source.mjs');
    if(typeof VideoDecoder!=='function')throw Error('WebCodecs is unavailable in this browser');
    const canvas=document.querySelector('canvas'),context=canvas.getContext('2d',{alpha:false}),rows=[];
    const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],maxMs:sorted.at(-1)}};
    for(const sample of samples){
      const encoded=new Map();
      // All bytes arrive before any timed decode. No Cache API writes or remote
      // media request can influence the timed observations below.
      for(const variant of sample.variants)encoded.set(variant.name,new Uint8Array(await (await fetch('/'+variant.file)).arrayBuffer()));
      const forward=Array.from({length:Math.ceil(sample.frameCount/4)},(_,i)=>i*4).concat(sample.frameCount-1);
      const patterns={forward,reverse:[...forward].reverse(),jumps:[1,47,6,35,13,58,24,3,43,19,54,8,31,15,57,0]};
      for(let round=0;round<rounds;round++){
        // Rotate the order to avoid always measuring one variant last/hottest.
        const ordered=[...sample.variants.slice(round%sample.variants.length),...sample.variants.slice(0,round%sample.variants.length)];
        for(const variant of ordered)for(const [pattern,targets] of Object.entries(patterns)){
          const bytes=encoded.get(variant.name),segment={...variant,url:'memory:'+variant.name,firstFrame:334,lastFrame:333+sample.frameCount,frameCount:sample.frameCount};
          const decoder=await createStreamedVideoSource([segment],variant.decoder,{width:settings.width,height:settings.height,cacheStorage:null,diagnostics:true,fetcher:async()=>new Response(bytes)});
          if(!decoder)throw Error('Unsupported exact decoder config '+variant.name);
          try{
            await decoder.frameAt(0);await decoder.frameAt(4); // identical untimed initialization
            const before=decoder.metrics,waits=[],draws=[];
            for(const index of targets){
              const began=performance.now(),frame=await decoder.frameAt(index);waits.push(performance.now()-began);
              if(Math.round(frame.timestamp*60/1e6)!==index)throw Error('Presented frame mismatch');
              const drawAt=performance.now();context.drawImage(frame,-1340,0);draws.push(performance.now()-drawAt);
            }
            const after=decoder.metrics;
            rows.push({sample:sample.name,variant:variant.name,pattern,round,wait:summarize(waits),paintSubmission:summarize(draws),
              chunks:after.chunks-before.chunks,cacheHits:after.cacheHits-before.cacheHits,flushes:after.flushes-before.flushes,
              compatibilityFlushes:after.compatibilityFlushes-before.compatibilityFlushes,retainedFrames:after.retainedFrames,requests:targets.length});
          }finally{decoder.dispose()}
        }
      }
    }
    return {userAgent:navigator.userAgent,rows};
  },{samples:manifest.samples,rounds,settings:manifest.settings});
  assert.deepEqual(errors,[]);
  const report={version:1,createdAt:new Date().toISOString(),engine,browserVersion:browser.version(),rounds,
    manifestSha256:createHash('sha256').update(manifestText).digest('hex'),sourceSha256:createHash('sha256').update(source).digest('hex'),
    method:'Same production WebCodecs source; complete in-memory sample bytes; identical target sequences; variant order rotated each round. Timed wait includes decoder work and source JS. Canvas time is CPU submission only, excluding GPU completion. Synthetic desktop sample benchmark; not whole-page cadence or physical phone evidence.',...results};
  const path=resolve(directory,`decoding-${engine}.json`);await writeFile(path,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:path,engine,rows:results.rows.length,userAgent:results.userAgent}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
