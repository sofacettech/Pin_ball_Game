const format=new Intl.NumberFormat('en-IN',{maximumFractionDigits:0});

export function connectFlipScorecard(button:HTMLButtonElement,score:HTMLElement,best:HTMLElement){
 const front=button.querySelector<HTMLElement>('.front')!,back=button.querySelector<HTMLElement>('.back')!;
 let previousScore:number|undefined,previousBest:number|null|undefined,phone=false,visible:boolean|undefined;
 function showScore(show:boolean){
  if(visible===show)return;visible=show;
  button.classList.toggle('flipped',show);
  if(phone)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',String(show));
  button.setAttribute('aria-label',phone?(show?'Your score':'Launch the ball'):(show?'Show instructions':'Show scoreboard'));
  button.setAttribute('aria-describedby',`${phone&&!show?'touch-launch':show?back.id:front.id}${phone?'':' flip-hint'}`);
  button.setAttribute('aria-hidden',String(phone&&!show));
  front.setAttribute('aria-hidden',String(phone||show));back.setAttribute('aria-hidden',String(!show));
  front.inert=phone||show;back.inert=!show;
 }
 button.addEventListener('click',()=>{if(!phone)showScore(!button.classList.contains('flipped'))});
 showScore(false);
 return {showScore,setPhoneStage(mobile:boolean){
  if(phone===mobile)return;
  phone=mobile;visible=undefined;button.tabIndex=phone?-1:0;
  button.setAttribute('role',phone?'group':'button');
  showScore(button.classList.contains('flipped'));
 },update(current:number,personalBest:number|null){
  if(current===previousScore&&personalBest===previousBest)return;
  score.textContent=format.format(Math.max(0,Number.isFinite(current)?current:0));
  best.textContent=personalBest===null?'—':format.format(Math.max(0,Number.isFinite(personalBest)?personalBest:0));
  best.setAttribute('aria-label',personalBest===null?'No saved score available':`Highest score: ${best.textContent}`);
  const characters=Math.max(score.textContent.length,best.textContent.length);
  button.style.setProperty('--score-size',Math.min(76,420/characters)+'px');
  previousScore=current;previousBest=personalBest;
 }};
}
