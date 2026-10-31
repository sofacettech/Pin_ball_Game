import test from 'node:test';
import assert from 'node:assert/strict';
import {fitOpeningView} from '../entrance-source/opening-framing.mjs';

test('opening correction blends continuously into the original doorway framing and reverses exactly',()=>{
 const view={fullWidth:1500,fullHeight:844,x:106,y:172,width:1288,height:600};
 const bounds={minX:300,minY:-120,maxX:1000,maxY:540};
 const opening=fitOpeningView(view,bounds,334);
 assert.ok(opening.fullWidth<view.fullWidth);
 let previous=opening;
 const samples=[];
 for(let frame=334;frame<640;frame++){
  const fitted=fitOpeningView(view,bounds,frame);samples.push(fitted);
  assert.ok(fitted.fullWidth>=previous.fullWidth);
  assert.ok(Math.abs(fitted.y-previous.y)<3,'No camera jump during the release');previous=fitted;
 }
 assert.equal(fitOpeningView(view,bounds,640),view);
 assert.ok(Math.abs(previous.y-view.y)<.03);
 for(let frame=639;frame>=334;frame--)assert.deepEqual(fitOpeningView(view,bounds,frame),samples[frame-334]);
});

test('an opening composition that is already inside its safe area keeps its scale and crop',()=>{
 const view={fullWidth:1514,fullHeight:852,x:560,y:0,width:393,height:852};
 assert.deepEqual(fitOpeningView(view,{minX:65,minY:80,maxX:360,maxY:640},334),view);
});
