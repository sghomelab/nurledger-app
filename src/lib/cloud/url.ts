/**
 * Backend URL policy (wizard). Credentials and the service key must never
 * travel over cleartext, and the host must be exactly what the owner typed:
 * no userinfo (`https://user:pass@host`, `http://localhost@evil.com`), no
 * lookalike hosts (`localhost.evil.com`). http:// is allowed only for local
 * development hosts (and the Android emulator's host alias).
 */
export function isSecureBackendUrl(raw: string): boolean {
  const u = raw.trim();
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return url.hostname.length > 0;
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '10.0.2.2';
  }
  return false;
}
