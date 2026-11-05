import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import {withRewardsSite,gameId} from '../tests/helpers/rewards-fixture.mjs';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:browserType}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await browserType.launch(engine==='chromium'?{channel:'chrome',args:['--enable-unsafe-swiftshader']}:{});
const output=process.env.SOFACET_SCREENSHOT_DIR;
if(output)await mkdir(output,{recursive:true});
const results=[];
const sizes=[[320,568],[375,667],[390,844],[430,932],[768,1024],[820,1180],[844,390],[1440,900]];
const mobile=width=>width<=900;
async function shot(page,name){if(output)await page.screenshot({path:resolve(output,engine+'-'+name+'.png'),fullPage:true});}
async function minimumText(page,selector,size){
 const values=await page.locator(selector).evaluateAll(nodes=>nodes.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>({text:(e.textContent||e.id).trim().slice(0,80),size:parseFloat(getComputedStyle(e).fontSize)})));
 assert.ok(values.length,'Visible text found: '+selector);
 assert.ok(values.every(value=>value.size>=size),selector+' meets '+size+'px minimum: '+JSON.stringify(values));
}
async function fits(page,selector){
 await page.locator(selector).evaluate(async e=>{await Promise.all(e.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});
 const metrics=await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth};});
 assert.ok(metrics.left>=-1&&metrics.right<=metrics.width+1,selector+' fits '+JSON.stringify(metrics));
 assert.ok(metrics.scroll<=metrics.width+1,'No horizontal document overflow');
}
async function createClaim(page,origin){
 await page.goto(origin+'/account.html');await page.locator('.design-account[data-scene-ready="true"]').waitFor();
 if(mobile(page.viewportSize().width))await minimumText(page,'.design-account .small-button',11);
 await page.getByRole('tab',{name:'CREATE YOUR ACCOUNT'}).click();
 if(mobile(page.viewportSize().width)){
  await minimumText(page,'#create-form .checkbox-row',13);
  await minimumText(page,'.design-account .tab',11);
 }
 await page.locator('input[name="title"][value="Ms"]').check();await page.locator('#new-name').fill('Test Member');
 await page.locator('#day').selectOption('1');await page.locator('#month').selectOption('1');await page.locator('#year').selectOption('1990');
 await page.locator('#new-city').fill('Delhi');await page.locator('#new-phone').fill('9876543210');await page.locator('#new-email').fill('test@example.invalid');await page.locator('[name="terms"]').check();
 await page.getByRole('button',{name:'CREATE ACCOUNT',exact:true}).click();
 await page.locator('.design-claim .art-layer.art-ready').waitFor();
}
try{await withRewardsSite(async({origin})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'no-preference',deviceScaleFactor:engine==='webkit'?3:1,...(engine==='webkit'||process.env.SOFACET_SAFARI_FALLBACK?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
 await page.route('**/api/membership/otp/request',route=>route.fulfill({json:{success:true,challengeId:'mobile-layout-check',expiresIn:300,resendAfter:60,deliveryChannel:'whatsapp'}}));
 try{
  for(const [width,height]of process.env.SOFACET_REWARD_ONLY?[]:sizes){
   await page.setViewportSize({width,height});await createClaim(page,origin);
   if(mobile(width)){
    await page.waitForFunction(()=>!!document.querySelector('.design-claim').dataset.claimArtShownAt);
    const opening=await page.locator('.design-claim').evaluate(root=>({artOpacity:+getComputedStyle(root.querySelector('.art-layer')).opacity,textOpacity:+getComputedStyle(root.querySelector('.content')).opacity,inert:root.querySelector('.content').inert}));
    assert.equal(opening.artOpacity,1);assert.equal(opening.textOpacity,0);assert.equal(opening.inert,true);
    if(width===390)await shot(page,'390-claim-opening');
    await page.waitForFunction(()=>!!document.querySelector('.design-claim').dataset.claimTextRevealedAt);
    const held=await page.locator('.design-claim').evaluate(r=>+r.dataset.claimTextRevealedAt-+r.dataset.claimArtShownAt);
    assert.ok(held>=1250&&held<1800,'Artwork is held for 1.3s: '+held);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.design-claim .content')).opacity==='1');
    const settled=await page.locator('.design-claim').evaluate(root=>{const art=root.querySelector('.art-layer'),r=art.getBoundingClientRect();return {artOpacity:+getComputedStyle(art).opacity,inert:root.querySelector('.content').inert,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight};});
    assert.equal(settled.artOpacity,width>700?.22:.18);assert.equal(settled.inert,false);
    assert.ok(settled.left>=0&&settled.right<=width+1&&settled.top>=0&&settled.bottom<=height+1,'Entire Claim logo stays in the viewport');
    assert.ok(+(await page.locator('[name="mobile"]').evaluate(e=>getComputedStyle(e).fontSize.replace('px','')))>=16,'No iOS form auto-zoom');
    results.push({page:'claim',width,height,held,logo: settled});
   }else{
    const desktop=await page.locator('.design-claim .art-layer').evaluate(e=>{const s=getComputedStyle(e);return {position:s.position,right:s.right,bottom:s.bottom,opacity:s.opacity};});
    assert.deepEqual(desktop,{position:'absolute',right:'0px',bottom:'0px',opacity:'1'});results.push({page:'claim',width,height,desktopUnchanged:true});
   }
   await fits(page,'.design-claim .content');
   assert.ok(!(await page.locator('.design-claim .signin').innerText()).includes('/'),'Claim question has no decorative slash');
   assert.equal(await page.locator('.claim-form button[type="submit"]').innerText(),'SAVE MY COINS');
   if(mobile(width)){await minimumText(page,'.design-claim .help',14);await minimumText(page,'.design-claim .signin',13);}
   if(width===1440)await page.locator('.design-claim .art-layer.art-landed').waitFor();
   if([390,844,1440].includes(width))await shot(page,width+'-claim-final');
   await page.locator('#final-otp').fill('012345');assert.equal(await page.locator('#final-otp').inputValue(),'012345');
   await page.goto(origin+'/account.html');await page.locator('.design-account[data-scene-ready="true"]').waitFor();await fits(page,'#registered-panel');
   if(mobile(width))assert.ok(parseFloat(await page.locator('#login-phone').evaluate(e=>getComputedStyle(e).fontSize))>=16);
   await page.getByRole('tab',{name:'CREATE YOUR ACCOUNT'}).click();await fits(page,'#create-panel');
   results.push({page:'account',width,height,registeredAndCreateFit:true});
   await page.goto(origin+'/launching-soon.html');await page.locator('.design-launch[data-scene-ready="true"]').waitFor();await fits(page,'.action-group');
   assert.match(await page.locator('.design-launch .description').innerText(),/Join “THE FIRST CUT”/);
   assert.equal(await page.getByRole('button',{name:'JOIN THE FIRST CUT',exact:true}).count(),1);
   await page.getByRole('button',{name:'JOIN THE FIRST CUT',exact:true}).click();await fits(page,'#join');
   await page.locator('#email').fill('mobile@example.invalid');await page.getByRole('button',{name:'Close signup'}).click();
   assert.match(await page.frameLocator('.mesh-layer').locator('.mouse-hint').textContent(),/ENTER OR SPACE/);
   results.push({page:'launch',width,height,dialogFits:true});
   console.log(engine+': Claim opening/position, Account tabs and Launch fit '+width+'×'+height);
  }
  await page.goto(origin+'/faq.html');await page.locator('h1').waitFor();assert.equal(await page.locator('h1').innerText(),'HOW POINTS WORK');
  if(engine==='webkit'){
   // Test the actual Reward React component in its existing shipped shell.
   // The Windows WebKit game-loader stall is outside this mobile UI change.
   const html=(await readFile(new URL('../play.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+origin+'/">').replace('media="print"','media="all"');
   const bundle=await build({stdin:{contents:`import {mountScorePage} from './game-source/src/score-page.jsx';mountScorePage(document.getElementById('score-page-root'),{onSave(){},onReplay(){},onLeaderboard(){}}).render({points:3205,rewardValue:320.5,completedAt:Date.now(),gameId:'${gameId}',status:'completed'});const dialog=document.getElementById('post-game-rewards');dialog.dataset.view='result';dialog.prepend(document.querySelector('body > header'));dialog.showModal();document.getElementById('rewards-heading').focus();`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,platform:'browser',format:'iife',loader:{'.css':'empty'},write:false});
   await page.goto(origin+'/health');await page.setContent(html);await page.evaluate(()=>{document.body.removeAttribute('data-game-loading');document.getElementById('game-loading-screen')?.remove();});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
  }else{
   await page.route('**/assets/sofacet-game-*.js',async route=>{const response=await route.fetch();let source=await response.text(),i=source.indexOf('post-game-rewards');if(i>=0){const name=[...source.slice(0,i).matchAll(/function ([\w$]+)\(/g)].at(-1)[1],binding=source.match(new RegExp('([\\w$]+)='+name+'\\('))[1];source+=';window.__testRewards='+binding+';';}await route.fulfill({response,body:source});});
   await page.goto(origin+'/play.html');await page.waitForFunction(()=>window.__testRewards&&!document.body.hasAttribute('data-game-loading'),{},{timeout:90000});
   await page.evaluate(id=>window.__testRewards.show(3205,id),gameId);
  }
  await page.locator('.design-rewards[data-scene-ready="true"]').waitFor();
  for(const [width,height]of sizes){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await fits(page,'.design-rewards .reward');
   assert.equal(await page.locator('#rewards-register').innerText(),'SAVE MY COINS');
   assert.ok(!(await page.locator('#rewards-expiry').innerText()).includes('/'),'Reward supporting copy has no decorative slash');
   if(mobile(width)){await minimumText(page,'.design-rewards .conversion',14);await minimumText(page,'.design-rewards .notice',13);}
   if(engine==='webkit'){
    const art=await page.locator('.design-rewards .art-layer').evaluate(e=>({quality:e.dataset.petalQuality,visible:[...e.querySelectorAll('.flower-image')].filter(i=>i.getBoundingClientRect().width>0&&getComputedStyle(i).visibility==='visible').length}));
    assert.equal(art.quality,'css-motion');assert.equal(art.visible,3,'Safari keeps every flower visible after resize');
   }
   const top=parseFloat(await page.locator('.design-rewards .art-canvas').evaluate(e=>getComputedStyle(e).top));
   if(width<=700)assert.ok(top<=-24&&top>=-40,'Reward artwork raised slightly');else assert.ok(Number.isNaN(top)||top===0,'Desktop artwork position unchanged');
   if([390,844,1440].includes(width))await shot(page,width+'-reward');
   results.push({page:'reward',width,height,artOffset:top});
  }
  assert.deepEqual(errors,[]);console.log(engine+': all Reward sizes fit, desktop position unchanged, no browser errors');
 }finally{await context.close();}
});if(output)await writeFile(resolve(output,engine+(process.env.SOFACET_REWARD_ONLY?'-reward':'')+'-checks.json'),JSON.stringify({engine,results},null,2));}finally{await browser.close();}
