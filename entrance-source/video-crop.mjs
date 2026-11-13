// Preserve the original source-to-CSS scale, drawing only source pixels that
// can reach the viewport. Integer bounds keep the canvas at one pixel per
// source pixel; the small border keeps fractional CSS placement off its edge.
export function visibleVideoCrop(sourceWidth,sourceHeight,view,overscan=2){
  if(!view||![sourceWidth,sourceHeight,view.fullWidth,view.fullHeight,view.width,view.height].every(value=>Number.isFinite(value)&&value>0)||![view.x,view.y].every(Number.isFinite))return null;
  const border=Math.max(0,Math.ceil(overscan));
  const scaleX=view.fullWidth/sourceWidth,scaleY=view.fullHeight/sourceHeight;
  // Size depends on the viewport, not its moving focus. Do not resize/reallocate
  // the backing store whenever rounding shifts a crop by one source pixel.
  const width=Math.min(sourceWidth,Math.ceil(view.width/scaleX)+border*2+1);
  const height=Math.min(sourceHeight,Math.ceil(view.height/scaleY)+border*2+1);
  const x=Math.max(0,Math.min(sourceWidth-width,Math.floor(view.x/scaleX)-border));
  const y=Math.max(0,Math.min(sourceHeight-height,Math.floor(view.y/scaleY)-border));
  return {x,y,width,height,cssX:x*scaleX-view.x,cssY:y*scaleY-view.y,
    cssWidth:width*scaleX,cssHeight:height*scaleY};
}
