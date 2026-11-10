import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:browserType}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await browserType.launch({...(process.env.SOFACET_BROWSER_CHANNEL?{channel:process.env.SOFACET_BROWSER_CHANNEL}:{}),args:engine==='chromium'?['--enable-unsafe-swiftshader']:[]});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
async function capture(page,name){if(output){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(output,name+'.png')});}}
const titles={
  '/':"What's yours?",'/video':"What's yours?",'/play.html':'Pinball','/membership.html':'My SO/ COINS','/account.html':'My SO/ COINS',
  '/faq.html':'How SO/ COINS work','/launching-soon.html':'Launching in December','/first-cuts-confirmation.html':"What's yours?",'/privacy.html':'Privacy','/terms.html':'Terms',
};
try{
 await withRewardsSite(async({origin})=>{
  for(const width of [375,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
   try{
    for(const [route,suffix] of Object.entries(titles)){
     await page.goto(origin+route,{waitUntil:'domcontentloaded'});
     if(['/account.html','/membership.html','/launching-soon.html'].includes(route))await page.locator('.react-page-root[data-scene-ready="true"]').waitFor();
     assert.equal(await page.title(),'SO/ FACET — '+suffix);report.push({width,route,title:await page.title()});
    }
    await page.goto(origin+'/faq.html');const play=page.locator('.pinball');await play.scrollIntoViewIfNeeded();
    const button=await play.evaluate(e=>({border:parseFloat(getComputedStyle(e).borderTopWidth),height:e.getBoundingClientRect().height}));
    assert.ok(button.border>=1&&button.height>=44);await capture(page,width+'-faq-end');await play.click();await page.waitForURL('**/play.html');
    await page.goto(origin+'/faq.html');
    await page.locator('#topic-basics').click();await page.locator('#topic-games').click();
    await page.goBack();await page.locator('#the-basics').waitFor();
    await page.goForward();await page.locator('#game-and-points').waitFor();
    await page.goto(origin+'/launching-soon.html');
    await page.getByRole('button',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).click();
    await page.waitForURL('**/membership.html?from=collective');await page.locator('#create-tab[aria-selected=true]').waitFor();
    await page.locator('.auth-flow-back').click();await page.waitForURL('**/launching-soon.html');
    await page.getByRole('button',{name:'Rather play first? Play Pinball',exact:true}).click();await page.waitForURL('**/play.html');
    for(const [name,path] of [['Play Pinball','/play.html'],['My SO/ COINS','/account.html']]){
     await page.goto(origin+'/first-cuts-confirmation.html');await page.getByRole('link',{name:new RegExp('^'+name)}).click();await page.waitForURL(origin+path);
    }
    await page.route('**/api/player',r=>r.fulfill({json:{member:true,display_name:'Test M.',best_score:3205}}));
    await page.route('**/api/account',r=>r.fulfill({json:{name:'Test Member',leaderboardName:'Test M.',email:'test@example.invalid',phoneNumber:'+919876543210',marketingConsent:false,savedPoints:3200,bestPoints:3205,rank:14}}));
    await page.goto(origin+'/account.html');await page.locator('#account-screen').waitFor();await page.getByRole('button',{name:'Share my score',exact:true}).click();await page.getByRole('heading',{name:'Your score. Your move.'}).waitFor();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedScore=text}}}));
    await page.getByRole('button',{name:'Copy my score',exact:true}).click();await page.getByRole('dialog').getByRole('status').filter({hasText:'Your score was copied.'}).waitFor();assert.match(await page.evaluate(()=>window.__copiedScore),/3,205 SO\/ COINS/);
    await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('link',{name:'Play again',exact:true}).click();await page.waitForURL('**/play.html');
    report.push({width,flows:'FAQ play button, launch join/play, confirmation play/world, My SO/ COINS share/replay'});
   }finally{await context.close()}
  }
  // The Windows WebKit runner lacks AudioContext; only Chromium exercises
  // the full 3D entrance and game handoff. Page/link checks above run on both.
  if(engine==='chromium')for(const width of [375,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
   try{
    await page.goto(origin+'/');await page.waitForFunction(()=>window.entrancePreview?.ready&&!document.body.hasAttribute('data-loading'),null,{timeout:90000});
    await page.evaluate(y=>scrollTo(0,y),createJourneyScrollMap().travel);
    const deck=page.locator('#game-loader-cards-root .deck');
    for(const name of ['Diamond','Pinball','Jewellery']){
     await page.getByRole('button',{name:name+' card. Front view',exact:true}).waitFor({timeout:90000});
     await deck.press('ArrowRight');
    }
    await page.waitForFunction(()=>document.body.dataset.game==='visible',null,{timeout:90000});
    const game=page.frameLocator('#game-page');
    assert.equal(await page.title(),'SO/ FACET — Pinball');await game.locator('#table-intro').waitFor();
    await game.locator('[data-menu-toggle]').click();
    await game.getByRole('link',{name:'HOW SO/ COINS WORK',exact:true}).click();
    const info=game.frameLocator('#game-info-dialog iframe');
    await info.locator('#topic-basics').click();
    await page.waitForFunction(()=>history.state?.sofacetInfo?.href.endsWith('#the-basics'));
    await page.goBack();await info.locator('#the-basics').waitFor({state:'hidden'});
    await page.goBack();await game.locator('#game-info-dialog').waitFor({state:'hidden'});await game.locator('#table-intro').waitFor();
    await page.goBack();
    await page.waitForFunction(()=>window.entrancePreview?.ready&&!window.entrancePreview.gameVisible,null,{timeout:90000});
    report.push({width,flows:'World → game → FAQ topic → Back to game → Back to world'});
   }finally{await context.close()}
  }
 });
 if(output)await writeFile(resolve(output,engine+'-page-flows.json'),JSON.stringify(report,null,2));
 console.log(engine+': '+report.length+' title/navigation checks passed');
}finally{await browser.close()}
