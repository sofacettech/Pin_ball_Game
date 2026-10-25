import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
const sourceLights=await fetch('/assets/entrance-3d/exterior-lights.json').then(r=>r.json());

// Reconstruct the video's exterior lighting in realtime. The source geometry
// stays on disk unchanged; reflections use the actual building, terrain and ball.
export function createExteriorLook(scene,renderer,{captureReflection=draw=>draw(),performanceMode=false}={}){
  RectAreaLightUniformsLib.init();
  const lights=new THREE.Group();scene.add(lights);
  const reflectionCards=new THREE.Group();reflectionCards.visible=false;scene.add(reflectionCards);
  const lightMotion=[],lightQuaternion=new THREE.Quaternion(),lightPosition=new THREE.Vector3();
  for(const source of sourceLights.filter(l=>l.type==='AREA'&&l.position[2]>35&&l.energy>0&&!l.hideRender)){
    const width=source.size*source.scale[0],height=(source.shape==='RECTANGLE'?source.sizeY:source.size)*source.scale[1];
    const area=width*height*(source.shape==='DISK'?Math.PI/4:1);
    const radiance=source.energy/(Math.PI*area);
    const color=new THREE.Color().fromArray(source.color);
    // Keep moving highlights and the source road wash as area lights. Approximate
    // the other broad washes with four point lights; evaluating 20 LTC area lights
    // on every glossy fragment was too expensive in the full-size benchmark.
    const moving=!!source.samples?.length;
    const areaLight=moving||/^Wet path • source cool reflection/.test(source.name);
    const staticWash=/Violet wash • front middle|Tall violet corner|Rock violet spill (0|3)/.test(source.name);
    const light=areaLight?new THREE.RectAreaLight(color,radiance,width,height):staticWash?new THREE.PointLight(color,source.energy/(4*Math.PI),350,2):new THREE.Object3D();
    light.position.fromArray(source.position);light.quaternion.fromArray(source.quaternion);if(areaLight||staticWash)lights.add(light);
    // Cycles area emitters appear in glossy rays. Recreate that visibility in
    // the planar capture without putting floating light panels in the camera.
    const geometry=source.shape==='DISK'?new THREE.CircleGeometry(width/2,48):new THREE.PlaneGeometry(width,height);
    const card=new THREE.Mesh(geometry,new THREE.ShaderMaterial({
      // Roll off intense emitters before reflection filtering; the narrow tall
      // card otherwise becomes a clipped, lens-flare-like streak on the water.
      uniforms:{radiance:{value:color.clone().multiplyScalar(radiance*.45/(1+radiance*.12))}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform vec3 radiance;varying vec2 vUv;void main(){float soft=pow(max(0.,16.*vUv.x*(1.-vUv.x)*vUv.y*(1.-vUv.y)),1.5);gl_FragColor=vec4(radiance*soft,1.);}',
      side:THREE.BackSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    }));
    card.position.copy(light.position);card.quaternion.copy(light.quaternion);reflectionCards.add(card);
    const roomColor=new THREE.Color().setRGB(...(/^Soft left/.test(source.name)?[1,.035,.62]:/^Soft right/.test(source.name)?[.82,.3,1]:[.94,.72,1]));
    const entryColor=new THREE.Color().setRGB(...(/^Soft left/.test(source.name)?[1,.035,.62]:/^Soft right/.test(source.name)?[.82,.55,1]:[1,.06,.78]));
    if(moving)light.userData.roomGain=/^Soft left/.test(source.name)?1.8:/^Soft right/.test(source.name)?1.3:1.5;
    lightMotion.push({light,card,samples:source.samples??[],sourceColor:color.clone(),roomColor,entryColor,cardRadiance:radiance*.45/(1+radiance*.12)});
  }
  // Match the camera aspect and antialias reflected silhouettes.
  const mirror=new Reflector(new THREE.PlaneGeometry(1,1),{textureWidth:768,textureHeight:432,clipBias:.003,multisample:2});
  const reflectionCamera=new THREE.PerspectiveCamera();
  const surfaceBounds=new THREE.Box3(),probeRay=new THREE.Raycaster();
  const probeNDC=new THREE.Vector2(),probePoint=new THREE.Vector3(),probeSurface=new THREE.Vector3();
  const probePlane=new THREE.Plane(new THREE.Vector3(0,1,0));
  mirror.getRenderTarget().texture.generateMipmaps=true;
  mirror.getRenderTarget().texture.minFilter=THREE.LinearMipmapLinearFilter;
  mirror.rotation.x=-Math.PI/2;mirror.position.y=.85;mirror.updateMatrixWorld(true);
  const reflectionMatrix={value:new THREE.Matrix4()};
  const outsideUniform={value:1};
  const roomHiddenUniform={value:1};
  const reflectionPass={value:0};
  const waterTime={value:0};
  const signGlow={value:null},signBounds={value:new THREE.Vector4()},signPlane={value:0};
  const inverseMirror=new THREE.Matrix4().copy(mirror.matrixWorld).invert();
  let reflectiveMeshes=[],reflectionExcludedMeshes=[],uniforms=[],interiorMaterials=[],transmissiveMaterials=[],outsideGlass=null;
  function buildSignGlow(model){
    // A mounted channel sign needs separate contact, close spill and broad
    // illumination. Pack those silhouette masks into one small shared texture.
    signGlow.value?.dispose();signGlow.value=null;
    const emblems=[],bounds=new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse(o=>{
      if(o.isMesh&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>m.name==='Porcelain white emblem')){
        emblems.push(o);bounds.expandByObject(o);
      }
    });
    if(!emblems.length)return;
    signPlane.value=bounds.min.z-1;
    // Give the existing emblem a narrow dark return and a stand-off from the
    // wall, like a fabricated lightbox letter. Geometry is changed only in the
    // loaded preview; the GLB and the open Blender scene remain untouched.
    const center=bounds.getCenter(new THREE.Vector3()),originalBack=bounds.min.z,originalDepth=bounds.max.z-bounds.min.z;
    for(const object of emblems){
      const source=object.geometry,face=source.clone(),bodyGeometry=source.clone(),inverse=object.matrixWorld.clone().invert(),point=new THREE.Vector3();
      for(const [geometry,isBody] of [[face,false],[bodyGeometry,true]]){
        const positions=geometry.getAttribute('position');
        // Decoded glTF positions may use normalized integer attributes; write
        // new float attributes before adjusting their physical placement.
        const moved=new Float32Array(positions.count*3);
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
          if(isBody){
            point.x=center.x+(point.x-center.x)*1.035;point.y=center.y+(point.y-center.y)*1.035;
            point.z=.85+(point.z-originalBack)/Math.max(originalDepth,.001)*1.45;
          }else point.z+=1.2;
          point.applyMatrix4(inverse).toArray(moved,i*3);
        }
        geometry.setAttribute('position',new THREE.BufferAttribute(moved,3));
        if(isBody)geometry.computeVertexNormals();
        geometry.computeBoundingBox();geometry.computeBoundingSphere();
      }
      object.geometry=face;source.dispose();
      const body=new THREE.Mesh(bodyGeometry,new THREE.MeshStandardMaterial({name:'Emblem • charcoal return',color:0x17111f,metalness:.45,roughness:.38}));
      body.name='Emblem • raised dark housing';body.matrixAutoUpdate=false;body.matrix.copy(object.matrix);object.parent.add(body);
    }
    bounds.expandByScalar(7);
    signBounds.value.set(bounds.min.x,bounds.min.y,bounds.max.x,bounds.max.y);
    const width=512,height=Math.round(width*(bounds.max.y-bounds.min.y)/(bounds.max.x-bounds.min.x));
    const mask=document.createElement('canvas');mask.width=width;mask.height=height;
    const ctx=mask.getContext('2d'),v=new THREE.Vector3();ctx.fillStyle='#fff';
    for(const object of emblems){
      const p=object.geometry.getAttribute('position'),indices=object.geometry.index;
      for(let i=0;i<(indices?indices.count:p.count);i+=3){
        ctx.beginPath();
        for(let corner=0;corner<3;corner++){
          v.fromBufferAttribute(p,indices?indices.getX(i+corner):i+corner).applyMatrix4(object.matrixWorld);
          const x=(v.x-bounds.min.x)/(bounds.max.x-bounds.min.x)*width;
          const y=(bounds.max.y-v.y)/(bounds.max.y-bounds.min.y)*height;
          if(corner===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.closePath();ctx.fill();
      }
    }
    const glow=document.createElement('canvas');glow.width=width;glow.height=height;
    const g=glow.getContext('2d'),packed=g.createImageData(width,height);
    for(const [channel,blur] of [1,6,32].entries()){
      g.clearRect(0,0,width,height);g.filter=`blur(${blur}px)`;g.drawImage(mask,0,0);
      const pixels=g.getImageData(0,0,width,height).data;
      for(let i=0;i<pixels.length;i+=4){packed.data[i+channel]=pixels[i+3];packed.data[i+3]=255;}
    }
    g.putImageData(packed,0,0);
    signGlow.value=new THREE.CanvasTexture(glow);
    signGlow.value.userData.journeyShared=true;
  }
  function signWall(material){
    material.onBeforeCompile=shader=>{
      shader.uniforms.uJourneySignGlow=signGlow;shader.uniforms.uJourneySignBounds=signBounds;shader.uniforms.uJourneySignPlane=signPlane;
      shader.vertexShader='varying vec3 vJourneySignWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vJourneySignWorld=(modelMatrix*vec4(transformed,1.)).xyz;`);
      shader.fragmentShader='uniform sampler2D uJourneySignGlow;uniform vec4 uJourneySignBounds;uniform float uJourneySignPlane;varying vec3 vJourneySignWorld;\n'+shader.fragmentShader;
      // Point approximations of broad area washes create a lens-flare dot next
      // to the sign. Reduce punctual highlights on the front facade, retaining
      // diffuse purple illumination and the actual area-light contributions.
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_RECT_AREA_LIGHTS > 0 )',`
        float signRegion=1.-smoothstep(.4,2.,abs(vJourneySignWorld.z-uJourneySignPlane));
        reflectedLight.directSpecular*=mix(1.,.015,signRegion);
        #ifdef USE_CLEARCOAT
          clearcoatSpecularDirect*=mix(1.,.015,signRegion);
        #endif
        #if ( NUM_RECT_AREA_LIGHTS > 0 )`));
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec2 signUV=(vJourneySignWorld.xy-uJourneySignBounds.xy)/(uJourneySignBounds.zw-uJourneySignBounds.xy);
        vec3 signSpill=texture2D(uJourneySignGlow,signUV).rgb;
        float wallFacing=1.-smoothstep(.4,2.,abs(vJourneySignWorld.z-uJourneySignPlane));
        vec2 signShadowOffset=vec2(-.35,.65)/(uJourneySignBounds.zw-uJourneySignBounds.xy);
        float contact=texture2D(uJourneySignGlow,signUV+signShadowOffset).r;
        outgoingLight*=1.-.65*contact*wallFacing;
        outgoingLight+=(vec3(.45,.32,.58)*signSpill.g+vec3(.32,.12,.5)*signSpill.b)*(1.-.8*contact)*wallFacing;
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=> 'journey-mounted-emblem-wall-spill';
  }
  function signFace(material){
    material.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vJourneyEmblemNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
        vJourneyEmblemNormal=normalize(mat3(modelMatrix)*objectNormal);`);
      shader.fragmentShader='varying vec3 vJourneyEmblemNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        float signFace=smoothstep(.55,.94,normalize(vJourneyEmblemNormal).z);
        totalEmissiveRadiance*=mix(.025,1.,signFace);`);
    };
    material.customProgramCacheKey=()=> 'journey-emblem-lit-face-dark-returns';
  }
  function reflection(material,strength,blur,ripple,water=false){
    const weight={value:strength};uniforms.push({weight,strength});
    material.onBeforeCompile=shader=>{
      shader.uniforms.uJourneyReflection={value:mirror.getRenderTarget().texture};
      shader.uniforms.uJourneyReflectionMatrix=reflectionMatrix;
      shader.uniforms.uJourneyReflectionWeight=weight;
      shader.uniforms.uJourneyReflectionBlur={value:blur};
      shader.uniforms.uJourneyRipple={value:ripple};
      shader.uniforms.uJourneyWater={value:water?1:0};
      shader.uniforms.uJourneyWaterTime=waterTime;
      shader.vertexShader='varying vec3 vJourneyWorld;\nvarying vec3 vJourneyNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vJourneyWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
        vJourneyNormal=normalize(mat3(modelMatrix)*objectNormal);`);
      shader.fragmentShader=`uniform sampler2D uJourneyReflection;
        uniform mat4 uJourneyReflectionMatrix;
        uniform float uJourneyReflectionWeight,uJourneyReflectionBlur,uJourneyRipple,uJourneyWater,uJourneyWaterTime;
        varying vec3 vJourneyWorld;varying vec3 vJourneyNormal;\n`+shader.fragmentShader;
      // Suppress punctual fill highlights before the area-light contribution.
      // Preserve the broad source road wash instead of suppressing it as well.
      const lightChunk=THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_RECT_AREA_LIGHTS > 0 )',`
        reflectedLight.directSpecular*=.12;
        #ifdef USE_CLEARCOAT
          clearcoatSpecularDirect*=.12;
        #endif
        #if ( NUM_RECT_AREA_LIGHTS > 0 )`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lightChunk);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        // Differentiate a world-space wave field. Moving the camera now sees
        // different slopes; the surface is not a blurred screen-space mirror.
        vec2 surface=vJourneyWorld.xz;
        vec2 directionA=vec2(.24,.97077),directionB=vec2(.85749,-.5145),directionC=vec2(.6,.8);
        float warp=dot(surface,vec2(.07,-.11));
        float phaseA=dot(surface,directionA)*.9+.55*sin(warp)+uJourneyWaterTime*.55;
        float phaseB=dot(surface,directionB)*1.73-uJourneyWaterTime*.44;
        float phaseC=dot(surface,directionC)*3.1+uJourneyWaterTime*.93;
        float fineDetail=1.-smoothstep(.45,1.4,length(fwidth(surface)));
        vec2 slope=.075*cos(phaseA)*(directionA+.55/.9*cos(warp)*vec2(.07,-.11));
        slope+=.028*cos(phaseB)*directionB+.012*cos(phaseC)*directionC*fineDetail;
        vec3 surfaceNormal=normalize(vJourneyNormal);
        float horizontal=smoothstep(.65,.95,surfaceNormal.y);
        vec3 waveNormal=normalize(surfaceNormal-vec3(slope.x,0.,slope.y)*mix(.12,1.,uJourneyWater)*horizontal);
        vec3 viewDirection=normalize(cameraPosition-vJourneyWorld);
        // Project the wave's reflected-ray displacement in world coordinates,
        // so its apparent direction and size follow the camera perspective.
        float grazingView=1.-clamp(dot(surfaceNormal,viewDirection),0.,1.);
        vec3 reflectedSurface=vJourneyWorld+vec3(slope.x,0.,slope.y)*uJourneyRipple*mix(.35,1.,grazingView)*horizontal;
        vec4 reflectedPosition=uJourneyReflectionMatrix*vec4(reflectedSurface,1.0);
        vec2 reflectionUV=reflectedPosition.xy/max(reflectedPosition.w,.0001);
        float reflectionLOD=mix(.3,.12,uJourneyWater);
        vec3 reflected=textureLod(uJourneyReflection,reflectionUV,reflectionLOD).rgb*.4;
        reflected+=textureLod(uJourneyReflection,reflectionUV+vec2(uJourneyReflectionBlur,0.),reflectionLOD).rgb*.15;
        reflected+=textureLod(uJourneyReflection,reflectionUV-vec2(uJourneyReflectionBlur,0.),reflectionLOD).rgb*.15;
        reflected+=textureLod(uJourneyReflection,reflectionUV+vec2(0.,uJourneyReflectionBlur),reflectionLOD).rgb*.15;
        reflected+=textureLod(uJourneyReflection,reflectionUV-vec2(0.,uJourneyReflectionBlur),reflectionLOD).rgb*.15;
        float facing=clamp(dot(waveNormal,viewDirection),0.,1.);
        float grazing=pow(1.-facing,3.);
        // Water reflects more at grazing angles and reveals its dark body
        // looking down. A fixed 90% blend read as a chrome mirror everywhere.
        float fresnel=mix(.72+.28*grazing,.22+.78*grazing,uJourneyWater);
        float border=min(min(reflectionUV.x,1.-reflectionUV.x),min(reflectionUV.y,1.-reflectionUV.y));
        float edge=smoothstep(0.,.06,border);
        outgoingLight=mix(outgoingLight,reflected*vec3(.95,.72,.92),uJourneyReflectionWeight*fresnel*horizontal*edge);
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>`journey-planar-${strength}-${blur}-${ripple}-${water}`;
    material.needsUpdate=true;
  }
  function install(model){
    reflectiveMeshes=[];reflectionExcludedMeshes=[];uniforms=[];interiorMaterials=[];transmissiveMaterials=[];outsideGlass=null;const done=new Set();
    buildSignGlow(model);
    // Procedural Blender surfaces can export without UVs. Three's anisotropic
    // BRDF needs tangents or UV derivatives; a zero tangent frame blows out
    // entire steel panels under direct light. Keep anisotropy on supported meshes.
    model.traverse(object=>{
      if(!object.isMesh||object.geometry.hasAttribute('tangent')||object.geometry.hasAttribute('uv'))return;
      for(const m of Array.isArray(object.material)?object.material:[object.material]){
        if(m.anisotropy>0){m.anisotropy=0;m.needsUpdate=true;}
      }
    });
    model.traverse(object=>{
      if(!object.isMesh)return;
      const mats=Array.isArray(object.material)?object.material:[object.material];
      // The recessed ribbon sits below the exported channel lip and disappears
      // in patches at grazing views. Lift it just above that lip for continuity.
      if(mats.some(m=>/^Path rail • recessed/.test(m.name))){
        object.userData.journeyRailOriginalY??=object.position.y;
        object.position.y=object.userData.journeyRailOriginalY+.35;
      }
      let reflected=false;
      for(const m of mats){
        const name=m.name;
        if(/Path • wet|Wet violet obsidian|Puddles • indigo/.test(name))reflected=true;
        if(done.has(m))continue;done.add(m);
        if(m.transmission>0)transmissiveMaterials.push({material:m,transmission:m.transmission,opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite});
        if(/Mannequin body/.test(name))interiorMaterials.push({material:m,color:m.color.clone()});
        if(/Polished steel/.test(name))m.clearcoatRoughness=.0825;
        if(m.specularColor)for(const channel of ['r','g','b'])m.specularColor[channel]=THREE.MathUtils.clamp(m.specularColor[channel],0,1);
        if(/Geology •|Wet dark amethyst|Rock facet|Ground • damp/.test(name)){
          m.color.multiplyScalar(.24);m.envMapIntensity=.12;m.roughness=.28;
        }
        if(/Panel enamel/.test(name)){
          m.color.r*=1.25;m.color.b*=.95;
          m.emissive.copy(m.color).multiplyScalar(.35);m.emissiveIntensity=1;m.envMapIntensity=.15;
          if(signGlow.value)signWall(m);
        }
        if(/Subtle dark navy night sky/.test(name)){
          m.emissive.setRGB(.014,.026,.06);m.emissiveIntensity=1;
        }
        if(/SOFACET ball \| uniform/.test(name)){
          m.color.setRGB(.78,.78,.78);m.roughness=.21;m.metalness=.84;m.envMapIntensity=.15;
        }
        if(name==='Porcelain white emblem'){
          m.color.setRGB(.09,.075,.12);m.emissive.setRGB(1,.97,.94);m.emissiveIntensity=1.45;
          m.metalness=.25;m.roughness=.3;m.envMapIntensity=.15;
          signFace(m);
        }
        if(/Path rail • recessed/.test(name)){m.emissiveIntensity=1.8;m.roughness=.3;}
        if(/Path rail • dark/.test(name)){m.color.setRGB(.025,.02,.045);m.roughness=.42;m.metalness=.4;m.clearcoat=.1;m.clearcoatRoughness=.3;m.envMapIntensity=.15;}
        if(/Path • wet/.test(name)){m.color.setRGB(.025,.032,.06);m.roughness=.29;m.metalness=.35;m.clearcoat=.18;m.clearcoatRoughness=.28;m.envMapIntensity=.28;reflection(m,.62,.00045,2.5);}
        if(/Wet violet obsidian/.test(name)){m.color.setRGB(.001,.002,.006);m.roughness=.16;m.metalness=.08;m.clearcoat=.2;m.clearcoatRoughness=.12;m.envMapIntensity=.12;reflection(m,.9,.0001,32,true);}
        if(/Puddles • indigo/.test(name)){m.color.setRGB(.001,.003,.008);m.roughness=.12;m.metalness=0;m.ior=1.333;m.clearcoat=.2;m.clearcoatRoughness=.12;m.envMapIntensity=.15;reflection(m,.95,.0001,36,true);}
        // Some imported Cycles shader combinations generate non-finite HDR
        // pixels. Keep those pixels from contaminating the whole bloom chain.
        const compile=m.onBeforeCompile;
        m.onBeforeCompile=shader=>{compile(shader);
          shader.uniforms.uJourneyOutside=outsideUniform;
          shader.uniforms.uJourneyRoomHidden=roomHiddenUniform;
          shader.uniforms.uJourneyReflectionPass=reflectionPass;
          shader.fragmentShader='uniform float uJourneyOutside,uJourneyRoomHidden,uJourneyReflectionPass;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          if(any(isnan(outgoingLight))||any(isinf(outgoingLight)))outgoingLight=vec3(.002,.001,.006);
          outgoingLight=clamp(outgoingLight,vec3(0.),vec3(8.));
          ${/Mannequin body/.test(name)?'outgoingLight*=mix(1.,.15,uJourneyRoomHidden);':''}
          ${/Polished steel/.test(name)?'outgoingLight*=mix(1.,.025,uJourneyRoomHidden);':''}
          ${/SOFACET ball/.test(name)?'outgoingLight*=mix(1.,.12,uJourneyReflectionPass);':''}
          #include <opaque_fragment>`);};
        const cacheKey=m.customProgramCacheKey.bind(m);
        m.customProgramCacheKey=()=>cacheKey()+'-finite-'+(/Mannequin body/.test(name)?'body':/Polished steel/.test(name)?'steel':/SOFACET ball/.test(name)?'ball':'standard');
        m.needsUpdate=true;
      }
      if(reflected)reflectiveMeshes.push(object);
      // The shared planar capture cannot reflect the raised curb correctly on
      // uneven puddles. Omit that duplicate image; retain both rails in camera.
      if(reflected||mats.some(m=>/^Path rail/.test(m.name)))reflectionExcludedMeshes.push(object);
    });
    surfaceBounds.makeEmpty();
    for(const object of reflectiveMeshes)surfaceBounds.expandByObject(object);
    return {reflectiveMeshes:reflectiveMeshes.length,materials:done.size};
  }
  function fitReflectionView(camera){
    // The road rises above the water mirror. A fixed overscan only hid the
    // cutoff at some frames: near-road pixels still left the captured image.
    // Bound the visible surface at both height extremes, then keep its mirrored
    // projection inside the texture's soft border throughout the camera path.
    let extentX=1,extentY=1;
    for(const height of [surfaceBounds.min.y,surfaceBounds.max.y]){
      probePlane.constant=-height;
      for(const x of [-1,1])for(const y of [-1,1]){
        probeRay.setFromCamera(probeNDC.set(x,y),camera);
        if(!probeRay.ray.intersectPlane(probePlane,probeSurface))continue;
        // The largest normal-driven lookup offset is <4.4 world units. Include
        // that footprint so the waves cannot bring back the moving dark strip.
        for(const dx of [-4.5,4.5])for(const dz of [-4.5,4.5]){
          probePoint.copy(probeSurface);probePoint.x+=dx;probePoint.z+=dz;
          probePoint.y=2*mirror.position.y-probePoint.y;
          probePoint.project(camera);
          extentX=Math.max(extentX,Math.abs(probePoint.x));
          extentY=Math.max(extentY,Math.abs(probePoint.y));
        }
      }
    }
    reflectionCamera.copy(camera,false);
    reflectionCamera.projectionMatrix.elements[0]*=Math.min(.7,.84/extentX);
    reflectionCamera.projectionMatrix.elements[5]*=Math.min(.7,.84/extentY);
    reflectionCamera.projectionMatrixInverse.copy(reflectionCamera.projectionMatrix).invert();
  }
  function update(camera,frame,refreshReflection=true){
    waterTime.value=frame/60;
    const strength=1-THREE.MathUtils.smoothstep(frame,780,940);
    const simpleGlass=frame<780;
    if(outsideGlass!==simpleGlass){
      for(const saved of transmissiveMaterials){
        const m=saved.material;
        const transmission=m.userData.journeyTransmission??saved.transmission;
        const simplify=simpleGlass&&transmission>0;
        m.transmission=simplify?0:transmission;
        m.opacity=simplify?.35:saved.opacity;
        m.transparent=simplify?true:saved.transparent;
        m.depthWrite=simplify?false:saved.depthWrite;
        m.needsUpdate=true;
      }
      outsideGlass=simpleGlass;
    }
    outsideUniform.value=strength;
    // The room is already visible through the doorway before the camera enters.
    // Keep its visibility independent of the outdoor road/exposure transition.
    roomHiddenUniform.value=1-THREE.MathUtils.smoothstep(frame,560,720);
    const roomTint=THREE.MathUtils.smoothstep(frame,600,780);
    const entryTint=THREE.MathUtils.smoothstep(frame,780,900);
    for(const {light,card,samples,sourceColor,roomColor,entryColor,cardRadiance} of lightMotion){
      if(samples.length<2)continue;
      const index=Math.min(samples.length-2,Math.max(0,Math.floor((frame-240)/24)));
      const a=samples[index],b=samples[index+1],t=THREE.MathUtils.clamp((frame-a.frame)/(b.frame-a.frame),0,1);
      light.position.fromArray(a.position).lerp(lightPosition.fromArray(b.position),t);
      light.quaternion.fromArray(a.quaternion).slerp(lightQuaternion.fromArray(b.quaternion),t);
      card.position.copy(light.position);card.quaternion.copy(light.quaternion);
      light.color.copy(sourceColor).lerp(roomColor,roomTint).lerp(entryColor,entryTint);
      card.material.uniforms.radiance.value.copy(light.color).multiplyScalar(cardRadiance*THREE.MathUtils.lerp(1,light.userData.roomGain??1,roomTint));
    }
    for(const {material,color} of interiorMaterials)material.color.copy(color).multiplyScalar(THREE.MathUtils.lerp(1,.25,roomHiddenUniform.value));
    lights.visible=performanceMode||strength>0;
    for(const light of lights.children){if(!light.isLight)continue;light.userData.fullIntensity??=light.intensity;light.intensity=light.userData.fullIntensity*strength*THREE.MathUtils.lerp(1,light.userData.roomGain??1,roomTint);}
    for(const u of uniforms)u.weight.value=u.strength*strength;
    if(strength<=0||!reflectiveMeshes.length||!refreshReflection)return;
    // The 1.5× / 2× quality controls also increase reflection resolution.
    const reflectionWidth=renderer.getPixelRatio()>1?1024:768;
    if(mirror.getRenderTarget().width!==reflectionWidth)mirror.getRenderTarget().setSize(reflectionWidth,Math.round(reflectionWidth/camera.aspect));
    camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);
    const visibility=reflectionExcludedMeshes.map(o=>o.visible);
    reflectionExcludedMeshes.forEach(o=>{o.visible=false;});
    reflectionCards.visible=true;
    reflectionPass.value=1;
    fitReflectionView(camera);
    captureReflection(()=>mirror.onBeforeRender(renderer,scene,reflectionCamera));
    reflectionPass.value=0;
    reflectionCards.visible=false;
    reflectionMatrix.value.copy(mirror.material.uniforms.textureMatrix.value).multiply(inverseMirror);
    reflectionExcludedMeshes.forEach((o,i)=>{o.visible=visibility[i];});
  }
  return {install,update,reflectionPass};
}
