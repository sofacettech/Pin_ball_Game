import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite,member,other,registration} from '../tests/helpers/rewards-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
async function capture(page,name){await page.evaluate(()=>document.fonts.ready);if(output)await page.screenshot({path:resolve(output,name+'.png'),fullPage:true})}
async function settled(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>Math.abs(Number(document.querySelector('#orbit').dataset.position)-Number(document.querySelector('#orbit').dataset.target))<.01)}
try{await withRewardsSite(async({origin,readStore,request})=>{
 const challenge=await request('/api/account/otp/request',{phoneNumber:registration.phoneNumber});
 assert.equal(challenge.status,200);
 const session=await request('/api/account/otp/verify',{phoneNumber:registration.phoneNumber,challengeId:challenge.data.challengeId,otp:'012345'});
 assert.equal(session.status,200);
 for(const [width,height] of [[1440,801],[390,844],[320,568],[844,390]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,isMobile:width<900}),page=await context.newPage(),errors=[],posts=[];
  await context.addCookies([{name:'sofacet_pinball_player',value:member,url:origin}]);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(request.url())});
  try{
   await page.goto(origin+'/launch');
   await page.waitForURL('**/notify');
   await page.getByRole('heading',{name:'LAUNCHING SOON',exact:true}).waitFor();
   await page.locator('.notify-member p').getByText('For exclusive early access, updates and more,',{exact:true}).waitFor();
   const about=page.getByRole('link',{name:'ABOUT SO/ FACET',exact:true});await about.waitFor();
   assert.equal(await page.getByRole('link',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).isVisible(),false);
   await page.waitForFunction(()=>document.querySelector('#scene')?.dataset.intro==='complete');
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#notify-root img')].map(img=>img.decode()))});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
   const styles=await page.locator('#page-title,.notification p,.notify-button').evaluateAll(nodes=>nodes.map(e=>({selector:e.id||e.className,family:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight,size:getComputedStyle(e).fontSize})));
   assert.equal(await page.title(),'SO/ FACET — Launching soon');
   assert.equal(await page.locator('#notify-form,#email,#confirmation,.site-join-footer').count(),0);
   assert.equal(await about.getAttribute('href'),'/about');
   if(width===1440)assert.ok(await about.evaluate(link=>link.getBoundingClientRect().bottom<=innerHeight),'Desktop About button fits in the initial viewport');
   await capture(page,width+'-notify');
   assert.equal(await page.locator('#scene').getAttribute('data-intro-turns'),'1');
   await page.getByRole('button',{name:'Previous photograph',exact:true}).click();await settled(page);assert.equal(await page.locator('#orbit').getAttribute('data-target'),'-1.000');
   for(let i=0;i<7;i++){await page.getByRole('button',{name:'Next photograph',exact:true}).click();await settled(page)}
   assert.equal(await page.locator('#orbit').getAttribute('data-target'),'6.000');
   await page.locator('.piece[aria-pressed="true"]').press('ArrowRight');await settled(page);
   const prior=await page.locator('#orbit').getAttribute('data-target');
   const box=await page.locator('#orbit').boundingBox();
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-145,box.y+box.height/2,{steps:12});await page.mouse.up();await settled(page);
   assert.notEqual(await page.locator('#orbit').getAttribute('data-target'),prior);
   await page.locator('#mesh-background').focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('#mesh-background').dataset.animating==='true');
   await page.waitForFunction(()=>document.querySelector('#mesh-background').dataset.animating==='false');
   assert.equal(posts.length,0,'Launching page does not submit notification requests');
   await page.locator('[data-menu-toggle]').click();await page.locator('[data-menu-panel][data-open]').waitFor();await page.keyboard.press('Escape');
   assert.deepEqual(errors,[]);
   report.push({width,height,memberCTA:true,noOverflow:true,fonts:styles,carouselOpening:true,loopDragKeyboard:true,mesh:true,errors});
  }finally{await context.close()}
 }
 const guest=await browser.newContext({viewport:{width:390,height:844}});await guest.addCookies([{name:'sofacet_pinball_player',value:other,url:origin}]);
 try{
  const page=await guest.newPage();
  await page.goto(origin+'/notify');
  const join=page.getByRole('link',{name:'JOIN THE SO/ COLLECTIVE',exact:true});
  await join.waitFor();
  await page.locator('.notify-join p').getByText('For exclusive early access, updates and more,',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'ABOUT SO/ FACET',exact:true}).isVisible(),false);
  await join.click();await page.waitForURL('**/join');report.push({guestJoin:true});
 }finally{await guest.close()}
 assert.equal((await readStore()).firstCuts,undefined);
}, {returningMember:true});}finally{await browser.close()}
if(output)await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
