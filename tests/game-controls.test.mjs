import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPaddle,connectTouchControls} from '../game-source/src/touch-controls.ts';
import {connectFlipScorecard} from '../game-source/src/flip-scorecard.ts';

class Element extends EventTarget {
 attributes=new Map();classes=new Set();captured=new Set();style={setProperty(){}};textContent='';inert=false;tabIndex=0;
 classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name)},contains:name=>this.classes.has(name)};
 setAttribute(name,value){this.attributes.set(name,String(value))} getAttribute(name){return this.attributes.get(name)} removeAttribute(name){this.attributes.delete(name)}
 setPointerCapture(id){this.captured.add(id)} hasPointerCapture(id){return this.captured.has(id)} releasePointerCapture(id){this.captured.delete(id)}
 getBoundingClientRect(){return {left:0,width:400}}
}
const send=(element,type,props={})=>{if(['pointerup','pointercancel','lostpointercapture'].includes(type))element.captured.delete(props.pointerId);return element.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),props))};

test('the held paddle keeps priority across keyboard/touch combinations; release transfers control',()=>{
 let side=null;
 for(const [left,right,expected] of [[false,true,'right'],[true,true,'right'],[true,false,'left'],[true,true,'left'],[false,true,'right'],[false,false,null],[true,true,'left']]){
  side=selectPaddle(left,right,side);assert.equal(side,expected);
 }
});

test('mouse, touch and pen use the same left/right zones demonstrated by the guide',()=>{
 for(const pointerType of ['mouse','touch','pen']){
  const canvas=new Element(),launch=new Element();let enabled=true;
  const input=connectTouchControls(canvas,launch,()=>enabled,()=>{},()=>{});
  send(canvas,'pointerdown',{pointerId:1,pointerType,button:0,clientX:80});assert.equal(input.state.left,true);assert.equal(input.state.right,false);
  send(canvas,'pointerup',{pointerId:1});assert.equal(input.state.left,false);
  send(canvas,'pointerdown',{pointerId:2,pointerType,button:0,clientX:320});assert.equal(input.state.right,true);
  send(canvas,'pointercancel',{pointerId:2});assert.equal(input.state.right,false);
  send(canvas,'pointerdown',{pointerId:3,pointerType,button:2,clientX:80});assert.equal(input.state.left,false);
  enabled=false;send(canvas,'pointerdown',{pointerId:4,pointerType,button:0,clientX:80});assert.equal(input.state.left,false);
 }
});

test('launch hold releases on pointer/keyboard release, cancellation, blur and clearing',()=>{
 const canvas=new Element(),launch=new Element();let enabled=true,starts=0;
 const touch=connectTouchControls(canvas,launch,()=>enabled,()=>starts++,()=>{});
 for(const end of ['pointerup','pointercancel','lostpointercapture']){
  send(launch,'pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:200});assert.equal(touch.state.space,true);
  send(launch,end,{pointerId:1});assert.equal(touch.state.space,false);
 }
 for(const key of ['Space','Enter']){
  send(launch,'keydown',{code:key});assert.equal(touch.state.space,true);
  send(launch,'keyup',{code:key});assert.equal(touch.state.space,false);
 }
 send(launch,'keydown',{code:'Space'});send(launch,'blur');assert.equal(touch.state.space,false);
 send(launch,'pointerdown',{pointerId:2,pointerType:'touch',button:0,clientX:200});touch.clear();assert.equal(touch.state.space,false);assert.equal(launch.captured.size,0);
 enabled=false;const previous=starts;send(launch,'pointerdown',{pointerId:3,pointerType:'touch',button:0,clientX:200});assert.equal(starts,previous);assert.equal(touch.state.space,false);
});

test('phone card alternates launch and score without exposing desktop instructions; desktop remains clickable',()=>{
 const card=new Element(),front=new Element(),back=new Element(),score=new Element(),best=new Element();front.id='instructions';back.id='scoreboard';card.querySelector=s=>s==='.front'?front:back;
 const panel=connectFlipScorecard(card,score,best);
 send(card,'click');assert.equal(card.classes.has('flipped'),true);
 panel.setPhoneStage(true);panel.showScore(false);
 assert.equal(card.classes.has('flipped'),false);assert.equal(card.getAttribute('aria-hidden'),'true');assert.equal(front.inert,true);assert.equal(front.getAttribute('aria-hidden'),'true');
 send(card,'click');assert.equal(card.classes.has('flipped'),false);
 panel.showScore(true);assert.equal(card.classes.has('flipped'),true);assert.equal(card.getAttribute('aria-hidden'),'false');assert.equal(back.inert,false);
 panel.update(450,1200);assert.equal(score.textContent,'450');assert.equal(best.textContent,'1,200');
 panel.setPhoneStage(false);send(card,'click');assert.equal(card.classes.has('flipped'),false);assert.equal(front.inert,false);assert.equal(card.getAttribute('aria-label'),'Show scoreboard');
});
