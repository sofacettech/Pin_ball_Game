import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
const script=readFileSync(new URL('../assets/cookie-preferences.js',import.meta.url),'utf8');
function boot(record,{blocked=false}={}){
 const events={},root={dataset:{}},window={dispatchEvent(){},addEventListener(name,fn){events[name]=fn}};window.top=window;
 const document={documentElement:root,readyState:'loading',addEventListener(){}};
 vm.runInNewContext(script,{window,document,Date,Number,JSON,Element:class{},CustomEvent:class{},localStorage:{getItem(){if(blocked)throw Error('Blocked');return record}}});
 return{api:window.sofacetCookiePreferences,root,events,clear(){record=null;events.storage({key:null})}};
}
test('optional cookies default off for absent, expired, malformed or inaccessible storage',()=>{
 for(const record of [null,'broken','{}',JSON.stringify({version:1,expires:Date.now()-1,analytics:true,advertising:true}),JSON.stringify({version:1,expires:Date.now()+100000,analytics:'true',advertising:true})]){
  const {api}=boot(record);assert.equal(api.allows('essential'),true);assert.equal(api.allows('analytics'),false);assert.equal(api.allows('advertising'),false);assert.equal(api.allows('unknown'),false);
 }
 assert.equal(boot(null,{blocked:true}).api.allows('analytics'),false);
});
test('saved preferences are read independently and reset when another tab clears storage',()=>{
 const {api,root,clear}=boot(JSON.stringify({version:1,expires:Date.now()+100000,analytics:true,advertising:false}));
 assert.equal(api.allows('analytics'),true);assert.equal(api.allows('advertising'),false);assert.equal(root.dataset.analytics,'true');
 clear();assert.equal(api.allows('analytics'),false);assert.equal(root.dataset.analytics,'false');
});
test('every rebuilt page includes exactly one preferences controller',()=>{
 const html=withGameLoader(withGameLoader('<html><head><meta charset="utf-8"></head><body></body></html>'));
 assert.equal((html.match(/id="cookie-preferences"/g)||[]).length,1);
 assert(html.indexOf('id="cookie-preferences"')<html.indexOf('</head>'));
});
