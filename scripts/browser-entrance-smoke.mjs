import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {summarizeFrameUpdates} from '../entrance-source/frame-rate-meter.js';

// Run against an already-built release server. A desktop WebKit/Chromium run
// with iPhone inputs validates behavior; its FPS is not an iPhone measurement.
const require = createRequire(import.meta.url);
const engine = process.env.SOFACET_BROWSER || 'webkit';
assert.ok(['webkit', 'chromium'].includes(engine), 'SOFACET_BROWSER must be webkit or chromium');
const {[engine]: browserType, devices} = require(process.env.SOFACET_PLAYWRIGHT_PATH || 'playwright');
const url = new URL(process.env.SOFACET_ENTRANCE_URL || 'http://127.0.0.1:8766/');
assert.equal(url.searchParams.has('quality'), false, 'Omit quality overrides to test automatic iPhone selection');
url.hash = '#experience';
const minimumFPS = process.env.SOFACET_MIN_FPS ? Number(process.env.SOFACET_MIN_FPS) : null;
assert.ok(minimumFPS === null || (Number.isFinite(minimumFPS) && minimumFPS > 0), 'SOFACET_MIN_FPS must be positive');
const output = fileURLToPath(new URL('../work/entrance-performance/', import.meta.url));
await mkdir(output, {recursive: true});
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = {engine, url: url.href, timestamp: new Date().toISOString(), minimumFPS,
  limitation: 'Desktop browser with iPhone emulation; real iPhone FPS still requires device testing.', cases: []};
const cases = process.env.SOFACET_ENTRANCE_NO_MULTI_DRAW === '1' ? [false, true] : [false];
let browser;

async function readState(page) {
  return page.evaluate(() => {
    const preview = window.entrancePreview, renderer = preview?.renderer;
    return {ready: preview?.ready, phase: preview?.phase, frame: preview?.frame,
      quality: preview?.quality, batching: preview?.batching, gameVisible: preview?.gameVisible,
      scrollY, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent,
      pixels: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
      canvasBounds: renderer ? [renderer.domElement.getBoundingClientRect().width, renderer.domElement.getBoundingClientRect().height] : null,
      draws: renderer?.info.render.calls, triangles: renderer?.info.render.triangles,
      multiDraw: renderer ? !!renderer.getContext().getExtension('WEBGL_multi_draw') : null,
      status: document.querySelector('#world-status')?.textContent};
  });
}

