import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Sixfold cut with broader facets: table, 6 stars, 6 crown mains,
// 12 upper girdles, 6 pavilion mains, 12 lower girdles and a thin girdle.
function brilliant(){
 const sides=6,girdleSides=sides*2,halfAngle=Math.PI/sides;
 const positions:number[]=[],normals:number[]=[],planes:THREE.Vector4[]=[];
 const ring=(count:number,r:number,y:number,offset=0)=>Array.from({length:count},(_,i)=>{const a=i*Math.PI*2/count+offset;return new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r)});
 const tableRadius=.62,crownHeight=.30,crownSlope=crownHeight/(1-tableRadius),starHeight=.18;
 const table=ring(sides,tableRadius,crownHeight),stars=ring(sides,(1-starHeight/crownSlope)/Math.cos(halfAngle),starHeight,halfAngle);
 const upper=ring(girdleSides,1,0),lower=ring(girdleSides,1,-.035),halves=ring(sides,.76,-.96+.925*.76*Math.cos(halfAngle),halfAngle),tip=new THREE.Vector3(0,-.96,0);
 const face=(points:THREE.Vector3[])=>{
  const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
  if(normal.dot(points[0].clone().sub(new THREE.Vector3(0,-.1,0)))<0){points=points.slice().reverse();normal.negate()}
  planes.push(new THREE.Vector4(normal.x,normal.y,normal.z,normal.dot(points[0])));
  for(let i=1;i<points.length-1;i++)for(const p of [points[0],points[i],points[i+1]]){positions.push(p.x,p.y,p.z);normals.push(normal.x,normal.y,normal.z)}
 };
 face(table);
 for(let i=0;i<sides;i++){
  const next=(i+1)%sides,previous=(i+sides-1)%sides,a=2*i,b=2*i+1,c=(2*i+2)%girdleSides;
  face([table[i],stars[i],upper[a],stars[previous]]);
  face([table[i],table[next],stars[i]]);
  face([stars[i],upper[a],upper[b]]);face([stars[i],upper[b],upper[c]]);
  face([tip,halves[previous],lower[a],halves[i]]);
  face([halves[i],lower[a],lower[b]]);face([halves[i],lower[b],lower[c]]);
 }
 for(let i=0;i<girdleSides;i++){const next=(i+1)%girdleSides;face([upper[i],upper[next],lower[next],lower[i]])}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 return {geometry,planes};
}

// Shared seamless studio reflections; no image downloads or per-frame captures.
function studio(){
 const size=128;
 const cards=[
  {direction:[-1,.5,1],width:.55,height:1.2,color:[.98,.99,1]},
  {direction:[1,.65,.7],width:.4,height:.9,color:[1,.99,.96]},
  {direction:[0,1,-.25],width:1.5,height:.75,color:[1,1,1]},
  {direction:[-.3,.25,-1],width:.85,height:.65,color:[.96,.98,1]},
  {direction:[-.65,-.15,-1],width:.25,height:1.5,color:[.015,.02,.028]},
  {direction:[.8,.1,-1],width:.3,height:1.1,color:[.035,.04,.05]},
  {direction:[.1,.05,1],width:.18,height:.85,color:[.06,.07,.09]},
 ].map(card=>{const direction=new THREE.Vector3(...card.direction as [number,number,number]).normalize(),right=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0)).normalize(),up=new THREE.Vector3().crossVectors(right,direction);return {...card,direction,right,up}});
 const faces=Array.from({length:6},(_,face)=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d')!,image=context.createImageData(size,size),ray=new THREE.Vector3();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const u=2*(x+.5)/size-1,v=2*(y+.5)/size-1;
   if(face===0)ray.set(1,-v,-u);else if(face===1)ray.set(-1,-v,u);else if(face===2)ray.set(u,1,v);else if(face===3)ray.set(u,-1,-v);else if(face===4)ray.set(u,-v,1);else ray.set(-u,-v,-1);ray.normalize();
   const brightness=.40+.40*(ray.y*.5+.5),color=[brightness*.96,brightness*.985,brightness];
   for(const card of cards){const forward=ray.dot(card.direction);if(forward<=0)continue;
    const edge=Math.min(card.width-Math.abs(ray.dot(card.right)/forward),card.height-Math.abs(ray.dot(card.up)/forward));
    const weight=THREE.MathUtils.smoothstep(edge,-.025,.025);for(let c=0;c<3;c++)color[c]=THREE.MathUtils.lerp(color[c],card.color[c],weight);
   }
   const index=(y*size+x)*4;for(let c=0;c<3;c++)image.data[index+c]=Math.round(color[c]*255);image.data[index+3]=255;
  }
  context.putImageData(image,0,0);return canvas;
 });
 const texture=new THREE.CubeTexture(faces);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
}

