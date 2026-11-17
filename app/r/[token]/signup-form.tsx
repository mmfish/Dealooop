'use client';
// A prospective user signs up through a creator's link (POST /api/v1/links/<token>/signup).
import {useState} from 'react';

export function SignUpForm({token, title}: {token: string; title: string}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'), [error, setError] = useState('');
  if (state === 'done') return <div className="success-banner">You&apos;re signed up for {title}. Thanks!</div>;
  return <form className="form-panel" onSubmit={async e => {
    e.preventDefault(); setState('busy'); setError('');
    const email = new FormData(e.currentTarget).get('email');
    const r = await fetch(`/api/v1/links/${token}/signup`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email})});
    const data = await r.json() as {error?: {message?: string}};
    if (r.ok) setState('done'); else { setError(data.error?.message ?? 'Sign-up failed.'); setState('idle'); }
  }}>
    <div className="field"><label htmlFor="signup-email">Email</label><input id="signup-email" name="email" type="email" autoComplete="email" required /></div>
    <button className="button primary" disabled={state === 'busy'}>{state === 'busy' ? 'Signing up…' : `Sign up for ${title}`}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
