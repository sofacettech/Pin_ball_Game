import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Approximate the video's baked violet wash in the existing panel materials.
// Panel order follows the authored facade: dim left edge, bright front/corner,
// then a falloff along the right wall. This also colours the existing reflections
// without introducing more lights, reflection captures or per-frame traversals.
export function matchExteriorPalette(model){
  const seen=new Set();
  const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
  model.traverse(object=>{
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
      if(seen.has(material))continue;seen.add(material);
      const panel=/^Panel enamel • (Front|Right) violet panel (\d+)$/.exec(material.name);
      if(panel){
        const front=panel[1]==='Front',wash=smooth(Number(panel[2])/(front?14:10));
        const red=front?.3+.85*wash:1.85-1.65*wash;
        const blue=front?.16+1.9*wash:3.4-3.2*wash;
        // These are linear-light material values, calibrated through ACES and
        // the exterior output grade; do not interpret them as sRGB hex colours.
        material.emissive.setRGB(material.color.r*.945*red,front?.005+.013*wash:.027-.023*wash,material.color.b*1.68*blue);
        material.emissiveIntensity=1;
      }
      if(material.name==='Subtle dark navy night sky'){
        material.emissive.setRGB(.019,.033,.078);material.emissiveIntensity=1;
      }
    }
  });
}

// Grade the camera image after ACES and display conversion, rather than the
// reflection textures. Folding this into OutputPass adds no render target or draw.
export function createCinematicPass(){
  const pass=new OutputPass();
  pass.uniforms.uCinematicStrength={value:.2};
  pass.uniforms.uCinematicVignette={value:.04};
  pass.material.fragmentShader=pass.material.fragmentShader
    .replace('uniform sampler2D tDiffuse;',`uniform sampler2D tDiffuse;
      uniform float uCinematicStrength,uCinematicVignette;`)
    .replace(/\n\s*}\s*$/,`
      vec3 original=gl_FragColor.rgb;
      vec3 color=clamp(original,0.,1.);
      float luma=dot(color,vec3(.2126,.7152,.0722));
      // A smooth toe and shoulder deepen low mids without a hard black cutoff.
      // Applying the curve to luminance keeps the violet/blue material hues.
      float shaped=luma*luma*(3.-2.*luma);
      float gradedLuma=mix(luma,shaped,.56);
      color*=gradedLuma/max(luma,.0001);
      // Restrain saturated bright blue reflections; keep luminous sign faces white.
      float highlights=smoothstep(.58,.96,luma);
      color=mix(vec3(gradedLuma),color,.96-.08*highlights);
      color*=mix(vec3(.99,.995,1.01),vec3(1.012,1.004,.985),highlights);
      color/=max(1.,max(color.r,max(color.g,color.b)));
      // Wide, soft optical falloff: no border, letterbox, blur or altered framing.
      vec2 lens=(vUv-vec2(.5,.52))*vec2(1.,.88);
      float edge=smoothstep(.06,.42,dot(lens,lens));
      color*=1.-uCinematicVignette*edge;
      gl_FragColor.rgb=mix(original,color,uCinematicStrength);
    }`);
  pass.setLook=(chamber,gallery,enabled,outside=0)=>{
    // The video keeps bright violet exterior mids. The stronger indoor grade
    // returns continuously during the existing doorway transition.
    pass.uniforms.uCinematicStrength.value=enabled?Math.min(1,.68+.22*chamber+.32*gallery)-.48*outside:0;
    pass.uniforms.uCinematicVignette.value=.16+.05*gallery-.12*outside;
  };
  return pass;
}
