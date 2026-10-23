import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {open,rename,rm} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

for(const filename of ['sofacet-experience.mp4']){
const path=new URL('../assets/'+filename,import.meta.url);
const file=await open(path,'r');
const header=Buffer.alloc(1024);
let length;
try{({bytesRead:length}=await file.read(header,0,header.length,0));}finally{await file.close();}
const pointer=/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\s*$/.exec(header.subarray(0,length).toString());
if(!pointer){
 if(header.subarray(0,length).toString().startsWith('version https://git-lfs.github.com'))throw new Error('Invalid journey video LFS pointer.');
 console.log(`${filename} is already materialized.`);
}else{
 // This public mirror contains the exact video verified below. A deployment
 // from another repository has a different commit SHA, absent from the mirror.
 const revision='f9ffafaa7bf3e4a11438b25945857a41f2229cad';
 const url=`https://media.githubusercontent.com/media/sofacettech/Pin_ball_Game/${encodeURIComponent(revision)}/assets/${filename}`;
 console.log(`Downloading journey video from GitHub LFS (${pointer[2]} bytes).`);
 const response=await fetch(url,{signal:AbortSignal.timeout(300_000)});
 if(!response.ok)throw new Error(`GitHub LFS download failed: HTTP ${response.status}`);
 const hash=createHash('sha256');
 let bytes=0;
 const temporary=new URL(path.href+'.download');
 try{
  await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,done){bytes+=chunk.length;hash.update(chunk);done(null,chunk);}}),createWriteStream(temporary));
  if(bytes!==Number(pointer[2])||hash.digest('hex')!==pointer[1])throw new Error('Downloaded video does not match the committed LFS size and SHA-256.');
  await rename(temporary,path);
  console.log('Journey video size and SHA-256 verified.');
 }finally{await rm(temporary,{force:true});}
}
}
