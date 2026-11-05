export default function initialize(scope) {
const {document,window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,addEventListener,matchMedia,ResizeObserver,IntersectionObserver,MutationObserver} = scope;
if(!matchMedia("(prefers-reduced-motion: reduce)").matches){document.documentElement.classList.add("wave-intro-pending");setTimeout(()=>document.documentElement.classList.remove("wave-intro-pending"),6000);}

// Route taps through the mobile text layer while allowing normal vertical scrolling.
const meshFrame=document.querySelector('.mesh-layer');
for(const type of ['pointerdown','pointermove','pointerup','pointercancel']){
  document.querySelector('.page').addEventListener(type,event=>{
    if(!matchMedia('(max-width:700px)').matches||event.pointerType==='mouse'||event.target.closest('button,a'))return;
    const target=meshFrame.contentDocument?.getElementById('mesh');
    if(target)target.dispatchEvent(new meshFrame.contentWindow.PointerEvent(type,{
      bubbles:true,clientX:event.clientX,clientY:event.clientY,pointerType:event.pointerType,
      pointerId:event.pointerId,isPrimary:event.isPrimary
    }));
  });
}

// Decode before exchanging the original resting artwork for its separated parts.
(() => {
  const art=document.querySelector('.art-layer'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const purpleAnchors={"desktop":[0.458955223880597,0.5450819672131147],"mobile":[0.47058823529411764,0.3958333333333333]};
  function positionPurple(){
    const brand=document.querySelector('.text-layer .brand'),canvas=art.querySelector('.art-canvas');
    if(!brand||!canvas)return;
    const style=getComputedStyle(brand),after=getComputedStyle(brand,'::after');
    const transform=new DOMMatrixReadOnly(style.transform==='none'?undefined:style.transform);
    const range=document.createRange();range.selectNodeContents(brand);
    const label=range.getBoundingClientRect(),box=brand.getBoundingClientRect(),stage=canvas.getBoundingClientRect();
    const centerX=label.right-transform.m41+(parseFloat(style.columnGap)||0)+(parseFloat(after.width)||62)/2;
    const centerY=box.top-transform.m42+box.height/2-20;
    for(const[name,anchor]of Object.entries(purpleAnchors)){
      const node=art.querySelector('.scene-'+name+' .purple-butterfly');
      if(!node||!node.offsetWidth)continue;
      node.style.left=(centerX-stage.left-node.offsetWidth*anchor[0])+'px';
      node.style.top=(centerY-stage.top-node.offsetHeight*anchor[1])+'px';
    }
    art.classList.add('purple-positioned');
  }
  const positionObserver=new ResizeObserver(positionPurple);
  positionObserver.observe(art.querySelector('.art-canvas'));
  positionObserver.observe(document.querySelector('.text-layer .brand'));
  window.addEventListener('resize',positionPurple);
  document.fonts.ready.then(positionPurple);
  const intersections=new Map();
  function sync(){
    const plantVisible=[...intersections].some(([node,visible])=>visible&&node.classList.contains('plant-visibility'));
    const purpleVisible=[...intersections].some(([node,visible])=>visible&&node.classList.contains('purple-butterfly'));
    art.classList.toggle('reduced-motion',reduced.matches);
    art.classList.toggle('plant-paused',!plantVisible);
    art.classList.toggle('purple-paused',!purpleVisible);
    art.classList.toggle('ambient-paused',document.hidden||reduced.matches||(!plantVisible&&!purpleVisible));
  }
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)intersections.set(entry.target,entry.isIntersecting);
    sync();
  },{threshold:.01});
  art.querySelectorAll('.plant-visibility,.purple-butterfly').forEach(node=>observer.observe(node));
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);
  sync();
  Promise.all([...art.querySelectorAll('img')].map(img=>img.decode())).then(()=>{
    art.classList.add('motion-ready');
    art.dataset.motionReady='true';
    setTimeout(()=>{art.classList.add('ambient-active');sync();},Math.max(0,1500-performance.now()));
  }).catch(()=>{art.dataset.motionReady='fallback';});
})();



