import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleVideoCrop} from '../entrance-source/video-crop.mjs';
import {framePlacement} from '../frame-placement.js';

function viewAt(width,height,focus){
  const p=framePlacement(width,height,focus,true);
  return {fullWidth:p.width,fullHeight:p.height,x:-p.x,y:-p.y,width,height};
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);}

test('portrait draws fewer 4K pixels without reducing visible source density or changing framing',()=>{
  const view=viewAt(393,695,[.65,.5]),crop=visibleVideoCrop(3840,2160,view);
  assert.equal(crop.height,2160);assert.ok(crop.width<1230);
  assert.ok(crop.width*crop.height/(3840*2160)<.321);
  assert.equal(Number.isInteger(crop.x)&&Number.isInteger(crop.width),true);
  near(crop.cssWidth/crop.width,view.fullWidth/3840);
  near(crop.cssHeight/crop.height,view.fullHeight/2160);
  for(const sourceX of [view.x*3840/view.fullWidth,(view.x+view.width)*3840/view.fullWidth]){
    near((sourceX-crop.x)*crop.cssWidth/crop.width+crop.cssX,sourceX*view.fullWidth/3840-view.x);
  }
  assert.ok(crop.cssX<=0);assert.ok(crop.cssX+crop.cssWidth>=393);
});

test('landscape crops vertically, and rotation changes the backing bounds while preserving cover',()=>{
  const crop=visibleVideoCrop(3840,2160,viewAt(900,393,[.5,.7]));
  assert.equal(crop.width,3840);assert.ok(crop.height<1685);
  assert.ok(crop.cssY<=0);assert.ok(crop.cssY+crop.cssHeight>=393);
  assert.ok(crop.y>=0&&crop.y+crop.height<=2160);
  const portrait=visibleVideoCrop(3840,2160,viewAt(393,900,[.5,.7]));
  assert.equal(portrait.height,2160);assert.ok(portrait.width<crop.width);
});

test('moving focus keeps fixed backing dimensions and overscan without shifting any visible source point',()=>{
  let dimensions;
  for(let i=0;i<=100;i++){
    const view=viewAt(393,695,[i/100,.5]),crop=visibleVideoCrop(3840,2160,view);
    dimensions??=[crop.width,crop.height];assert.deepEqual([crop.width,crop.height],dimensions);
    const left=view.x*3840/view.fullWidth,right=(view.x+view.width)*3840/view.fullWidth;
    assert.ok(crop.x<=left+1e-8&&crop.x+crop.width>=right-1e-8);
    if(crop.x>0&&crop.x+crop.width<3840){assert.ok(left-crop.x>=2);assert.ok(crop.x+crop.width-right>=2);}
    near((left-crop.x)*crop.cssWidth/crop.width+crop.cssX,0);
    near((right-crop.x)*crop.cssWidth/crop.width+crop.cssX,393);
  }
});

test('matching aspect ratio retains every source pixel and lower-resolution fallback never upscales its backing store',()=>{
  const full=visibleVideoCrop(3840,2160,viewAt(1440,810,[.5,.5]));
  assert.deepEqual([full.x,full.y,full.width,full.height],[0,0,3840,2160]);
  const view=viewAt(393,695,[.6,.5]),fallback=visibleVideoCrop(1920,1080,view);
  assert.equal(fallback.height,1080);assert.ok(fallback.width<620);
  near(fallback.cssWidth/fallback.width,view.fullWidth/1920);
  assert.equal(visibleVideoCrop(3840,2160,null),null);
  assert.equal(visibleVideoCrop(3840,2160,{...view,width:0}),null);
});
