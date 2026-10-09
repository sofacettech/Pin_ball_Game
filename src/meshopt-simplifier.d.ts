declare module 'three/addons/libs/meshopt_simplifier.module.js' {
 export const MeshoptSimplifier:{supported:boolean;ready:Promise<void>;getScale(positions:Float32Array,stride:number):number;
  simplifyWithAttributes(indices:Uint32Array,positions:Float32Array,positionStride:number,attributes:Float32Array,attributeStride:number,weights:number[],locks:Uint8Array|null,targetCount:number,targetError:number,flags:string[]):[Uint32Array,number]};
}
