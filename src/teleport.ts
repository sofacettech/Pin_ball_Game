import type {XYZ} from './types';
import type {MeshStandardMaterial} from 'three';

const ease=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t)};

// Presentation only: a teleport remains one atomic physics transaction.
export class TeleportEffect {
 private source:XYZ|null=null;private cameraSource:XYZ=[0,0,0];elapsed=0;
 readonly duration:number;private readonly departure:number;
 private uniforms={uTeleportPresence:{value:1},uTeleportStrength:{value:0},uTeleportCenterY:{value:0},uTeleportDiameter:{value:1}};
 constructor(readonly reduced:boolean){this.duration=reduced?.2:.48;this.departure=reduced?.08:.16}
 get active(){return this.source!==null}
 begin(from:XYZ,cameraFrom:XYZ){this.source=[...from];this.cameraSource=[...cameraFrom];this.elapsed=0}
 advance(dt:number){if(!this.active)return;this.elapsed+=dt;if(this.elapsed>=this.duration)this.reset()}
 reset(){this.source=null;this.elapsed=0;this.uniforms.uTeleportPresence.value=1;this.uniforms.uTeleportStrength.value=0}
 sample(destination:XYZ){
  if(!this.source)return {position:destination,camera:destination,presence:1,strength:0,phase:'idle'};
  const leaving=this.elapsed<this.departure;
  const t=leaving?this.elapsed/this.departure:(this.elapsed-this.departure)/(this.duration-this.departure),progress=ease(t);
  const presence=leaving?1-progress:this.reduced?progress:ease((t-.4)/.6);
  const cameraProgress=leaving?0:this.reduced?1:ease(t/.65);
  return {position:leaving?this.source:destination,camera:this.cameraSource.map((v,i)=>v+(destination[i]-v)*cameraProgress) as XYZ,presence,strength:this.reduced?0:1-presence,phase:leaving?'departing':'arriving'};
 }
 apply(position:XYZ,presence:number,strength:number){this.uniforms.uTeleportCenterY.value=position[1];this.uniforms.uTeleportPresence.value=presence;this.uniforms.uTeleportStrength.value=strength}
 attach(material:MeshStandardMaterial,diameter:number){
  this.uniforms.uTeleportDiameter.value=diameter;
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,this.uniforms);
   const uniforms='uniform float uTeleportPresence; uniform float uTeleportStrength; uniform float uTeleportCenterY; uniform float uTeleportDiameter; varying float vTeleportBand;\n';
   shader.vertexShader=uniforms+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
    vTeleportBand=floor(((modelMatrix*vec4(transformed,1.0)).y-uTeleportCenterY)/uTeleportDiameter*14.0);
    gl_Position.x+=uTeleportStrength*sin(vTeleportBand*1.7)*0.009*gl_Position.w;`);
   shader.fragmentShader=uniforms+shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
    if(uTeleportPresence<0.9999){
     float band=floor(vTeleportBand);
     float bandMask=fract(sin((band+31.0)*127.1)*43758.5453);
     float coverage=clamp((uTeleportPresence-bandMask+0.12)/0.24,0.0,1.0);
     float grain=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
     if(uTeleportPresence<0.0001||grain>coverage)discard;
     vec3 tint=mod(abs(band),2.0)<1.0?vec3(0.35,0.95,1.0):vec3(1.0,0.38,0.85);
     gl_FragColor.rgb=mix(gl_FragColor.rgb,tint,uTeleportStrength*0.55);
    }`);
  };
  material.customProgramCacheKey=()=> 'facet-local-teleport-v1';
 }
}
