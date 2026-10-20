import {parsePhoneNumberFromString,getCountries,getCountryCallingCode} from 'libphonenumber-js/min';

const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
export const countries=getCountries().map(code=>({code,name:countryNames.of(code)||code,dial:'+'+getCountryCallingCode(code)})).sort((a,b)=>a.name.localeCompare(b.name));
export function normalisePhone(value,country='IN'){
 if(typeof value!=='string'||!/^[+\d\s().-]+$/.test(value.trim()))return null;
 try{const phone=parsePhoneNumberFromString(value,{defaultCountry:country||undefined,extract:false});return phone?.isPossible()&&phone.isValid()?phone.number:null}catch{return null}
}
export function phoneCountry(value,fallback='IN'){
 try{return parsePhoneNumberFromString(value)?.country||fallback}catch{return fallback}
}
export function maskedPhone(value){
 const phone=parsePhoneNumberFromString(value||'');
 return phone?'+'+phone.countryCallingCode+' ••••••'+phone.nationalNumber.slice(-4):'';
}