try {
  for (const disableMultiDraw of cases) {
    const name = disableMultiDraw ? 'without-multi-draw' : 'iphone-default';
    const result = {name, pageErrors: [], shaderErrors: [], consoleErrors: [], failedRequests: [], frames: [], screenshots: []};
    report.cases.push(result);
    browser = await browserType.launch({
      // The macOS runner has a Metal device. Headless Chromium otherwise forces
      // software rendering and can stall while preparing this production scene.
      ...(engine === 'chromium' && process.platform === 'darwin' ? {args: ['--enable-gpu']} : {}),
      ...(process.env.SOFACET_BROWSER_EXECUTABLE ? {executablePath: process.env.SOFACET_BROWSER_EXECUTABLE} : {}),
    });
    const context = await browser.newContext({...devices['iPhone 13']});
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      result.consoleErrors.push(message.text());
      if (/THREE\.WebGLProgram|VALIDATE_STATUS|shader.*(?:error|failed)|(?:error|failed).*shader|GL_INVALID_/i.test(message.text())) result.shaderErrors.push(message.text());
    });
    page.on('requestfailed', request => result.failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
    if (disableMultiDraw) await page.addInitScript(() => {
      for (const type of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
        if (!type) continue;
        const getExtension = type.prototype.getExtension;
        type.prototype.getExtension = function (name) {
          return name === 'WEBGL_multi_draw' ? null : getExtension.call(this, name);
        };
      }
    });
    const screenshot = async label => {
      const path = join(output, `${stamp}-${engine}-${name}-${label}.png`);
      await page.screenshot({path});
      result.screenshots.push(path);
    };
    try {
      result.graphics = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return {available: false, reason: 'WebGL2 context creation failed'};
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const precision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
        return {available: !gl.isContextLost() && precision !== null,
          vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
          renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
          highFloatPrecision: precision?.precision ?? null, contextLost: gl.isContextLost()};
      });
      console.log(JSON.stringify({case: name, graphics: result.graphics}));
      assert.ok(result.graphics.available, 'The browser runner must provide a working WebGL2 context before loading the scene');
      const response = await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 120000});
      assert.equal(response?.status(), 200, 'The release entrance must load');
      result.modules = await page.locator('script[type="module"][src]').evaluateAll(elements => elements.map(element => element.src));
      assert.ok(result.modules.some(src => /\/assets\/entrance-3d\/entry-[\w-]+\.js(?:\?|$)/.test(src)), 'Exercise the built entrance bundle, not an experiment/source page');
      await page.waitForFunction(() => document.body.hasAttribute('data-error') || window.entrancePreview?.ready || window.entrancePreview?.phase === 'opening', {}, {timeout: 120000});
      assert.equal(await page.locator('body').getAttribute('data-error'), null, 'The release scene must load without its error fallback');
      try {
        await page.waitForFunction(() => window.entrancePreview?.ready, {}, {timeout: 8000});
      } catch {
        // The smoke tests the live 3D scroll, independently of CDN opening-video
        // availability or autoplay permission. Use its installed completion event.
        result.openingSkipped = await page.evaluate(() => {
          const opening = document.querySelector('#opening');
          if (!opening || window.entrancePreview?.phase !== 'opening') return false;
          opening.dispatchEvent(new Event('ended'));
          return true;
        });
      }
      // The opening now runs during the download and shader warm-up. Keep the
      // same scene-readiness budget even when the opening finishes first.
      await page.waitForFunction(() => window.entrancePreview?.ready, {}, {timeout: 120000});
      result.initial = await readState(page);
      assert.equal(result.initial.quality?.mobile, true, 'iPhone must select mobile quality without a URL override');
      assert.equal(result.initial.batching, 'portable', 'iPhone must use extension-independent batching');
      if (disableMultiDraw) assert.equal(result.initial.multiDraw, false);
      assert.ok(result.initial.draws > 0 && result.initial.triangles > 0, 'The loaded scene must actually render');
      await screenshot('ready');
      for (const frame of [680, 1000, 1550, 2050, 940, 400]) {
        await page.evaluate(frame => window.scrollTo(0, (frame - 240) * 8), frame);
        await page.waitForFunction(frame => Math.abs(window.entrancePreview.frame - frame) < 0.2, frame);
        const state = await readState(page);
        assert.equal(state.gameVisible, false, 'Scrolling short of the handoff must retain the entrance');
        result.frames.push({target: frame, ...state});
      }
      await screenshot('reverse');
      if (!disableMultiDraw) {
        assert.equal(await page.locator('.frame-rate-panel').count(), 0, 'Public pages must not display developer diagnostics');
        const originalY = await page.evaluate(() => scrollY);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => window.entrancePreview.frame < 241);
        const measurement = await page.evaluate(() => new Promise(resolve => {
          const travel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--travel'));
          const start = performance.now(), times = [];
          let previousFrame = window.entrancePreview.frame;
          function step(now) {
            const frame = window.entrancePreview.frame;
            if (frame !== previousFrame) { times.push(now); previousFrame = frame; }
            const progress = Math.min(1, (now - start) / 10000);
            window.scrollTo(0, travel * progress * .998);
            if (progress === 1) resolve({times, start, end: now, sourceFrame: frame});
            else requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        }));
        result.performance = {...summarizeFrameUpdates(measurement.times, measurement.start, measurement.end), sourceFrame: measurement.sourceFrame};
        assert.ok(result.performance.updates > 0 && result.performance.durationMs >= 10000, 'Complete the full ten-second scene-update measurement');
        assert.ok(result.performance.sourceFrame > 2000, 'The check must cover the entrance through the final room');
        await page.evaluate(y => window.scrollTo(0, y), originalY);
        await page.waitForFunction(() => Math.abs(window.entrancePreview.frame - 400) < 0.2);
        await screenshot('fps-check');
        if (minimumFPS !== null) assert.ok(result.performance.minWindowFps >= minimumFPS,
          `Slowest one-second window ${result.performance.minWindowFps} FPS is below SOFACET_MIN_FPS=${minimumFPS}`);
      }
      await page.setViewportSize({width: 852, height: 393});
      await page.waitForFunction(() => {
        const canvas = window.entrancePreview?.renderer?.domElement;
        const bounds = canvas?.getBoundingClientRect();
        return bounds && Math.abs(bounds.width - 852) < 2 && Math.abs(bounds.height - 393) < 2;
      });
      result.landscape = await readState(page);
      assert.ok(Math.abs(result.landscape.frame - 400) < 0.2, 'Rotation must preserve the current animation pose');
      assert.ok(result.landscape.pixels[0] > 0 && result.landscape.pixels[0] <= 852
        && result.landscape.pixels[1] > 0 && result.landscape.pixels[1] <= 393, 'Rotated mobile canvas must retain its one-device-pixel budget');
      await screenshot('landscape');
      assert.deepEqual(result.pageErrors, [], 'The entrance must not throw browser errors');
      assert.deepEqual(result.shaderErrors, [], 'The entrance shaders must compile and link');
      assert.deepEqual(result.consoleErrors, [], 'The release assets and renderer must load without errors');
      result.passed = true;
      console.log(JSON.stringify({case: name, mobile: result.initial.quality.mobile, batching: result.initial.batching,
        scrollTargets: result.frames.map(frame => frame.target), performance: result.performance || null}));
    } catch (error) {
      result.passed = false;
      result.error = error.stack || String(error);
      result.failureState = await readState(page).catch(() => null);
      console.error(JSON.stringify({case: name, graphics: result.graphics, failureState: result.failureState,
        pageErrors: result.pageErrors, consoleErrors: result.consoleErrors, failedRequests: result.failedRequests}));
      await screenshot('failure').catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
  }
  console.log(`${engine} release entrance smoke passed. Results: ${output}`);
} finally {
  await browser?.close();
  await writeFile(join(output, `${stamp}-${engine}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, `${engine}-latest.json`), JSON.stringify(report, null, 2) + '\n');
}
