import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewAccount,readPreviewAccount,writePreviewAccount,clearPreviewAccount,accountSignInHref,accountNavigationHref} from '../shared/account-session.js';
import {normalisePhone,phoneParts} from '../membership-source/src/phone.js';
import {matchingIndianCities} from '../membership-source/src/cities.js';

test('frontend account preview uses existing membership fields and clears its tab-only session',t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),storage=new Map();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 t.after(()=>{clearPreviewAccount();if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage});
 const account=createPreviewAccount('+919876543210');
 assert.equal(account.preview,true);assert.equal(account.phoneNumber,'+919876543210');assert.equal(account.marketingConsent,false);
 assert.ok(['name','leaderboardName','email','phoneNumber','marketingConsent'].every(key=>key in account));
 assert.equal('username' in account,false);assert.deepEqual(readPreviewAccount(),account);
 writePreviewAccount({...account,name:'Asha Kapoor',leaderboardName:'Asha K.',email:'asha@example.test',marketingConsent:true});
 assert.equal(readPreviewAccount().leaderboardName,'Asha K.');
 assert.ok(![...storage.values()].join('').includes('123456'),'No verification code belongs in account storage');
 assert.match(accountSignInHref,/view=signin&preview=1/);
 clearPreviewAccount();assert.equal(readPreviewAccount(),null);assert.equal(storage.size,0);
});

test('Indian city suggestions filter by typed city name without changing the city field contract',()=>{
 const all=matchingIndianCities();assert.ok(all.length>1000);
 assert.equal(new Set(all.map(city=>city.name+'|'+city.state)).size,all.length);
 const matches=matchingIndianCities(' gAnDhI ');assert.ok(matches.some(city=>city.name==='Gandhinagar'&&city.state==='Gujarat'));
 assert.ok(matches.every(city=>city.name.toLowerCase().includes('gandhi')));
 assert.deepEqual(matchingIndianCities('no-such-city-98765'),[]);
 assert.ok(matchingIndianCities('mumbai').some(city=>city.name==='Mumbai'));
});

test('international calling codes survive preview sign-in, account editing and tab session restoration',t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),storage=new Map();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 t.after(()=>{clearPreviewAccount();if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage});
 for(const [country,entered,expected,national] of [['GB','020 7946 0018','+442079460018','2079460018'],['US','202 555 0123','+12025550123','2025550123'],['AU','0412 345 678','+61412345678','412345678'],['IN','9876543210','+919876543210','9876543210']]){
  assert.equal(normalisePhone(entered,country),expected);
  createPreviewAccount(expected);assert.equal(readPreviewAccount().phoneNumber,expected);
  assert.equal(phoneParts(expected).country,country);assert.equal(phoneParts(expected).nationalNumber,national);
 }
 assert.equal(normalisePhone('123','GB'),null);
});


test('account navigation preserves explicit game context without leaking into website visits',()=>{
 assert.equal(accountNavigationHref('/account.html','?nav=game'),'/account.html?nav=game');
 assert.equal(accountNavigationHref('/membership.html?from=account','?nav=game'),'/membership.html?from=account&nav=game');
 assert.equal(accountNavigationHref('/account.html?view=signin&preview=1','?nav=game'),'/account.html?view=signin&preview=1&nav=game');
 for(const search of ['', '?from=account', '?nav=website', '?nav=https://example.test'])assert.equal(accountNavigationHref('/account.html',search),'/account.html');
});
