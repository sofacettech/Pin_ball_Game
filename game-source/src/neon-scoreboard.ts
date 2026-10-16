const segmentPaths:Record<string,string>={
 a:'M12 2H58L67 11L58 20H12L3 11Z',b:'M61 6L69 14V49L61 57L54 49V22Z',
 c:'M61 55L69 63V98L61 106L54 98V67Z',d:'M12 92H58L67 101L58 110H12L3 101Z',
 e:'M9 55L16 63V98L9 106L1 98V63Z',f:'M9 6L16 14V49L9 57L1 49V14Z',
 g:'M12 51H58L65 56L58 62H12L5 56Z'
};
const digitSegments:Record<string,string>={0:'abcdef',1:'bc',2:'abged',3:'abgcd',4:'fgbc',5:'afgcd',6:'afgecd',7:'abc',8:'abcdefg',9:'abfgcd'};
const format=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});

// One SVG fits any score in the supplied artwork without shrinking individual digits unevenly.
export function scoreArtwork(value:number|null){
 const text=value===null?'—':format.format(Number.isFinite(value)?Math.max(0,Math.trunc(value)):0);
 let x=0;
 const paths=[...text].map(character=>{
  const d=character===','?['M7 88H22V101L10 112H1Z']:character==='—'?[segmentPaths.g]:[...digitSegments[character]].map(segment=>segmentPaths[segment]);
  const group=`<g transform="translate(${x} 0)">${d.map(path=>`<path d="${path}"/>`).join('')}</g>`;
  x+=(character===','?28:70)+8;return group;
 }).join('');
 return {text,svg:`<svg viewBox="0 0 ${x-8} 112" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`};
}

export function connectNeonScoreboard(score:HTMLOutputElement,best:HTMLOutputElement){
 let previousScore:number|undefined,previousBest:number|null|undefined;
 const paint=(output:HTMLOutputElement,value:number|null,label:string)=>{const art=scoreArtwork(value);output.innerHTML=art.svg;output.setAttribute('aria-label',`${label}: ${value===null?'No saved score available':art.text}`)};
 return (current:number,personalBest:number|null)=>{
  if(current!==previousScore){paint(score,current,'Score');previousScore=current}
  if(personalBest!==previousBest){paint(best,personalBest,'High score');previousBest=personalBest}
 };
}
