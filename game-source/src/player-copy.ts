const numbers=new Intl.NumberFormat('en-IN');
export const formatPoints=(points:number)=>numbers.format(Math.max(0,Math.trunc(points)));
export const rewardMoney=(points:number)=>{const whole=Math.max(0,Math.trunc(points));return '₹'+numbers.format(Math.floor(whole/10))+(whole%10?'.'+whole%10:'')};
export const underAgeCopy="Thanks for playing. You need to be 18 or older to save scores and earn points, but you're welcome to keep playing as a guest.";
export function resultHeadline(points:number,previousBest:number|null=null){
 if(previousBest!==null&&previousBest>=0)return points>previousBest?'New best. Your points just went up.':`Your best is still ${formatPoints(previousBest)} pts (${rewardMoney(previousBest)}). Beat it to earn more.`;
 return points<10?'Not much to keep yet.':'Here’s what’s yours.';
}
export const leaveCopy=(points:number)=>({title:`Leaving ${rewardMoney(points)} on the table?`,support:`Your ${formatPoints(points)} points disappear when you leave. Saving takes 20 seconds.`});
export const exitCopy={label:'COMING SOON',title:"Your move, whenever you're ready.",support:"Your points weren't saved this time. Come back and play before we open. Your best score is the one that counts.",signoff:"SO/FACET. What's yours?"};
export function splitPlayerName(value:string){
 const parts=value.trim().replace(/\s+/g,' ').split(' '),last=parts.length>1?parts.pop()!:'';
 return{firstName:parts.join(' '),lastInitial:(last.match(/^\p{L}\p{M}*/u)?.[0]||'').toLocaleUpperCase()};
}
export const publicPlayerName=(firstName:string,lastInitial:string)=>firstName.trim().replace(/\s+/g,' ')+(lastInitial.trim()?' '+lastInitial.trim().toLocaleUpperCase().replace(/\.$/,'')+'.':'');
export const validPlayerName=(value:string,max=80)=>value.trim().length<=max&&/^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u.test(value.trim());
export const validPublicName=(value:string)=>validPlayerName(value,30);
export function birthDateState(value:string,today=new Date()):'invalid'|'underage'|'adult'{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return'invalid';
 const [year,month,day]=value.split('-').map(Number),born=new Date(year,month-1,day);
 if(year<1900||born.getFullYear()!==year||born.getMonth()!==month-1||born.getDate()!==day||born>today)return'invalid';
 const age=today.getFullYear()-year-(today.getMonth()<month-1||today.getMonth()===month-1&&today.getDate()<day?1:0);
 return age<18?'underage':'adult';
}
