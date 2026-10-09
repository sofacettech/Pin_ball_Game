import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {PinballPhysics} from './src/physics.ts';
import {unpackInput} from './src/simulation.ts';
const assets=new URL('./public/assets/',import.meta.url);
const json=name=>JSON.parse(readFileSync(new URL(name,assets),'utf8'));
const binary=name=>{const buffer=readFileSync(new URL(name,assets));return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
let physics;
try{
 physics=await PinballPhysics.create(json('manifest.json'),new Float32Array(binary('collision-vertices.bin')),new Uint32Array(binary('collision-indices.bin')),json('collider-entities.json'));
 physics.start(workerData.seed);
 for(const [bits,count] of workerData.inputs){const input=unpackInput(bits);for(let tick=0;tick<count;tick++){
  if(physics.state==='finished')throw new Error('The replay contains controls after the game ended.');
  physics.tick(input);
 }}
 if(physics.state!=='finished'||physics.lives!==0||physics.drains!==3)throw new Error('The replay does not complete all three balls.');
 parentPort.postMessage({score:physics.score,ticks:Math.round(physics.time*120)});
}catch(error){parentPort.postMessage({error:error.message})}finally{physics?.dispose()}
