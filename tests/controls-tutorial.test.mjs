import test from 'node:test';
import assert from 'node:assert/strict';
import {TutorialState,createTutorialHistory,tutorialStorageKey} from '../game-source/src/tutorial-state.ts';

test('one correct flipper press and release automatically advances after visible feedback',()=>{
 const guide=new TutorialState();
 assert.equal(guide.press('right'),false);assert.equal(guide.tick(1),null);assert.equal(guide.index,0);
 assert.equal(guide.press('left'),true);assert.equal(guide.tick(1),null);assert.equal(guide.index,0);
 assert.equal(guide.release(),true);assert.equal(guide.tick(.2),null);assert.equal(guide.index,0);
 assert.equal(guide.tick(.21),'advanced');assert.equal(guide.control,'right');assert.equal(guide.tried,false);
 guide.press('right');guide.release();assert.equal(guide.tick(.41),'advanced');assert.equal(guide.control,'launch');
});

test('rapid repeat clicks and stray releases cannot skip a step or restart its transition',()=>{
 const guide=new TutorialState();guide.press('left');guide.release();guide.tick(.2);
 assert.equal(guide.press('left'),false);assert.equal(guide.press('right'),false);assert.equal(guide.release(true),false);
 assert.equal(guide.tick(.21),'advanced');assert.equal(guide.control,'right');
 assert.equal(guide.release(),false);assert.equal(guide.tick(10),null);assert.equal(guide.control,'right');
});

test('launcher automatically completes once after a hold and release, not a tap or held key',()=>{
 const guide=new TutorialState();guide.index=2;
 guide.press('launch');guide.tick(.05);assert.equal(guide.release(),false);
 assert.equal(guide.tick(1),null);assert.equal(guide.tried,false);
 guide.press('launch');guide.tick(.4);assert.equal(guide.tick(1),null);
 assert.equal(guide.release(),true);assert.equal(guide.charge,0);
 assert.equal(guide.tick(.41),'complete');assert.equal(guide.tick(10),null);assert.equal(guide.press('launch'),false);
});

test('cancelled pointers, blur and resize release the control without advancing',()=>{
 for(const index of [0,1,2]){
  const guide=new TutorialState();guide.index=index;guide.press(guide.control);guide.tick(2);
  assert.equal(guide.release(true),false);assert.equal(guide.held,false);assert.equal(guide.charge,0);assert.equal(guide.tried,false);
  assert.equal(guide.release(),false);assert.equal(guide.tick(1),null);assert.equal(guide.index,index);
 }
});

test('charge is bounded and a new guide starts without pending automatic advancement',()=>{
 const guide=new TutorialState();guide.index=2;guide.press('launch');guide.tick(-1);assert.equal(guide.charge,0);
 guide.tick(100);assert.equal(guide.charge,1);guide.release();
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
