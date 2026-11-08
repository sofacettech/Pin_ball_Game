import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
const script=readFileSync(new URL('../assets/cookie-preferences.js',import.meta.url),'utf8');
function boot(record,{blocked=false,path='/'}={}){
 const events={},root={dataset:{}},window={location:{pathname:path},CustomEvent:class{},dispatchEvent(){},addEventListener(name,fn){events[name]=fn}};window.top=window;
 const document={documentElement:root,readyState:'loading',querySelectorAll:()=>[],addEventListener(){}};
 window.document=document;
 vm.runInNewContext(script,{window,document,Date,Number,JSON,Element:class{},CustomEvent:class{},localStorage:{getItem(){if(blocked)throw Error('Blocked');return record},setItem(key,value){if(blocked)throw Error('Blocked');record=value}}});
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
 assert.equal((html.match(/src="\/assets\/cookie-popup\.js\?v=/g)||[]).length,1);
});

test('the React notice is landing-only and existing saved choices suppress it',()=>{
 for(const path of ['/','/index.html','/entrance-3d.html','/video','/about.html','/play.html','/account.html']){
  const {api}=boot(null,{path});let view;api.mount(value=>{view=value});
  assert.equal(view.showNotice,['/','/index.html','/entrance-3d.html','/video'].includes(path),path);
 }
 const {api}=boot(JSON.stringify({version:1,expires:Date.now()+100000,analytics:true,advertising:false}));
 let view;api.mount(value=>{view=value});assert.equal(view.showNotice,false);
});

test('React settings preserve consent, close state, and storage failure feedback',()=>{
 for(const blocked of [false,true]){
  const {api,root}=boot(null,{blocked});let view;api.mount(value=>{view=value});
  api.open();assert.equal(view.settingsOpen,true);assert.equal(view.showNotice,false);assert.equal(root.dataset.cookieSettingsOpen,'true');
  view.save(true,false);assert.equal(api.allows('analytics'),true);assert.equal(api.allows('advertising'),false);
  assert.equal(view.persisted,!blocked);assert.equal(view.settingsOpen,blocked);
  view.close();assert.equal(view.settingsOpen,false);assert.equal(root.dataset.cookieSettingsOpen,'false');
  api.open();view.save(false,false);assert.equal(api.allows('analytics'),false);
 }
});