function crystal(planes:THREE.Vector4[],environment:THREE.CubeTexture,tableEnvironment:THREE.Texture){
 const size=tableEnvironment.image as {width:number;height:number};
 const maxMip=Math.log2(size.height)-2;
 return new THREE.ShaderMaterial({
  toneMapped:false, // The shared OutputPass applies table exposure once.
  defines:{ENVMAP_TYPE_CUBE_UV:'',CUBEUV_TEXEL_WIDTH:1/size.width,CUBEUV_TEXEL_HEIGHT:1/size.height,CUBEUV_MAX_MIP:maxMip.toFixed(1)},
  uniforms:{planes:{value:planes},studio:{value:environment},tableEnvironment:{value:tableEnvironment},worldToGem:{value:new THREE.Matrix4()},gemToWorld:{value:new THREE.Matrix4()}},
  vertexShader:`uniform mat4 worldToGem;varying vec3 surface;varying vec3 facet;varying vec3 eye;
   void main(){surface=position;facet=normal;eye=(worldToGem*vec4(cameraPosition,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`precision highp float;
   uniform vec4 planes[${planes.length}];uniform samplerCube studio;uniform sampler2D tableEnvironment;uniform mat4 gemToWorld;
   #include <cube_uv_reflection_fragment>
   varying vec3 surface;varying vec3 facet;varying vec3 eye;
   const float IOR=2.417;
   vec3 lightAt(vec3 ray){return textureCube(studio,normalize(mat3(gemToWorld)*ray)).rgb;}
   float fresnel(float cosine){return .172+.828*pow(1.-clamp(cosine,0.,1.),5.);}
   vec3 exitLight(vec3 ray,vec3 wall,vec3 green){
    // Share the internal path; split wavelengths only at exiting facets.
    vec3 red=refract(ray,-wall,2.410),blue=refract(ray,-wall,2.425);
    return vec3(lightAt(dot(red,red)>.001?red:green).r,lightAt(green).g,lightAt(dot(blue,blue)>.001?blue:green).b);
   }
   vec3 travel(vec3 incident,vec3 normal){
    vec3 ray=refract(incident,normal,1./IOR),point=surface+ray*.0002,total=vec3(0.);float energy=1.;
    for(int bounce=0;bounce<5;bounce++){
     float nearest=10000.;vec3 wall=vec3(0.,1.,0.);
     for(int i=0;i<${planes.length};i++){
      float denominator=dot(planes[i].xyz,ray);
      if(denominator>.00001){float distance=(planes[i].w-dot(planes[i].xyz,point))/denominator;
       if(distance>.00001&&distance<nearest){nearest=distance;wall=planes[i].xyz;}}
     }
     if(nearest>9999.)break;
     point+=ray*nearest;
     vec3 exitRay=refract(ray,-wall,IOR);float reflected=fresnel(dot(ray,wall));
     if(dot(exitRay,exitRay)>.001){total+=exitLight(ray,wall,exitRay)*energy*(1.-reflected);energy*=reflected;}
     if(energy<.015)break;
     ray=reflect(ray,wall);point+=ray*.0002;
    }
    return total+lightAt(ray)*energy;
   }
   void main(){
    vec3 incident=normalize(surface-eye),normal=normalize(facet);float reflected=fresnel(dot(-incident,normal));
    vec3 reflectedRay=reflect(incident,normal);
    vec3 tableLight=textureCubeUV(tableEnvironment,normalize(mat3(gemToWorld)*reflectedRay),.08).rgb;
    vec3 surfaceLight=mix(lightAt(reflectedRay),tableLight,.18);
    vec3 color=mix(travel(incident,normal),surfaceLight,reflected);
    gl_FragColor=vec4(color,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
}


// One shared set of three static meshes per cradle. All dimensions are relative
// to the diamond radius; the recessed lenses use emission, not extra lights.
function openCradle(environment:THREE.Texture){
 const metal:THREE.BufferGeometry[]=[],purple:THREE.BufferGeometry[]=[],lime:THREE.BufferGeometry[]=[];
 const shape=(points:number[][])=>new THREE.Shape(points.map(([x,y])=>new THREE.Vector2(x,y)));
 const prism=(points:number[][],depth:number,bevel=.025)=>{
  const g=new THREE.ExtrudeGeometry(shape(points),{depth,steps:1,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,curveSegments:1});
  g.translate(0,0,-depth/2);g.clearGroups();return g;
 };
 const outline=(w:number,d:number,c:number)=>[[-w+c,-d],[w-c,-d],[w,-d+c],[w,d-c],[w-c,d],[-w+c,d],[-w,d-c],[-w,-d+c]];
 const base=prism(outline(.83,.42,.13),.13,.025);base.rotateX(-Math.PI/2);base.translate(0,.09,0);metal.push(base);
 const plate=prism(outline(.80,.39,.12),.045,.015);plate.rotateX(-Math.PI/2);plate.translate(0,.195,0);metal.push(plate);
 // Two polygonal elbows, with a thin inlaid strip on their front faces.
 for(const side of [-1,1]){
  const reflect=(p:number[][])=>p.map(([x,y])=>[x*side,y]);
  metal.push(prism(reflect([[.38,.23],[.62,.23],[.94,.73],[1.04,1.03],[.81,1.08],[.67,.76],[.38,.45]]),.24));
  const strip=prism(reflect([[.48,.25],[.53,.25],[.82,.73],[.94,1.025],[.90,1.035],[.78,.75]]),.006,0);strip.translate(0,0,.149);purple.push(strip);
  const cap=prism(outline(.16,.17,.035),.07,.018);cap.rotateX(-Math.PI/2);cap.rotateZ(-side*.23);cap.translate(side*.925,1.075,0);metal.push(cap);
  // Dark cap bezel remains visible around the inset lime diffuser.
  const pad=prism(outline(.112,.119,.018),.005,.003);pad.rotateX(-Math.PI/2);pad.translate(0,.048,0);pad.rotateZ(-side*.23);pad.translate(side*.925,1.075,0);lime.push(pad);
 }
 const material=new THREE.MeshStandardMaterial({color:0x403747,metalness:.8,roughness:.28,envMap:environment,envMapIntensity:1.1});
 const violet=new THREE.MeshStandardMaterial({color:0x7413b5,emissive:0xa226ed,emissiveIntensity:.85,metalness:.35,roughness:.3});
 const green=new THREE.MeshStandardMaterial({color:0xd5ff52,emissive:0xbfff00,emissiveIntensity:1.15,metalness:.05,roughness:.32});
 return [[metal,material],[purple,violet],[lime,green]].map(([parts,mat])=>{
  const geometries=parts as THREE.BufferGeometry[],geometry=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return {geometry,material:mat as THREE.MeshStandardMaterial};
 });
}

// Decorative only: no physics colliders. Portrait framing includes their full extent.
export class FloatingDiamonds {
 readonly meshes:THREE.Mesh[]=[];
 readonly stands:THREE.Group[]=[];
 readonly framingMeshes:THREE.Mesh[]=[];
 private motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
 private remaining=0;
 constructor(scene:THREE.Scene,tableEnvironment:THREE.Texture,anchors:THREE.Vector3[],private reduced:boolean){
  const {geometry,planes}=brilliant(),environment=studio(),cradle=openCradle(tableEnvironment),frameGeometry=new THREE.BoxGeometry(2.3,2.1,2.3);
  anchors.forEach((anchor,index)=>{
   const material=crystal(planes,environment,tableEnvironment),mesh=new THREE.Mesh(geometry,material);
   mesh.name=`Floating diamond ${index===0?'left':'right'}`;mesh.position.copy(anchor);mesh.position.y+=.030*1.70;mesh.scale.setScalar(.030);mesh.rotation.x=0;mesh.rotation.y=index*Math.PI/8;
   mesh.onBeforeRender=()=>{material.uniforms.worldToGem.value.copy(mesh.matrixWorld).invert();material.uniforms.gemToWorld.value.copy(mesh.matrixWorld)};
   scene.add(mesh);this.meshes.push(mesh);
   const stand=new THREE.Group();stand.name='Diamond open cradle '+(index===0?'left':'right');stand.position.copy(anchor);stand.scale.setScalar(.030);stand.rotation.y=0;if(index===1)stand.scale.x*=.75;
   for(const part of cradle){const child=new THREE.Mesh(part.geometry,part.material);child.name=stand.name+' '+(['metal','purple inlay','lime pads'][cradle.indexOf(part)]);stand.add(child)}
   scene.add(stand);this.stands.push(stand);
   // Unrendered support geometry bounds every yaw, so scoring never pumps the camera.
   const frame=new THREE.Mesh(frameGeometry);frame.position.copy(anchor);frame.position.y+=.030*1.01;frame.scale.setScalar(.030);frame.updateMatrixWorld(true);this.framingMeshes.push(frame);
  });
 }
 score(){this.reduced=this.motionPreference.matches;if(!this.reduced)this.remaining=Math.min(this.remaining+Math.PI/3,Math.PI)}
 advance(dt:number){
  this.reduced=this.motionPreference.matches;
  if(this.reduced){this.remaining=0;return false}
  if(dt<=0||this.remaining<=0)return false;
  const step=Math.min(this.remaining,Math.min(dt,.05)*Math.min(.55,this.remaining*2+.04));this.remaining-=step;
  if(this.remaining<.0001)this.remaining=0;
  for(let i=0;i<this.meshes.length;i++)this.meshes[i].rotation.y+=step*(i===0?1:-1);return true;
 }
 reset(){this.remaining=0;this.meshes.forEach((mesh,index)=>mesh.rotation.y=index*Math.PI/8)}
}
