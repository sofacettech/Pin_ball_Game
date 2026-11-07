import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:type}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await type.launch(process.env.SOFACET_BROWSER_CHANNEL?{channel:process.env.SOFACET_BROWSER_CHANNEL}:{});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
async function faces(page,back){
 const card=page.locator('.sofacet-card[data-slot="0"]');
 assert.equal(await card.locator('.front-face').isVisible(),!back,'Front face visibility');
 assert.equal(await card.locator('.reverse-face').isVisible(),back,'Reverse face visibility');
}
async function capture(page,name){if(output){
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.waitForTimeout(200);
 await page.screenshot({path:resolve(output,name+'.png')});
}}
async function turn(page,back){
 await page.locator('.game-loader-cards .deck').press('Enter');
 await page.evaluate(()=>{
  const element=document.querySelector('.sofacet-card[data-slot="0"] .card-turn');
  window.__testTurn=element.getAnimations()[0];
  if(!window.__testTurn)throw Error('The flip animation did not start');
  window.__testTurn.pause();window.__testTurn.currentTime=100;
 });
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const timing=await page.evaluate(()=>window.__testTurn.effect.getComputedTiming());
 assert.equal(timing.duration,1000);assert.ok(timing.progress<.5);
 await faces(page,!back);
 await page.evaluate(()=>{window.__testTurn.currentTime=700});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.ok(await page.evaluate(()=>window.__testTurn.effect.getComputedTiming().progress>=.5));
 await faces(page,back);
 await page.evaluate(()=>{window.__testTurn.currentTime=1000;window.__testTurn.play()});
 await page.waitForFunction(()=>document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false');
 await faces(page,back);
}
try{await withRewardsSite(async({origin})=>{
 for(const [width,height] of [[375,812],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:width<768,hasTouch:width<768,reducedMotion:'no-preference'}),page=await context.newPage();
  await page.route('**/assets/sofacet-game-*.js',r=>r.fulfill({contentType:'text/javascript',body:'/* Hold the real game while checking its loading cards. */'}));
  await page.goto(origin+'/play.html');
  const deck=page.locator('.game-loader-cards .deck');await deck.waitFor();
  await page.locator('#sf-cookie-notice [data-reject]').click({timeout:1200}).catch(()=>{});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.sofacet-card img')].map(i=>i.decode()))});
  await deck.press(' '); // Pause automatic changes; manual flips keep their real animation.
  for(const name of ['Diamond','Jewellery','Pinball']){
   if(name!=='Diamond')await deck.press('ArrowRight');
   await page.waitForFunction(name=>document.querySelector('.sofacet-card[data-slot="0"]').getAttribute('aria-label')===name+' card'&&document.querySelector('.game-loader-cards .stage').getAttribute('aria-busy')==='false',name);
   await faces(page,false);await deck.evaluate(e=>e.blur());
   await capture(page,width+'-'+name.toLowerCase()+'-front');
   await turn(page,true);await deck.evaluate(e=>e.blur());
   await capture(page,width+'-'+name.toLowerCase()+'-back');
   await turn(page,false);
   report.push({engine,width,card:name,front:true,reverse:true,bothFlipDirections:true,edgeVisibilityChecked:true});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await context.close();
 }
});}finally{await browser.close()}
if(output)await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
