import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEntranceVideoWidth} from '../entrance-source/video-quality.mjs';
import {loadEntranceMedia} from '../entrance-source/video-delivery.mjs';

const phone={userAgent:'Mozilla/5.0 (Linux; Android 15) Mobile'};
const scenarios=[
  ['fast cellular enters measured preload', {...phone,connection:{type:'cellular',effectiveType:'4g',downlink:100}},3840],
  ['desktop cellular enters measured preload', {connection:{type:'cellular',effectiveType:'4g'}},3840],
  ['Wi-Fi data saver', {...phone,connection:{type:'wifi',effectiveType:'4g',saveData:true}},1920],
  ...['slow-2g','2g','3g'].map(effectiveType=>[`slow Wi-Fi ${effectiveType}`,{connection:{type:'wifi',effectiveType}},1920]),
  ['unknown Android transport with fast estimate', {...phone,connection:{effectiveType:'4g',saveData:false}},3840],
  ['unknown explicit transport', {...phone,connection:{type:'unknown',effectiveType:'4g'}},3840],
  ['iPhone without connection API', {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},3840],
  ['iPad desktop identity', {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5},3840],
  ['Apple phone platform with desktop user agent', {userAgent:'Mozilla/5.0 (Macintosh)',platform:'iPhone',maxTouchPoints:1},3840],
  ['Apple tablet with one touch point', {userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:1},3840],
  ['mobile client hint without user agent', {userAgentData:{mobile:true}},3840],
  ['known phone Wi-Fi', {...phone,connection:{type:'wifi',effectiveType:'4g'}},3840],
  ['known ethernet', {connection:{type:'ethernet',effectiveType:'4g'}},3840],
  ['ordinary desktop with no connection API', {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:0},3840],
  ['desktop speed hint only', {connection:{effectiveType:'4g'}},3840],
];
for(const [name,navigator,width] of scenarios)test(`entrance video quality: ${name}`,()=>{
  assert.equal(selectEntranceVideoWidth({navigator}),width);
});
test('comparison option 2 stays 1080p even on Wi-Fi',()=>{
  assert.equal(selectEntranceVideoWidth({option:'2',navigator:{connection:{type:'wifi'}}}),1920);
});

function deliveryFixture({regularAvailable=true,onFetch=()=>{}}={}){
  const local={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,bytes:100,sha256:'a'.repeat(64)},journey:{frameCount:1831,bytes:100,sha256:'b'.repeat(64)}}};
  const hd=structuredClone(local);
  for(const kind of ['opening','journey'])hd.clips[kind].file=`entrance-${kind}-${hd.clips[kind].sha256}.mp4`;
  const ultra={...structuredClone(hd),width:3840,height:2160},calls=[];
  return {calls,fetcher:async url=>{
    calls.push(url);onFetch(url);
    return {ok:regularAvailable||!String(url).includes('/hd/'),json:async()=>url==='/api/media-config'?{entranceManifestURL:'https://media.example/hd/manifest.json',entrance4kManifestURL:'https://media.example/4k/manifest.json'}:String(url).includes('/4k/')?ultra:String(url).includes('/hd/')?hd:local};
  }};
}
for(const [name,navigator,width] of scenarios.filter(([, ,width])=>width===1920))test(`reduced quality never fetches the 4K manifest: ${name}`,async()=>{
  const {calls,fetcher}=deliveryFixture();
  const media=await loadEntranceMedia(fetcher,{option:'3',navigator});
  assert.equal(media.manifest.width,1920);assert.match(media.clips.journey.url,/\/hd\//);
  assert.equal(calls.some(url=>String(url).includes('/4k/')),false);
});
test('reduced quality retains only 1080p when its CDN is unavailable',async()=>{
  const {calls,fetcher}=deliveryFixture({regularAvailable:false});
  const media=await loadEntranceMedia(fetcher,{navigator:{...phone,connection:{saveData:true}}});
  assert.equal(media.manifest.width,1920);assert.equal(media.clips.journey.url,media.clips.journey.local);
  assert.equal(calls.some(url=>String(url).includes('/4k/')),false);
});
test('quality is fixed before fetching config even if network hints change during startup',async()=>{
  const navigator={...phone,connection:{saveData:true}};
  const {calls,fetcher}=deliveryFixture({onFetch:()=>{navigator.connection.saveData=false}});
  const media=await loadEntranceMedia(fetcher,{navigator});
  assert.equal(media.manifest.width,1920);assert.equal(calls.some(url=>String(url).includes('/4k/')),false);
});
test('known Wi-Fi still selects the verified 4K CDN',async()=>{
  const {fetcher}=deliveryFixture();
  const media=await loadEntranceMedia(fetcher,{navigator:{...phone,connection:{type:'wifi',effectiveType:'4g'}}});
  assert.equal(media.manifest.width,3840);assert.match(media.clips.journey.url,/\/4k\//);
});
