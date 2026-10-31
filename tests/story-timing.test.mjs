import test from 'node:test';
import assert from 'node:assert/strict';
import {storyFrameAt} from '../entrance-source/story-timing.mjs';
import {JOURNEY_START_FRAME} from '../entrance-source/journey-scroll.mjs';

test('welcome holds at the relocated spawn before the first chapter follows the outdoor approach',()=>{
 assert.equal(storyFrameAt(JOURNEY_START_FRAME),240);
 assert.ok(storyFrameAt(JOURNEY_START_FRAME+10)>241);
 assert.ok(storyFrameAt(600)<516);
 assert.equal(storyFrameAt(780),516);
});

test('the doorway chapter leads into the room while later copy and the finale retain their timing',()=>{
 assert.ok(storyFrameAt(900)>516&&storyFrameAt(900)<951);
 assert.equal(storyFrameAt(1000),951);
 for(const frame of [1301,1550,1630,2049,2164])assert.equal(storyFrameAt(frame),frame);
});

test('copy timing stays continuous and reversible through the retimed opening',()=>{
 let previous=240;
 for(let frame=JOURNEY_START_FRAME;frame<=2164;frame+=.5){const next=storyFrameAt(frame);assert.ok(next>=previous);assert.ok(next-previous<1);previous=next;}
 for(const boundary of [780,1000,1301])assert.ok(Math.abs(storyFrameAt(boundary+.00001)-storyFrameAt(boundary-.00001))<.0001);
});
