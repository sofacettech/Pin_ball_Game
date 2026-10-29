// Server-only rewards OTP adapter. Keys and JWTs never reach the browser.
import { rewardsConfigured, requestRewardsOtp, verifyRewardsOtp } from './rewards.mjs';
export const otpProvider = { configured: rewardsConfigured, request: requestRewardsOtp, verify: verifyRewardsOtp };
