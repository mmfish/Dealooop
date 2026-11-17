// Internal test accounts that sign in with a fixed code instead of the site's normal sign-in,
// on any deployment: POST /api/auth/code with {"email", "code"} returns a session cookie. There
// is no page for it; it is for the team's own scripts and checks. Configured only through the
// environment (never in the repository):
//   DEALOOP_TEST_USERS="email:code:Display name, email2:code2:Name 2"
// Locally, .env.local (git-ignored) holds it. The code is compared in constant time.

import {timingSafeEqual} from 'node:crypto';

export interface TestUser { email: string; code: string; name: string }

export function testUsers(): TestUser[] {
  return (process.env.DEALOOP_TEST_USERS || '').split(',').map(x => x.trim()).filter(Boolean).flatMap(entry => {
    const [email, code, ...name] = entry.split(':');
    return email && code && code.length >= 8 ? [{email: email.trim().toLowerCase(), code: code.trim(), name: name.join(':').trim() || email.split('@')[0]}] : [];
  });
}

export const isTestUser = (email: string) => testUsers().some(u => u.email === email.trim().toLowerCase());

/** The test user if this email and code match one, else null. */
export function checkTestCode(email: string, code: string): TestUser | null {
  const u = testUsers().find(x => x.email === email.trim().toLowerCase());
  if (!u) return null;
  const a = Buffer.from(code.trim()), b = Buffer.from(u.code);
  return a.length === b.length && timingSafeEqual(a, b) ? u : null;
}
