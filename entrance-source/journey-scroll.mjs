export const JOURNEY_START_FRAME=334;
// Integral of a smooth 0→1 ramp, with zero acceleration at either end.
export function integratedRamp(frame,center,halfWidth=80){
  const width=halfWidth*2,x=frame-(center-halfWidth);
  if(x<=0)return 0;
  if(x>=width)return x-halfWidth;
  const t=x/width;return width*(t*t*t-.5*t*t*t*t);
}
// Keep the opening and short approaches direct. The rooms and final approach
// use 2/3 of their former scroll distance, with smooth speed changes at the joins.
export function createJourneyScrollMap(firstFrame=JOURNEY_START_FRAME,lastFrame=2164) {
  const distance=frame=>4*(frame+(integratedRamp(frame,780)-integratedRamp(frame,1560)+integratedRamp(frame,2000))/3);
  const start=distance(firstFrame),rawTravel=distance(lastFrame)-start,travel=Math.round(rawTravel);
  // Safari rounds scroll positions to whole pixels. Normalize both directions
  // to that range so scrolling to the bottom reaches the exact handoff frame.
  const scale=rawTravel?travel/rawTravel:1;
  const scrollAtFrame=frame=>(distance(Math.max(firstFrame,Math.min(lastFrame,frame)))-start)*scale;
  function frameAtScroll(value){
    if(value<=0)return firstFrame;if(value>=travel)return lastFrame;
    let low=firstFrame,high=lastFrame;
    for(let i=0;i<44;i++){const mid=(low+high)/2;if(scrollAtFrame(mid)<value)low=mid;else high=mid;}
    return (low+high)/2;
  }
  return {travel,frameAtScroll,scrollAtFrame};
}
