import test from 'node:test';
import assert from 'node:assert/strict';
import {TutorialState,createTutorialHistory,tutorialStorageKey} from '../game-source/src/tutorial-state.ts';

test('one left tap then one right tap completes the two-step guide after visible feedback',()=>{
 const guide=new TutorialState();
 assert.equal(guide.press('right'),false);assert.equal(guide.tick(1),null);assert.equal(guide.index,0);
 assert.equal(guide.press('left'),true);assert.equal(guide.tick(1),null);assert.equal(guide.index,0);
 assert.equal(guide.release(),true);assert.equal(guide.tick(.2),null);assert.equal(guide.index,0);
 assert.equal(guide.tick(.21),'advanced');assert.equal(guide.control,'right');assert.equal(guide.tried,false);
 guide.press('right');guide.release();assert.equal(guide.tick(.2),null);
 assert.equal(guide.tick(.21),'complete');assert.equal(guide.control,'right');
 assert.equal(guide.index,1);assert.equal(guide.tick(10),null);assert.equal(guide.press('right'),false);
});

test('rapid repeat clicks and stray releases cannot skip a step or restart its transition',()=>{
 const guide=new TutorialState();guide.press('left');guide.release();guide.tick(.2);
 assert.equal(guide.press('left'),false);assert.equal(guide.press('right'),false);assert.equal(guide.release(true),false);
 assert.equal(guide.tick(.21),'advanced');assert.equal(guide.control,'right');
 assert.equal(guide.release(),false);assert.equal(guide.tick(10),null);assert.equal(guide.control,'right');
});

test('holding the final flipper waits for release; repeated taps cannot complete twice',()=>{
 const guide=new TutorialState();guide.press('left');guide.release();guide.tick(.41);
 assert.equal(guide.press('right'),true);assert.equal(guide.tick(10),null);
 assert.equal(guide.release(),true);assert.equal(guide.press('right'),false);
 assert.equal(guide.tick(.41),'complete');assert.equal(guide.tick(10),null);assert.equal(guide.press('right'),false);
});

test('cancelled pointers, blur and resize release the control without advancing',()=>{
 for(const index of [0,1]){
  const guide=new TutorialState();guide.index=index;guide.press(guide.control);guide.tick(2);
  assert.equal(guide.release(true),false);assert.equal(guide.held,false);assert.equal(guide.tried,false);
  assert.equal(guide.release(),false);assert.equal(guide.tick(1),null);assert.equal(guide.index,index);
 }
});

test('a replay starts at the left flipper without pending automatic advancement',()=>{
 const guide=new TutorialState();guide.press('left');guide.release();guide.tick(.41);
 guide.press('right');guide.release();assert.equal(guide.tick(.41),'complete');
 const fresh=new TutorialState();assert.equal(fresh.tick(10),null);assert.equal(fresh.index,0);assert.equal(fresh.tried,false);
});

test('the first display is remembered across new games and reloads without needing completion',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const history=createTutorialHistory(storage);assert.equal(history.seen,false);
 history.markShown();assert.equal(values.get(tutorialStorageKey),'done');
 assert.equal(history.seen,true);assert.equal(createTutorialHistory(storage).seen,true);
 history.markShown();assert.equal(history.seen,true);
});

test('denied storage still prevents repeated automatic guides during the current visit',()=>{
 const denied={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
 for(const storage of [denied,undefined]){
  const history=createTutorialHistory(storage);assert.equal(history.seen,false);
  assert.doesNotThrow(()=>history.markShown());assert.equal(history.seen,true);
 }
});
