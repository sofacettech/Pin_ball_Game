import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../collective-source/animation-scope.js',import.meta.url),'utf8');
function fixture(){
 const frames=new Map(),timers=new Map(),cancelled=[],cleared=[],observers=[],media=new Map();let next=0;
 class Observer{
  constructor(callback){this.callback=callback;this.disconnections=0;this.observations=0;observers.push(this)}
  observe(){this.observations++}
  disconnect(){this.disconnections++}
 }
 const window=Object.assign(new EventTarget(),{
  requestAnimationFrame(callback){const id=++next;frames.set(id,callback);return id},
  cancelAnimationFrame(id){cancelled.push(id)},
  setTimeout(callback){const id=++next;timers.set(id,callback);return id},
  clearTimeout(id){cleared.push(id)},
  matchMedia(query){if(!media.has(query))media.set(query,Object.assign(new EventTarget(),{matches:false}));return media.get(query)},
  existingValue:'original',
 });
 const document=new EventTarget(),classes=new Set(['wave-intro-pending']);
 const root={classList:{remove:value=>classes.delete(value)},dataset:{textWaveStart:'123'},querySelector:()=>null,querySelectorAll:()=>[]};
 const context=vm.createContext({window,document,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:Observer,CSS:{escape:value=>value}});
 vm.runInContext(source.replace('export function','function')+';this.create=createAnimationScope;',context);
 return {scope:context.create(root),window,document,root,frames,timers,cancelled,cleared,observers,media,classes};
}

test('disposing releases scene resources once and ignores pending animation callbacks',()=>{
 const f=fixture(),{scope}=f;let released=0,callbacks=0;
 scope.onDispose(()=>{released++});
 const frame=scope.requestAnimationFrame(()=>callbacks++),timer=scope.setTimeout(()=>callbacks++,100);
 scope.addEventListener('scene-event',()=>callbacks++);
 scope.document.addEventListener('scene-event',()=>callbacks++);
 const query=scope.matchMedia('(pointer:coarse)');query.addEventListener('change',()=>callbacks++);
 const observer=new scope.ResizeObserver(()=>callbacks++);observer.observe(f.root);
 scope.window.existingValue='scene';scope.window.sceneOnly=true;
 scope.dispose();scope.dispose();
 assert.equal(released,1);assert.deepEqual(f.cancelled,[frame]);assert.deepEqual(f.cleared,[timer]);
 assert.equal(f.observers[0].disconnections,1);assert.equal(f.classes.has('wave-intro-pending'),false);
 assert.equal('textWaveStart' in f.root.dataset,false);assert.equal(f.window.existingValue,'original');assert.equal('sceneOnly' in f.window,false);
 f.frames.get(frame)(1);f.timers.get(timer)();f.observers[0].callback([]);
 f.window.dispatchEvent(new Event('scene-event'));f.document.dispatchEvent(new Event('scene-event'));
 f.media.get('(pointer:coarse)').dispatchEvent(new Event('change'));
 observer.observe(f.root);assert.equal(f.observers[0].observations,1);
 assert.equal(callbacks,0,'callbacks queued before unmount must not recreate scene resources');
 assert.equal(scope.requestAnimationFrame(()=>callbacks++),0);assert.equal(scope.setTimeout(()=>callbacks++,100),0);
 scope.window.sceneOnly=true;assert.equal('sceneOnly' in f.window,false);
 scope.onDispose(()=>{released++});assert.equal(released,2,'late resources are released immediately');
});

test('completed and explicitly cancelled animation work is removed from scene cleanup',()=>{
 const f=fixture(),{scope}=f;let callbacks=0;
 const completedFrame=scope.requestAnimationFrame(()=>callbacks++),completedTimer=scope.setTimeout(()=>callbacks++,0);
 f.frames.get(completedFrame)(1);f.timers.get(completedTimer)();
 const cancelledFrame=scope.requestAnimationFrame(()=>callbacks++),cancelledTimer=scope.setTimeout(()=>callbacks++,10);
 scope.cancelAnimationFrame(cancelledFrame);scope.clearTimeout(cancelledTimer);
 scope.dispose();assert.equal(callbacks,2);
 assert.deepEqual(f.cancelled,[cancelledFrame]);assert.deepEqual(f.cleared,[cancelledTimer]);
});
