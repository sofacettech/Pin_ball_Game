import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationScreenRoute,canonicalHref} from '../site-routes.js';

test('account signup retains its origin through URL updates and a verification restart',()=>{
 let url=new URL('https://example.invalid/join?from=account');
 const screen=(state)=>{
  const route=registrationScreenRoute({step:'identity',tab:'create',challenge:null,exit:null,fromAccount:url.searchParams.get('from')==='account',...state});
  url=new URL(canonicalHref(route),url);
  return url.pathname+url.search;
 };
 assert.equal(screen({}),'/join?from=account');
 // A reload has no in-memory challenge or registration details.
 assert.equal(screen({}),'/join?from=account');
 assert.equal(screen({step:'claim',challenge:{kind:'signup'}}),'/verify?from=account');
 assert.equal(screen({}),'/join?from=account');
 assert.equal(screen({step:'claim',challenge:{kind:'signup'}}),'/verify?from=account');
 assert.equal(screen({step:'success'}),'/coins-saved');
});

test('general signup, claim, saved and leave routes retain their existing addresses',()=>{
 assert.equal(registrationScreenRoute({step:'identity',tab:'create'}),'/join');
 assert.equal(registrationScreenRoute({step:'claim',challenge:{kind:'signup'}}),'/verify');
 assert.equal(registrationScreenRoute({step:'claim'}),'/claim');
 assert.equal(registrationScreenRoute({step:'success',fromAccount:true}),'/coins-saved');
 assert.equal(registrationScreenRoute({exit:'confirm',fromAccount:true}),null);
 assert.equal(registrationScreenRoute({exit:'left',fromAccount:true}),'/exit');
 assert.equal(registrationScreenRoute({step:'identity',tab:'registered',fromAccount:true}),'/sign-in?from=account');
});
