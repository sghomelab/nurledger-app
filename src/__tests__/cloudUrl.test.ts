import { isSecureBackendUrl } from '../lib/cloud/url';

describe('isSecureBackendUrl', () => {
  it.each([
    'https://abcd.supabase.co', 'https://abcd.supabase.co/', ' https://abcd.supabase.co ',
    'http://localhost:54321', 'http://127.0.0.1:54321/', 'http://10.0.2.2:54321',
  ])('accepts %s', (u) => expect(isSecureBackendUrl(u)).toBe(true));
  it.each([
    '', 'abcd.supabase.co', 'http://abcd.supabase.co', 'ftp://abcd.supabase.co', 'https://',
    'https://user:pass@abcd.supabase.co', 'https://user@abcd.supabase.co',
    'http://localhost@evil.com', 'http://localhost.evil.com', 'http://127.0.0.1.evil.com',
    'http://10.0.2.2.evil.com', 'javascript:alert(1)',
  ])('rejects %s', (u) => expect(isSecureBackendUrl(u)).toBe(false));
});
