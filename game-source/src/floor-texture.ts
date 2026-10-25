import {DataTexture,HalfFloatType,RGBAFormat} from 'three';
import type {ColorSpace,MagnificationTextureFilter,MinificationTextureFilter} from 'three';

export type FloorTextureData={
 data:Uint16Array;width:number;height:number;format:typeof RGBAFormat;type:typeof HalfFloatType;
 colorSpace:ColorSpace;minFilter:MinificationTextureFilter;magFilter:MagnificationTextureFilter;
 generateMipmaps:boolean;flipY:boolean;
};

async function download(url:string){
 const response=await fetch(url);
 if(!response.ok)throw new Error('Missing floor texture: '+response.status);
 return response.arrayBuffer();
}

function decodeInWorker(buffer:ArrayBuffer):Promise<FloorTextureData>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./floor-texture.worker.ts',import.meta.url),{type:'module'});
  let finished=false;
  const finish=(error:Error|null,data?:FloorTextureData)=>{
   if(finished)return;finished=true;clearTimeout(timeout);
   worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();
   if(error)reject(error);else resolve(data!);
  };
  const timeout=setTimeout(()=>finish(new Error('Floor texture worker timed out')),30000);
  worker.onerror=event=>{event.preventDefault();finish(new Error('Floor texture worker could not start'))};
  worker.onmessageerror=()=>finish(new Error('Floor texture worker response could not be read'));
  worker.onmessage=event=>{
   const message=event.data,data=message?.texture as FloorTextureData|undefined;
   if(message?.type!=='decoded'||!data||!(data.data instanceof Uint16Array)||
    !Number.isSafeInteger(data.width)||data.width<=0||!Number.isSafeInteger(data.height)||data.height<=0||
    data.data.length!==data.width*data.height*4||data.format!==RGBAFormat||data.type!==HalfFloatType){
    finish(new Error(message?.error||'Invalid floor texture worker response'));return;
   }
   finish(null,data);
  };
  try{worker.postMessage({buffer},[buffer])}catch(error){finish(error instanceof Error?error:new Error(String(error)))}
 });
}

export async function loadFloorTexture(url:string):Promise<DataTexture>{
 const buffer=await download(url);
 if(typeof Worker!=='undefined'){
  try{
   const data=await decodeInWorker(buffer),texture=new DataTexture(data.data,data.width,data.height,data.format,data.type);
   texture.colorSpace=data.colorSpace;texture.minFilter=data.minFilter;texture.magFilter=data.magFilter;
   texture.generateMipmaps=data.generateMipmaps;texture.flipY=data.flipY;texture.needsUpdate=true;
   return texture;
  }catch{
   // A worker can fail after taking ownership of the compressed bytes. Reuse
   // intact input, or retrieve it again rather than parsing a detached buffer.
  }
 }
 const {EXRLoader}=await import('three/addons/loaders/EXRLoader.js');
 return new EXRLoader().createDataTexture(buffer.byteLength?buffer:await download(url));
}
