import test from 'node:test';
import assert from 'node:assert/strict';
import {brandParts,setBrandText} from '../shared/brand-text.ts';

test('brand copy is canonical inside sentences without touching email or web addresses',()=>{
 const parts=brandParts('So/Facet, SOFACET and SO FACET. Visit https://sofacet.com or hello@sofacet.com.');
 assert.deepEqual(parts.filter(part=>part.brand).map(part=>part.text),['SO/ FACET','SO/ FACET','SO/ FACET']);
 assert.equal(parts.map(part=>part.text).join(''),'SO/ FACET, SO/ FACET and SO/ FACET. Visit https://sofacet.com or hello@sofacet.com.');
 assert.deepEqual(brandParts('Every 10 points = ₹1. What’s yours?'),[{text:'Every 10 points = ₹1. What’s yours?',brand:false}]);
});

test('dynamic copy uses the logo font only for the brand and keeps text as safe text nodes',()=>{
 const previous=globalThis.document;
 globalThis.document={createTextNode:text=>({textContent:text}),createElement:()=>({})};
 try{
  let children;
  setBrandText({replaceChildren:(...nodes)=>{children=nodes}},'Your So/Facet membership. <img onerror=alert(1)>');
  assert.equal(children[1].className,'brand-word');assert.equal(children[1].textContent,'SO/ FACET');
  assert.equal(children[2].textContent,' membership. <img onerror=alert(1)>');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});
