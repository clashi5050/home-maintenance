// What the Azure platform puts in the X-MS-CLIENT-PRINCIPAL header: base64 of a JSON document.
export const principalHeader = ({ email = 'me@example.com', id = 'user-1', idp = 'google', extra = [] } = {}) => Buffer.from(JSON.stringify({
  auth_typ: idp,
  claims: [{ typ: 'sub', val: id }, ...(email ? [{ typ: 'email', val: email }] : []), ...extra],
})).toString('base64');
