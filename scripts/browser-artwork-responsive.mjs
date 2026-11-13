import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import flowers from '../collective-source/artwork/flower-variants.json' with {type:'json'};

// Real React scenes and production CSS, served locally without accounts or a
// game session. Run once per engine with SOFACET_PLAYWRIGHT_PATH if necessary.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(root, 'work/responsive-artwork');
await mkdir(output, {recursive:true});
await writeFile(resolve(output, 'entry.jsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import LaunchPage from '../../collective-source/LaunchPage.jsx';
import {ScorePage} from '../../game-source/src/score-page.jsx';
import {AccountArtwork} from '../../collective-source/artwork/AccountArtwork.jsx';
import '../../collective-source/flow.css';
import '../../game-source/src/score-page.css';
const scene = new URLSearchParams(location.search).get('scene');
createRoot(document.getElementById(scene==='launch'?'launch-root':scene==='rewards'?'rewards-result':'account-root')).render(
  scene==='launch'?<LaunchPage onJoin={()=>{}} onPlay={()=>{}}/>:
  scene==='rewards'?<ScorePage result={{points:3205}} onSave={()=>{}} onReplay={()=>{}} onLeaderboard={()=>{}}/>:<AccountArtwork/>
);
`);
await build({entryPoints:[resolve(output,'entry.jsx')],bundle:true,format:'esm',outfile:resolve(output,'fixture.js'),logLevel:'silent'});
const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture') {
      res.setHeader('content-type','text/html');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${url.searchParams.has('fallback')?'<meta name="sofacet-artwork-cdn" content="https://artwork.invalid">':''}<link rel="stylesheet" href="/work/responsive-artwork/fixture.css"><style>html,body{margin:0;background:#08040d}#account-root{min-height:300vh;padding-top:50px}.butterfly-scene{position:relative;width:300px;height:300px;margin:0 auto}</style><div id="launch-root"></div><div id="post-game-rewards"><div id="rewards-result"></div></div><div id="account-root"></div><script type="module" src="/work/responsive-artwork/fixture.js"></script>`);
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep)) {res.writeHead(403).end();return;}
    const body = await readFile(file);
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(accept => server.listen(0,'127.0.0.1',accept));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
const engine = process.env.SOFACET_BROWSER || 'chromium';
const browser = await require(process.env.SOFACET_PLAYWRIGHT_PATH || 'playwright')[engine].launch({args:engine==='chromium'?['--enable-unsafe-swiftshader']:[]});
const manifest = new Map(Object.values(flowers).flatMap(flower => flower.variants.map(candidate => [candidate.src,candidate])));
const originals = new Set(Object.keys(flowers));
const report = {engine, runs:[], rotation:null, fallback:null, localFallback:null, butterfly:null};
async function inspect(page) {
  return page.locator('.flower-image').evaluateAll(images => images.filter(image=>image.closest('.motion-scene').offsetWidth>0).map(image=>({
    src:new URL(image.currentSrc).pathname, width:image.offsetWidth, height:image.offsetHeight, dpr:devicePixelRatio,
    naturalWidth:image.naturalWidth, naturalHeight:image.naturalHeight, sizes:image.sizes,
    scene:image.closest('.motion-scene').className, complete:image.complete, rendered:image.classList.contains('petal-rendered')
  })));
}
async function ready(page,scene) {
  await page.locator(`.design-${scene}[data-scene-ready="true"]`).waitFor();
  await page.evaluate(async()=>{
    const {decodeArtworkImages}=await import('/shared/artwork-assets.js');
    await decodeArtworkImages(document,'.flower-image');
  });
}
try {
  for (const scene of ['launch','rewards']) for (const [width,height] of [[393,735],[735,393],[820,1180],[1440,900]]) for (const dpr of [1,2,3]) {
    console.log(`${engine}: ${scene} ${width}x${height} DPR ${dpr}`);
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
    try {
      const page = await context.newPage(), requested = [], errors = [];
      page.on('request',request=>{if(request.resourceType()==='image')requested.push(new URL(request.url()).pathname);});
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${origin}/fixture?scene=${scene}`);
      await ready(page,scene);
      const images = await inspect(page);
      assert.equal(images.length,3);
      let bytes=0,pixels=0;
      for (const image of images) {
        const candidate=manifest.get(image.src);
        assert.ok(candidate, 'selected candidate must be in the hashed manifest');
        const original=flowers[Object.keys(flowers).find(source=>flowers[source].variants.some(variant=>variant.src===image.src))].variants.at(-1);
        assert.ok(candidate.width>=Math.min(original.width,image.width*dpr),`insufficient horizontal density: ${JSON.stringify(image)}`);
        assert.ok(candidate.height>=Math.min(original.height,image.height*dpr),`insufficient vertical density: ${JSON.stringify(image)}`);
        bytes+=candidate.bytes;pixels+=candidate.width*candidate.height;
      }
      const requestedFlowers = [...new Set(requested.filter(src=>manifest.has(src)))];
      assert.ok(requestedFlowers.every(src=>images.some(image=>image.src===src)), 'hidden composition must not fetch a second flower size');
      assert.deepEqual(errors,[]);
      report.runs.push({scene,width,height,dpr,bytes,pixels,images,requested});
    } finally {await context.close();}
  }
  // A same-element candidate upgrade must refresh an existing WebGL texture.
  if (engine==='chromium') {
    const context = await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:2});
    await context.addInitScript(()=>{
      Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>16});
      Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
      const upload=WebGL2RenderingContext.prototype.texImage2D;
      WebGL2RenderingContext.prototype.texImage2D=function(...args){const image=args.at(-1);if(image instanceof HTMLImageElement)(window.__flowerUploads||=[]).push(image.currentSrc);return upload.apply(this,args);};
    });
    try {
      const page=await context.newPage();await page.goto(`${origin}/fixture?scene=rewards`);await ready(page,'rewards');
      await page.waitForFunction(()=>window.__petalFlex?.surfaces===3);
      const before=await inspect(page);
      await page.setViewportSize({width:660,height:1000});
      await page.waitForFunction(()=>[...document.querySelectorAll('.scene-mobile .flower-image')].every(image=>image.complete));
      await page.waitForTimeout(250);
      const after=await inspect(page),uploads=await page.evaluate(()=>window.__flowerUploads);
      for(const image of after.filter(image=>!before.some(previous=>previous.src===image.src)))assert.ok(uploads.some(url=>url.endsWith(image.src)),'upgraded candidate uploaded');
      const compositions=[];
      for(const [width,height] of [[1000,660],[393,735]]){
        await page.setViewportSize({width,height});
        await page.waitForFunction(()=>[...document.querySelectorAll('.flower-image')].filter(image=>image.closest('.motion-scene').offsetWidth>0).every(image=>image.complete&&image.naturalWidth>1&&image.currentSrc.includes('/assets/collective/')));
        await page.waitForFunction(()=>window.__petalFlex?.surfaces===3);
        const images=await inspect(page);
        const currentUploads=await page.evaluate(()=>window.__flowerUploads);
        for(const image of images){
          assert.ok(currentUploads.some(url=>url.endsWith(image.src)), 'newly visible composition uploads its selected texture');
          const candidate=manifest.get(image.src);
          assert.ok(candidate.width>=Math.min(flowers[Object.keys(flowers).find(source=>flowers[source].variants.some(variant=>variant.src===image.src))].variants.at(-1).width,image.width*2));
        }
        compositions.push({width,height,images});
      }
      report.rotation={before,after,uploads,compositions};
    } finally {await context.close();}
  }
  {
    const context=await browser.newContext({viewport:{width:393,height:735},deviceScaleFactor:3,reducedMotion:'reduce'});
    try {
      const page=await context.newPage();await page.route('https://artwork.invalid/**',route=>route.abort());
      await page.goto(`${origin}/fixture?scene=rewards&fallback=1`);await ready(page,'rewards');
      const images=await inspect(page);
      assert.ok(images.every(image=>originals.has(image.src)),'CDN candidate errors retain full local originals');
      assert.ok(await page.locator('.scene-mobile .flower-image').evaluateAll(images=>images.every(image=>!image.srcset&&image.dataset.artworkFallback==='true')));
      report.fallback=images;
    } finally {await context.close();}
  }
  {
    const context=await browser.newContext({viewport:{width:393,height:735},deviceScaleFactor:3,reducedMotion:'reduce'});
    try {
      const page=await context.newPage();
      await page.route('**/assets/collective/*.webp',route=>{
        const path=new URL(route.request().url()).pathname;
        return manifest.has(path)&&!originals.has(path)?route.abort():route.continue();
      });
      await page.goto(`${origin}/fixture?scene=rewards`);await ready(page,'rewards');
      const images=await inspect(page);
      assert.ok(images.every(image=>originals.has(image.src)),'missing local derivative retains full local original');
      report.localFallback=images;
    } finally {await context.close();}
  }
  {
    const context=await browser.newContext({viewport:{width:393,height:735}});
    try {
      const page=await context.newPage();await page.goto(`${origin}/fixture?scene=account`);
      await page.waitForFunction(()=>document.querySelector('.butterfly-scene')&&!document.querySelector('.butterfly-scene').classList.contains('butterfly-paused'));
      await page.waitForTimeout(200);
      const running=await page.locator('.facet-wing').first().evaluate(node=>getComputedStyle(node).animationPlayState);
      await page.evaluate(()=>window.scrollTo(0,1200));
      await page.waitForFunction(()=>document.querySelector('.butterfly-scene').classList.contains('butterfly-paused'));
      const paused=await page.locator('.facet-wing').first().evaluate(node=>getComputedStyle(node).animationPlayState);
      const phase=await page.locator('.facet-wing').first().evaluate(node=>node.getAnimations()[0].currentTime);
      await page.waitForTimeout(200);
      const heldPhase=await page.locator('.facet-wing').first().evaluate(node=>node.getAnimations()[0].currentTime);
      assert.equal(running,'running');assert.equal(paused,'paused');
      assert.ok(Math.abs(heldPhase-phase)<20, 'offscreen animation retains its phase');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.waitForFunction(()=>!document.querySelector('.butterfly-scene').classList.contains('butterfly-paused'));
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.ok(await page.locator('.butterfly-scene').evaluate(node=>node.classList.contains('butterfly-paused')));
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      report.butterfly={running,paused,resumed:true,phase,heldPhase,hiddenPagePaused:true};
    } finally {await context.close();}
  }
  await writeFile(resolve(output,engine+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({engine,scenarios:report.runs.length,rotation:!!report.rotation,fallback:!!report.fallback,butterfly:report.butterfly}));
} finally {await browser.close();await new Promise(accept=>server.close(accept));}
