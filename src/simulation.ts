import type {Input} from './physics.ts';
export const REPLAY_VERSION=1;
export const MAX_GAME_TICKS=120*60*30;
export const MAX_INPUT_RUNS=120000;
export type InputRun=[number,number];
export function seededRandom(seed:number){let state=seed>>>0;return ()=>{state=(state+0x6d2b79f5)>>>0;let value=Math.imul(state^(state>>>15),state|1);value^=value+Math.imul(value^(value>>>7),value|61);return ((value^(value>>>14))>>>0)/4294967296}}
export const packInput=(input:Input)=>(input.left?1:0)|(input.right?2:0)|(input.space?4:0)|(input.holdCharge?8:0);
export const unpackInput=(bits:number):Input=>({left:!!(bits&1),right:!!(bits&2),space:!!(bits&4),holdCharge:!!(bits&8)});
