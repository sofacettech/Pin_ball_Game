export function createPerformanceOverlay(sequence,renderer){
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!new URLSearchParams(location.search).has('perf'))return()=>{};
 const output=document.createElement('output');output.setAttribute('aria-hidden','true');
 output.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10000;pointer-events:none;white-space:pre;background:#000d;color:#fff;padding:12px;font:12px/1.5 monospace';document.body.append(output);
 let previous=0;
 const paint=now=>{
  if(document.hidden)return;
  if(now-previous<100)return;previous=now;
  const s=sequence.stats;
  output.textContent=`Progress ${(sequence.desiredFrame/(sequence.frameCount-1)*100).toFixed(1)}% · ${sequence.phase}\nRequested ${s.target} · displayed ${sequence.displayedFrame}\n${s.direction>0?'Forward':'Backward'} · ${s.mode} · ${s.latencyMs.toFixed(1)} ms\nDecoded ${s.decoded}/${s.settings.decoded} · compressed ${s.compressed}\nPending ${s.pending} · queued ${s.queued}\nThree.js ${sequence.phase==='idle'?'available on demand':'not rendering'} · draws ${renderer.info.render.frame}`;
 };
 const timer=setInterval(()=>paint(performance.now()),200);
 return Object.assign(paint,{destroy(){clearInterval(timer);output.remove()}});
}