// Unlit, full-resolution texture deformation: the center and stem stay fixed.
(()=>{
 const art=document.querySelector('.art-layer'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const appleWebKit=/AppleWebKit/.test(navigator.userAgent)&&!/Chrome\/|Chromium\/|Edg\/|OPR\//.test(navigator.userAgent);
 if(appleWebKit){art.dataset.petalQuality='css-motion';return;}
 const settings={top:{center:[.517,.390],bottom:.415,left:0,period:9.5,phase:0},right:{center:[.501,.404],bottom:.55,left:.30,period:11,phase:1.1},left:{center:[.777,.446],bottom:.68,left:0,period:12.5,phase:2.2}};
 const rigs=new Map();let raf=0,last=0,elapsed=0,inspectionPaused=false;
 const vertex=`#version 300 es
 in vec2 uv; out vec2 vUV;
 uniform vec2 center; uniform float bottom; uniform float leftEdge; uniform float time; uniform float aspect; uniform float phase; uniform float gain;
 void main(){vUV=uv;vec2 d=uv-center;float r=length(vec2(d.x*aspect,d.y));
 float edge=smoothstep(.055,.24,r)*(1.-smoothstep(bottom-.045,bottom,uv.y))*smoothstep(leftEdge-.04,leftEdge+.02,uv.x);
 float wave=sin(time+phase);float wave2=sin(time*.81+phase+.7);
 vec2 shift=vec2(d.x*.0055*wave+d.y*.0018*wave2,d.y*.0045*wave2+d.x*.0018*wave);
 vec2 p=uv+edge*shift*gain;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}`;
 const fragment=`#version 300 es
 precision highp float;in vec2 vUV;uniform sampler2D source;out vec4 color;void main(){color=texture(source,vUV);}`;
 function create(img){
  const canvas=document.createElement('canvas');canvas.className='petal-surface';canvas.style.cssText=img.style.cssText;canvas.setAttribute('aria-hidden','true');img.after(canvas);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
  if(!gl){canvas.remove();return null;}
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const coords=[],cols=32,rows=40;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const x0=x/cols,x1=(x+1)/cols,y0=y/rows,y1=(y+1)/rows;coords.push(x0,y0,x1,y0,x0,y1,x0,y1,x1,y0,x1,y1);}
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(coords),gl.STATIC_DRAW);
  const uv=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const anis=gl.getExtension('EXT_texture_filter_anisotropic');if(anis)gl.texParameterf(gl.TEXTURE_2D,anis.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,gl.getParameter(anis.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  const config=settings[img.parentElement.dataset.flower];
  const uniforms={};for(const name of ['center','bottom','leftEdge','time','aspect','phase','gain'])uniforms[name]=gl.getUniformLocation(program,name);
  gl.uniform2fv(uniforms.center,config.center);gl.uniform1f(uniforms.bottom,config.bottom);gl.uniform1f(uniforms.leftEdge,config.left);gl.uniform1f(uniforms.phase,config.phase);
  const rig={img,canvas,gl,program,uniforms,config,count:coords.length/2};
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();img.classList.remove('petal-rendered');canvas.remove();rigs.delete(img);});
  return rig;
 }
 function draw(r,t){
  const {canvas,img,gl,config,uniforms}=r;const w=img.offsetWidth,h=img.offsetHeight,dpr=Math.min(devicePixelRatio||1,2.5);
  const rw=Math.max(1,Math.round(w*dpr)),rh=Math.max(1,Math.round(h*dpr));
  if(canvas.width!==rw||canvas.height!==rh){canvas.width=rw;canvas.height=rh;gl.viewport(0,0,rw,rh);}
  const start=Math.min(1,t/2);gl.uniform1f(uniforms.gain,start*start*(3-2*start));gl.uniform1f(uniforms.aspect,w/h);gl.uniform1f(uniforms.time,t*2*Math.PI/config.period);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,r.count);img.classList.add('petal-rendered');
 }
 function visibleImages(){return [...art.querySelectorAll((innerWidth<=767?'.scene-mobile':'.scene-desktop')+' .flower-image')];}
 function allowed(){return !inspectionPaused&&!document.hidden&&!reduce.matches&&art.classList.contains('ambient-active')&&!art.classList.contains('plant-paused')&&!art.classList.contains('ambient-paused');}
 function frame(now){raf=0;if(!allowed()){last=0;return;}if(last)elapsed+=Math.min(.05,(now-last)/1000);last=now;
  for(const img of visibleImages()){let r=rigs.get(img);if(!r){try{r=create(img);if(r)rigs.set(img,r);}catch(error){console.warn('Petal motion retained static artwork:',error);}}if(r)draw(r,elapsed);}
  raf=requestAnimationFrame(frame);
 }
 function sync(){
  if(reduce.matches){for(const r of rigs.values()){r.img.classList.remove('petal-rendered');r.canvas.style.visibility='hidden';}}
  else for(const r of rigs.values())r.canvas.style.visibility='visible';
  if(allowed()&&!raf)raf=requestAnimationFrame(frame);else if(!allowed()){cancelAnimationFrame(raf);raf=0;last=0;}
 }
 Promise.all([...art.querySelectorAll('.flower-image')].map(i=>i.decode())).then(()=>{new MutationObserver(sync).observe(art,{attributes:true,attributeFilter:['class']});reduce.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);addEventListener('resize',sync);sync();});
 window.__petalFlex={get elapsed(){return elapsed;},get surfaces(){return rigs.size;},seek(seconds){inspectionPaused=true;cancelAnimationFrame(raf);raf=0;last=0;elapsed=seconds;for(const r of rigs.values())draw(r,seconds);},resume(){inspectionPaused=false;last=0;sync();}};
})();



(()=>{
 const frame=document.querySelector('.mesh-layer');let opened=false;
 addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.data?.type!=='so:opening-wave-hit')return;
  document.documentElement.dataset.textWaveStart=String(performance.now());
  document.documentElement.classList.remove('wave-intro-pending');
 });
 document.querySelector('.page').addEventListener('click',e=>{
  if(!matchMedia('(max-width:700px)').matches||e.pointerType==='touch'||e.target.closest('button,a'))return;
  const mesh=frame.contentDocument?.getElementById('mesh');
  mesh?.dispatchEvent(new frame.contentWindow.MouseEvent('click',{bubbles:true,clientX:e.clientX,clientY:e.clientY}));
 });
 async function openingWave(){
  if(opened)return;opened=true;
  await Promise.all([document.fonts.ready,...[...document.querySelectorAll('.flower-image')].map(i=>i.decode())]);
  for(let tries=0;tries<120;tries++){
   await new Promise(requestAnimationFrame);
   const start=frame.contentWindow?.__startMeshWave;if(!start)continue;
   await new Promise(requestAnimationFrame);
   const pin=document.querySelector((innerWidth<=767?'.scene-mobile':'.scene-desktop')+' .right-bloom-origin');
   const p=pin.getBoundingClientRect(),f=frame.getBoundingClientRect();
   const area=document.querySelector('.text-layer .reward').getBoundingClientRect();
   document.documentElement.dataset.openingWaveStart=String(performance.now());
   start(p.left-f.left,p.top-f.top,'opening',{left:area.left-f.left,top:area.top-f.top,right:area.right-f.left,bottom:area.bottom-f.top});return;
  }
 }
 openingWave();
})();

}
