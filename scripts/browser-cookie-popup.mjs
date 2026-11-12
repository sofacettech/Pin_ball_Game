import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withRewardsSite} from '../tests/helpers/rewards-fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
const output=process.env.SOFACET_SCREENSHOT_DIR,report=[];
if(output)await mkdir(output,{recursive:true});
async function capture(page,name){await page.evaluate(()=>document.fonts.ready);if(output)await page.screenshot({path:resolve(output,name+'.png')})}
async function fits(page,selector){return page.locator(selector).evaluate(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,noOverflow:b.x>=0&&b.right<=innerWidth+1&&b.y>=0&&b.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}})}
try{await withRewardsSite(async({origin})=>{
 for(const [width,height] of [[1440,900],[375,812],[320,568]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce'}),page=await context.newPage();
  try{
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/#experience');
   await page.waitForFunction(()=>!document.body.hasAttribute('data-loading'),null,{timeout:120000});
   await page.locator('#sf-cookie-notice').waitFor({state:'visible'});
   assert.equal(await page.locator('#sf-cookie-root').count(),1);
   assert.equal(await page.locator('#sf-cookie-notice h2').textContent(),'YOUR COOKIE CHOICES.');
   const notice=await fits(page,'#sf-cookie-notice');assert.equal(notice.noOverflow,true);
   if(width>650)assert.equal(notice.width,480);
   assert.match(await page.locator('#sf-cookie-notice h2').evaluate(e=>getComputedStyle(e).fontFamily),/SFCookieDisplay/);
   assert.match(await page.locator('#sf-cookie-notice button').first().evaluate(e=>getComputedStyle(e).fontFamily),/SFCookieButton/);
   await capture(page,width+'-landing-notice');
   await page.locator('#sf-cookie-notice [data-manage]').click();
   await page.locator('#sf-cookie-settings').waitFor({state:'visible'});
   assert.equal(await page.locator('html').getAttribute('data-cookie-settings-open'),'true');
   const preferences=await fits(page,'#sf-cookie-settings');assert.equal(preferences.noOverflow,true);
   await capture(page,width+'-landing-preferences');
   await page.getByRole('switch',{name:'Analytics',exact:true}).check();
   await page.getByRole('button',{name:'Save preferences',exact:true}).click();
   await page.locator('#sf-cookie-settings').waitFor({state:'hidden'});
   assert.equal(await page.locator('#sf-cookie-notice').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.sofacetCookiePreferences.allows('analytics')),true);
   await page.waitForFunction(()=>document.documentElement.dataset.cookieSettingsOpen==='false');
   await page.reload();await page.waitForFunction(()=>!!window.sofacetCookiePreferences);
   assert.equal(await page.locator('#sf-cookie-notice').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.sofacetCookiePreferences.allows('analytics')),true);
   await page.goto(origin+'/about.html');await page.locator('#intro-title').waitFor();
   await page.evaluate(()=>localStorage.removeItem('sofacet-cookie-preferences'));
   await page.reload();await page.locator('#intro-title').waitFor();
   assert.equal(await page.locator('#sf-cookie-notice').isVisible(),false,'Automatic notice is landing-only');
   await page.locator('[data-menu-toggle]').click();await page.locator('[data-cookie-settings]').click();
   await page.locator('#sf-cookie-settings').waitFor({state:'visible'});
   await page.keyboard.press('Escape');await page.locator('#sf-cookie-settings').waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.documentElement.dataset.cookieSettingsOpen==='false');
   // First-visit accept/reject buttons preserve the existing consent API and storage.
   for(const [action,allow] of [['accept',true],['reject',false]]){
    await page.goto(origin+'/#experience');await page.reload();
    await page.waitForFunction(()=>!document.body.hasAttribute('data-loading'),null,{timeout:120000});
    await page.locator('#sf-cookie-notice [data-'+action+']').click();
    await page.locator('#sf-cookie-notice').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.sofacetCookiePreferences.allows('analytics')),allow);
    assert.equal(await page.evaluate(()=>window.sofacetCookiePreferences.allows('advertising')),allow);
    await page.evaluate(()=>localStorage.removeItem('sofacet-cookie-preferences'));
   }
   assert.deepEqual(errors,[]);
   report.push({width,height,notice,preferences,reactUI:true,landingOnly:true,menuSettings:true,savedChoiceRetained:true,acceptRejectSave:true,errors});
  }finally{await context.close()}
 }
});}finally{await browser.close()}
if(output)await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
