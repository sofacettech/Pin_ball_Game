import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild-wasm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:['collective-source/ClaimPage.jsx'],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require});
const ClaimPage=module.exports.default;
test('saving confirmation retains the supplied membership artwork and replaces the form',()=>{
 const form=renderToStaticMarkup(React.createElement(ClaimPage,{result:{points:900},collectDetails:true}));
 const saved=renderToStaticMarkup(React.createElement(ClaimPage,{confirmation:React.createElement('h1',null,'It’s yours.')}));
 assert.match(form,/name="mobile"/);assert.match(form,/name="otp"/);assert.match(form.replace(/<[^>]*>/g,''),/SAVE MY SO\/ COINS/);
 assert.match(saved,/SO\/ SAVED/);assert.match(saved,/It’s yours\./);assert.doesNotMatch(saved,/<form|<input/);
 for(const html of [form,saved]){assert.match(html,/design-claim/);assert.match(html,/class="artwork art-layer/);assert.match(html,/class="mesh-layer/);}
});
