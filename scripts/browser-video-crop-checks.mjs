import assert from 'node:assert/strict';

// This function is also serialized into browser probes. Keep it self-contained.
export function readVideoCropGeometry(framing){
  const p=window.entrancePreview,q=p.quality,shown=p.displayedFrame;
  const viewport=document.getElementById('scene-viewport').getBoundingClientRect();
  const stage=document.getElementById('scene-frame').getBoundingClientRect();
  const canvas=p.renderer.domElement,bounds=canvas.getBoundingClientRect();
  const i=Math.floor(shown),j=Math.min(i+1,framing.points.length-1);
  const focus=framing.points[i].map((v,n)=>v+(framing.points[j][n]-v)*(shown-i));
  const scale=Math.max(viewport.width/1920,viewport.height/1080),fullWidth=1920*scale,fullHeight=1080*scale;
  const expectedX=Math.max(viewport.width-fullWidth,Math.min(0,viewport.width/2-focus[0]*fullWidth));
  const expectedY=Math.max(viewport.height-fullHeight,Math.min(0,viewport.height/2-focus[1]*fullHeight));
  const crop=q.crop||{x:0,y:0,width:q.sourceWidth,height:q.sourceHeight};
  const scaleX=bounds.width/canvas.width,scaleY=bounds.height/canvas.height;
  const sourceOriginX=bounds.left-viewport.left-crop.x*scaleX,sourceOriginY=bounds.top-viewport.top-crop.y*scaleY;
  const expectedScaleX=fullWidth/q.sourceWidth,expectedScaleY=fullHeight/q.sourceHeight;
  const projectionErrorPx=Math.max(Math.hypot(sourceOriginX-expectedX,sourceOriginY-expectedY),
    Math.hypot(sourceOriginX+q.sourceWidth*scaleX-expectedX-fullWidth,sourceOriginY+q.sourceHeight*scaleY-expectedY-fullHeight));
  return {requestedFrame:p.frame,displayedFrame:shown,settled:p.settled,visibleArea:q.visibleArea,
    sourceWidth:q.sourceWidth,sourceHeight:q.sourceHeight,canvasWidth:canvas.width,canvasHeight:canvas.height,crop,
    viewport:{width:viewport.width,height:viewport.height},stage:{width:stage.width,height:stage.height},
    sourceOriginX,sourceOriginY,scaleX,scaleY,expectedX,expectedY,expectedScaleX,expectedScaleY,projectionErrorPx,
    coverageGapPx:Math.max(0,bounds.left-viewport.left,bounds.top-viewport.top,viewport.right-bounds.right,viewport.bottom-bounds.bottom),
    sourcePixelsPerBackingPixelX:crop.width/canvas.width,sourcePixelsPerBackingPixelY:crop.height/canvas.height};
}

export function assertVideoCropGeometry(g,expectedWidth,label='Video crop'){
  assert.equal(g.sourceWidth,expectedWidth,`${label}: preserve selected source width`);
  assert.equal(g.sourceHeight,expectedWidth*9/16,`${label}: preserve selected source height`);
  assert.equal(g.visibleArea,true,`${label}: use the visible source region`);
  assert.ok(g.projectionErrorPx<.1,`${label}: source projection differs by ${g.projectionErrorPx}px`);
  assert.ok(g.coverageGapPx<.1,`${label}: crop leaves a viewport gap`);
  assert.equal(g.sourcePixelsPerBackingPixelX,1,`${label}: preserve horizontal source density`);
  assert.equal(g.sourcePixelsPerBackingPixelY,1,`${label}: preserve vertical source density`);
  assert.ok(Math.abs(g.stage.width-g.viewport.width)<.1&&Math.abs(g.stage.height-g.viewport.height)<.1,`${label}: stage follows viewport`);
  for(const value of Object.values(g.crop))assert.equal(Number.isInteger(value),true,`${label}: crop bounds are integer source pixels`);
  assert.ok(g.crop.x>=0&&g.crop.y>=0&&g.crop.x+g.crop.width<=g.sourceWidth&&g.crop.y+g.crop.height<=g.sourceHeight,`${label}: crop remains inside source`);
  if(g.viewport.width/g.viewport.height<1)assert.ok(g.canvasWidth<g.sourceWidth*.6,`${label}: portrait does not retain discarded side pixels`);
}

export function assertVideoStartupPolicy(q){
  assert.equal(q.startupReady,true,'The declared startup window must be ready');
  assert.equal(typeof q.preloaded,'boolean','preloaded describes complete source caching');
  if(q.progressive){
    assert.ok(q.startupBytes>0&&q.startupBytes<q.preloadedBytes,'Progressive readiness must require fewer bytes than the complete source');
    assert.ok(q.residentBytes>=0&&q.residentBytes<=q.bufferBudgetBytes,'Compressed resident bytes stay inside the declared budget');
  }else assert.equal(q.preloaded,true,'The full-preload fallback must be complete before readiness');
}
