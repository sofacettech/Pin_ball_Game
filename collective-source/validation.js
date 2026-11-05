export function validPhone(value, minimum = 7) {
  return /^[+\d ()-]+$/.test(value) && new RegExp('^\\d{' + minimum + ',15}$').test(value.replace(/\D/g, ''));
}

export function validateClaim(values) {
  if (!values.fullName?.trim()) return {field: 'fullName', message: 'Please enter your full name.'};
  if (!validPhone(values.mobile || '')) return {field: 'mobile', message: 'Please enter a valid mobile number.'};
  if (!/^\d{4,6}$/.test(values.otp || '')) return {field: 'otp', message: 'Please enter the 4–6 digit OTP.'};
  return null;
}

export function validateAccount(values, today = new Date()) {
  if (!values.title) return {field: 'title', message: 'Please select a title.'};
  if (!values.name?.trim()) return {field: 'name', message: 'Please enter your name.'};
  const year = Number(values.year), month = Number(values.month), day = Number(values.day);
  const birthday = new Date(year, month - 1, day);
  if (!year || !month || !day || birthday.getFullYear() !== year || birthday.getMonth() !== month - 1 || birthday.getDate() !== day) {
    return {field: 'day', message: 'Please enter a valid date of birth.'};
  }
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age--;
  if (age < 18) return {field: 'year', message: 'You must be at least 18 to create an account.'};
  if (!values.city?.trim()) return {field: 'city', message: 'Please enter your city.'};
  if (!validPhone(values.phone || '')) return {field: 'phone', message: 'Please enter a valid mobile number.'};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email || '')) return {field: 'email', message: 'Please enter a valid email address.'};
  if (!values.terms) return {field: 'terms', message: 'Please confirm the age declaration and terms.'};
  return null;
}
