// Transport/device identity is not a bandwidth test. Start with the preferred
// source, then measure its real preload before releasing the entrance loader.
export function entranceVideoPreference({option='3',navigator=globalThis.navigator}={}){
  if(option!=='3')return {width:1920,reason:'option'};
  const connection=navigator?.connection;
  if(connection?.saveData===true)return {width:1920,reason:'data-saver'};
  if(['slow-2g','2g','3g'].includes(connection?.effectiveType))return {width:1920,reason:'connection-slow'};
  return {width:3840,reason:'preferred'};
}

export function selectEntranceVideoWidth(options){
  return entranceVideoPreference(options).width;
}
