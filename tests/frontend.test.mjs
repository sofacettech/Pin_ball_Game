import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalisePhone,countries,phoneCountry,maskedPhone} from '../membership-source/src/phone.js';
import {capitaliseName,formatPoints,rewardMoney,resultHeadline,leaveCopy,birthDateState,splitPlayerName,publicPlayerName,leaderboardName,validPlayerName,validPublicName} from '../game-source/src/player-copy.ts';
import {POINTS_PER_RUPEE,rewardFromPoints} from '../shared/reward-value.js';
import {registrationDetails,registrationPayload,normaliseDesignPhone} from '../collective-source/auth-values.js';

test('result and leave copy preserves exact scores without rounding money upwards',()=>{
 assert.equal(POINTS_PER_RUPEE,10);assert.equal(rewardFromPoints(7300),730);assert.equal(rewardFromPoints(3205),320.5);
 assert.equal(formatPoints(3200),'3,200');assert.equal(rewardMoney(3205),'₹320.5');assert.equal(rewardMoney(9),'₹0.9');assert.equal(rewardMoney(-5),'₹0');
 assert.equal(resultHeadline(0),'Not much to keep yet.');assert.equal(resultHeadline(9),'Not much to keep yet.');assert.equal(resultHeadline(10),'Here’s what’s yours.');
 assert.equal(resultHeadline(5000,4500),'New best. Your SO/ COINS just went up.');assert.equal(resultHeadline(1,0),'New best. Your SO/ COINS just went up.');
 assert.equal(resultHeadline(3000,4500),'Your best is still 4,500 SO/ COINS (₹450). Beat it to earn more.');assert.equal(resultHeadline(4500,4500),resultHeadline(3000,4500));
 assert.deepEqual(leaveCopy(3200),{title:'Leaving ₹320 on the table?',support:'Your 3,200 SO/ COINS disappear when you leave.'});
});
test('international phone fields normalize real numbering plans and reject invalid input',()=>{
 for(const [value,country,expected] of [['98765 43210','IN','+919876543210'],['020 7946 0018','GB','+442079460018'],['(202) 555-0123','US','+12025550123'],['+61 412 345 678','IN','+61412345678'],['+33 6 12 34 56 78','','+33612345678']])assert.equal(normalisePhone(value,country),expected);
 for(const value of ['123','<script>','+999123456789','call 9876543210','0000000000','+12025550123123123'])assert.equal(normalisePhone(value,'IN'),null);
 assert.equal(phoneCountry('+442079460018'),'GB');assert.equal(maskedPhone('+442079460018'),'+44 ••••••0018');assert.equal(maskedPhone(''),'');assert.ok(countries.length>200);
});
test('single name field and public suggestion accept Unicode and reject HTML',()=>{
 assert.equal(capitaliseName('asha Kapoor'),'Asha Kapoor');
 assert.equal(capitaliseName('  élodie de Vries'),'  Élodie de Vries');
 assert.equal(capitaliseName('अनन्या'),'अनन्या');
 assert.deepEqual(splitPlayerName('  Asha  Kapoor '),{firstName:'Asha',lastInitial:'K'});assert.equal(publicPlayerName('Asha','K'),'Asha K.');assert.equal(publicPlayerName('Asha','K.'),'Asha K.');
 assert.equal(validPlayerName('Élodie'),true);assert.equal(validPlayerName('Asha Kapoor'),true);assert.equal(validPublicName('Asha'),true);
 assert.equal(validPublicName('Asha K.'),true);assert.equal(validPublicName('Élodie D.'),true);assert.equal(validPublicName('Guest123'),false);assert.equal(validPublicName('<script> A.'),false);assert.equal(validPublicName('A'.repeat(31)+' K.'),false);
});
test('age validation distinguishes guests, invalid dates and exact eighteenth birthday',()=>{
 const today=new Date(2026,9,20);
 assert.equal(birthDateState('2008-10-20',today),'adult');assert.equal(birthDateState('2008-10-21',today),'underage');assert.equal(birthDateState('2010-01-01',today),'underage');
 for(const value of ['','2027-01-01','2000-02-30','2000-13-01','1899-01-01'])assert.equal(birthDateState(value,today),'invalid');
});
test('leaderboard display names use a capitalised first name and last-name initial',()=>{
 for(const [input,expected] of [['chanda roy','Chanda R.'],['chanda r.','Chanda R.'],['CHANDA ROY','Chanda R.'],['  élodie dupont  ','Élodie D.'],['Asha Devi Kapoor','Asha K.'],['chanda','Chanda'],['','Player']]){
  assert.equal(leaderboardName(input),expected);
  assert.equal(leaderboardName(expected),expected);
 }
 assert.equal(publicPlayerName('chanda','r'),'Chanda R.');
});

test('country menus put India first without changing alphabetical order for other countries',()=>{
 assert.equal(countries[0].code,'IN');assert.equal(countries[0].dial,'+91');
 const rest=countries.slice(1);assert.equal(rest.some(country=>country.code==='IN'),false);
 assert.deepEqual(rest.map(country=>country.name),[...rest].sort((a,b)=>a.name.localeCompare(b.name)).map(country=>country.name));
});

test('account registration uses the age declaration without collecting birth date or city',()=>{
 const values={title:'Ms',name:'Asha Kapoor',country:'+91',phone:'9876543210',email:'asha@example.test',terms:true,updates:false};
 assert.throws(()=>registrationDetails({...values,terms:false}),/terms/);
 const details=registrationDetails(values);
 assert.equal(details.phoneNumber,'+919876543210');assert.equal('dateOfBirth' in details,false);assert.equal('city' in details,false);
 assert.equal(details.termsAccepted,true);assert.equal(details.marketingConsent,false);assert.equal(details.leaderboardName,'Asha K.');
 const payload=registrationPayload({...details,points:999999,rewardValue:999999},'verified-token','game-reference');
 assert.equal('dateOfBirth' in payload,false);assert.equal('city' in payload,false);
 assert.equal(payload.gameId,'game-reference');assert.equal(payload.verificationToken,'verified-token');assert.equal('points' in payload,false);assert.equal('rewardValue' in payload,false);
 assert.equal(normaliseDesignPhone('020 7946 0018','+44'),'+442079460018');
 assert.equal('gameId' in registrationPayload(details,'verified-token'),false,'creating an account without a game cannot invent rewards');
});
