export const GAME_TONE_GAIN=.06*1.5;

export function createGameSound(createContext=()=>new AudioContext()){
 let context:AudioContext|undefined,master:GainNode|undefined,volume=100,muted=false;
 const applyVolume=()=>{if(context&&master){const now=context.currentTime;master.gain.cancelScheduledValues(now);master.gain.setTargetAtTime(muted?0:volume/100,now,.015)}};
 const unlock=()=>{
  if(muted||volume===0)return;
  if(!context){context=createContext();master=context.createGain();master.gain.value=volume/100;master.connect(context.destination)}
  void context.resume().catch(()=>{});
 };
 return {
  get volume(){return volume},get muted(){return muted},unlock,
  setVolume(value:number){volume=Number.isFinite(value)?Math.min(100,Math.max(0,value)):0;applyVolume()},
  setMuted(value:boolean){muted=value;applyVolume();if(!muted)unlock()},
  play(frequency:number){
   if(muted||volume===0||!context||!master||context.state!=='running')return;
   const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
   oscillator.frequency.value=frequency;gain.gain.setValueAtTime(GAME_TONE_GAIN,now);gain.gain.exponentialRampToValueAtTime(.001,now+.1);
   oscillator.connect(gain).connect(master);oscillator.start();oscillator.stop(now+.11);
   oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
  }
 };
}
