export function validPhone(value, minimum = 7) {
  return /^[+\d ()-]+$/.test(value) && new RegExp('^\\d{' + minimum + ',15}$').test(value.replace(/\D/g, ''));
}

export function validateClaim(values) {
  if (!values.fullName?.trim()) return {field: 'fullName', message: 'Please enter your full name.'};
  if (!validPhone(values.mobile || '')) return {field: 'mobile', message: 'Please enter a valid mobile number.'};
  if (!/^\d{4,6}$/.test(values.otp || '')) return {field: 'otp', message: 'Please enter the 4–6 digit OTP.'};
  return null;
}

export function validateAccount(values) {
  if (!values.name?.trim()) return {field: 'name', message: 'Please enter your name.'};
  if (!validPhone(values.phone || '')) return {field: 'phone', message: 'Please enter a valid mobile number.'};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email || '')) return {field: 'email', message: 'Please enter a valid email address.'};
  if (!values.terms) return {field: 'terms', message: 'Please confirm the age declaration and terms.'};
  return null;
}
