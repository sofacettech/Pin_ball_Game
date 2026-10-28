import test from 'node:test';
import assert from 'node:assert/strict';
import {brandParts} from '../shared/brand-text.ts';
test('brand copy uses SO/FACET while preserving email addresses and asset identifiers',()=>{
 for(const name of ['SoFacet','SO FACET','So/Facet','SO/ FACET','SO/FACET']){
  assert.deepEqual(brandParts('Your '+name+'. What’s yours?'),[{text:'Your ',brand:false},{text:'SO/FACET',brand:true},{text:'. What’s yours?',brand:false}]);
 }
 for(const value of ['hello@sofacet.com','/assets/sofacet-wordmark.svg','sofacet:membership-ready','SO/ UNLOCKED','SO/ SAVED'])assert.deepEqual(brandParts(value),[{text:value,brand:false}]);
});
