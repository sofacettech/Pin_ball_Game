// Server-only hooks. The backend engineer connects the SMS provider here.
// request({phone}) -> {challengeId:string, expiresIn:number}
// verify({phone, otp, challengeId}) -> {verified:boolean}
// Provider credentials and tokens must remain on the server.
export const otpProvider = { request: null, verify: null };
