// Measure display opportunities while the scene is moving. Counting only
// requested renders would mistake slow wheel input or a pause for a slow GPU.
export function entranceResolutionBounds({width,height,devicePixelRatio=1,maxPixelRatio=3}){
 const portrait=height>=width;
 // Round upward so integer drawing-buffer dimensions never slip below Full HD.
 const minPixelRatio=Math.ceil(Math.max((portrait?1080:1920)/width,(portrait?1920:1080)/height)*1000)/1000;
 return {minPixelRatio,maxPixelRatio:Math.max(minPixelRatio,Math.min(maxPixelRatio,devicePixelRatio))};
}
export function createEntranceResolution({minPixelRatio=2.75,maxPixelRatio=3,onChange=()=>{},now=()=>performance.now(),requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}={}){
 const makeLevels=()=>{const values=[minPixelRatio];for(let value=maxPixelRatio;value>minPixelRatio+.1;value-=.25)values.push(value);return [...new Set([...values,maxPixelRatio])].sort((a,b)=>a-b);};
 let levels=makeLevels();
 let level=levels.length-1,pixelRatio=maxPixelRatio,lastMotion=-Infinity,raf=0,disposed=false;
 let last=null,warmup=600,windowMs=0,count=0,slowMs=0,stableMs=0;
 const reset=()=>{last=null;warmup=600;windowMs=count=slowMs=stableMs=0;};
 function apply(value){if(value===pixelRatio)return;pixelRatio=value;onChange(value);}
 function sample(time){
  if(last===null){last=time;return;}
  const elapsed=time-last;last=time;
  if(elapsed<=0||elapsed>1000){reset();return;}
  if(warmup>0){warmup-=elapsed;return;}
  windowMs+=elapsed;count++;
  if(windowMs<800||count<8)return;
  const average=windowMs/count,duration=windowMs;windowMs=count=0;
  if(average>1000/30+.01){
   stableMs=0;slowMs+=duration;
   if(slowMs<1600||level===0)return;
   level--;
  }else{
   slowMs=0;stableMs=average<22?stableMs+duration:0;
   if(stableMs<4000||level===levels.length-1)return;
   level++;
  }
  reset();apply(levels[level]);
 }
 function monitor(time){
  raf=0;if(disposed)return;
  const idle=time-lastMotion;
  // One sharp frame after settling; keep the measured movement budget for
  // the next swipe. The redraw itself must not restart this monitor.
  if(idle>=650){reset();apply(maxPixelRatio);return;}
  // A slow GPU can leave more than 120ms between moving frames. Keep sampling
  // until the scene truly settles; idle RAF opportunities themselves stay fast.
  sample(time);
  raf=requestFrame(monitor);
 }
 function pause(){if(raf)cancelFrame(raf);raf=0;lastMotion=-Infinity;reset();}
 return {
  motion(){if(disposed)return;lastMotion=now();apply(levels[level]);if(!raf)raf=requestFrame(monitor);},
  // Called by the renderer's resize transaction; do not recursively notify it.
  setBounds(bounds){if(bounds.minPixelRatio===minPixelRatio&&bounds.maxPixelRatio===maxPixelRatio)return;({minPixelRatio,maxPixelRatio}=bounds);levels=makeLevels();level=levels.length-1;pixelRatio=maxPixelRatio;reset();},
  pause,settle(){if(disposed)return;pause();apply(maxPixelRatio);},dispose(){disposed=true;pause();},
  get pixelRatio(){return pixelRatio;},get activePixelRatio(){return levels[level];},get minPixelRatio(){return minPixelRatio;},get maxPixelRatio(){return maxPixelRatio;},
 };
}
