import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

// Controlled frame delays verify the policy; they do not measure device FPS.
const require=createRequire(import.meta.url);
const {chromium,webkit,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit';
const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{});
try{
 const context=await browser.newContext({...devices['iPhone 13'],reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  localStorage.setItem('sofacet.controls-practised.v1','done');
  const request=requestAnimationFrame.bind(window);
  window.gameTestFrameDelay=0;
  window.requestAnimationFrame=callback=>request(now=>{
   if(window.gameTestFrameDelay)setTimeout(()=>callback(performance.now()),window.gameTestFrameDelay);
   else callback(now);
  });
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(new URL('/play.html',process.env.SOFACET_GAME_URL||'http://127.0.0.1:8879').href);
 await page.waitForSelector('#stage[data-ready="true"]',{timeout:60000});
 assert.equal(await page.locator('#quality').inputValue(),'full');
 await page.locator('#start').click();
 await page.waitForFunction(()=>!document.querySelector('#touch-launch').disabled);
 await page.evaluate(()=>window.gameTestFrameDelay=45);
 await page.waitForTimeout(4500);
 assert.equal(await page.locator('#quality').inputValue(),'full','slow launcher idle must not change quality');
 const launch=await page.locator('#touch-launch').boundingBox();
 await page.mouse.move(launch.x+launch.width/2,launch.y+launch.height/2);
 await page.mouse.down();await page.waitForTimeout(2000);await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#scorecard-panel').dataset.scoreVisible==='true');
 try{await page.waitForFunction(()=>document.querySelector('#quality').value==='auto',null,{timeout:15000})}
 catch(error){console.error(await page.evaluate(()=>({quality:document.querySelector('#quality').value,message:document.querySelector('#message').textContent,stage:document.querySelector('#stage').className,pause:document.querySelector('#pause').getAttribute('aria-label'),scoreVisible:document.querySelector('#scorecard-panel').dataset.scoreVisible})));throw error}
 assert.equal(await page.evaluate(()=>localStorage.getItem('sofacet.game-quality.v1')),null,'automatic fallback must not save Auto as a preference');
 await page.locator('#settings').click();await page.locator('#quality').selectOption('full');
 await page.waitForTimeout(4500);
 assert.equal(await page.locator('#quality').inputValue(),'full','paused settings must not count as slow gameplay');
 await page.locator('#menu-close').click();await page.locator('#pause').click();
 assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Resume game');
 await page.waitForTimeout(4500);
 assert.equal(await page.locator('#quality').inputValue(),'full','paused gameplay must keep the selected quality');
 await page.evaluate(()=>window.gameTestFrameDelay=0);
 await page.reload();await page.waitForSelector('#stage[data-ready="true"]',{timeout:60000});
 assert.equal(await page.locator('#quality').inputValue(),'full','a new visit restores Full rather than the temporary fallback');
 assert.deepEqual(errors,[]);
 console.log(`${engine}: Full default, slow-play Auto fallback, idle/pause exclusions and preference retention passed.`);
}finally{await browser.close()}
