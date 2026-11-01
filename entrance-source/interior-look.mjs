import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createChamberReflections } from './chamber-reflections.mjs';
import { copyReflectionCamera } from './reflection-camera.mjs';

const sourceLights=await fetch('/assets/entrance-3d/interior-lights.json').then(r=>r.json());
const roomMaterial=/Polished steel|Reflective floor|Panel joint shadow|Pitted architectural concrete|Arch borders|Arch entry|architectural blocks|Layered violet|Mannequin body|Earrings|Necklace|Ring|Purple |Purple •|Veins •|Pattern •|Lime •|Outer arch edge|Exterior boxes/;

export function createInteriorLook(scene,renderer,{reflectionPass,captureReflection=draw=>draw(),performanceMode=false,reflectionWidth=512}){
  const localStrength={value:0};
  const ballStrength={value:0};
  const localReflections=createChamberReflections(sourceLights,localStrength,{ballStrength});
  const lights=new THREE.Group();lights.name='Purple chamber source lights';scene.add(lights);
  const environmentScene=new THREE.Scene();
  environmentScene.background=new THREE.Color().setRGB(.045,.035,.058);
  const center=new THREE.Vector3(27,18,-24);
  // Capture only the source emitters once. This replaces the unrelated white
  // studio reflections with the chamber's violet and lavender light layout.
  for(const source of sourceLights){
    const width=source.size*source.scale[0],height=(source.shape==='RECTANGLE'?source.sizeY:source.size)*source.scale[1];
    const area=width*height*(source.shape==='DISK'?Math.PI/4:1);
    const radiance=source.energy/(Math.PI*area);
    const color=new THREE.Color().fromArray(source.color);
    if(source.visibleGlossy){
      const geometry=source.shape==='DISK'?new THREE.CircleGeometry(width/2,32):new THREE.PlaneGeometry(width,height);
      const card=new THREE.Mesh(geometry,new THREE.ShaderMaterial({
        uniforms:{radiance:{value:color.clone().multiplyScalar(Math.min(radiance,12)*.3)}},
        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'uniform vec3 radiance;varying vec2 vUv;void main(){float soft=pow(max(0.,16.*vUv.x*(1.-vUv.x)*vUv.y*(1.-vUv.y)),2.);gl_FragColor=vec4(radiance*soft,1.);}',
        side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      }));
      card.position.fromArray(source.position).sub(center);card.quaternion.fromArray(source.quaternion);environmentScene.add(card);
    }
    const areaLight=/^Key\.001|^Soft white • lime|^Soft neutral facade/.test(source.name);
    const pointLight=/^Violet wash • (left|right)\.001|^Low violet bounce\.001/.test(source.name);
    if(!areaLight&&!pointLight)continue;
    const light=areaLight?new THREE.RectAreaLight(color,radiance*(/^Key/.test(source.name)?2.4:/^Soft neutral/.test(source.name)?.35:/^Soft white/.test(source.name)?.5:.65),width,height):new THREE.PointLight(color,source.energy/(4*Math.PI)*.55,75,2);
    light.name=source.name;light.position.fromArray(source.position);light.quaternion.fromArray(source.quaternion);
    light.userData.fullIntensity=light.intensity;lights.add(light);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(environmentScene,.06,.1,250);
  environment.texture.userData.journeyShared=true;
  pmrem.dispose();environmentScene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  const mirror=new Reflector(new THREE.PlaneGeometry(1,1),{textureWidth:reflectionWidth,textureHeight:reflectionWidth,clipBias:.003,multisample:0});
  mirror.rotation.x=-Math.PI/2;mirror.position.y=4.05;mirror.updateMatrixWorld(true);
  mirror.getRenderTarget().texture.generateMipmaps=true;
  mirror.getRenderTarget().texture.minFilter=THREE.LinearMipmapLinearFilter;
  const inverseMirror=mirror.matrixWorld.clone().invert();
  const reflectionCamera=new THREE.PerspectiveCamera();
  const reflectionMatrix={value:new THREE.Matrix4()},reflectionStrength={value:0};
  let floorMeshes=[];
  function install(model){
    floorMeshes=[];const done=new Set();
    model.traverse(o=>{
      if(o.isMesh&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>m.name==='Reflective floor'))floorMeshes.push(o);
      for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){
        if(done.has(m))continue;done.add(m);
        if(/SOFACET ball/.test(m.name))localReflections(m,{ball:true});
        if(!roomMaterial.test(m.name))continue;
        m.envMap=environment.texture;m.envMapIntensity=.65;
        if(/Polished steel/.test(m.name)){
          m.emissive.setRGB(.065,.055,.08);m.envMapIntensity=.24;
          m.roughness=.24;m.clearcoat=.12;m.clearcoatRoughness=.22;
          const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
          // Keep the figure/chandelier area lights from washing the entire
          // metal enclosure. The source-emitter map supplies wall highlights.
          m.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=shader.fragmentShader.replace(
            '#include <lights_fragment_end>',`#include <lights_fragment_end>
              reflectedLight.directSpecular*=.015;
              #ifdef USE_CLEARCOAT
                clearcoatSpecularDirect*=.015;
              #endif`);};
          m.customProgramCacheKey=()=>cacheKey()+'-chamber-steel';
          localReflections(m);
        }
        if(/architectural blocks|Exterior boxes/.test(m.name)){
          m.envMapIntensity=.4;m.roughness=.3;m.transmission=0;m.userData.journeyTransmission=0;
          m.clearcoat=.04;m.clearcoatRoughness=.35;m.emissive.setRGB(.04,.035,.055);
          const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
          m.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=shader.fragmentShader.replace(
            '#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.03;');};
          m.customProgramCacheKey=()=>cacheKey()+'-chamber-block-fill';
          localReflections(m);
        }
        if(/Mannequin body/.test(m.name)){
          m.metalness=.18;m.roughness=.72;m.envMapIntensity=.45;
          const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
          m.onBeforeCompile=shader=>{
            compile(shader);shader.uniforms.uFigureFill=localStrength;
            shader.fragmentShader='uniform float uFigureFill;\n'+shader.fragmentShader;
            // Approximate the missing soft indirect fill on the textured figure.
            shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight*=mix(1.,1.65,uFigureFill);\n#include <opaque_fragment>');
          };
          m.customProgramCacheKey=()=>cacheKey()+'-chamber-figure-fill';
        }
        if(/Arch borders|Arch entry|Outer arch edge/.test(m.name)){
          m.emissive.setRGB(.11,.02,.13);m.envMapIntensity=.35;
          if(m.transmission>0){m.transmission=.18;m.userData.journeyTransmission=.18;}
          m.clearcoat=.35;m.roughness=.28;
          const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
          m.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=shader.fragmentShader.replace(
            '#include <lights_fragment_end>',`#include <lights_fragment_end>
              reflectedLight.directSpecular*=.12;reflectedLight.directDiffuse*=.25;
              #ifdef USE_CLEARCOAT
                clearcoatSpecularDirect*=.12;
              #endif`);};
          m.customProgramCacheKey=()=>cacheKey()+'-chamber-arch-fill';
        }
        if(performanceMode&&/Arch borders|Arch entry|Outer arch edge|Layered violet/.test(m.name)){
          // These broad architectural surfaces read as coated resin in the
          // reference. Keep their glossy shading without refracting the whole
          // room through them on every entrance frame.
          m.transmission=0;m.userData.journeyTransmission=0;
          m.opacity=1;m.transparent=false;m.depthWrite=true;
        }
        if(m.name==='Reflective floor'){
          m.emissive.setRGB(.045,.016,.06);m.envMapIntensity=.95;
          const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
          m.onBeforeCompile=shader=>{
            compile(shader);
            shader.uniforms.uChamberReflection={value:mirror.getRenderTarget().texture};
            shader.uniforms.uChamberMatrix=reflectionMatrix;
            shader.uniforms.uChamberStrength=reflectionStrength;
            shader.vertexShader='varying vec3 vChamberWorld;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvChamberWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
            shader.fragmentShader='uniform sampler2D uChamberReflection;uniform mat4 uChamberMatrix;uniform float uChamberStrength;varying vec3 vChamberWorld;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
              if(uChamberStrength>0.&&uJourneyReflectionPass<.5){
              vec4 reflectedPosition=uChamberMatrix*vec4(vChamberWorld,1.);
              vec2 uv=reflectedPosition.xy/max(reflectedPosition.w,.0001);
              float valid=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
              vec3 reflected=textureLod(uChamberReflection,uv,2.5).rgb;
              outgoingLight=mix(outgoingLight,reflected*vec3(.92,.8,1.),uChamberStrength*valid);
              outgoingLight+=vec3(.035,.008,.055)*uChamberStrength;
              }
              #include <opaque_fragment>`);
          };
          m.customProgramCacheKey=()=>cacheKey()+'-chamber-planar';
        }
        m.needsUpdate=true;
      }
    });
  }
  function update(frame){
    const exit=1-THREE.MathUtils.smoothstep(frame,1480,1660);
    const visible=THREE.MathUtils.smoothstep(frame,560,720)*exit;
    localStrength.value=visible;
    ballStrength.value=THREE.MathUtils.smoothstep(frame,640,800)*exit;
    lights.visible=visible>0;
    for(const light of lights.children)light.intensity=light.userData.fullIntensity*visible;
    reflectionStrength.value=THREE.MathUtils.smoothstep(frame,680,780)*exit*.72;
    // Camera grading follows entry; room illumination is visible from outside.
    return THREE.MathUtils.smoothstep(frame,780,940)*exit;
  }
  function capture(camera){
    if(reflectionStrength.value<=0||!floorMeshes.length)return;
    camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);
    const visibility=floorMeshes.map(o=>o.visible);floorMeshes.forEach(o=>{o.visible=false;});
    reflectionPass.value=1;
    copyReflectionCamera(camera,reflectionCamera);
    captureReflection(()=>mirror.onBeforeRender(renderer,scene,reflectionCamera));
    reflectionPass.value=0;
    reflectionMatrix.value.copy(mirror.material.uniforms.textureMatrix.value).multiply(inverseMirror);
    floorMeshes.forEach((o,i)=>{o.visible=visibility[i];});
  }
  return {install,update,capture};
}
