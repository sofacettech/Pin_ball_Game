import test from 'node:test';
import assert from 'node:assert/strict';
import {entranceRenderPolicy} from '../entrance-source/render-policy.mjs';

test('iPhone gets the mobile buffer budget without losing the HDR colour pipeline',()=>{
  const p=entranceRenderPolicy({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'});
  assert.equal(p.name,'mobile');
  assert.equal(p.mainSamples,0);
  assert.equal(p.reflectionSamples,0);
  assert.equal(p.canvasAntialias,false);
  assert.equal(p.maxPixelRatio,1);
});

test('desktop-mode iPad is detected, an ordinary Mac and Android keep existing quality',()=>{
  assert.equal(entranceRenderPolicy({platform:'MacIntel',maxTouchPoints:5}).name,'mobile');
  assert.equal(entranceRenderPolicy({platform:'MacIntel',maxTouchPoints:0}).name,'desktop');
  assert.equal(entranceRenderPolicy({userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'}).name,'desktop');
});

test('quality overrides allow matched comparisons and preserve reference quality',()=>{
  assert.equal(entranceRenderPolicy({quality:'mobile'}).mainSamples,0);
  assert.equal(entranceRenderPolicy({quality:'desktop',userAgent:'iPhone'}).mainSamples,2);
  const reference=entranceRenderPolicy({quality:'reference',userAgent:'iPhone'});
  assert.equal(reference.name,'reference');
  assert.equal(reference.mainSamples,4);
  assert.equal(reference.exteriorReflectionWidth,null);
});
