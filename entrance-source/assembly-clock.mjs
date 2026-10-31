// Drive the authored 1–240 ball assembly with the render clock, never media playback.
export function createAssemblyClock({reducedMotion=false}={}) {
  let frame=reducedMotion?240:1,lastTime;
  return {
    advance(now) {
      if(lastTime!==undefined)frame=Math.min(240,frame+Math.max(0,now-lastTime)*.06);
      lastTime=now;
      return frame;
    },
    suspend() { lastTime=undefined; },
    finish() { frame=240;lastTime=undefined;return frame; },
    get frame() { return frame; },
    get active() { return frame<240; },
  };
}
