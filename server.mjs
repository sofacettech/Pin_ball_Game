import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ServiceError,authenticatePhone,rewardsLeaderboard,awardPoints} from './rewards.mjs';
import {validateInputs,verifyGame} from './verify-game.mjs';
import {REPLAY_VERSION} from './src/simulation.ts';

const root=fileURLToPath(new URL('.',import.meta.url)),dev=process.argv.includes('--dev');
const dir=resolve(process.env.DATA_DIR||resolve(root,'data'));mkdirSync(dir,{recursive:true});
const file=resolve(dir,'players.json');
let store=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{players:{},games:{}};
// ponytail: atomic local storage for one server process; use a shared database before running multiple replicas.
function commit(change){const previous=structuredClone(store);try{change();writeFileSync(file+'.tmp',JSON.stringify(store),{mode:0o600});renameSync(file+'.tmp',file)}catch(error){store=previous;throw error}}
function fail(status,message){throw new ServiceError(status,message)}
function json(response,status,data){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data))}
async function body(request,limit=8192){let data='';for await(const chunk of request){data+=chunk;if(Buffer.byteLength(data)>limit)fail(413,'The request is too large.')}try{return JSON.parse(data||'{}')}catch{fail(400,'Please send valid JSON.')}}
const publicPlayer=p=>({display_name:p.name,member:!!p.profile,best_score:p.bestVerified?p.best:null});
function player(request,response){
 const id=/(?:^|;\s*)facet_player=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie||'')?.[1];
 if(id&&store.players[id])return [id,store.players[id]];
 const fresh=randomBytes(32).toString('hex');
 commit(()=>{store.players[fresh]={name:'Player '+fresh.slice(0,4).toUpperCase()}});
 response.setHeader('Set-Cookie',`facet_player=${fresh}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.APP_ORIGIN?.startsWith('https://')?'; Secure':''}`);
 return [fresh,store.players[fresh]];
}
function name(value){if(typeof value!=='string')fail(400,'Please enter your player name.');const result=value.trim().replace(/\s+/g,' ');if(!result||result.length>40||/[\x00-\x1f\x7f]/.test(result))fail(400,'Use a player name between 1 and 40 characters.');return result}
function phone(value){if(typeof value!=='string')fail(400,'Please enter your Indian phone number.');let digits=value.replace(/[\s()-]/g,'');if(digits.startsWith('+91'))digits=digits.slice(3);if(/^0\d{10}$/.test(digits))digits=digits.slice(1);if(!/^\d{10}$/.test(digits))fail(400,'Membership currently supports Indian phone numbers (+91, followed by 10 digits).');return '+91'+digits}
const requests=new Map();
function rateLimit(request){const now=Date.now(),key=request.socket.remoteAddress;for(const [ip,bucket] of requests)if(now>bucket.until)requests.delete(ip);const bucket=requests.get(key)||{count:0,until:now+60000};bucket.count++;requests.set(key,bucket);if(bucket.count>120)fail(429,'Too many requests. Please wait a minute and try again.')}
function sameOrigin(request){const expected=process.env.APP_ORIGIN||'http://'+request.headers.host;if(request.headers.origin!==expected)fail(403,'Please submit this request from the game.');if(!request.headers['content-type']?.startsWith('application/json'))fail(415,'Please send JSON.');}
function trusted(request){const secret=process.env.REWARDS_ADMIN_SECRET;if(!secret)fail(503,'Redeemable rewards are disabled.');const actual=Buffer.from(request.headers.authorization||''),expected=Buffer.from('Bearer '+secret);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail(401,'Unauthorized.');}
function gameBoard(id){
 const ranked=Object.entries(store.players).filter(([,p])=>p.bestVerified===true&&Number.isSafeInteger(p.best)).sort(([a,p],[b,q])=>q.best-p.best||p.bestAt-q.bestAt||a.localeCompare(b));
 const entry=([key,p],index)=>({rank:index+1,display_name:p.name,points:p.best,is_you:key===id});
 const index=ranked.findIndex(([key])=>key===id);
 return {mode:'game',entries:ranked.slice(0,100).map(entry),me:index<0?null:entry(ranked[index],index)};
}
const inflight=new Map();
async function api(request,response,path){
 rateLimit(request);
 if(path==='/api/internal/rewards/award'&&request.method==='POST'){trusted(request);const data=await body(request);data.phone=phone(data.phone);return json(response,200,await awardPoints(data))}
 if(request.method==='POST')sameOrigin(request);
 const [id,p]=player(request,response);
 if(path==='/api/player'&&request.method==='GET')return json(response,200,publicPlayer(p));
 if(path==='/api/player/name'&&request.method==='POST'){const data=await body(request),value=name(data.name);commit(()=>{p.name=value});return json(response,200,publicPlayer(p))}
 if(path==='/api/member'&&request.method==='POST'){
  const data=await body(request);if(data.memberConsent!==true||data.contestConsent!==true)fail(400,'Please accept the membership and contest terms.');
  const fullName=name(name(data.firstName)+' '+name(data.lastName));const normalized=phone(data.phone);
  if(typeof data.email!=='string'||data.email.length>254||!/^\S+@\S+\.\S+$/.test(data.email))fail(400,'Please enter a valid email address.');
  if(typeof data.birthDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate)||!Number.isFinite(Date.parse(data.birthDate))||new Date(data.birthDate).toISOString().slice(0,10)!==data.birthDate||data.birthDate<'1900-01-01'||data.birthDate>new Date().toISOString().slice(0,10))fail(400,'Please enter a valid date of birth.');
  const result=await authenticatePhone(normalized);
  // The upstream API creates a phone-only customer. Other details stay in this game's private profile.
  commit(()=>{p.name=fullName;p.profile={customerId:result.customer_id,phone:normalized,email:data.email,firstName:data.firstName,lastName:data.lastName,birthDate:data.birthDate,country:String(data.country||'').slice(0,2),civility:String(data.civility||'').slice(0,20),memberConsent:true,contestConsent:true,registeredAt:new Date().toISOString()}});
  return json(response,200,{...publicPlayer(p),created:result.created});
 }
 if(path==='/api/games/start'&&request.method==='POST'){
  const gameId=randomUUID(),now=Date.now(),seed=randomBytes(4).readUInt32LE();commit(()=>{for(const [key,game] of Object.entries(store.games))if(now-game.startedAt>86400000)delete store.games[key];store.games[gameId]={player:id,startedAt:now,seed,version:REPLAY_VERSION}});return json(response,201,{id:gameId,seed,version:REPLAY_VERSION});
 }
 const match=/^\/api\/games\/([a-f0-9-]{36})\/finish$/.exec(path);
 if(match&&request.method==='POST'){
  const data=await body(request,2*1024*1024),game=store.games[match[1]];if(!game||game.player!==id)fail(404,'This game session was not found. Please play again.');
  if(!data||typeof data!=='object'||Object.keys(data).some(key=>!['version','inputs'].includes(key)))fail(400,'Submit gameplay controls only. The server calculates the score.');
  if(game.version!==REPLAY_VERSION||data.version!==REPLAY_VERSION||!Number.isInteger(game.seed))fail(409,'The game version changed. Please refresh and play again.');
  if(Date.now()-game.startedAt>86400000)fail(410,'This game session expired. Please play again.');
  const ticks=validateInputs(data.inputs),hash=createHash('sha256').update(JSON.stringify(data.inputs)).digest('hex');
  const result=()=>({saved:true,verified:true,score:store.games[match[1]].score,best_score:store.players[id].best});
  if(game.verified){if(game.replayHash!==hash)fail(409,'This game has already been verified with different controls.');return json(response,200,{...result(),replayed:true})}
  if(ticks/120>(Date.now()-game.startedAt)/1000+2)fail(400,'The submitted gameplay runs faster than the elapsed game time.');
  const pending=inflight.get(match[1]);if(pending&&pending.hash!==hash)fail(409,'This game is already being verified with different controls.');
  if(pending){await pending.promise;return json(response,200,{...result(),replayed:true})}
  const promise=verifyGame(game.seed,data.inputs).then(verified=>{
   commit(()=>{const currentGame=store.games[match[1]],currentPlayer=store.players[id];if(!currentGame||!currentPlayer)fail(410,'This game session expired. Please play again.');currentGame.score=verified.score;currentGame.verified=true;currentGame.replayHash=hash;currentGame.finishedAt=Date.now();if(!currentPlayer.bestVerified||verified.score>currentPlayer.best){currentPlayer.best=verified.score;currentPlayer.bestAt=currentGame.finishedAt;currentPlayer.bestVerified=true}});
  });
  inflight.set(match[1],{hash,promise});try{await promise;return json(response,200,{...result(),replayed:false})}finally{inflight.delete(match[1])}
 }
 if((path==='/api/leaderboard'||path==='/api/rewards/leaderboard')&&request.method==='GET'){
  if(path==='/api/rewards/leaderboard'||process.env.LEADERBOARD_MODE==='rewards'){
   const result=await rewardsLeaderboard();
   // Key-only lookup has no identified customer session. Do not guess a personal rewards rank.
   return json(response,200,{mode:'rewards',entries:result.entries.map(row=>({rank:row.rank,display_name:row.display_name,points:row.points,is_you:false})),me:null});
  }return json(response,200,gameBoard(id));
 }
 fail(404,'This endpoint was not found.');
}
const vite=dev?await (await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'}):null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.json':'application/json','.glb':'model/gltf-binary','.bin':'application/octet-stream','.exr':'application/octet-stream','.hdr':'application/octet-stream','.woff2':'font/woff2'};
const dist=resolve(root,'dist');
const server=createServer(async(request,response)=>{
 try{const path=new URL(request.url,'http://localhost').pathname;
  if(path.startsWith('/api/'))return await api(request,response,path);
  if(vite)return vite.middlewares(request,response);
  if(request.method!=='GET'&&request.method!=='HEAD')fail(405,'Method not allowed.');
  let target=resolve(dist,'.'+decodeURIComponent(path));if(!target.startsWith(dist+sep)&&target!==dist)fail(403,'Forbidden.');
  if(path==='/')target=resolve(dist,'index.html');
  if(!(await stat(target).catch(()=>null))?.isFile())fail(404,'File not found.');
  const data=await readFile(target);response.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.startsWith('/assets/')?'public, max-age=3600':'no-cache'});response.end(request.method==='HEAD'?undefined:data);
 }catch(error){if(!response.headersSent)json(response,error instanceof ServiceError?error.status:500,{message:error instanceof ServiceError?error.message:'The service could not complete this request. Please try again.'});else response.end()}
});
const port=Number(process.env.PORT||5173),host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>console.log(`FACET pinball: http://${host}:${port}${dev?' (development)':''}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await vite?.close();server.close(()=>process.exit(0))});
