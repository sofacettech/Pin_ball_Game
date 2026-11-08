import referenceMesh from './score-mesh-topology.json';
function createTopology(width,height){
  // Preserve reference facet proportions; crop the same mesh on narrower viewports.
  const factor=Math.max(width/1672,height/941),offsetX=(width-1672*factor)/2,offsetY=(height-941*factor)/2;
  const points=referenceMesh.points.map(([x,y])=>({x:x*factor+offsetX,y:y*factor+offsetY}));
  let seed=21987;
  return {points,triangles:referenceMesh.triangles,edges:referenceMesh.edges,shades:referenceMesh.triangles.map(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;})};
}


export function mountScoreMesh(surface, onOpeningHit, {backgroundColor='#08040c',ambient=true}={}) {
  const canvas=surface.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const controller=new AbortController(),options={signal:controller.signal};
  if(!ctx)return;
  const background=document.createElement('canvas'),bg=background.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(!bg)return;
  let width=1,height=1,scale=1,topology,wave=null,raf=0;
  const sweep=2100,tail=1100;
  function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(render);}
  function radial(cx,cy,r,color){const g=bg.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(20,5,28,0)');bg.fillStyle=g;bg.fillRect(cx-r,cy-r,r*2,r*2);}
  function resize(){
    width=surface.clientWidth;height=surface.clientHeight;if(!width||!height)return;
    scale=Math.min(devicePixelRatio||1,1.5);
    for(const c of [canvas,background]){c.width=Math.ceil(width*scale);c.height=Math.ceil(height*scale);}
    bg.setTransform(scale,0,0,scale,0,0);bg.fillStyle=backgroundColor;bg.fillRect(0,0,width,height);
    if(ambient){
      radial(width*.5,height*.16,Math.max(width,height)*.63,'rgba(20,5,28,.40)');
      radial(width*.61,height*.72,Math.max(width,height)*.49,'rgba(22,5,31,.40)');
    }
    topology=createTopology(width,height);wave=null;schedule();
  }
  let introCue=null;
  function releaseIntro(){if(introCue===null)return;introCue=null;onOpeningHit();}
  function start(x,y,source="input",textArea=null){
    if(!topology)return;
    if(source!=='opening')releaseIntro();
    wave={x,y,start:performance.now(),reach:Math.max(Math.hypot(x,y),Math.hypot(width-x,y),Math.hypot(x,height-y),Math.hypot(width-x,height-y)),reduced:reduced.matches};
    if(source==='opening'&&textArea){
      const dx=Math.max(textArea.left-x,0,x-textArea.right),dy=Math.max(textArea.top-y,0,y-textArea.bottom);
      introCue=Math.hypot(dx,dy);
    }
    schedule();
  }
  function strength(x,y,elapsed){
    const age=wave.reduced?elapsed:elapsed-Math.hypot(x-wave.x,y-wave.y)/wave.reach*sweep;
    if(age<=0||age>=tail)return 0;
    if(age<150){const t=age/150;return t*t*(3-2*t);}
    if(age<330)return 1;
    const t=(age-330)/(tail-330);return 1-t*t*(3-2*t);
  }
  function render(now){
    raf=0;if(!topology||!width||!height)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(background,0,0);ctx.setTransform(scale,0,0,scale,0,0);
    if(!wave)return;
    const elapsed=now-wave.start;
    if(introCue!==null&&(wave.reduced||elapsed/sweep*wave.reach>=introCue))releaseIntro();
    if(elapsed>=(wave.reduced?tail:sweep+tail)){wave=null;return;}
    ctx.save();
    if(!wave.reduced){ctx.beginPath();ctx.arc(wave.x,wave.y,Math.max(0,elapsed/sweep*wave.reach),0,Math.PI*2);ctx.clip();}
    const points=topology.points;
    topology.triangles.forEach(([a,b,c],i)=>{
      const A=points[a],B=points[b],C=points[c],cx=(A.x+B.x+C.x)/3,cy=(A.y+B.y+C.y)/3;
      const light=strength(cx,cy,elapsed);if(light<.001)return;
      const shade=topology.shades[i],alpha=light*(.30+shade*.25);
      const g=ctx.createLinearGradient(A.x,A.y,(B.x+C.x)/2,(B.y+C.y)/2);
      g.addColorStop(0,`rgba(68,10,87,${alpha})`);g.addColorStop(1,`rgba(48,6,66,${alpha*.5})`);ctx.fillStyle=g;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.lineTo(C.x,C.y);ctx.closePath();ctx.fill();
    });
    // Sample along each original edge so its reveal and fade travel smoothly.
    for(const [a,b]of topology.edges){
      const A=points[a],B=points[b],steps=Math.max(1,Math.ceil(Math.hypot(B.x-A.x,B.y-A.y)/14));
      for(let j=0;j<steps;j++){
        const t=(j+.5)/steps,light=strength(A.x+(B.x-A.x)*t,A.y+(B.y-A.y)*t,elapsed);if(light<.001)continue;
        ctx.beginPath();ctx.moveTo(A.x+(B.x-A.x)*j/steps,A.y+(B.y-A.y)*j/steps);ctx.lineTo(A.x+(B.x-A.x)*(j+1)/steps,A.y+(B.y-A.y)*(j+1)/steps);
        ctx.lineWidth=2.2;ctx.strokeStyle=`rgba(77,16,108,${light*.09})`;ctx.stroke();
        ctx.lineWidth=.7;ctx.strokeStyle=`rgba(85,22,112,${light*.68})`;ctx.stroke();
      }
    }
    ctx.restore();schedule();
  }
  function clear(){releaseIntro();wave=null;schedule();}
  reduced.addEventListener('change',clear,options);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseIntro();wave=null;cancelAnimationFrame(raf);raf=0;}else schedule();},options);
  canvas.addEventListener('contextlost',()=>{cancelAnimationFrame(raf);raf=0;wave=null;canvas.style.visibility='hidden';},options);
  canvas.addEventListener('contextrestored',()=>{canvas.style.visibility='visible';resize();},options);
  const resizeObserver=new ResizeObserver(resize);
  resizeObserver.observe(surface);resize();
  return {start,dispose(){controller.abort();resizeObserver.disconnect();cancelAnimationFrame(raf)}};
}
