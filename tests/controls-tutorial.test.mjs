import test from 'node:test';
import assert from 'node:assert/strict';
import {TutorialState,hasPractised,rememberPractice,tutorialStorageKey} from '../game-source/src/tutorial-state.ts';

test('practice requires the correct side and a release before moving to the next control',()=>{
 const guide=new TutorialState();
 assert.equal(guide.press('right'),false);
 assert.equal(guide.next(),false);assert.equal(guide.index,0);
 assert.equal(guide.press('left'),true);
 assert.equal(guide.press('left'),false);
 guide.next();assert.equal(guide.index,0);
 assert.equal(guide.release(),true);
 guide.next();assert.equal(guide.control,'right');assert.equal(guide.tried,false);
 assert.equal(guide.press('left'),false);
 guide.press('right');guide.release();guide.next();assert.equal(guide.control,'launch');
});

test('launcher practice needs a hold and release, not a quick tap or a held key',()=>{
 const guide=new TutorialState();guide.index=2;
 guide.press('launch');guide.tick(.05);assert.equal(guide.release(),false);
 assert.equal(guide.tried,false);assert.equal(guide.next(),false);
 guide.press('launch');guide.tick(.4);assert.equal(guide.next(),false);
 assert.equal(guide.release(),true);assert.equal(guide.charge,0);assert.equal(guide.next(),true);
});

test('cancelled pointers, blur and resize release the practice control without completing it',()=>{
 for(const index of [0,1,2]){
  const guide=new TutorialState();guide.index=index;guide.press(guide.control);guide.tick(2);
  assert.equal(guide.release(true),false);assert.equal(guide.held,false);assert.equal(guide.charge,0);assert.equal(guide.tried,false);
  assert.equal(guide.release(),false);guide.next();assert.equal(guide.index,index);
 }
});

test('charge is bounded and repeated practice cannot skip an untried step',()=>{
 const guide=new TutorialState();guide.index=2;guide.press('launch');guide.tick(-1);assert.equal(guide.charge,0);
 guide.tick(100);assert.equal(guide.charge,1);guide.release();
 const fresh=new TutorialState();fresh.next();assert.equal(fresh.index,0);assert.equal(fresh.tried,false);
});

test('completion is remembered when available and denied storage never prevents playing',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 assert.equal(hasPractised(storage),false);rememberPractice(storage);assert.equal(values.get(tutorialStorageKey),'done');assert.equal(hasPractised(storage),true);
 const denied={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
 assert.equal(hasPractised(denied),false);assert.doesNotThrow(()=>rememberPractice(denied));
 assert.equal(hasPractised(undefined),false);assert.doesNotThrow(()=>rememberPractice(undefined));
});
