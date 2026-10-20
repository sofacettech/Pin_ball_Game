const clips={
 start:{file:'sofacet-game-start.mp3',gain:.28},music:{file:'sofacet-game-music.mp3',gain:.075},
 bumper:{file:'sofacet-bumper-hit.mp3',gain:.2,cooldown:.055},
 launch:{file:'sofacet-ball-launch.mp3',gain:.25},teleport:{file:'sofacet-cave-transport.mp3',gain:.24},
 flap:{file:'sofacet-paddle-hit.wav',gain:.18},
 rebound:{file:'sofacet-rebound.mp3',gain:.2,offset:.08,duration:.3,cooldown:.1},
 collect:{file:'sofacet-target-collect.mp3',gain:.25,duration:.9},
} as const;
export type GameSound=keyof typeof clips;

export function createGameSound(){
 let context:AudioContext|undefined,master:GainNode|undefined,loading:Promise<void>|undefined;
 let volume=100,muted=false,musicWanted=false,musicStartAt=0;
 let music:{source:AudioBufferSourceNode;gain:GainNode}|undefined;
 const buffers=new Map<GameSound,AudioBuffer>(),lastPlayed=new Map<GameSound,number>();
 const setup=()=>{if(!context){context=new AudioContext();master=context.createGain();master.gain.value=volume/100;master.connect(context.destination)}};
 const applyVolume=()=>{if(context&&master){const now=context.currentTime;master.gain.cancelScheduledValues(now);master.gain.setTargetAtTime(muted?0:volume/100,now,.015)}};
 const startMusic=()=>{
  if(!musicWanted||music||!context||!master)return;
  const buffer=buffers.get('music');if(!buffer)return;
  const source=context.createBufferSource(),gain=context.createGain(),at=Math.max(context.currentTime,musicStartAt);
  source.buffer=buffer;source.loop=true;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(clips.music.gain,at+.25);
  source.connect(gain).connect(master);source.start(at);music={source,gain};
  source.onended=()=>{source.disconnect();gain.disconnect();if(music?.source===source)music=undefined};
 };
 const load=()=>{
  if(!loading){setup();loading=Promise.all((Object.entries(clips) as [GameSound,(typeof clips)[GameSound]][]).map(async([name,clip])=>{
   try{const response=await fetch('/sounds/'+clip.file);if(!response.ok)throw new Error(String(response.status));buffers.set(name,await context!.decodeAudioData(await response.arrayBuffer()));if(name==='music')startMusic()}
   catch(error){console.warn('Could not load game sound',name,error)}
  })).then(()=>{});}
  return loading;
 };
 const unlock=()=>{setup();void load();return context!.resume().then(startMusic).catch(()=>{})};
 const play=(name:Exclude<GameSound,'music'>,pan=0)=>{
  if(muted||volume===0)return;
  const buffer=buffers.get(name);if(!buffer){void load().then(()=>{if(buffers.has(name))play(name,pan)});return}
  if(!context||!master||context.state!=='running')return;
  const clip=clips[name],now=context.currentTime,previous=lastPlayed.get(name)??-Infinity;
  if('cooldown' in clip&&now-previous<clip.cooldown)return;
  lastPlayed.set(name,now);
  const source=context.createBufferSource(),gain=context.createGain(),panner=context.createStereoPanner();
  const offset='offset' in clip?clip.offset:0;
  const duration='duration' in clip?Math.min(clip.duration,buffer.duration-offset):buffer.duration-offset;
  if(duration<=0)return;
  source.buffer=buffer;panner.pan.value=Math.max(-1,Math.min(1,pan));gain.gain.value=clip.gain;
  if('duration' in clip){gain.gain.setValueAtTime(clip.gain,now+Math.max(0,duration-.025));gain.gain.linearRampToValueAtTime(0,now+duration)}
  source.connect(gain).connect(panner).connect(master);source.start(now,offset,duration);
  source.onended=()=>{source.disconnect();gain.disconnect();panner.disconnect()};
 };
 return {
  get volume(){return volume},get muted(){return muted},load,unlock,play,
  setVolume(value:number){volume=Number.isFinite(value)?Math.min(100,Math.max(0,value)):0;applyVolume()},
  setMuted(value:boolean){muted=value;applyVolume();if(!muted)unlock()},
  setMusic(active:boolean,delay=0){
   if(musicWanted===active)return;musicWanted=active;
   if(active){setup();musicStartAt=context!.currentTime+delay;void load().then(startMusic);return}
   if(music&&context){const {source,gain}=music,now=context.currentTime;music=undefined;gain.gain.cancelScheduledValues(now);gain.gain.setValueAtTime(gain.gain.value,now);gain.gain.linearRampToValueAtTime(0,now+.12);source.stop(now+.13)}
  },
 };
}
