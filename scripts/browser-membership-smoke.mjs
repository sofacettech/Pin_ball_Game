import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite,member,gameId} from '../tests/helpers/rewards-fixture.mjs';

// Built React pages, real local proxy, deterministic upstream. No real OTP messages.
const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const {[engine]:browserType}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await browserType.launch({...(process.env.SOFACET_BROWSER_CHANNEL?{channel:process.env.SOFACET_BROWSER_CHANNEL}:{}),args:engine==='chromium'?['--enable-unsafe-swiftshader']:[]});
const output=process.env.SOFACET_SCREENSHOT_DIR;
if(output)await mkdir(output,{recursive:true});
async function capture(page,name){if(output){
  for(const frame of page.frames())await frame.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(img=>!img.closest('#game-loading-screen[hidden]')).map(img=>img.decode().catch(()=>{})));});
  const claim=page.frameLocator(name.includes('direct-claim')?'#registration-frame':'#membership');
  if(name.startsWith('04-'))await claim.locator('.art-layer.art-ready').waitFor();
  if(name.includes('mobile')&&name.startsWith('04-'))assert.ok((await claim.locator('.claim-invitation').boundingBox()).y>110,'Claim heading clears the header and Back');
  if(name.includes('mobile')&&/^(02|03)-/.test(name))assert.ok((await page.locator('.welcome-heading').boundingBox()).y>90,'Account heading clears the navigation');
  await page.screenshot({path:resolve(output,name+'.png'),fullPage:true});
}}
async function fillCreate(frame){
  await frame.locator('#new-name').fill('Test Member');
  await frame.locator('#new-phone').fill('9876543210');await frame.locator('#new-email').fill('test@example.invalid');await frame.locator('input[name="terms"]').check();await frame.locator('input[name="updates"]').check();
}
async function embed(page,origin,returningMember){
  await page.goto(origin+'/health');
  await page.setContent(`<style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe id="membership" src="/membership.html?nav=game${returningMember?'&verify=1':''}"></iframe><script>
  addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='sofacet:membership-ready')e.source.postMessage({type:'sofacet:pending-reward',result:{points:3205,rewardValue:320.5,completedAt:Date.now(),gameId:'${gameId}',status:'completed'}},location.origin)});
  </script>`);
  const frame=page.frameLocator('#membership');await frame.locator('.design-account[data-scene-ready="true"]').waitFor();return frame;
}
try{
  for(const returningMember of [false,true])await withRewardsSite(async({origin,request,events,awards,state})=>{
    const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    try{
      await context.addCookies([{name:'sofacet_pinball_player',value:member,url:origin,httpOnly:true,sameSite:'Lax'}]);
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const frame=await embed(page,origin,returningMember);
      if(returningMember){
        await frame.locator('#login-phone').fill('9876543210');await capture(page,'03-account-registered-desktop');
        assert.equal((await request('/api/membership/rewards',{gameId})).data.code,'rewards_verification_required');
        await frame.locator('#generate').click();await frame.locator('#login-feedback').filter({hasText:'WhatsApp'}).waitFor();
        await frame.locator('#login-otp').fill('000000');await frame.getByRole('button',{name:'SIGN IN',exact:true}).click();await frame.locator('#login-feedback').filter({hasText:'That code doesn’t match'}).waitFor();
        await frame.locator('#login-otp').fill('012345');await frame.getByRole('button',{name:'SIGN IN',exact:true}).click();
      }else{
        await capture(page,'02-account-create-desktop');await frame.getByRole('tab',{name:'SIGN IN'}).click();
        assert.equal(await frame.locator('body').evaluate(()=>window.sofacetPendingReward.gameId),gameId);await frame.getByRole('tab',{name:'JOIN THE SO/ COLLECTIVE'}).click();
        await fillCreate(frame);await frame.getByRole('button',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).click();await frame.locator('.design-claim[data-scene-ready="true"]').waitFor();
        await frame.locator('.claim-invitation').filter({hasText:'JOIN THE SO/ COLLECTIVE'}).waitFor();assert.match(await frame.locator('.claim-score').innerText(),/3,205 pts · ₹320\.5 off SO\/ FACET diamond jewellery/);assert.equal(await frame.locator('.design-claim .brand').innerText(),'GAME COMPLETE');assert.match(await frame.locator('[name=\"dialCode\"] option').first().innerText(),/India \(\+91\)/);assert.equal(await frame.locator('[name="mobile"]').inputValue(),'9876543210');
        await capture(page,'04-claim-desktop');await page.setViewportSize({width:390,height:844});await capture(page,'04-claim-mobile');await page.setViewportSize({width:1440,height:900});
        await frame.getByRole('button',{name:'← Back',exact:true}).click();assert.equal(await frame.locator('#new-name').inputValue(),'Test Member');assert.ok(await frame.locator('[name="terms"]').isChecked());
        assert.equal(await frame.locator('body').evaluate(()=>window.sofacetPendingReward.gameId),gameId);
        await frame.getByRole('button',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).click();await frame.locator('#final-otp').waitFor();
        await frame.locator('#final-otp').fill('000000');await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();await frame.locator('#feedback').filter({hasText:'That code doesn’t match'}).waitFor();assert.equal(awards.size,0);
        state.profileWriteError={status:503,code:'service_unavailable'};await frame.locator('#final-otp').fill('012345');await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
        await frame.locator('#feedback').filter({hasText:/try again|unavailable/i}).waitFor();assert.equal(awards.size,0);state.profileWriteError=null;
        await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
      }
      await frame.getByRole('heading',{name:'It’s yours.'}).waitFor();await frame.getByText('You joined THE SO/ COLLECTIVE.',{exact:true}).waitFor();await capture(page,'07-points-saved');assert.match(await frame.locator('.auth-flow-notice').innerText(),/3,200 points/);
      await frame.locator('body').evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedScore=text}}});});
      await frame.getByRole('button',{name:'Share my score',exact:true}).click();await frame.getByRole('heading',{name:'Share your score'}).waitFor();await frame.getByRole('button',{name:'Copy score & link',exact:true}).click();await frame.getByRole('status').filter({hasText:'Your score and link are copied.'}).waitFor();
      assert.match(await frame.locator('body').evaluate(()=>window.__copiedScore),/I scored 3,205 SO\/ COINS in SO\/ FACET Pinball/);
      assert.equal(awards.size,1);assert.deepEqual([...awards.values()],[320]);assert.equal(events.filter(e=>e.path==='/rewards/auth').length,1);assert.equal(events.filter(e=>e.path==='/rewards/auth/verify').length,2);
      const storage=await frame.locator('body').evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));for(const v of ['fixture-signature','fixture-partner-key','test@example.invalid','9876543210'])assert.ok(!storage.includes(v));
      await page.goto(origin+'/account.html');await page.locator('#account-screen').waitFor();await page.getByRole('textbox',{name:'Name',exact:true}).fill('Updated Member');await page.getByRole('textbox',{name:'Leaderboard name',exact:true}).fill('Updated M.');await page.getByRole('textbox',{name:'Email',exact:true}).fill('updated@example.invalid');
      await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Your details are updated.'}).waitFor();await page.reload();await page.locator('#account-screen').waitFor();
      assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).inputValue(),'Updated Member');assert.equal((await request('/api/account')).data.savedPoints,3200);assert.equal(awards.size,1);assert.deepEqual(errors,[]);
      console.log(engine+': '+(returningMember?'returning sign-in':'create → Claim, wrong OTP, retry, pending reward')+' and profile persistence passed');
    }finally{await context.close();}
  },{returningMember});
  await withRewardsSite(async({origin})=>{
    const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),sent=[],verified=[];
    try{
      await page.clock.install();
      await page.route('**/api/membership/otp/request',async route=>{sent.push(route.request().postDataJSON());await route.fulfill({json:{success:true,challengeId:'client-check-'+sent.length,expiresIn:300,resendAfter:60,deliveryChannel:'whatsapp'}});});
      await page.route('**/api/membership/otp/verify',async route=>{verified.push(route.request().postDataJSON());await route.fulfill({status:400,json:{code:'invalid_otp',message:'Enter the new code for this number.'}});});
      const frame=await embed(page,origin,false);await fillCreate(frame);await frame.getByRole('button',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).click();await frame.locator('#final-otp').waitFor();
      await frame.locator('#final-otp').fill('012345');await frame.locator('[name="mobile"]').fill('9876543211');assert.ok(await frame.getByRole('button',{name:'SEND NEW CODE',exact:true}).isDisabled());
      await page.clock.fastForward(61000);await frame.getByRole('button',{name:'SEND NEW CODE',exact:true}).click();
      await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).waitFor();assert.equal(await frame.locator('#final-otp').inputValue(),'');assert.equal(sent[1].phoneNumber,'+919876543211');assert.equal(sent[1].name,'Test Member');assert.equal(sent[1].dateOfBirth,undefined);assert.equal(sent[1].city,undefined);
      assert.equal(verified.length,0);await frame.locator('#final-otp').fill('123456');await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();await frame.locator('#feedback').filter({hasText:'Enter the new code'}).waitFor();
      assert.equal(verified[0].phoneNumber,'+919876543211');assert.equal(verified[0].challengeId,'client-check-2');assert.equal(await frame.locator('body').evaluate(()=>window.sofacetPendingReward.gameId),gameId);
      console.log(engine+': changed phone observes cooldown, requests a fresh OTP, clears old code and preserves game ID');
    }finally{await context.close();}
  });
  await withRewardsSite(async({origin})=>{
    const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    try{
      await page.goto(origin+'/account.html');await page.locator('.design-account[data-scene-ready="true"]').waitFor();await page.setViewportSize({width:390,height:844});await capture(page,'03-account-registered-mobile');await page.getByRole('tab',{name:'JOIN THE SO/ COLLECTIVE'}).click();await capture(page,'02-account-create-mobile');
      for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile']]){
        await page.setViewportSize({width,height});await page.goto(origin+'/launching-soon.html');await page.locator('.design-launch[data-scene-ready="true"]').waitFor();await capture(page,'05-launch-'+label);
        await page.goto(origin+'/launching-soon.html#join');await page.locator('#join[open]').waitFor();await capture(page,'06-join-dialog-'+label);await page.locator('#join-name').fill('Launch Member');await page.locator('#join-phone').fill('9876543210');await page.locator('#email').fill('launch@example.invalid');await page.locator('#join-privacy').check();await page.locator('#join-updates').check();await page.locator('#join-form button[type=submit]').click();await page.waitForURL('**/first-cuts-confirmation.html');await page.getByRole('link',{name:'My SO/ COINS',exact:true}).waitFor();await page.goto(origin+'/launching-soon.html');await page.goto(origin+'/launching-soon.html#join');await page.locator('#join[open]').waitFor();await page.getByRole('button',{name:'Close signup',exact:true}).click();
        await page.getByRole('button',{name:'JOIN THE SO/ COLLECTIVE',exact:true}).waitFor();
      }
      await page.getByRole('button',{name:'Rather play first? Play Pinball',exact:true}).click();await page.waitForURL('**/play.html');console.log(engine+': launch → Join → saved signup, confirmation and Play Pinball passed');
    }finally{await context.close();}
  });
  await withRewardsSite(async({origin})=>{
    const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    try{
      page.on('pageerror',e=>errors.push(e.message));
      // Expose the existing controller only in the intercepted test response.
      // No debug globals or invented game results are shipped in the application.
      await page.route('**/assets/sofacet-game-*.js',async route=>{
        const response=await route.fetch();let source=await response.text();
        const index=source.indexOf('post-game-rewards');
        if(index>=0){const declaration=[...source.slice(0,index).matchAll(/function ([\w$]+)\(/g)].at(-1)[1];
          const binding=source.match(new RegExp('([\\w$]+)='+declaration+'\\('))[1];
          source+=';window.__testRewards='+binding+';';}
        await route.fulfill({response,body:source});
      });
      await page.goto(origin+'/play.html');await page.waitForFunction(()=>!!window.__testRewards);
      for(const name of ['Diamond','Pinball','Jewellery']){
        const card=page.getByRole('button',{name:name+' card. Front view',exact:true});
        await card.press('ArrowRight');
      }
      await page.waitForFunction(()=>!document.body.hasAttribute('data-game-loading'),{},{timeout:60000});
      await page.evaluate(id=>window.__testRewards.show(3205,id),gameId);await page.locator('.design-rewards[data-scene-ready="true"]').waitFor();
      assert.equal(await page.locator('#rewards-points').innerText(),'3,205');assert.match(await page.locator('#rewards-value').innerText(),/320\.5/);
      await capture(page,'01-reward-desktop');await page.setViewportSize({width:390,height:844});await capture(page,'01-reward-mobile');await page.setViewportSize({width:1440,height:900});
      await page.locator('#post-game-rewards .site-brand').click();await page.locator('#rewards-keep').waitFor({state:'visible'});await page.keyboard.press('Escape');
      const frame=page.frameLocator('#registration-frame');
      async function openClaim(){await page.locator('#rewards-register').click();await frame.locator('.design-claim[data-scene-ready="true"]').waitFor();await frame.locator('[name="fullName"]').waitFor();assert.equal(await frame.locator('[name="fullName"]').isEditable(),true);assert.equal(await frame.locator('#final-otp').isDisabled(),true);assert.equal(await frame.locator('body').evaluate(()=>window.sofacetPendingReward.gameId),gameId);}
      async function scoreRestored(){await page.waitForFunction(()=>!document.querySelector('#registration-dialog').open);await page.locator('#rewards-register').waitFor();assert.equal(await page.locator('#rewards-points').innerText(),'3,205');}
      await openClaim();await capture(page,'04-direct-claim-desktop');await page.setViewportSize({width:375,height:844});await capture(page,'04-direct-claim-mobile');await page.setViewportSize({width:1440,height:900});
      await frame.getByRole('button',{name:'← Back',exact:true}).click();await scoreRestored();
      await openClaim();await frame.locator('[name="fullName"]').press('Escape');await scoreRestored();
      await openClaim();await page.goBack();await scoreRestored();
      await openClaim();await frame.getByRole('button',{name:'Sign in',exact:true}).click();await frame.locator('#login-phone').waitFor();assert.equal(await frame.locator('body').evaluate(()=>window.sofacetPendingReward.points),3205);await frame.getByRole('tab',{name:'JOIN THE SO/ COLLECTIVE'}).click();await frame.locator('[name="fullName"]').waitFor();
      await frame.getByRole('button',{name:'Close account form'}).click();await frame.getByRole('heading',{name:/Leaving/i}).waitFor();await frame.getByRole('button',{name:'Save my SO/ COINS',exact:true}).click();await frame.locator('[name="fullName"]').waitFor();
      assert.equal(await frame.locator('.claim-invitation').innerText(),'JOIN THE SO/ COLLECTIVE');assert.match(await frame.locator('.claim-score').innerText(),/3,205 pts/);
      await context.addCookies([{name:'sofacet_pinball_player',value:member,url:origin,httpOnly:true,sameSite:'Lax'}]);
      await frame.locator('[name="fullName"]').fill('Test Member');await frame.locator('[name="mobile"]').fill('9876543210');
      await frame.getByRole('button',{name:'Send OTP',exact:true}).click();
      await frame.locator('#final-otp:not([disabled])').waitFor();
      assert.equal(await frame.getByRole('dialog',{name:'Confirm your details'}).count(),0);
      assert.equal(await frame.getByRole('textbox',{name:'Email address'}).count(),0);
      await frame.locator('#final-otp').fill('012345');
      await frame.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
      const details=frame.getByRole('region',{name:'Confirm your details'});
      await details.getByRole('textbox',{name:'Email address'}).fill('test@example.invalid');
      await details.locator('[name="terms"]').check();
      await details.getByRole('button',{name:'SAVE MY SO/ COINS',exact:true}).click();
      await frame.getByRole('heading',{name:'It’s yours.'}).waitFor();assert.ok(await page.locator('#registration-dialog').evaluate(e=>e.open));assert.equal(await page.locator('#leaderboard-dialog').isVisible(),false);
      await frame.getByRole('button',{name:'Share my score',exact:true}).click();await frame.getByRole('heading',{name:'Share your score'}).waitFor();assert.match(await frame.getByRole('link',{name:'Share via WhatsApp'}).getAttribute('href'),/I%20scored%203%2C205%20SO%2F%20COINS/);
      await capture(page,'07-points-saved-game-desktop');await page.setViewportSize({width:375,height:844});await capture(page,'07-points-saved-game-mobile');
      await frame.getByRole('button',{name:'Play again',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#registration-dialog').open&&(!document.querySelector('#gameplay-controls').hidden||document.querySelector('#controls-tutorial')?.open));
      assert.deepEqual(errors,[]);console.log(engine+': game result → save → persistent success, Share my score and replay passed');
    }finally{await context.close();}
  });
}finally{await browser.close();}
