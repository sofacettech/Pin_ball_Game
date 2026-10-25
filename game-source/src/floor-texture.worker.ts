import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {HalfFloatType,LinearFilter,LinearSRGBColorSpace,RGBAFormat} from 'three';
import type {FloorTextureData} from './floor-texture';

const scope=self as unknown as {
 onmessage:((event:MessageEvent<{buffer:ArrayBuffer}>)=>void)|null;
 postMessage(message:unknown,transfer?:Transferable[]):void;
};
scope.onmessage=event=>{
 try{
  const parsed=new EXRLoader().parse(event.data.buffer);
  if(!(parsed.data instanceof Uint16Array)||!parsed.width||!parsed.height||parsed.format!==RGBAFormat||parsed.type!==HalfFloatType)throw new Error('Unexpected floor texture format');
  const texture:FloorTextureData={
   data:parsed.data,width:parsed.width,height:parsed.height,format:parsed.format,type:parsed.type,
   colorSpace:parsed.colorSpace??LinearSRGBColorSpace,minFilter:parsed.minFilter??LinearFilter,magFilter:parsed.magFilter??LinearFilter,
   generateMipmaps:parsed.generateMipmaps??false,flipY:parsed.flipY??false,
  };
  scope.postMessage({type:'decoded',texture},[texture.data.buffer as ArrayBuffer]);
 }catch(error){scope.postMessage({type:'error',error:error instanceof Error?error.message:String(error)})}
};
