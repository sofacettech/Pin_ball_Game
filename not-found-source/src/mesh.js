import referenceMesh from './reference-mesh.json';

function createTopology(width, height) {
  const factor=Math.max(width/1672,height/941),offsetX=(width-1672*factor)/2,offsetY=(height-941*factor)/2;
  const points=referenceMesh.points.map(([x,y])=>({x:x*factor+offsetX,y:y*factor+offsetY}));
  let seed=21987;
  return {points,triangles:referenceMesh.triangles,edges:referenceMesh.edges,shades:referenceMesh.triangles.map(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;})};
}

export function mountMesh(surface) {
  const canvas=surface.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)return;
  const background=document.createElement('canvas'),bg=background.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const events=new AbortController();
  const on=(target,type,listener)=>target.addEventListener(type,listener,{signal:events.signal});
  let width=1,height=1,scale=1,topology,wave=null,raf=0,tap=null,down=null,lastTouch=-Infinity;
  const sweep=2100,tail=1100;
  function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(render);}
  function resize(){
    width=surface.clientWidth;height=surface.clientHeight;scale=Math.min(devicePixelRatio||1,1.5);
    for(const c of [canvas,background]){c.width=Math.ceil(width*scale);c.height=Math.ceil(height*scale);}
    bg.setTransform(scale,0,0,scale,0,0);bg.fillStyle='#000';bg.fillRect(0,0,width,height);
    topology=createTopology(width,height);wave=null;schedule();
  }
  let introCue=null;
  function releaseIntro(){if(introCue===null)return;introCue=null;surface.dataset.introHit='true';}
  function start(x,y,source='input',textArea=null){
    if(source!=='opening')releaseIntro();
    surface.dataset.waveSource=source;surface.dataset.waveCount=String(Number(surface.dataset.waveCount||0)+1);
    wave={x,y,start:performance.now(),reach:Math.max(Math.hypot(x,y),Math.hypot(width-x,y),Math.hypot(x,height-y),Math.hypot(width-x,height-y)),reduced:reduced.matches};
    if(source==='opening'&&textArea){
      const dx=Math.max(textArea.left-x,0,x-textArea.right),dy=Math.max(textArea.top-y,0,y-textArea.bottom);
      introCue=Math.hypot(dx,dy);
    }
    surface.dataset.waveOrigin=`${Math.round(x)},${Math.round(y)}`;schedule();
  }
  function strength(x,y,elapsed){
    const age=wave.reduced?elapsed:elapsed-Math.hypot(x-wave.x,y-wave.y)/wave.reach*sweep;
    if(age<=0||age>=tail)return 0;
    if(age<150){const t=age/150;return t*t*(3-2*t);}
    if(age<330)return 1;
    const t=(age-330)/(tail-330);return 1-t*t*(3-2*t);
  }
  function render(now){
    raf=0;ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(background,0,0);ctx.setTransform(scale,0,0,scale,0,0);
    surface.dataset.animating='false';
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
    for(const [a,b]of topology.edges){
      const A=points[a],B=points[b],steps=Math.max(1,Math.ceil(Math.hypot(B.x-A.x,B.y-A.y)/14));
      for(let j=0;j<steps;j++){
        const t=(j+.5)/steps,light=strength(A.x+(B.x-A.x)*t,A.y+(B.y-A.y)*t,elapsed);if(light<.001)continue;
        ctx.beginPath();ctx.moveTo(A.x+(B.x-A.x)*j/steps,A.y+(B.y-A.y)*j/steps);ctx.lineTo(A.x+(B.x-A.x)*(j+1)/steps,A.y+(B.y-A.y)*(j+1)/steps);
        ctx.lineWidth=2.2;ctx.strokeStyle=`rgba(77,16,108,${light*.09})`;ctx.stroke();
        ctx.lineWidth=.7;ctx.strokeStyle=`rgba(85,22,112,${light*.68})`;ctx.stroke();
      }
    }
    ctx.restore();surface.dataset.animating='true';schedule();
  }
  function position(e){const r=surface.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  on(surface,'click',e=>{e.preventDefault();if(performance.now()-lastTouch<500)return;const p=position(e);start(p.x,p.y);});
  on(surface,'pointerdown',e=>{if(e.pointerType==='mouse')return;down={...position(e),id:e.pointerId,time:performance.now(),moved:false};});
  on(surface,'pointermove',e=>{if(down&&e.pointerId===down.id){const p=position(e);if(Math.hypot(p.x-down.x,p.y-down.y)>14)down.moved=true;}});
  on(surface,'pointercancel',()=>{down=null;tap=null;});
  on(surface,'pointerup',e=>{
    if(e.pointerType==='mouse'||!down||down.id!==e.pointerId)return;
    const p=position(e),now=performance.now(),valid=!down.moved&&now-down.time<300&&Math.hypot(p.x-down.x,p.y-down.y)<14;down=null;lastTouch=now;
    if(!valid){tap=null;return;}
    tap=null;start(p.x,p.y);
  });
  function clear(){releaseIntro();wave=null;tap=null;down=null;schedule();}
  on(surface,'keydown',e=>{if(e.key==='Escape'){clear();return;}if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();start(width/2,height/2);}});
  on(reduced,'change',clear);
  on(document,'visibilitychange',()=>{if(document.hidden){releaseIntro();wave=null;cancelAnimationFrame(raf);raf=0;}else schedule();});
  on(canvas,'contextlost',()=>{cancelAnimationFrame(raf);raf=0;wave=null;canvas.style.visibility='hidden';});
  on(canvas,'contextrestored',()=>{canvas.style.visibility='visible';resize();});
  window.__startMeshWave=start;
  const observer=new ResizeObserver(resize);
  surface.dataset.renderer='canvas2d';observer.observe(surface);resize();start(width/2,height/2,'opening');
  return ()=>{events.abort();observer.disconnect();cancelAnimationFrame(raf);if(window.__startMeshWave===start)delete window.__startMeshWave;};
}
