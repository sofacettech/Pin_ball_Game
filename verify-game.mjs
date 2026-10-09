import {Worker} from 'node:worker_threads';
import {ServiceError} from './rewards.mjs';
import {MAX_GAME_TICKS,MAX_INPUT_RUNS} from './src/simulation.ts';
export function validateInputs(inputs){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_INPUT_RUNS)throw new ServiceError(400,'A valid gameplay replay is required.');
 let ticks=0;for(const item of inputs){if(!Array.isArray(item)||item.length!==2||!Number.isInteger(item[0])||item[0]<0||item[0]>15||!Number.isInteger(item[1])||item[1]<1||item[1]>MAX_GAME_TICKS)throw new ServiceError(400,'The gameplay controls are invalid.');ticks+=item[1];if(ticks>MAX_GAME_TICKS)throw new ServiceError(400,'This game exceeds the 30-minute verification limit.');}
 return ticks;
}
let running=0;
export function verifyGame(seed,inputs){
 if(running>=2)throw new ServiceError(503,'Game verification is busy. Please try again in a moment.');
 running++;
 return new Promise((resolve,reject)=>{
  let done=false,worker;try{worker=new Worker(new URL('./replay-worker.mjs',import.meta.url),{workerData:{seed,inputs},execArgv:['--experimental-strip-types']})}catch{running--;reject(new ServiceError(503,'Game verification could not start. Please try again.'));return}
  const finish=(error,result)=>{if(done)return;done=true;running--;clearTimeout(timeout);void worker.terminate();error?reject(error):resolve(result)};
  const timeout=setTimeout(()=>finish(new ServiceError(503,'Game verification took too long. Please try again.')),60000);
  worker.once('message',result=>finish(result.error?new ServiceError(400,result.error):null,result));
  worker.once('error',()=>finish(new ServiceError(503,'Game verification could not run. Please try again.')));
  worker.once('exit',()=>{if(!done)finish(new ServiceError(503,'Game verification stopped. Please try again.'))});
 });
}
