// Keep the authored animation, but spend half as much scroll on the empty
// chessboard crossing. The rooms and final approach retain 8 pixels per frame.
export function createJourneyScrollMap(firstFrame=240,lastFrame=2164) {
  const chessStart=1560,chessEnd=2000;
  const before=(chessStart-firstFrame)*8;
  const crossing=before+(chessEnd-chessStart)*4;
  const points=[[firstFrame,0],[chessStart,before],[chessEnd,crossing],[lastFrame,crossing+(lastFrame-chessEnd)*8]];
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
