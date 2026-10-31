import {createFrameRateMeter,summarizeFrameUpdates} from './frame-rate-meter.js';

export function createFrameRatePanel({label,getState,compareURL,compareLabel,travel,firstFrame=240,minimumFPS=null}){
  const style=document.createElement('style');
  style.textContent=`
    .frame-rate-panel{position:fixed;right:20px;bottom:20px;z-index:10001;width:266px;padding:16px;border:1px solid #ffffff30;border-radius:14px;background:#0b0d18ed;box-shadow:0 8px 30px #0004;color:#f6f2ff;font:12px/1.5 system-ui,sans-serif;backdrop-filter:blur(12px)}
    .frame-rate-panel header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b3b1c0}
    .frame-rate-panel button,.frame-rate-toggle{cursor:pointer;font:inherit;color:inherit;background:transparent;border:1px solid #ffffff30;border-radius:6px;padding:6px 9px}
    .frame-rate-panel header button{border:0;padding:0 3px;font-size:18px;line-height:1}
    .frame-rate-panel strong{font-size:32px;line-height:1.2;color:#d3ff65;font-variant-numeric:tabular-nums}
    .frame-rate-value{margin:9px 0 1px}.frame-rate-state{color:#b3b1c0}.frame-rate-details{white-space:pre-line;margin:10px 0;font-variant-numeric:tabular-nums}
    .frame-rate-panel small{display:block;color:#aaa7bc;font-size:10px;line-height:1.4;margin:9px 0}
    .frame-rate-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.frame-rate-panel a{color:#e2deee;text-underline-offset:3px}.frame-rate-panel button:disabled{opacity:.4;cursor:default}
    .frame-rate-result{white-space:pre-line;border-top:1px solid #ffffff25;margin:12px 0 0;padding-top:10px;color:#d3ff65;font-variant-numeric:tabular-nums}
    .frame-rate-toggle{position:fixed;right:20px;bottom:20px;z-index:10001;background:#0b0d18e8;color:#d3ff65;padding:8px 12px}
    .frame-rate-panel :is(a,button):focus-visible,.frame-rate-toggle:focus-visible{outline:2px solid #d3ff65;outline-offset:3px}
    @media(max-width:600px){.frame-rate-panel{bottom:78px;right:12px;width:244px;padding:12px}.frame-rate-toggle{bottom:78px;right:12px}}
  `;
  document.head.append(style);
  const panel=document.createElement('aside');panel.className='frame-rate-panel';panel.setAttribute('aria-label',label+' frame rate');
  panel.innerHTML='<header><span></span><button type="button" aria-label="Hide frame-rate display">×</button></header><div class="frame-rate-value"><strong>—</strong> FPS</div><div class="frame-rate-state">Scroll to measure</div><div class="frame-rate-details"></div><small>New scene updates while moving. 60 FPS ≈ 16.7 ms; 30 FPS ≈ 33.3 ms. Source FPS and display refresh are separate.</small><div class="frame-rate-actions"><button type="button" class="frame-rate-measure">Run 10s check</button><a target="_blank" rel="noopener"></a></div><p class="frame-rate-result" hidden></p>';
  panel.querySelector('header span').textContent=label;
  const link=panel.querySelector('a');link.href=compareURL;link.textContent=compareLabel;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='frame-rate-toggle';toggle.textContent='Show FPS';toggle.hidden=true;
  const value=panel.querySelector('strong'),status=panel.querySelector('.frame-rate-state'),details=panel.querySelector('.frame-rate-details'),result=panel.querySelector('.frame-rate-result'),button=panel.querySelector('.frame-rate-measure');
  document.body.append(panel,toggle);
  const meter=createFrameRateMeter(),events=new AbortController();
  let lastScroll=-Infinity,collapsed=false,run=null,lastResult=null;
  const updateVisibility=()=>{const hidden=!!getState().game;panel.hidden=hidden||collapsed;toggle.hidden=hidden||!collapsed;};
  panel.querySelector('header button').onclick=()=>{collapsed=true;updateVisibility();};
  toggle.onclick=()=>{collapsed=false;updateVisibility();};
  function active(now,state){return !document.hidden&&state.ready&&!state.game&&(!!run||state.seeking||now-lastScroll<180);}
  function record(now=performance.now()){
    const state=getState();meter.setActive(active(now,state),now);
    if(meter.record(state.frame,now)&&run?.started!==null&&run?.started!==undefined)run.times.push(now);
  }
  function paint(){
    const now=performance.now(),state=getState();meter.setActive(active(now,state),now);
    const m=meter.read(now);value.textContent=m.fps===null?'—':m.fps.toFixed(1);
    status.textContent=!state.ready?'Preparing…':run?'Measuring scroll…':m.active?(m.collecting?'Collecting frames…':m.gapMs>150?'Waiting for a new frame':'Live · last 1 second'):'Idle · last movement';
    details.textContent=[m.p95===null?'Scroll to measure frame timing':`p95 update interval ${m.p95.toFixed(1)} ms`,state.details].filter(Boolean).join('\n');
    button.disabled=!state.ready||!!state.game;
    button.textContent=run?'Stop check':'Run 10s check';updateVisibility();
  }
  function finish(cancelled=false){
    if(!run)return;
    const current=run;run=null;cancelAnimationFrame(current.raf);
    if(!cancelled&&current.started!==null){
      const state=getState();lastResult={label,...summarizeFrameUpdates(current.times,current.started,performance.now()),sourceFrame:state.frame,details:state.details,viewport:[innerWidth,innerHeight],timestamp:new Date().toISOString()};
      result.textContent=`10s check · ${lastResult.fps.toFixed(1)} FPS average\nSlowest 1s · ${lastResult.minWindowFps??'—'} FPS\np95 ${lastResult.p95Ms?.toFixed(1)??'—'} ms · ${lastResult.updates} updates\nReached source frame ${Math.round(state.frame)}`;result.hidden=false;
      if(minimumFPS!==null){
        lastResult.passesMinimum=lastResult.minWindowFps!==null&&lastResult.minWindowFps>=minimumFPS;
        result.textContent+=`\n${minimumFPS} FPS floor ${lastResult.passesMinimum?'met in this check':'not met'}`;
        result.style.color=lastResult.passesMinimum?'#d3ff65':'#ffbc9f';
      }
      window.frameRateChecks??=[];window.frameRateChecks.push(lastResult);
      window.scrollTo(0,current.originalY);
    }
    meter.setActive(false,performance.now());paint();
  }
  function measure(){
    if(run){finish(true);return;}
    const state=getState();if(!state.ready||state.game)return;
    run={originalY:scrollY,started:null,times:[],raf:0,preparing:performance.now()};window.scrollTo(0,0);
    function step(now){
      if(!run)return;
      if(document.hidden){finish(true);return;}
      // Let the existing renderer/decoder return to its start before measuring.
      if(run.started===null){
        if(getState().frame>firstFrame+1&&now-run.preparing<5000){run.raf=requestAnimationFrame(step);return;}
        run.started=now;meter.setActive(false,now);meter.setActive(true,now);
      }
      const progress=Math.min(1,(now-run.started)/10000);
      window.scrollTo(0,travel*progress*.998);
      if(progress===1){finish();return;}
      run.raf=requestAnimationFrame(step);
    }
    run.raf=requestAnimationFrame(step);paint();
  }
  button.onclick=measure;
  window.addEventListener('scroll',()=>{lastScroll=performance.now();},{passive:true,signal:events.signal});
  for(const name of ['wheel','touchstart','keydown'])window.addEventListener(name,()=>{if(run)finish(true);},{passive:true,signal:events.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){finish(true);meter.setActive(false,performance.now());}},{signal:events.signal});
  const timer=setInterval(paint,200);paint();
  return {record,paint,get measuring(){return !!run;},get result(){return lastResult;},destroy(){finish(true);clearInterval(timer);events.abort();panel.remove();toggle.remove();style.remove();}};
}
