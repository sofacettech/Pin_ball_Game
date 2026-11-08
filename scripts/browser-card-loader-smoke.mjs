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
async function checkTravel(page,right){
 await page.waitForFunction(()=>document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='true');
 const motion=await page.locator('.game-loader-cards .sofacet-card').evaluateAll(cards=>cards.flatMap(card=>card.getAnimations()).filter(a=>a.effect.getKeyframes().length===65).map(a=>({x:new DOMMatrixReadOnly(a.effect.getKeyframes()[32].transform).m41,...a.effect.getTiming()}))[0]);
 assert.ok(right?motion.x>0:motion.x<0,'The card follows the intended swipe direction');
 assert.equal(motion.duration,1600);assert.equal(motion.easing,'cubic-bezier(0.45, 0, 0.2, 1)');
}
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
   await page.goto(origin+'/play.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.sofacetGameLoader);await page.locator('#sf-cookie-notice [data-reject]').click();
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#game-loader-cards-root img')].map(image=>image.decode()));});
   await settled(page,'Diamond');assert.equal(await page.locator('#game-loading-screen canvas,.loading-statement').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('.game-loader-cards .deck').boundingBox();assert.ok(box.y>0&&box.y+box.height<= (width===320?568:900));
   assert.ok(Math.abs(box.width/box.height-806/1330)<.01,'The smaller card preserves its aspect ratio');
   const swipeHint=page.locator('.card-hint-swipe'),clickHint=page.locator('.card-hint-desktop');
   assert.equal(await swipeHint.innerText(),'Swipe left to explore');
   const swipeBox=await swipeHint.boundingBox();assert.ok(swipeBox.y>=0&&swipeBox.y+swipeBox.height<box.y-12,'Swipe hint fits above the deck');
   assert.equal(await clickHint.isVisible(),!mobile);
   if(!mobile){
    assert.equal(await clickHint.innerText(),'Click to discover your next facet.');
    const clickBox=await clickHint.boundingBox();assert.ok(clickBox.y>box.y+box.height+12&&clickBox.y+clickBox.height<=900,'Click hint fits below the deck');
   }
   await capture(page,width+'-diamond');
   if(mobile){
    await swipe(page,90);await checkTravel(page,true);await settled(page,'Jewellery');await capture(page,width+'-jewellery');
    const {x,y}=await point(page);await page.touchscreen.tap(x,y);await page.waitForFunction(()=>document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]').classList.contains('is-reversed')&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false');await capture(page,width+'-back');
    await page.touchscreen.tap(x,y);await page.waitForFunction(()=>!document.querySelector('.game-loader-cards .sofacet-card[data-slot="0"]').classList.contains('is-reversed')&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false');
    await swipe(page,-90);await checkTravel(page,false);await settled(page,'Pinball');
   }else{
    const {x,y}=await point(page);await page.mouse.click(x,y);await checkTravel(page,false);await settled(page,'Jewellery');assert.equal(await page.locator(activeCard).evaluate(e=>e.classList.contains('is-reversed')),false);await capture(page,width+'-jewellery');
    await page.locator('.game-loader-cards .deck').press('ArrowLeft');await checkTravel(page,false);await settled(page,'Pinball');
   }
   // Hidden parent views suspend autoplay/floating, then resume the same deck.
   await page.evaluate(()=>window.sofacetGameLoader.setActive(false));assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
   await page.evaluate(()=>window.sofacetGameLoader.setActive(true));assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationPlayState),'running');
   await (mobile?swipe(page,90):page.locator('.game-loader-cards .deck').press('ArrowRight'));
   await page.locator('#game-loader-cards-root').waitFor({state:'hidden'});
   assert.equal(await page.locator('#game-loading-screen').isVisible(),true,'The final swipe waits for the actual table if it is still loading');
   if(engine==='chromium')release();else await page.evaluate(()=>window.sofacetGameLoader.ready());
   await page.waitForFunction(()=>document.querySelector('#stage').dataset.ready==='true'&&document.querySelector('#game-loading-screen').hidden&&!document.body.hasAttribute('data-game-loading'),null,{timeout:90000});
   if(engine==='chromium')await page.locator('#table-intro').waitFor();
   assert.deepEqual(errors,[]);report.push({width,mobile,flows:'Three-card progression, mobile flip, visibility pause, game-ready handoff',game:engine==='chromium'?'actual game initialization':'controller only; Windows WebKit has no AudioContext',swipes:mobile?(engine==='chromium'?'native':'PointerEvent simulation'):undefined});
  }finally{release();await context.close()}
 }
 const page=await browser.newPage({viewport:{width:375,height:844},reducedMotion:'reduce'});
 await page.route('**/assets/sofacet-game-*.js',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.goto(origin+'/play.html');await page.waitForFunction(()=>!!window.sofacetGameLoader);await page.locator('#sf-cookie-notice [data-reject]').click();await page.evaluate(()=>window.sofacetGameLoader.fail(Error('WASM fixture failure'),'fixture'));
 await page.getByRole('button',{name:'Try again',exact:true}).waitFor();await capture(page,'retry');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.waitForFunction(()=>!!window.sofacetGameLoader&&document.querySelector('.game-loading-error').hidden);
 await page.locator('#game-loader-cards-root').waitFor();
 await page.locator('.game-loader-cards .deck').press('ArrowRight');await settled(page,'Jewellery');
 assert.equal(await page.locator('.game-loader-cards .floating').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.evaluate(()=>window.sofacetGameLoader.ready());
 assert.equal(await page.locator('#game-loading-screen').isVisible(),true);
 await page.locator('.game-loader-cards .deck').press('ArrowRight');await settled(page,'Pinball');
 await page.locator('.game-loader-cards .deck').press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#game-loading-screen').hidden);await page.close();
 report.push({flows:'failure → retry reload; reduced-motion keyboard navigation and readiness'});
});if(output)await writeFile(resolve(output,engine+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({engine,report}));}finally{await browser.close()}
