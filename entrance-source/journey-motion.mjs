import {integratedRamp} from './journey-scroll.mjs';

// Leave the actual impact picture visible before the opaque cards replace it.
export const FINAL_FRAME_HOLD_MS=200;

// A swipe to the bottom must still show the final approach (frames 2000–2164).
// applies only to automatic completion; ordinary scroll/reversal stays direct.
// Bound each request by the last painted picture so a slow decoder cannot turn
// the ending into another jump straight to its last frame.
export function createJourneyCompletion(lastFrame,{frames=164,fps=90,maxStep=4}={}){
  const startFrame=lastFrame-frames;
  let active=false,origin,startedAt,requested,pausedAt=null;
  return {
    advance(next,{target,presented,now,reducedMotion=false}){
      if(target!==lastFrame||reducedMotion||next<startFrame){active=false;pausedAt=null;return next;}
      if(!active){
        active=true;origin=Math.max(startFrame,Math.min(lastFrame,presented));
        startedAt=null;requested=origin;
      }
      if(presented<requested)return requested;
      if(startedAt===null)startedAt=now;
      requested=Math.min(lastFrame,origin+Math.floor(Math.max(0,now-startedAt)*fps/1000),presented+maxStep);
      return requested;
    },
    suspend(now){if(pausedAt===null)pausedAt=now;},
    resume(now){
      const elapsed=pausedAt===null?0:Math.max(0,now-pausedAt);
      if(active&&startedAt!==null)startedAt+=elapsed;
      pausedAt=null;return elapsed;
    },
  };
}

// Spend time crossing the doorway even when one swipe targets the far side.
// The speed limit fades in/out over 80 source frames; outside it, retain the
// existing direct touch response and desktop easing. No queued scroll events.
const crossingTime=frame=>(integratedRamp(frame,1360,40)-integratedRamp(frame,1680,40))*1000/360;

export function advanceJourneyFrame(current,target,deltaMs,{coarse=false,reducedMotion=false}={}){
  if(reducedMotion)return target;
  const dt=Math.max(0,Math.min(50,deltaMs));
  if(dt===0)return current;
  const amount=coarse?1:1-Math.exp(-dt/75);
  let next=current+(target-current)*amount;
  const start=crossingTime(current),direction=Math.sign(target-current);
  if(Math.abs(crossingTime(next)-start)>dt){
    let low=0,high=1;
    for(let i=0;i<32;i++){
      const fraction=(low+high)/2,at=current+(next-current)*fraction;
      if((crossingTime(at)-start)*direction>dt)high=fraction;else low=fraction;
    }
    next=current+(next-current)*(low+high)/2;
  }
  return Math.abs(target-next)<.15?target:next;
}
