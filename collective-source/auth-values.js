import {normalisePhone} from '../membership-source/src/phone.js';
import {validPlayerName,splitPlayerName,publicPlayerName} from '../game-source/src/player-copy.ts';
import {validateAccount} from './validation.js';

const countries={'+91':'IN','+1':'US','+44':'GB','+971':'AE'};
export function normaliseDesignPhone(phone,dialCode='+91') {return normalisePhone(phone,countries[dialCode] || 'IN');}
export function registrationDetails(values) {
  const error=validateAccount(values);
  if(error)throw new Error(error.message);
  if(!validPlayerName(values.name))throw new Error('Please use letters for your name.');
  const phoneNumber=normaliseDesignPhone(values.phone,values.country);
  if(!phoneNumber)throw new Error('Please enter a valid mobile number.');
  const {firstName,lastInitial}=splitPlayerName(values.name);
  return {name:values.name.trim(),email:values.email.trim(),leaderboardName:publicPlayerName(firstName,lastInitial).slice(0,30),termsAccepted:values.terms===true || values.terms==='on',marketingConsent:values.updates===true || values.updates==='on',phoneNumber};
}
export function registrationPayload(details,verificationToken,gameId) {
  return {name:details.name,email:details.email,leaderboardName:details.leaderboardName,termsAccepted:details.termsAccepted,marketingConsent:details.marketingConsent,phoneNumber:details.phoneNumber,verificationToken,...(gameId?{gameId}:{})};
}
