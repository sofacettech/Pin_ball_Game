// Pick once before loading media. effectiveType describes speed, not whether
// data is cellular; a fast "4g" estimate must not opt a phone into 4K.
export function selectEntranceVideoWidth({option='3',navigator=globalThis.navigator}={}){
  if(option!=='3')return 1920;
  const connection=navigator?.connection;
  if(connection?.saveData===true||connection?.type==='cellular'||['slow-2g','2g','3g'].includes(connection?.effectiveType))return 1920;
  if(connection?.type==='wifi'||connection?.type==='ethernet')return 3840;
  // Safari has no connection API. Its phone/tablet fallback must also protect
  // cellular visits, including iPads that advertise a desktop user agent.
  const agent=navigator?.userAgent||'';
  const mobile=navigator?.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod/i.test(agent)||
    /iPhone|iPad|iPod/i.test(navigator?.platform||'')||
    (navigator?.maxTouchPoints>0&&(navigator?.platform==='MacIntel'||/Macintosh/.test(agent)));
  return mobile?1920:3840;
}
