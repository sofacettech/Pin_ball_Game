(() => {
 'use strict';
 if(window.sofacetGameLoader)return;
 const root=document.getElementById('game-loading-screen');
 if(!root)return;
 const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const status=root.querySelector('[role="status"]'),error=root.querySelector('.game-loading-error');
 const gamePage=document.body.hasAttribute('data-game-loading');
 let story=gamePage&&new URLSearchParams(location.search).get('from')==='chess';
 const statement=root.querySelector('.loading-statement'),phrase=root.querySelector('.loading-phrase');
 const messages=['Next: a game of pinball.','Score points. Save them for SO/ FACET diamond jewellery.'];
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let width=1,height=1,radius=9,x=0,y=0,vx=0,vy=0,time=0,last=0,frame=0,fade=0,delay=0;
 let active=false,failed=false,parentVisible=parent===window,events,observer;
 let points=[],impacts=[],blocked=[];
 let textAnimation,statementIndex=0,textRun=0,storyDone=true,readyPending=false;
 const stop=()=>{cancelAnimationFrame(frame);frame=0;last=0;textAnimation?.pause()};
 function cleanup(){stop();textAnimation?.cancel();textAnimation=null;textRun++;events?.abort();observer?.disconnect();events=observer=null;clearTimeout(delay)}
 function renderStatement(){
  statement.dataset.statement=String(statementIndex);
  const classes={'10':'loading-value','₹1':'loading-value','SO/ FACET':'brand-word',Pink:'loading-pink','neon-green':'loading-green',Cyan:'loading-cyan'};
  phrase.replaceChildren(...messages[statementIndex].split(/(10|₹1|SO\/ FACET|Pink|neon-green|Cyan)/).map(part=>{
   if(!classes[part])return document.createTextNode(part);
   const value=document.createElement('span');value.className=classes[part];value.textContent=part;return value;
  }));
 }
 function animateStatement(){
  if(!active||failed||storyDone||motion.matches)return;
  renderStatement();
  const final=statementIndex===messages.length-1,duration=final?3500:4300;
  // Replace the copy only after fade-out; the final line waits visibly for readiness.
  const frames=[{opacity:0,transform:'translateY(10px)',offset:0},{opacity:1,transform:'translateY(0)',offset:900/duration},{opacity:1,transform:'translateY(0)',offset:3500/duration}];
  if(!final)frames.push({opacity:0,transform:'translateY(-10px)',offset:1});
  textAnimation=phrase.animate(frames,{duration,easing:'cubic-bezier(.65,0,.35,1)',fill:'both'});
  textAnimation.onfinish=()=>{
   if(!active||failed)return;
   if(final){storyDone=true;if(readyPending)finishReady()}
   else{textAnimation.cancel();statementIndex++;animateStatement()}
  };
  if(document.hidden||!parentVisible)textAnimation.pause();
 }
 function measure(){
  const anchors=gamePage?document.querySelectorAll('.navbar-backdrop,.nav-trim,#game-header .site-brand,#nav-toggle'):document.querySelectorAll('.site-brand,[data-menu-toggle]');
  let top=0;
  for(const element of anchors){const box=element.getBoundingClientRect();if(box.width&&box.height&&getComputedStyle(element).visibility!=='hidden')top=Math.max(top,box.bottom)}
  root.style.setProperty('--game-loader-top',Math.ceil(top+4)+'px');
  const box=root.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height);
  if(w===width&&h===height&&canvas.width===Math.round(w*Math.min(devicePixelRatio||1,2)))return;
  const oldWidth=width,oldHeight=height;width=w;height=h;
  radius=Math.min(12,Math.max(8,width*.007),width/4,height/4);
  x=oldWidth>1?x/oldWidth*width:width*.62;y=oldHeight>1?y/oldHeight*height:height*.60;
  x=Math.max(radius,Math.min(width-radius,x));y=Math.max(radius,Math.min(height-radius,y));
  const speed=Math.min(800,Math.max(280,Math.hypot(width,height)*.55));
  vx=(vx<0?-1:1)*speed*.8;vy=(vy<0?-1:1)*speed*.6;
  const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx?.setTransform(dpr,0,0,dpr,0,0);
  points=[];impacts=[];last=0;draw();
 }
 function draw(){
  if(!ctx||document.hidden||!parentVisible)return;
  ctx.fillStyle='#08060c';ctx.fillRect(0,0,width,height);
  if(!motion.matches){
   for(const impact of impacts){
    const age=(time-impact.t)/.42;if(age>=1)continue;
    const side=impact.edge==='left'||impact.edge==='right',length=46*(1+age*.35),thickness=11;
    ctx.save();ctx.translate(impact.x,impact.y);ctx.scale(side?thickness:length,side?length:thickness);
    const gradient=ctx.createRadialGradient(0,0,0,0,0,1);gradient.addColorStop(0,`rgba(191,255,0,${.85*(1-age)**2})`);gradient.addColorStop(.25,`rgba(191,255,0,${.45*(1-age)**2})`);gradient.addColorStop(1,'rgba(191,255,0,0)');
    ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
   }
   ctx.lineWidth=width<600?1.8:1.4;ctx.lineCap='butt';ctx.lineJoin='round';
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],alpha=Math.max(0,1-(time-b.t)/2)**1.6;
    ctx.strokeStyle=`rgba(255,255,255,${alpha*.8})`;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
   }
  }
  ctx.shadowBlur=18;ctx.shadowColor='rgba(255,255,255,.6)';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  canvas.style.background='none';
 }
 function advance(dt){
  let remaining=dt;
  while(remaining>1e-8){
   const tx=vx>0?(width-radius-x)/vx:(radius-x)/vx,ty=vy>0?(height-radius-y)/vy:(radius-y)/vy;
   const step=Math.min(remaining,Math.max(0,tx),Math.max(0,ty));
   x+=vx*step;y+=vy*step;time+=step;remaining-=step;
   const hitX=tx<=step+1e-8,hitY=ty<=step+1e-8;
   points.push({x,y,t:time});
   if(hitX){impacts.push({edge:vx>0?'right':'left',x:vx>0?width:0,y,t:time});vx=-vx}
   if(hitY){impacts.push({edge:vy>0?'bottom':'top',x,y:vy>0?height:0,t:time});vy=-vy}
   if(!hitX&&!hitY)break;
  }
  points=points.filter(p=>time-p.t<=2).slice(-240);impacts=impacts.filter(p=>time-p.t<.42).slice(-8);
 }
 function tick(now){frame=0;if(!active||failed||document.hidden||!parentVisible||motion.matches)return;advance(last?Math.min((now-last)/1000,.05):0);last=now;draw();frame=requestAnimationFrame(tick)}
 function resume(){stop();if(active&&!failed&&!root.hidden){measure();draw();if(!document.hidden&&parentVisible){if(!storyDone)textAnimation?.play();if(!motion.matches)frame=requestAnimationFrame(tick)}}}
 function listen(){
  events=new AbortController();const signal=events.signal;
  addEventListener('resize',resume,{signal});visualViewport?.addEventListener('resize',resume,{signal});
  document.addEventListener('visibilitychange',()=>document.hidden?stop():resume(),{signal});
  motion.addEventListener('change',()=>{
   points=[];impacts=[];
   if(story&&motion.matches){textAnimation?.cancel();textAnimation=null;textRun++;storyDone=true;renderStatement();phrase.style.opacity='1';phrase.style.transform='none';if(readyPending){finishReady();return}}
   resume();
  },{signal});
  observer=new ResizeObserver(()=>{measure();if(motion.matches)draw()});
  for(const element of document.querySelectorAll('#game-header,.navbar-backdrop,.site-brand,[data-menu-toggle]'))observer.observe(element);
 }
 function show(options={}){
  if(active&&!failed)return;
  // A parent entrance can own the same story while its game iframe loads.
  story=options.story??story;
  clearTimeout(fade);cleanup();active=true;failed=false;root.hidden=false;delete root.dataset.state;error.hidden=true;
  statementIndex=0;storyDone=!story||motion.matches;readyPending=false;statement.hidden=!story;
  if(story){
   root.dataset.story='';phrase.style.opacity=motion.matches?'1':'0';phrase.style.transform='none';renderStatement();
   const run=textRun;
   Promise.all(['Acumin','SOFacetWordmark'].map(font=>document.fonts.load('400 16px '+font))).catch(()=>{}).then(()=>{if(run===textRun&&active&&!failed)animateStatement()});
  }
  status.firstChild.textContent='Polishing your table… ';
  blocked=[...document.querySelectorAll('#stage')].map(element=>[element,element.inert]);for(const [element] of blocked)element.inert=true;
  listen();measure();draw();resume();
  delay=setTimeout(()=>{if(active&&!failed)status.firstChild.textContent='Still preparing your game. Please wait. '},20000);
 }
 function hide(){clearTimeout(fade);cleanup();root.hidden=true;active=false;delete root.dataset.state;for(const [element,inert] of blocked)element.inert=inert;blocked=[];const stage=document.getElementById('stage');if(gamePage&&stage?.dataset.ready==='true'){stage.inert=false;document.body.removeAttribute('data-game-loading')}}
 function ready(){
  if(failed)return;
  readyPending=true;
  if(story&&!storyDone&&!motion.matches)return;
  finishReady();
 }
 function finishReady(){
  if(story){phrase.style.opacity='1';phrase.style.transform='none'}
  cleanup();active=false;const stage=document.getElementById('stage');if(stage){stage.inert=false;stage.dataset.ready='true';stage.setAttribute('aria-busy','false')}
  blocked=[];root.dataset.state='leaving';
  root.dispatchEvent(new CustomEvent('sofacet:game-loader-ready'));
  fade=setTimeout(()=>{root.hidden=true;document.body.removeAttribute('data-game-loading')},motion.matches?0:story?800:200);
 }
 function fail(reason,phase='module'){
  if(failed)return;
  const message=String(reason?.message||reason||'Unknown startup failure');
  const code=/memory|allocation|array buffer|out of bounds/i.test(message)?'memory':/webgl|context lost|gpu/i.test(message)?'graphics':/wasm|webassembly|unreachable/i.test(message)?'wasm':/fetch|network|load|asset|http/i.test(message)?'asset':'runtime';
  console.error('[SOFACET game startup]',phase,code,reason);
  root.dataset.errorCode=code;root.dataset.errorPhase=phase;
  // Send only bounded categories to our own logs: no player, URL, or error text.
  if(gamePage)try{void fetch('/api/game-load-failure',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true,
   body:JSON.stringify({phase,code,embedded:parent!==window})}).catch(()=>{})}catch{}
  if(root.hidden)show();failed=true;cleanup();active=false;statement.hidden=true;error.hidden=false;root.dataset.state='error';document.getElementById('stage')?.setAttribute('aria-busy','false');
 }
 const style=document.getElementById('game-entry-style');
 const stylesReady=style?.dataset.failed?Promise.reject(Error('Game styles unavailable')):!style||style.sheet?Promise.resolve():new Promise((resolve,reject)=>{style.addEventListener('load',resolve,{once:true});style.addEventListener('error',()=>reject(Error('Game styles unavailable')),{once:true})});
 stylesReady.catch(error=>fail(error,'styles'));
 window.sofacetGameLoader={show,ready,fail,cancel:hide,stylesReady,isActive:()=>parentVisible,setActive(value){parentVisible=value;value?resume():stop()}};
 root.querySelector('[data-game-retry]').onclick=()=>location.reload();
 document.addEventListener('click',event=>{
  if(root.hasAttribute('data-managed'))return;
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
  const link=event.target.closest?.('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!=='/play.html')return;
  show();setTimeout(()=>{if(event.defaultPrevented)hide()},0);
 },true);
 addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='sofacet:experience-visibility'&&typeof event.data.visible==='boolean')window.sofacetGameLoader.setActive(event.data.visible)});
 addEventListener('pagehide',()=>{cleanup();clearTimeout(fade)});
 addEventListener('pageshow',event=>{if(event.persisted){if(gamePage&&failed){root.hidden=false;return}if(gamePage&&document.getElementById('stage')?.dataset.ready!=='true'){active=false;show()}else hide()}});
 if(gamePage){
  show();
  const entry=document.getElementById('game-loader-controller').dataset.gameEntry;
  // Paint the shell before evaluating the large game module. Hidden preloads
  // use tasks because requestAnimationFrame is suspended in hidden documents.
  const load=()=>import(new URL(entry,location.href).href).catch(fail);
  if(entry){if(document.hidden||!parentVisible)setTimeout(load,0);else requestAnimationFrame(()=>setTimeout(load,0))}
 }
})();
