export const JOURNEY_START_FRAME=334;
// Start near the doorway. Both the outdoor approach and empty chessboard use
// half the scrolling; the rooms and final contact keep their authored pacing.
export function createJourneyScrollMap(firstFrame=JOURNEY_START_FRAME,lastFrame=2164) {
  const chessStart=1560,chessEnd=2000;
  const doorway=780,approach=(doorway-firstFrame)*4;
  const before=approach+(chessStart-doorway)*8;
  const crossing=before+(chessEnd-chessStart)*4;
  const points=[[firstFrame,0],[doorway,approach],[chessStart,before],[chessEnd,crossing],[lastFrame,crossing+(lastFrame-chessEnd)*8]];
  function sample(value,from,to) {
    if(value<=points[0][from])return points[0][to];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];
      if(value<=b[from])return a[to]+(value-a[from])/(b[from]-a[from])*(b[to]-a[to]);
    }
    return points.at(-1)[to];
  }
  return {
    travel:points.at(-1)[1],
    frameAtScroll:value=>sample(value,1,0),
    scrollAtFrame:value=>sample(value,0,1),
  };
}
