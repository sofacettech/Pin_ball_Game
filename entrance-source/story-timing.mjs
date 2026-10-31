import {JOURNEY_START_FRAME} from './journey-scroll.mjs';

// Retell the opening from the new spawn without shifting the later rooms or
// shortening the final pinball invitation. Assembly uses its own 1–240 clock.
const anchors=[[JOURNEY_START_FRAME,240],[780,516],[1000,951],[1301,1301]];
export function storyFrameAt(sceneFrame){
  if(sceneFrame<=anchors[0][0])return 240;
  for(let i=1;i<anchors.length;i++){
    const [fromFrame,fromCopy]=anchors[i-1],[toFrame,toCopy]=anchors[i];
    if(sceneFrame<=toFrame)return fromCopy+(sceneFrame-fromFrame)/(toFrame-fromFrame)*(toCopy-fromCopy);
  }
  return sceneFrame;
}
