const base=process.env.REWARDS_API_BASE||'https://backend-production-082b.up.railway.app';
export class ServiceError extends Error{constructor(status,message){super(message);this.status=status}}
const messages={invalid_phone:'Please use a valid Indian phone number (+91).',rate_limited:'Too many requests. Please wait a minute and try again.',rewards_not_configured:'Membership is temporarily unavailable. Please try again later.',invalid_token:'Your rewards session expired. Please try again.'};
async function call(path,{body,token}={}){
 const key=process.env.REWARDS_API_KEY;if(!key)throw new ServiceError(503,'Membership is not configured yet. Your game remains playable.');
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'x-rewards-key':key,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
   const data=await response.json().catch(()=>({}));
   if(response.ok)return data;
   if((response.status>=500||response.status===429)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,250*3**attempt));continue}
   throw new ServiceError(response.status===400?400:response.status===429?429:503,messages[data.error]||'SO FACET is temporarily unavailable. Please try again later.');
  }catch(error){if(error instanceof ServiceError)throw error;if(attempt===2)throw new ServiceError(503,'Unable to reach SO FACET. Please try again later.');await new Promise(resolve=>setTimeout(resolve,250*3**attempt))}
 }
}
export const authenticatePhone=phone=>call('/rewards/auth',{body:{phone}});
export const rewardsLeaderboard=()=>call('/rewards/leaderboard?limit=100');
// Only a trusted server/admin may call this. Browser scores never become redeemable points.
export async function awardPoints({phone,points,eventId}){
 if(!Number.isSafeInteger(points)||points<=0||typeof eventId!=='string'||!eventId.trim()||eventId.length>160)throw new ServiceError(400,'Positive integer points and a stable eventId are required.');
 const {token}=await authenticatePhone(phone);
 return call('/rewards/points',{token,body:{points,idempotency_key:'facet-pinball:'+eventId,reason:'pinball-verified-event',external_ref:eventId,metadata:{game:'facet-pinball'}}});
}
