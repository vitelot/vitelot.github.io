// The setup code that travels after the # of the shared link: the address of
// the script and the group key. Neither is in the published files.

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Only a Google Apps Script address, or this computer while testing.
function isAllowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'https:' && u.hostname === 'script.google.com') return true;
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

export function encodeSetup({ url, key }) {
  return toBase64Url(JSON.stringify({ u: url, k: key }));
}

export function decodeSetup(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  let data;
  try { data = JSON.parse(fromBase64Url(code)); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (typeof data.u !== 'string' || typeof data.k !== 'string' || data.k === '') return null;
  if (!isAllowedUrl(data.u)) return null;
  return { url: data.u, key: data.k };
}
