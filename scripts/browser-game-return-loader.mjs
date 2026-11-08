import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:process.env.SOFACET_BROWSER_CHANNEL||'chrome',args:['--enable-unsafe-swiftshader']});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
async function capture(page,name){if(output){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(output,name+'.png')})}}
try{await withRewardsSite(async({origin})=>{
 for(const [width,height] of [[375,812],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<600,isMobile:width<600,reducedMotion:'reduce'}),page=await context.newPage();
  let release,releaseAssets;
  try{
   await page.goto(origin+'/');
   await page.waitForFunction(()=>window.entrancePreview?.ready&&!document.body.hasAttribute('data-loading'),null,{timeout:120000});
   await page.locator('#sf-cookie-notice [data-reject]').click({timeout:1200}).catch(()=>{});
   await page.evaluate(y=>scrollTo(0,y),createJourneyScrollMap().travel);
   await page.getByRole('button',{name:'Diamond card. Front view',exact:true}).waitFor({timeout:90000});
   assert.equal(await page.locator('#game-loading-screen').getAttribute('data-loader'),'cards');
   assert.equal(await page.locator('.game-loading-progress').isVisible(),false);
   await capture(page,width+'-chess-cards');
   const deck=page.locator('#game-loader-cards-root .deck');
   for(const name of ['Diamond','Jewellery','Pinball']){
    await page.getByRole('button',{name:name+' card. Front view',exact:true}).waitFor();
    await deck.press('ArrowRight');
   }
   await page.waitForFunction(()=>document.body.dataset.game==='visible',null,{timeout:120000});
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('sofacet-game-visited')),'1');
   const game=page.frameLocator('#game-page');await game.locator('#table-intro').waitFor();

   await game.locator('[data-menu-toggle]').click();
   await game.locator('[data-menu-panel] a[href*="about.html"]').click();
   await game.frameLocator('#game-info-dialog iframe').locator('#intro-title').waitFor();
   await page.goBack();await game.locator('#game-info-dialog').waitFor({state:'hidden'});
   assert.equal(await game.locator('#game-loading-screen').isVisible(),false,'A retained table returns immediately');

   await page.goto(origin+'/about.html');await page.locator('#intro-title').waitFor();
   const gate=new Promise(r=>release=r);
   const assetsGate=new Promise(r=>releaseAssets=r);
   await page.route('**/assets/sofacet-game-*.js',async route=>{
    const response=await route.fetch();await gate;await route.fulfill({response});
   });
   await page.route('**/assets/collision-vertices.bin*',async route=>{
    const response=await route.fetch();await assetsGate;await route.fulfill({response});
   });
   await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    const bar=document.querySelector('.game-loading-progress');if(!bar)return;
    window.__gameProgress=[];
    const record=()=>window.__gameProgress.push(Number(bar.getAttribute('aria-valuenow')));
    record();new MutationObserver(record).observe(bar,{attributes:true,attributeFilter:['aria-valuenow']});
   }));
   await page.locator('a[href="/play.html"]').first().click();
   await page.waitForURL('**/play.html');
   await page.locator('.game-loading-progress').waitFor({state:'visible'});
   assert.equal(await page.locator('#game-loading-screen').getAttribute('data-loader'),'progress');
   assert.equal(await page.locator('#game-loader-cards-root').isVisible(),false);
   assert.equal(await page.locator('#stage').getAttribute('data-ready'),'false');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.equal(await page.locator('.game-loading-statement').innerText(),'Up Next:\nPinball');
   assert.equal(await page.locator('.game-loading-percent').count(),0);
   await capture(page,width+'-return-progress-zero');
   // Hold the module while exercising statement boundaries in the real loader UI.
   for(const [value,index] of [[33,0],[66,1]]){
    await page.evaluate(value=>window.sofacetGameLoader.progress(value),value);
    const expected=await page.locator('#game-loader-cards-root .card-copy').nth(index).evaluate(e=>[...e.children].map(line=>line.innerHTML).join('<br>'));
    assert.equal(await page.locator('.game-loading-statement').innerHTML(),expected);
    const fits=await page.locator('.game-loading-statement').evaluate(e=>{const b=e.getBoundingClientRect();return b.x>=0&&b.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1});
    assert.equal(fits,true,'Statement stays inside the screen');
    await capture(page,width+'-return-statement-'+(index+1));
   }
   release();
   await page.waitForFunction(()=>document.querySelector('.game-loading-progress').getAttribute('aria-valuenow')==='85',null,{timeout:120000});
   assert.match(await page.locator('.game-loading-statement').innerText(),/^Score SO\/ COINS\./);
   assert.equal(await page.locator('#stage').getAttribute('data-ready'),'false');
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.waitForTimeout(250);
   const fill=await page.locator('.game-loading-fill').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
   assert.ok(Math.abs(fill-.85)<.01,'Bar fill matches the reported loading progress');
   await capture(page,width+'-return-progress');
   await page.emulateMedia({reducedMotion:'reduce'});
   releaseAssets();
   await page.locator('#game-loading-screen').waitFor({state:'hidden',timeout:120000});
   assert.equal(await page.locator('#stage').getAttribute('data-ready'),'true');
   assert.equal(await page.locator('#game-loader-cards-root').isVisible(),false);
   await page.locator('#table-intro').waitFor();
   const values=await page.evaluate(()=>window.__gameProgress);
   assert.equal(values[0],0);assert.equal(values.at(-1),100);
   assert.ok(values.every((value,i)=>value>=0&&value<=100&&(!i||value>=values[i-1])));
   assert.match(await page.locator('.game-loading-statement').innerText(),/^Score SO\/ COINS\./);
   await capture(page,width+'-return-ready');
   report.push({width,height,chessCards:true,retainedGameReturnsImmediately:true,returnFromAboutUsesOnlyProgress:true,waitsForRealReadiness:true,progressValues:[...new Set(values)],noOverflow:true});
  }finally{release?.();releaseAssets?.();await context.close()}
 }
});}finally{await browser.close()}
if(output)await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
