import * as THREE from 'three';

// Finite source emitters give the metal room local reflections with parallax.
// An infinite environment alone puts the same oversized white patch on every panel.
export function createChamberReflections(sources,strength,{ballStrength=strength}={}){
  const cards=sources.filter(s=>/Reference (rear|right) wall|Magenta left recess|Soft frontal lavender|Foreground broad white/.test(s.name));
  // The fourteen narrow bounce strips form four broad pools of light. Merge
  // them by location, conserving energy, rather than evaluating every strip
  // for every metal pixel. Keep all eight small reference highlights separate.
  const pools=new Map();
  for(const source of sources.filter(s=>/^Architectural/.test(s.name))){
    const key=(source.position[0]<25?0:1)+(source.position[1]<17?0:2);
    if(!pools.has(key))pools.set(key,[]);pools.get(key).push(source);
  }
  for(const group of pools.values()){
    const energy=group.reduce((sum,s)=>sum+s.energy,0),position=[0,0,0],color=[0,0,0];
    const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
    for(const s of group){
      for(let i=0;i<3;i++){position[i]+=s.position[i]*s.energy/energy;color[i]+=s.color[i]*s.energy/energy;}
      const radius=[s.size*s.scale[0]*.5,s.sizeY*s.scale[1]*.5];
      for(let i=0;i<2;i++){min[i]=Math.min(min[i],s.position[i]-radius[i]);max[i]=Math.max(max[i],s.position[i]+radius[i]);}
    }
    cards.push({name:'Architectural pooled bounce',position,color,energy,quaternion:group[0].quaternion,
      size:max[0]-min[0],sizeY:max[1]-min[1],scale:[1,1,1]});
  }
  const centers=[],right=[],up=[],sizes=[],colors=[];
  for(const source of cards){
    const q=new THREE.Quaternion().fromArray(source.quaternion);
    const width=source.size*source.scale[0],height=source.sizeY*source.scale[1];
    const violet=/Reference|Architectural|Magenta/.test(source.name);
    centers.push(new THREE.Vector3().fromArray(source.position));
    right.push(new THREE.Vector3(1,0,0).applyQuaternion(q));
    up.push(new THREE.Vector3(0,1,0).applyQuaternion(q));
    sizes.push(new THREE.Vector2(width*.5,height*.5));
    const radiance=source.energy/(Math.PI*width*height);
    colors.push(new THREE.Color().fromArray(source.color).multiplyScalar(Math.min(radiance,violet?32:12)*(violet?2.:.5)));
  }
  return function install(material,{ball=false}={}){
    const compile=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=shader=>{
      compile(shader);
      Object.assign(shader.uniforms,{
        uChamberLocalStrength:ball?ballStrength:strength,uChamberCenters:{value:centers},uChamberRight:{value:right},
        uChamberUp:{value:up},uChamberSizes:{value:sizes},uChamberColors:{value:colors},
      });
      shader.vertexShader='varying vec3 vChamberSurface;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvChamberSurface=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader=`
        varying vec3 vChamberSurface;
        uniform float uChamberLocalStrength;
        uniform vec3 uChamberCenters[${cards.length}],uChamberRight[${cards.length}],uChamberUp[${cards.length}],uChamberColors[${cards.length}];
        uniform vec2 uChamberSizes[${cards.length}];
        vec3 chamberEmitters(vec3 origin,vec3 ray,float roughness){
          vec3 sum=vec3(0.);
          for(int i=0;i<${cards.length};i++){
            vec3 planeNormal=cross(uChamberRight[i],uChamberUp[i]);
            float denominator=dot(ray,planeNormal);
            if(abs(denominator)<.001)continue;
            float distance=dot(uChamberCenters[i]-origin,planeNormal)/denominator;
            if(distance<=0.||distance>180.)continue;
            vec3 hit=origin+ray*distance-uChamberCenters[i];
            vec2 uv=vec2(dot(hit,uChamberRight[i]),dot(hit,uChamberUp[i]));
            vec2 radius=uChamberSizes[i];
            float spread=roughness*roughness*distance*1.8+.22;
            vec2 footprint=sqrt(radius*radius+vec2(spread*spread));
            vec2 d=uv/footprint;
            float falloff=exp(-1.4*dot(d,d))*radius.x*radius.y/(footprint.x*footprint.y);
            sum+=uChamberColors[i]*falloff;
          }
          return sum;
        }
      `+shader.fragmentShader;
      if(ball){
        // The fallback studio environment is neutral white. Give its broad
        // indirect reflection the chamber's violet bounce; the direct area
        // lights retain the bright white core and moving magenta highlights.
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          reflectedLight.indirectSpecular*=mix(vec3(1.),vec3(1.,.22,.95),uChamberLocalStrength);`);
      }
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        if(uChamberLocalStrength>0.){
          vec3 roomNormal=inverseTransformDirection(normal,viewMatrix);
          vec3 roomView=normalize(cameraPosition-vChamberSurface);
          vec3 localLight=chamberEmitters(vChamberSurface,reflect(-roomView,roomNormal),roughnessFactor);
          ${ball?'outgoingLight=mix(outgoingLight,outgoingLight*.85+(localLight*1.25+vec3(.09,.025,.12))*mix(1.,.12,uJourneyReflectionPass),uChamberLocalStrength);':'outgoingLight+=localLight*diffuseColor.rgb*uChamberLocalStrength;'}
        }
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>cache()+'-finite-chamber-'+ball;
    material.needsUpdate=true;
  };
}
