export function validateCorporateEmail(email: string): boolean {
  const corporateDomain = '@corp.messenger.com';
  return (
    typeof email === 'string' &&
    email.endsWith(corporateDomain) &&
    email.length > corporateDomain.length
  );
}

export function validatePassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8;
}
