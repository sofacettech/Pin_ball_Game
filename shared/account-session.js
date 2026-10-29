// Frontend preview only: no server authentication or reward credits are created.
import {normalisePhone} from '../membership-source/src/phone.js';
const key='sofacet-account-preview';
let memory=null;
export function accountNavigationHref(href,search=globalThis.location?.search||''){
 if(new URLSearchParams(search).get('nav')!=='game')return href;
 const [path,query='']=href.split('?'),params=new URLSearchParams(query);params.set('nav','game');return path+'?'+params;
}
export const accountHref=accountNavigationHref('/account.html');
export const accountSignInHref=accountNavigationHref('/account.html?view=signin');
export const membershipHref=accountNavigationHref('/membership.html?from=account');
export const previewCode='123456';
export function readPreviewAccount(){
 try{const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value?.preview===true&&typeof value.name==='string'&&typeof value.leaderboardName==='string'&&typeof value.email==='string'&&normalisePhone(value.phoneNumber)===value.phoneNumber&&typeof value.marketingConsent==='boolean'&&[value.savedPoints,value.bestPoints].every(points=>Number.isSafeInteger(points)&&points>=0))return value}catch{}
 return memory;
}
export function writePreviewAccount(value){memory={...value,preview:true};try{sessionStorage.setItem(key,JSON.stringify(memory))}catch{}return memory}
export function clearPreviewAccount(){memory=null;try{sessionStorage.removeItem(key)}catch{}}
export function createPreviewAccount(phoneNumber){return writePreviewAccount({name:'Player',leaderboardName:'Player',email:'',phoneNumber,marketingConsent:false,savedPoints:3200,bestPoints:3200,rank:14})}
