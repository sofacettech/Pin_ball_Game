import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/loading/intro.js',import.meta.url),'utf8');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const attrs=new Set(),main={inert:true,removeAttribute(){}},body={removeAttribute(){this.loading=false},loading:true};
 let revealed,removed=0,cleaned=0;
 const overlay={querySelector:()=>({}),setAttribute:key=>attrs.add(key),removeAttribute:key=>attrs.delete(key),
  classList:{add(){}},contains:()=>false,remove(){removed++}};
 const context={document:{querySelector:selector=>selector==='#site-loader'?overlay:main,documentElement:{hasAttribute:()=>false},body},
  mountReveal:(_stage,done)=>{revealed=done;return()=>cleaned++},matchMedia:()=>({matches:true}),setTimeout,Promise};
 vm.runInNewContext(source.replace(/^import .*;\n/,'').replace('export function','function')+';this.finishLoading=finishLoading;',context);
 return{context,attrs,main,body,reveal:()=>revealed(),get removed(){return removed},get cleaned(){return cleaned}};
}

test('a slow GPU keeps the loader visible and looping after the logo reveal finishes',async()=>{
 const view=fixture(),gpu=deferred(),done=view.context.finishLoading({ready:gpu.promise});
 assert.equal(view.attrs.has('data-preparing'),true);
 view.reveal();await turn();
 assert.equal(view.removed,0);assert.equal(view.main.inert,true);assert.equal(view.body.loading,true);
 assert.equal(view.attrs.has('data-waiting'),true);
 gpu.resolve();await done;
 assert.equal(view.removed,1);assert.equal(view.cleaned,1);assert.equal(view.main.inert,false);assert.equal(view.body.loading,false);
 assert.equal(view.attrs.has('data-waiting'),false);
});

test('a warm scene still waits for the reveal and repeated handoff calls remove the loader once',async()=>{
 const view=fixture(),done=view.context.finishLoading({ready:Promise.resolve()});
 assert.equal(view.context.finishLoading(),done);await turn();assert.equal(view.removed,0);
 view.reveal();await done;assert.equal(view.removed,1);
});
