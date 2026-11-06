export default function initialize(scope) {
const {document,window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,addEventListener,matchMedia,ResizeObserver,IntersectionObserver,MutationObserver} = scope;

(() => {
  const frame=document.querySelector('.mesh-layer');
  function waveAt(x,y,kind='input'){
    const rect=frame.getBoundingClientRect();
    frame.contentWindow?.__startMeshWave?.(x-rect.left,y-rect.top,kind);
  }
  // Form controls keep their normal click behavior; blank page areas reveal the mesh.
  document.addEventListener('click',event=>{
    if(event.target.closest('button,a,input,select,textarea,label,dialog,[role="tab"]'))return;
    waveAt(event.clientX,event.clientY);
  });
  async function revealOpeningWave(){
    for(let tries=0;tries<180;tries++){
      const start=frame.contentWindow?.__startMeshWave;
      if(start){
        await new Promise(requestAnimationFrame);
        const butterfly=document.querySelector('.butterfly-scene').getBoundingClientRect();
        const mesh=frame.getBoundingClientRect();
        start(butterfly.left+butterfly.width*.39-mesh.left,
              butterfly.top+butterfly.height*.27-mesh.top,'opening');
        return;
      }
      await new Promise(requestAnimationFrame);
    }
  }
  revealOpeningWave();
})();

}
