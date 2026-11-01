import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { copyReflectionCamera } from './reflection-camera.mjs';

const isRoom=name=>name.includes(' | ')&&parseInt(name)>=1&&parseInt(name)<=14;

export function createChessLook(scene,renderer,{performanceMode=false,captureReflection=draw=>draw(),reflectionSamples=2,reflectionScale=1}={}){
  const strength={value:0},capturing={value:0};
  const lights=new THREE.Group();lights.name='Chess gallery blue softboxes';scene.add(lights);
  for(const [position,target,width,height,intensity] of [
    [[-30,13.7,-42],[-30,4,-42],30,14,.26],
    [[-17,10,-41],[-36,6,-41],12,7,.6],
    [[-52,10,-41],[-25,6,-41],16,8,.32],
  ]){
    const light=new THREE.RectAreaLight(0xb4d7ff,intensity,width,height);
    light.position.fromArray(position);light.lookAt(...target);light.userData.fullIntensity=intensity;lights.add(light);
  }
  lights.visible=false;
  let surfaces=[],environment=null,ballMaterials=[],ballUsesRoom=false,crystalMaterials=[],simpleGlass=null;
  let lastCaptureFrame=null,wallCapture=0;
  const reflectionCamera=new THREE.PerspectiveCamera();

  function dominantPlane(meshes,center){
    const planes=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
    for(const mesh of meshes){
      const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
      for(let i=0;i<(index?index.count:p.count);i+=3){
        a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        const normal=ab.subVectors(b,a).cross(ac.subVectors(c,a)),area=normal.length()/2;
        if(area<.00001)continue;normal.normalize();
        if(normal.dot(ac.subVectors(center,a))<0)normal.negate();
        const constant=-normal.dot(a),key=normal.toArray().map(n=>n.toFixed(2)).join(',')+','+constant.toFixed(1);
        const group=planes.get(key)??{area:0,normal:normal.clone(),point:a.clone()};group.area+=area;planes.set(key,group);
      }
    }
    return [...planes.values()].sort((a,b)=>b.area-a.area)[0];
  }

  function planar(meshes,point,normal,width,lod,weights,tint){
    const targetWidth=Math.max(1,Math.round(width*reflectionScale));
    const mirror=new Reflector(new THREE.PlaneGeometry(1,1),{textureWidth:targetWidth,textureHeight:Math.max(1,Math.round(targetWidth*9/16)),clipBias:.002,multisample:reflectionSamples});
    mirror.position.copy(point);mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mirror.updateMatrixWorld(true);
    mirror.getRenderTarget().texture.generateMipmaps=true;mirror.getRenderTarget().texture.minFilter=THREE.LinearMipmapLinearFilter;
    const matrix={value:new THREE.Matrix4()},inverse=mirror.matrixWorld.clone().invert();
    surfaces.push({meshes,mirror,matrix,inverse});
    const done=new Set();
    for(const mesh of meshes)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(done.has(m))continue;done.add(m);
      const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m),weight=weights(m.name);
      m.onBeforeCompile=shader=>{
        compile(shader);
        shader.uniforms.uChessMirror={value:mirror.getRenderTarget().texture};shader.uniforms.uChessMatrix=matrix;
        shader.uniforms.uChessStrength=strength;shader.uniforms.uChessCapturing=capturing;
        shader.uniforms.uChessPlaneNormal={value:normal};
        shader.vertexShader='varying vec3 vChessWorld,vChessNormal;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
          vChessWorld=(modelMatrix*vec4(transformed,1.)).xyz;vChessNormal=normalize(mat3(modelMatrix)*objectNormal);`);
        shader.fragmentShader='uniform sampler2D uChessMirror;uniform mat4 uChessMatrix;uniform float uChessStrength,uChessCapturing;uniform vec3 uChessPlaneNormal;varying vec3 vChessWorld,vChessNormal;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          if(uChessStrength>0.&&uChessCapturing<.5){
            vec4 p=uChessMatrix*vec4(vChessWorld,1.);vec2 uv=p.xy/max(p.w,.0001);
            float border=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
            float aligned=smoothstep(.8,.98,abs(dot(normalize(vChessNormal),uChessPlaneNormal)));
            float amount=${weight.toFixed(3)}*uChessStrength*aligned*smoothstep(0.,.015,border);
            vec3 reflected=textureLod(uChessMirror,uv,${lod.toFixed(2)}).rgb;
            outgoingLight=mix(outgoingLight,reflected*vec3(${tint.join(',')}),amount);
          }
          #include <opaque_fragment>`);
      };
      m.customProgramCacheKey=()=>cacheKey()+`-chess-planar-${width}-${lod}-${weight}-${tint}`;m.needsUpdate=true;
    }
  }

  function install(model){
    lastCaptureFrame=null;wallCapture=0;
    for(const s of surfaces){s.mirror.getRenderTarget().dispose();s.mirror.geometry.dispose();s.mirror.material.dispose();}
    surfaces=[];environment?.dispose();environment=null;ballMaterials=[];ballUsesRoom=false;crystalMaterials=[];simpleGlass=null;
    model.updateMatrixWorld(true);
    const room=[],floor=[],ceiling=[],left=[],right=[],done=new Set(),scale=new THREE.Vector3();
    model.traverse(o=>{
      if(!o.isMesh)return;
      let mats=Array.isArray(o.material)?o.material:[o.material];
      if(mats.some(m=>m.name.includes('Chess ·'))){
        // GLB quantization introduces different object scales. Compensate so
        // the glass represents a solid ~1.2-unit section, not a zero-thickness sheet.
        const source=o.material,m=source.clone();m.onBeforeCompile=source.onBeforeCompile;m.customProgramCacheKey=source.customProgramCacheKey;
        o.getWorldScale(scale);m.thickness=1.2/Math.max(scale.x,scale.y,scale.z);
        m.transmission=1;m.opacity=1;m.transparent=false;m.depthWrite=true;
        m.ior=1.5;m.color.setRGB(.5,.32,.8);m.attenuationColor.setRGB(.55,.3,.8);m.attenuationDistance=4;
        m.roughness=.018;m.clearcoat=0;m.side=THREE.FrontSide;
        // A screen-space transmission buffer cannot see the side panels or
        // other glass pieces. Supplement it with sharp room-probe refraction.
        const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey.bind(m);
        m.onBeforeCompile=shader=>{
          compile(shader);
          shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`#include <transmission_fragment>
            #if defined(USE_TRANSMISSION) && defined(ENVMAP_TYPE_CUBE_UV)
              vec3 crystalRay=refract(-v,n,1./material.ior);
              vec3 crystalInterior=textureCubeUV(envMap,envMapRotation*crystalRay,material.roughness).rgb;
              vec3 crystalBounce=textureCubeUV(envMap,envMapRotation*reflect(-v,n),material.roughness).rgb;
              crystalInterior=mix(crystalInterior,crystalBounce,.65)*vec3(1.4,1.15,.9);
              totalDiffuse=mix(totalDiffuse,crystalInterior*material.diffuseContribution*1.1,.8*material.transmission);
            #endif`);
        };
        m.customProgramCacheKey=()=>cacheKey()+'-chess-volume-room-refraction';
        crystalMaterials.push(m);
        o.material=m;mats=[m];
      }
      if(mats.some(m=>isRoom(m.name)))room.push(o);
      if(mats.some(m=>/^0[12] \| Floor/.test(m.name)))floor.push(o);
      if(mats.some(m=>m.name.startsWith('04 | Ceiling')))ceiling.push(o);
      if(mats.some(m=>m.name.startsWith('03 | Walls')))left.push(o);
      if(mats.some(m=>m.name.startsWith('13 | Right wall')))right.push(o);
      for(const m of mats){
        if(done.has(m))continue;done.add(m);
        if(m.name.includes('SOFACET ball'))ballMaterials.push({m,envMap:m.envMap,intensity:m.envMapIntensity,roughness:m.roughness});
        if(!isRoom(m.name))continue;
        m.envMapIntensity=.85;
        if(m.name.startsWith('06 | Rear')){m.color.setRGB(.2,.24,.34);m.emissive.setRGB(.03,.04,.06);m.roughness=.24;m.metalness=.45;m.envMapIntensity=.3;}
        if(m.name.startsWith('11 | Ceiling')){m.color.setRGB(.24,.33,.47);m.emissive.setRGB(.05,.07,.1);m.metalness=.45;m.roughness=.28;m.envMapIntensity=.35;}
        if(m.name.startsWith('12 | Ceiling')){m.color.setRGB(.035,.06,.11);m.metalness=.5;m.roughness=.22;}
        if(/^(05|07) \|/.test(m.name))m.emissive.setRGB(.4,.7,1.25);
        if(m.name.startsWith('02 | Floor')){m.color.setRGB(.28,.43,.9);m.emissive.setRGB(.22,.38,.9);}
        m.needsUpdate=true;
      }
    });
    // Static architecture gives crystal and metal the room's actual checker
    // pattern and blue panels instead of the unrelated default studio softboxes.
    const probeScene=new THREE.Scene();probeScene.background=new THREE.Color(.015,.025,.05);
    const center=new THREE.Vector3(-32,8.8,-42),offset=new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z);
    const probeMaterials=[];
    for(const original of room){
      const source=Array.isArray(original.material)?original.material[0]:original.material;
      const color=source.color.clone();
      if(source.name.includes('luminous')||source.name.startsWith('02 | Floor'))color.copy(source.emissive).multiplyScalar(.85);
      else if(!source.name.includes('Chess ·'))color.multiplyScalar(.35);
      if(source.name.includes('Chess ·'))color.setRGB(.12,.07,.24);
      const material=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide});probeMaterials.push(material);
      // The ceiling and side walls are mirrors too. Include a single checker
      // bounce in the probe so crystal facets do not reflect a solid blue box.
      // This is an inexpensive static approximation of the offline multi-bounce glass.
      if(/^(03|04|13) \|/.test(source.name)){
        material.onBeforeCompile=shader=>{
          shader.vertexShader='varying vec3 vProbePosition,vProbeNormal;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
            vProbePosition=(modelMatrix*vec4(transformed,1.)).xyz;
            vProbeNormal=normalize(mat3(modelMatrix)*normal);`);
          shader.fragmentShader='varying vec3 vProbePosition,vProbeNormal;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            vec3 ray=reflect(normalize(vProbePosition),normalize(vProbeNormal));
            if(ray.y<-.001){
              float distance=(-4.74-vProbePosition.y)/ray.y;
              vec2 hit=(vProbePosition+ray*distance).xz+vec2(-32.,-42.);
              if(distance>0.&&hit.x>-54.&&hit.x<0.&&hit.y>-53.5&&hit.y<-30.5){
                float checker=mod(floor((hit.x+54.)/3.125)+floor((hit.y+53.5)/3.125),2.);
                diffuseColor.rgb=mix(vec3(.004,.006,.012),vec3(.35,.43,.65),checker);
              }
            }`);
        };
        material.customProgramCacheKey=()=> 'chess-probe-single-checker-bounce';
      }
      const copy=new THREE.Mesh(original.geometry,material);copy.matrixAutoUpdate=false;copy.matrix.copy(original.matrixWorld).premultiply(offset);probeScene.add(copy);
    }
    const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(probeScene,.015,.1,150);
    environment.texture.userData.journeyShared=true;pmrem.dispose();probeMaterials.forEach(m=>m.dispose());
    for(const o of room)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.envMap=environment.texture;m.needsUpdate=true;}
    planar(floor,new THREE.Vector3(0,4.06,0),new THREE.Vector3(0,1,0),768,.25,name=>name.startsWith('01 |')?.94:.3,['.4','.48','.65']);
    planar(ceiling,new THREE.Vector3(0,14.1395,0),new THREE.Vector3(0,-1,0),512,1.6,()=>.85,['.42','.38','.4']);
    const wall=dominantPlane(left,center);if(wall)planar(left,wall.point,wall.normal,512,3,()=>.85,['.42','.38','.4']);
    const side=dominantPlane(right,center);if(side)planar(right,side.point,side.normal,512,2.5,()=>.8,['.3','.3','.31']);
  }

  function update(frame){
    const distant=frame<(performanceMode?1480:780);
    if(simpleGlass!==distant){
      for(const m of crystalMaterials){m.transmission=distant?0:1;m.opacity=distant?.35:1;m.transparent=distant;m.depthWrite=!distant;m.needsUpdate=true;}
      simpleGlass=distant;
    }
    strength.value=THREE.MathUtils.smoothstep(frame,1520,1680);
    lights.visible=performanceMode||strength.value>0;for(const l of lights.children)l.intensity=l.userData.fullIntensity*strength.value;
    const useRoom=strength.value>.9;
    for(const saved of ballMaterials){
      saved.m.roughness=THREE.MathUtils.lerp(saved.roughness,.055,strength.value);
      saved.m.envMapIntensity=THREE.MathUtils.lerp(saved.intensity,1,strength.value);
      if(useRoom!==ballUsesRoom){saved.m.envMap=useRoom?environment.texture:saved.envMap;saved.m.needsUpdate=true;}
    }
    ballUsesRoom=useRoom;return strength.value;
  }
  function capture(camera,frame){
    if(strength.value<=0){lastCaptureFrame=null;return;}
    camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);capturing.value=1;
    copyReflectionCamera(camera,reflectionCamera);
    const refreshAll=!performanceMode||lastCaptureFrame===null||Math.abs(frame-lastCaptureFrame)>24;
    const selectedWall=1+wallCapture++%Math.max(1,surfaces.length-1);lastCaptureFrame=frame;
    try{
      for(const [index,s] of surfaces.entries()){
        // The floor follows every animation frame. Soft architectural mirrors
        // rotate through one update per frame, retaining their capture matrix.
        if(!refreshAll&&index!==0&&index!==selectedWall)continue;
        const visibility=s.meshes.map(o=>o.visible);s.meshes.forEach(o=>{o.visible=false;});
        // Match the entrance mirrors: reflected glass should not trigger
        // another transmission render of the entire world for every surface.
        try{captureReflection(()=>s.mirror.onBeforeRender(renderer,scene,reflectionCamera));s.matrix.value.copy(s.mirror.material.uniforms.textureMatrix.value).multiply(s.inverse);}
        finally{s.meshes.forEach((o,i)=>{o.visible=visibility[i];});}
      }
    }finally{capturing.value=0;}
  }
  return {install,update,capture};
}
