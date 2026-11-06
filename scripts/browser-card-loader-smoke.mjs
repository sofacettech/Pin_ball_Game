import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:type}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await type.launch(engine==='chromium'?{channel:process.env.SOFACET_BROWSER_CHANNEL||'chrome',args:['--enable-unsafe-swiftshader']}:{});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
const activeCard='.game-loader-cards .sofacet-card[data-slot="0"]';
async function settled(page,name){await page.waitForFunction(name=>document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]')?.getAttribute('aria-label')===name+' card'&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false',name);}
async function capture(page,name){if(output)await page.screenshot({path:resolve(output,engine+'-'+name+'.png')});}
async function point(page){const r=await page.locator('.game-loader-cards .deck').boundingBox();return{x:r.x+r.width/2,y:r.y+r.height/2};}
async function swipe(page,dx){
 const {x,y}=await point(page);
 if(engine==='chromium'){
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else await page.locator('.game-loader-cards .deck').evaluate((deck,{x,y,dx})=>{
  // Playwright exposes native WebKit taps but no native swipe transport.
  const capture=deck.setPointerCapture;deck.setPointerCapture=()=>{};
  const event={bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y};
  deck.dispatchEvent(new PointerEvent('pointerdown',event));deck.dispatchEvent(new PointerEvent('pointerup',{...event,clientX:x+dx}));deck.setPointerCapture=capture;
 },{x,y,dx});
}
try{await withRewardsSite(async({origin})=>{
 for(const width of [1440,375,320]){
  const mobile=width<600,context=await browser.newContext({viewport:{width,height:width===320?568:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));let release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/assets/sofacet-game-*.js',async route=>{
   if(engine==='webkit')return route.fulfill({body:'/* Controller/React test: this Windows WebKit has no AudioContext. */',contentType:'text/javascript'});
   const response=await route.fetch();await gate;await route.fulfill({response});
  });
  try{
   await page.goto(origin+'/play.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.sofacetGameLoader);
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#game-loader-cards-root img')].map(image=>image.decode()));});
   await settled(page,'Diamond');assert.equal(await page.locator('#game-loading-screen canvas,.loading-statement').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('.game-loader-cards .deck').boundingBox();assert.ok(box.y>0&&box.y+box.height<= (width===320?568:900));
   await capture(page,width+'-diamond');
   if(mobile){
    await swipe(page,90);await settled(page,'Jewellery');await capture(page,width+'-jewellery');
    await swipe(page,-90);await settled(page,'Diamond');
    const {x,y}=await point(page);await page.touchscreen.tap(x,y);await page.waitForFunction(()=>document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]').classList.contains('is-reversed')&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false');await capture(page,width+'-back');
    await page.touchscreen.tap(x,y);await page.waitForFunction(()=>!document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]').classList.contains('is-reversed')&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false');
   }else{
    let {x,y}=await point(page);await page.mouse.click(x,y);await settled(page,'Jewellery');assert.equal(await page.locator(activeCard).evaluate(e=>e.classList.contains('is-reversed')),false);await capture(page,width+'-jewellery');
    ({x,y}=await point(page));await page.mouse.dblclick(x,y);await page.waitForFunction(()=>document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='true');
    const moving=await page.locator('.game-loader-cards .sofacet-card').evaluateAll(cards=>cards.flatMap(card=>card.getAnimations().map(animation=>({name:card.getAttribute('aria-label'),frames:animation.effect.getKeyframes()}))).find(animation=>animation.frames.length===65));
    assert.equal(moving.name,'Diamond card');assert.equal(moving.frames.length,65);await settled(page,'Diamond');
    await page.waitForFunction(()=>document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]').getAttribute('aria-label')==='Jewellery card',null,{timeout:13000});await settled(page,'Jewellery');
   }
   // Hidden parent views suspend autoplay/floating, then resume the same deck.
   await page.evaluate(()=>window.sofacetGameLoader.setActive(false));assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
   await page.evaluate(()=>window.sofacetGameLoader.setActive(true));assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationPlayState),'running');
   if(engine==='chromium')release();else await page.evaluate(()=>window.sofacetGameLoader.ready());
   await page.waitForFunction(()=>document.querySelector('#stage').dataset.ready==='true'&&document.querySelector('#game-loading-screen').hidden&&!document.body.hasAttribute('data-game-loading'),null,{timeout:90000});
   if(engine==='chromium')await page.locator('#table-intro').waitFor();
   assert.deepEqual(errors,[]);report.push({width,mobile,flows:'React cards, next/previous, mobile flip or desktop autoplay, visibility pause, game-ready handoff',game:engine==='chromium'?'actual game initialization':'controller only; Windows WebKit has no AudioContext',swipes:mobile?(engine==='chromium'?'native':'PointerEvent simulation'):undefined});
  }finally{release();await context.close()}
 }
 const page=await browser.newPage({viewport:{width:375,height:844},reducedMotion:'reduce'});
 await page.route('**/assets/sofacet-game-*.js',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.goto(origin+'/play.html');await page.waitForFunction(()=>!!window.sofacetGameLoader);await page.evaluate(()=>window.sofacetGameLoader.fail(Error('WASM fixture failure'),'fixture'));
 await page.getByRole('button',{name:'Try again',exact:true}).waitFor();await capture(page,'retry');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.waitForFunction(()=>!!window.sofacetGameLoader&&document.querySelector('.game-loading-error').hidden);
 await page.locator('.game-loader-cards .deck').focus();await page.keyboard.press('ArrowRight');await settled(page,'Jewellery');assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationName),'none');await page.evaluate(()=>window.sofacetGameLoader.ready());await page.waitForFunction(()=>document.querySelector('#game-loading-screen').hidden);await page.close();
 report.push({flows:'failure → retry reload; reduced-motion keyboard navigation and readiness'});
});if(output)await writeFile(resolve(output,engine+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({engine,report}));}finally{await browser.close()}
