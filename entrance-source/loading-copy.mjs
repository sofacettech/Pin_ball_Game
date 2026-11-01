const lines=[
 'Growing the diamonds…',
 'Cutting the facets…',
 'Setting the light…',
 'Building the SO/ FACET world…',
 'Polishing the pinball table…',
 'Warming up the flippers…',
 'Opening the doors…',
 "SO/ FACET. What's yours?",
];
export function createLoadingCopy(paint,{setInterval:every=globalThis.setInterval,clearInterval:stop=globalThis.clearInterval}={}){
 let index=0,finished=false;
 paint(lines[index]);
 const timer=every(()=>{if(finished)return;index=(index+1)%lines.length;paint(lines[index])},1500);
 const cancel=()=>{stop(timer);finished=true};
 return {ready(){if(finished)return;cancel();paint(lines.at(-1))},cancel};
}
