import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLoadingCopy} from '../entrance-source/loading-copy.mjs';
import {withSiteMetadata} from '../scripts/site-metadata.mjs';

test('slow loading cycles through all eight messages without claiming the world is ready',()=>{
 const messages=[];let tick,cleared=0;
 const copy=createLoadingCopy(message=>messages.push(message),{setInterval(callback,delay){assert.equal(delay,1500);tick=callback;return 1},clearInterval(id){assert.equal(id,1);cleared++}});
 for(let i=0;i<7;i++)tick();
 assert.deepEqual(messages,['Growing the diamonds…','Cutting the facets…','Setting the light…','Building the SO/ FACET world…','Polishing the pinball table…','Warming up the flippers…','Opening the doors…',"SO/ FACET. What's yours?"]);
 assert.equal(cleared,0);tick();assert.equal(messages.at(-1),'Growing the diamonds…');
 copy.cancel();tick();assert.equal(messages.length,9);assert.equal(cleared,1);
});
test('a ready world skips the remaining loading messages and stops the timer immediately',()=>{
 const messages=[];let tick,cleared=0;
 const copy=createLoadingCopy(message=>messages.push(message),{setInterval(callback){tick=callback;return 1},clearInterval(){cleared++}});
 tick();copy.ready();tick();copy.ready();
 assert.deepEqual(messages,['Growing the diamonds…','Cutting the facets…',"SO/ FACET. What's yours?"]);
 assert.equal(cleared,1);
});
test('all page builds receive one complete share card and real favicons',()=>{
 const source='<html><head><title>Page</title><link rel="icon" href="data:,"></head><body></body></html>';
 const html=withSiteMetadata(source,'https://example.test/');
 assert.match(html,/og:image" content="https:\/\/example.test\/assets\/sofacet-share.png"/);
 assert.match(html,/og:image:width" content="1200"/);assert.match(html,/og:image:height" content="630"/);
 assert.match(html,/SO\/ FACET. What's yours\?/);assert.match(html,/summary_large_image/);assert.doesNotMatch(html,/href="data:,"/);
 assert.equal(withSiteMetadata(html,'https://example.test/'),html);assert.throws(()=>withSiteMetadata(source,'javascript:alert(1)'));
 const png=readFileSync(new URL('../assets/sofacet-share.png',import.meta.url));assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
});
test('public sign-in cannot trust preview storage or use a demonstration verification code',()=>{
 const source=readFileSync(new URL('../account-source/src/main.jsx',import.meta.url),'utf8');
 for(const text of ['createPreviewAccount','readPreviewAccount','writePreviewAccount','previewCode','isPreview','frontend-preview','123456'])assert.ok(!source.includes(text),text);
 assert.match(source,/request\('\/api\/account\/otp\/verify'/);assert.match(source,/result.verified!==true/);
});
