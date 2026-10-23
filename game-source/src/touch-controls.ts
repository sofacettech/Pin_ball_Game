export type PaddleSide='left'|'right';
export function selectPaddle(left:boolean,right:boolean,previous:PaddleSide|null):PaddleSide|null{
 return previous&&(previous==='left'?left:right)?previous:left?'left':right?'right':null;
}

export function connectTouchControls(canvas:HTMLElement,launch:HTMLButtonElement,enabled:(control:'paddle'|'launch')=>boolean,onLaunch:()=>void,onChange:(state:{left:boolean;right:boolean;space:boolean})=>void){
 const state={left:false,right:false,space:false};
 const held=new Map<number,{control:keyof typeof state;element:HTMLElement}>();
 const update=()=>{state.left=state.right=state.space=false;for(const touch of held.values())state[touch.control]=true;launch.setAttribute('aria-pressed',String(state.space));onChange(state)};
 const release=(event:PointerEvent)=>{if(held.delete(event.pointerId))update()};
 for(const element of [canvas,launch]){
  element.addEventListener('pointerdown',event=>{
   const e=event as PointerEvent,isLaunch=element===launch;
   if(!enabled(isLaunch?'launch':'paddle')||!isLaunch&&e.pointerType!=='touch'&&e.pointerType!=='pen'||held.has(e.pointerId))return;
   if(isLaunch&&e.button!==0)return;
   e.preventDefault();const bounds=canvas.getBoundingClientRect();
   const control=isLaunch?'space':e.clientX<bounds.left+bounds.width/2?'left':'right';
   held.set(e.pointerId,{control,element});element.setPointerCapture(e.pointerId);if(isLaunch)onLaunch();update();
  },{passive:false});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(name,event=>release(event as PointerEvent));
  element.addEventListener('contextmenu',event=>event.preventDefault());
 }
 // The launch button remains usable with a keyboard on touch-capable laptops.
 launch.addEventListener('keydown',event=>{if((event.code==='Space'||event.code==='Enter')&&enabled('launch')){event.preventDefault();if(!held.has(-1)){held.set(-1,{control:'space',element:launch});onLaunch();update()}}});
 launch.addEventListener('keyup',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();if(held.delete(-1))update()}});
 launch.addEventListener('blur',()=>{if(held.delete(-1))update()});
 return {state,clear(){const captured=[...held];held.clear();for(const [id,{element}] of captured)if(id>=0&&element.hasPointerCapture(id))element.releasePointerCapture(id);update()}};
}
