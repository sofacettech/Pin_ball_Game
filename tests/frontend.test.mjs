import test from 'node:test';
import assert from 'node:assert/strict';
import {normalisePhone,countries,phoneCountry,maskedPhone} from '../membership-source/src/phone.js';
import {formatPoints,rewardMoney,resultHeadline,leaveCopy,birthDateState,splitPlayerName,publicPlayerName,validPlayerName,validPublicName} from '../game-source/src/player-copy.ts';

test('result and leave copy preserves exact scores without rounding money upwards',()=>{
 assert.equal(formatPoints(3200),'3,200');assert.equal(rewardMoney(3205),'₹320.5');assert.equal(rewardMoney(9),'₹0.9');assert.equal(rewardMoney(-5),'₹0');
 assert.equal(resultHeadline(0),'Not much to keep yet.');assert.equal(resultHeadline(9),'Not much to keep yet.');assert.equal(resultHeadline(10),'Here’s what’s yours.');
 assert.equal(resultHeadline(5000,4500),'New best. Your points just went up.');assert.equal(resultHeadline(1,0),'New best. Your points just went up.');
 assert.equal(resultHeadline(3000,4500),'Your best is still 4,500 pts (₹450). Beat it to earn more.');assert.equal(resultHeadline(4500,4500),resultHeadline(3000,4500));
 assert.deepEqual(leaveCopy(3200),{title:'Leaving ₹320 on the table?',support:'Your 3,200 points disappear when you leave. Saving takes 20 seconds.'});
});
test('international phone fields normalize real numbering plans and reject invalid input',()=>{
 for(const [value,country,expected] of [['98765 43210','IN','+919876543210'],['020 7946 0018','GB','+442079460018'],['(202) 555-0123','US','+12025550123'],['+61 412 345 678','IN','+61412345678'],['+33 6 12 34 56 78','','+33612345678']])assert.equal(normalisePhone(value,country),expected);
 for(const value of ['123','<script>','+999123456789','call 9876543210','0000000000','+12025550123123123'])assert.equal(normalisePhone(value,'IN'),null);
 assert.equal(phoneCountry('+442079460018'),'GB');assert.equal(maskedPhone('+442079460018'),'+44 ••••••0018');assert.equal(maskedPhone(''),'');assert.ok(countries.length>200);
});
test('single name field and public suggestion accept Unicode and reject HTML',()=>{
 assert.deepEqual(splitPlayerName('  Asha  Kapoor '),{firstName:'Asha',lastInitial:'K'});assert.equal(publicPlayerName('Asha','K'),'Asha K.');assert.equal(publicPlayerName('Asha','K.'),'Asha K.');
 assert.equal(validPlayerName('Élodie'),true);assert.equal(validPlayerName('Asha Kapoor'),true);assert.equal(validPublicName('Asha'),true);
 assert.equal(validPublicName('Asha K.'),true);assert.equal(validPublicName('Élodie D.'),true);assert.equal(validPublicName('Guest123'),false);assert.equal(validPublicName('<script> A.'),false);assert.equal(validPublicName('A'.repeat(31)+' K.'),false);
});
test('age validation distinguishes guests, invalid dates and exact eighteenth birthday',()=>{
 const today=new Date(2026,9,20);
 assert.equal(birthDateState('2008-10-20',today),'adult');assert.equal(birthDateState('2008-10-21',today),'underage');assert.equal(birthDateState('2010-01-01',today),'underage');
 for(const value of ['','2027-01-01','2000-02-30','2000-13-01','1899-01-01'])assert.equal(birthDateState(value,today),'invalid');
});
