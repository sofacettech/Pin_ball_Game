// Count newly rendered/presented scene updates, never RAF callbacks or source-frame jumps.
export function createFrameRateMeter(windowMs=1000){
  let active=false,start=0,stop=0,previous=null,key,events=[];
  function setActive(value,now){
    if(value===active)return;
    active=value;
    if(value){start=now;stop=now;previous=null;key=undefined;events=[];}else stop=now;
  }
  function record(nextKey,now){
    if(!active||nextKey===key)return false;
    key=nextKey;events.push({time:now,interval:now-(previous??start)});previous=now;
    events=events.filter(event=>event.time>=now-windowMs);return true;
  }
  function read(now){
    const end=active?now:stop,elapsed=Math.min(windowMs,Math.max(0,end-start));
    const recent=events.filter(event=>event.time>end-windowMs);
    const intervals=recent.map(event=>event.interval).filter(v=>v>0).sort((a,b)=>a-b);
    return {active,collecting:elapsed<250,fps:elapsed>=250?recent.length*1000/elapsed:null,
      p95:intervals.length?intervals[Math.min(intervals.length-1,Math.ceil(intervals.length*.95)-1)]:null,
      gapMs:active?end-(previous??start):0,updates:recent.length};
  }
  return {setActive,record,read};
}

export function summarizeFrameUpdates(times,start,end){
  const duration=end-start,intervals=times.map((time,i)=>time-(i?times[i-1]:start)).filter(v=>v>0).sort((a,b)=>a-b);
  let minWindowFps=null;
  // Overlapping complete one-second windows catch a slow section that a
  // whole-journey average can hide. Sample the window position every 100 ms.
  for(let from=start;from+1000<=end;from+=100){
    const count=times.filter(time=>time>from&&time<=from+1000).length;
    minWindowFps=minWindowFps===null?count:Math.min(minWindowFps,count);
  }
  return {fps:duration>0?times.length*1000/duration:0,updates:times.length,durationMs:duration,
    minWindowFps,
    p95Ms:intervals.length?intervals[Math.min(intervals.length-1,Math.ceil(intervals.length*.95)-1)]:null};
}
