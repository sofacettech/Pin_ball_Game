// iPadOS can report a desktop Safari user agent, even with a trackpad attached.
export const completeViewOnly=(userAgent:string,touchPoints:number,coarsePointer:boolean)=>coarsePointer||/Android|iPhone|iPad|iPod/i.test(userAgent)||/Macintosh/i.test(userAgent)&&touchPoints>1;

// Screen dimensions survive rotation and iPad split view; viewport width alone cannot identify a phone.
export const phoneDevice=(userAgent:string,touchPoints:number,coarsePointer:boolean,shortestScreenSide:number)=>/iPhone|iPod|Windows Phone/i.test(userAgent)||/Android/i.test(userAgent)&&/Mobile/i.test(userAgent)||(coarsePointer||touchPoints>0)&&shortestScreenSide>0&&shortestScreenSide<600;
