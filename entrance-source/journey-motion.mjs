import {integratedRamp} from './journey-scroll.mjs';

export const VIDEO_FRAME_INTERVAL_MS=1000/30;

// Scroll chooses a destination, not a seek past the intervening story. Present
// the 60 Hz source at up to 30 fps and wait for each full-resolution decode.
export function createVideoJourneyClock(firstFrame){
  let frame=firstFrame,lastTime;
  return {
    advance(now,target,{settled=true}={}){
      if(lastTime===undefined)lastTime=now;
      if(frame===target){lastTime=now;return frame;}
      if(!settled||now-lastTime<VIDEO_FRAME_INTERVAL_MS-.001)return frame;
      frame+=Math.sign(target-frame)*Math.min(2,Math.abs(target-frame));
      lastTime=now;
      return frame;
    },
    suspend(){lastTime=undefined;},
  };
}

// Spend time crossing the doorway even when one swipe targets the far side.
// The speed limit fades in/out over 80 source frames; outside it, retain the
// existing direct touch response and desktop easing. No queued scroll events.
const crossingTime=frame=>(integratedRamp(frame,1360,40)-integratedRamp(frame,1680,40))*1000/240;

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
