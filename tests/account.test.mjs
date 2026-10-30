import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {brandParts} from '../shared/brand-text.ts';

test('brand font matches only written brand names, preserving surrounding copy and email addresses',()=>{
 const text='About SO/FACET. Your So / Facet points. SOFACET membership. hello@sofacet.com';
 const parts=brandParts(text);assert.equal(parts.map(p=>p.text).join(''),'About SO/ FACET. Your SO/ FACET points. SO/ FACET membership. hello@sofacet.com');assert.deepEqual(parts.filter(p=>p.brand).map(p=>p.text),['SO/ FACET','SO/ FACET','SO/ FACET']);
 assert.equal(brandParts('Welcome back.')[0].brand,false);
});
test('account reads only the current member, uses confirmed credits, blocks pending actions and signs out without deleting records',async()=>{
 const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const directory=await mkdtemp(join(tmpdir(),'sofacet-account-test-')),member='a'.repeat(64),guest='b'.repeat(64);
 const store={players:{[member]:{name:'Asha',profile:{name:'Asha',phone:'+919876543210',customerId:'test-customer',marketingConsent:false},best:4500,bestVerified:true,bestAt:1},[guest]:{name:'Guest'}},games:{},rewardAccounts:{'test-customer':{bestScore:4500,creditedUnits:320}}};
 await writeFile(join(directory,'players.json'),JSON.stringify(store));const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,DATA_DIR:directory,REWARDS_API_KEY:'',REWARDS_ADMIN_SECRET:''},stdio:['ignore','pipe','pipe']});const exited=once(child,'exit');
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Fixture server stopped')})]);
  const request=(path,id=member,body)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'sofacet_pinball_player='+id,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/api/account',guest)).status,401);
  const account=await (await request('/api/account')).json();assert.deepEqual(account,{name:'Asha',leaderboardName:'Asha',phoneNumber:'+919876543210',savedPoints:3200,bestPoints:4500,rank:1,marketingConsent:false});assert.ok(!JSON.stringify(account).includes('test-customer'));
  for(const path of ['otp/request','otp/verify','preferences','delete'])assert.equal((await request('/api/account/'+path,member,{confirm:true,name:'Changed',phoneNumber:'+919000000000',otp:'123456'})).status,503);
  assert.deepEqual(await (await request('/api/account')).json(),account);
  const details={name:'Asha Kapoor',leaderboardName:'Asha K.',email:'asha@example.invalid',phoneNumber:account.phoneNumber,marketingConsent:false};
  assert.equal((await request('/api/account/details',guest,details)).status,401);
  assert.equal((await request('/api/account/details',member,details)).status,200);
  assert.deepEqual(await (await request('/api/account')).json(),{...account,...details});
  const signout=await request('/api/account/signout',member,{});assert.equal(signout.status,200);assert.match(signout.headers.get('set-cookie'),/HttpOnly/);assert.match(signout.headers.get('set-cookie'),/Max-Age=0/);assert.deepEqual(await signout.json(),{success:true});
  assert.equal((await fetch(origin+'/api/account/signout',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
 }finally{child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})}
});
