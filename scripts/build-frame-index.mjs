import {open,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {basename} from 'node:path';

const root=new URL('../',import.meta.url);
function boxes(data,start=0){
 const result=[];
 while(start<data.length){
  if(start+8>data.length)throw Error('Truncated movie box');
  let size=data.readUInt32BE(start),header=8;
  if(size===1){size=Number(data.readBigUInt64BE(start+8));header=16}
  if(!size)size=data.length-start;
  if(!Number.isSafeInteger(size)||size<header||start+size>data.length)throw Error('Invalid movie box');
  result.push({type:data.toString('ascii',start+4,start+8),data:data.subarray(start+header,start+size)});start+=size;
 }
 return result;
}
const child=(data,type)=>{const box=boxes(data).find(box=>box.type===type);if(!box)throw Error('Missing '+type);return box.data};
async function indexMovie(url,widthExpected,heightExpected){
 const file=await open(url),{size:fileSize}=await file.stat();let moov;
 try{
  for(let offset=0;offset<fileSize;){
   const header=Buffer.alloc(16);await file.read(header,0,16,offset);let size=header.readUInt32BE(0),length=8;
   if(size===1){size=Number(header.readBigUInt64BE(8));length=16}
   if(!size)size=fileSize-offset;
   if(!Number.isSafeInteger(size)||size<length||offset+size>fileSize)throw Error('Invalid movie size');
   if(header.toString('ascii',4,8)==='moov'){if(size>2e6)throw Error('Unexpectedly large movie index');moov=Buffer.alloc(size-length);await file.read(moov,0,moov.length,offset+length);break}offset+=size;
  }
  if(!moov)throw Error('Missing movie index');
  const tracks=boxes(moov).filter(box=>box.type==='trak').map(box=>child(box.data,'mdia'));
  const mdia=tracks.find(data=>child(data,'hdlr').toString('ascii',8,12)==='vide');if(!mdia)throw Error('Missing video track');
  const mdhd=child(mdia,'mdhd'),timeScale=mdhd.readUInt32BE(mdhd[0]===1?20:12);
  const table=child(child(mdia,'minf'),'stbl'),stsz=child(table,'stsz'),count=stsz.readUInt32BE(8),constantSize=stsz.readUInt32BE(4);
  const stts=child(table,'stts');if(stts.readUInt32BE(4)!==1||stts.readUInt32BE(8)!==count)throw Error('Expected constant frame rate');
  const fps=timeScale/stts.readUInt32BE(12);
  const stss=boxes(table).find(box=>box.type==='stss')?.data;
  if(stss&&(stss.readUInt32BE(4)!==count||Array.from({length:count},(_,i)=>stss.readUInt32BE(8+i*4)).some((n,i)=>n!==i+1)))throw Error('Every frame must be a sync sample');
  const ctss=boxes(table).find(box=>box.type==='ctts')?.data;
  if(ctss)for(let i=0;i<ctss.readUInt32BE(4);i++)if(ctss.readUInt32BE(12+i*8)!==0)throw Error('Reordered frames are not supported');
  const stsd=child(table,'stsd');if(stsd.readUInt32BE(4)!==1)throw Error('Expected one sample description');
  const entry=boxes(stsd,8)[0];if(entry.type!=='avc1')throw Error('Expected H.264 video');
  const width=entry.data.readUInt16BE(24),height=entry.data.readUInt16BE(26),avcC=child(entry.data.subarray(78),'avcC'),colr=child(entry.data.subarray(78),'colr');
  if(!['nclc','nclx'].includes(colr.toString('ascii',0,4))||[4,6,8].some(at=>colr.readUInt16BE(at)!==1))throw Error('Expected the original Rec.709 colour metadata');
  const colorSpace={primaries:'bt709',transfer:'bt709',matrix:'bt709',...(colr.length>10?{fullRange:!!(colr[10]&128)}:{})};
  const stsc=child(table,'stsc'),mapping=Array.from({length:stsc.readUInt32BE(4)},(_,i)=>[stsc.readUInt32BE(8+i*12),stsc.readUInt32BE(12+i*12),stsc.readUInt32BE(16+i*12)]);
  const co64=boxes(table).find(box=>box.type==='co64')?.data,stco=co64||child(table,'stco');
  const frames=[];let map=0,sample=0;
  for(let i=0;i<stco.readUInt32BE(4);i++){
   while(map+1<mapping.length&&mapping[map+1][0]<=i+1)map++;
   if(mapping[map][2]!==1)throw Error('Unexpected sample description');
   let offset=co64?Number(stco.readBigUInt64BE(8+i*8)):stco.readUInt32BE(8+i*4);
   for(let j=0;j<mapping[map][1];j++){
    if(sample>=count)throw Error('Too many samples');
    const size=constantSize||stsz.readUInt32BE(12+sample*4);
    if(!size||!Number.isSafeInteger(offset)||offset<0||offset+size>fileSize)throw Error('Invalid frame range');
    frames.push([offset,size]);offset+=size;sample++;
   }
  }
  if(frames.length!==count||fps!==60||width!==widthExpected||height!==heightExpected)throw Error(`Expected independent ${widthExpected}×${heightExpected} / 60 FPS frames`);
  // The fast decoder requires an IDR in every sample, not just an absent sync table.
  const prefix=(avcC[4]&3)+1;
  for(const [offset,size] of frames){
   const data=Buffer.alloc(size);await file.read(data,0,size,offset);let idr=false;
   for(let at=0;at<data.length;){if(at+prefix>data.length)throw Error('Truncated NAL');const length=data.readUIntBE(at,prefix);at+=prefix;if(!length||at+length>data.length)throw Error('Invalid NAL');idr||=(data[at]&31)===5;at+=length}
   if(!idr)throw Error('A frame depends on another frame');
  }
  const hash=createHash('sha256');for await(const chunk of createReadStream(url))hash.update(chunk);
  return{version:1,source:'./'+basename(fileURLToPath(url)),sha256:hash.digest('hex'),bytes:fileSize,fps,width,height,frameCount:count,codec:'avc1.'+avcC.subarray(1,4).toString('hex'),description:avcC.toString('hex'),colorSpace,frames};
 }finally{await file.close()}
}
const manifest={version:1,variants:{}};
for(const [variant,suffix,width,height] of [['desktop','',1920,1080]]){
 const filename=`sofacet-experience${suffix}.mp4`,indexFile=`journey${suffix}-index.json`;
 const index=await indexMovie(new URL('assets/'+filename,root),width,height);
 await writeFile(new URL('assets/'+indexFile,root),JSON.stringify(index));
 const openingFile=`sofacet-opening${suffix}.mp4`,opening=await readFile(new URL('assets/'+openingFile,root));
 const openingHash=createHash('sha256').update(opening).digest('hex');
 manifest.variants[variant]={
  journey:{file:filename,index:indexFile,sha256:index.sha256,bytes:index.bytes,width,height,fps:index.fps,frameCount:index.frameCount,key:`videos/${index.sha256}/${filename}`},
  opening:{file:openingFile,sha256:openingHash,bytes:opening.length,key:`videos/${openingHash}/${openingFile}`},
 };
 console.log(`Indexed ${variant}: ${index.frameCount} independent ${width}×${height} frames at ${index.fps} FPS (${index.bytes} bytes).`);
}
// Mobile keeps the exact original compressed samples: no resize or second lossy encode.
manifest.variants.mobile=structuredClone(manifest.variants.desktop);
await writeFile(new URL('assets/video-manifest.json',root),JSON.stringify(manifest,null,2)+'\n');
// Content versions keep cached helper code consistent when performance settings change.
for(const [parent,dependencies] of [
 ['assets/frame-source.js',['./video-playback.js']],
 ['sequence.js',['./assets/frame-cache.js','./assets/frame-source.js','./assets/video-playback.js','./assets/kinetic-copy.js']],
 ['viewer.js',['./sequence.js','./reference-appearance.js','./assets/performance-overlay.js','./assets/media-delivery.js']],
 ['index.html',['./viewer.js']],
]){
 const file=new URL(parent,root);let source=await readFile(file,'utf8');
 for(const dependency of dependencies){
  if(!source.includes(dependency))throw Error('Missing landing dependency: '+dependency);
  const hash=createHash('sha256').update(await readFile(new URL(dependency,file))).digest('hex').slice(0,12);
  const escaped=dependency.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  source=source.replace(new RegExp(escaped+'(?:\\?v=[\\w-]+)?','g'),dependency+'?v=frames-'+hash);
 }
 await writeFile(file,source);
}
