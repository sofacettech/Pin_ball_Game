import {integratedRamp} from './journey-scroll.mjs';

// Leave the actual impact picture visible before the opaque cards replace it.
export const FINAL_FRAME_HOLD_MS=200;

// A swipe to the bottom must still show the final approach (frames 2000–2164).
// applies only to automatic completion; ordinary scroll/reversal stays direct.
// Bound each request by the last painted picture so a slow decoder cannot turn
// the ending into another jump straight to its last frame.
export function createJourneyCompletion(lastFrame,{frames=164,fps=60,maxStep=4}={}){
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
const crossingTime=frame=>(integratedRamp(frame,1360,40)-integratedRamp(frame,1680,40))*1000/240;

export function advanceJourneyFrame(current,target,deltaMs,{coarse=false,reducedMotion=false}={}){
  if(reducedMotion)return target;
  const dt=Math.max(0,Math.min(50,deltaMs));
  if(dt===0)return current;
  // Touch follows the finger directly while it is moving. Within a few frames
  // of the destination (momentum tail, release) it eases faster than desktop,
  // so the iOS scroll tail lands as a smooth glide rather than uneven steps.
  const touchTail=coarse&&Math.abs(target-current)<=12;
  const amount=coarse&&!touchTail?1:1-Math.exp(-dt/(coarse?30:75));
  let next=current+(target-current)*amount;
  // A pure exponential ease crawls below one frame per tick near the target,
  // so the video lands on its last frames at uneven 50-100 ms gaps. Keep a
  // minimum glide (one source frame per 60 Hz tick) so the ball lands cleanly.
  const gap=target-current,glide=dt/16.67;
  if(Math.abs(next-current)<glide)next=current+Math.sign(gap)*Math.min(Math.abs(gap),glide);
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

// Touch release hands over to iOS momentum, whose last second creeps a few
// pixels per second; following it 1:1 shows ~3 pictures/s. After release,
// aim a little short of the predicted rest point and ease there instead.
// Returns the raw target while touching, when idle, or once the page overtakes.
export function createTouchGlide({window=150,reach=.6,minSpeed=8,idle=300}={}){
  let samples=[],touching=false,latch=null,commit=null;
  return {
    touch(value){touching=value;if(value)latch=null;},
    push(frame,now){samples.push([now,frame]);while(samples.length&&now-samples[0][0]>window)samples.shift();},
    // When scrolling ends with the ball ahead of the page, the page is moved to
    // the ball (takeCommit) instead of pulling the ball back. Without this the
    // picture visibly reverses about half a second after it stopped.
    takeCommit(){const value=commit;commit=null;return value;},
    target(raw,now,{first=-Infinity,last=Infinity}={}){
      const end=samples.at(-1);
      if(touching||!end){latch=null;return raw;}
      if(now-end[0]>idle){
        if(latch&&(latch.point-raw)*latch.direction>0){commit=latch.point;samples=[[now,latch.point]];return latch.point;}
        latch=null;return raw;
      }
      const span=end[0]-samples[0][0],speed=span>=40?(end[1]-samples[0][1])/span*1000:0;
      if(Math.abs(speed)>=minSpeed){
        const direction=Math.sign(speed),point=Math.max(first,Math.min(last,raw+speed*reach));
        if(!latch||latch.direction!==direction||(point-latch.point)*direction>0)latch={point,direction};
      }
      if(latch&&(latch.point-raw)*latch.direction>0)return latch.point;
      latch=null;return raw;
    },
  };
}
