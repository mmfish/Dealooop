'use client';
// Sign-in for the internal test accounts on a public address, where the email-only form is off
// (backend/test-users.ts, POST /api/auth/code).
import {useState} from 'react';

export function TestCodeForm({returnTo}:{returnTo:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="signin-options email-signin" onSubmit={async e=>{
  e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);
  try{
   const r=await fetch('/api/auth/code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.get('email'),code:f.get('code')})});
   const data=await r.json() as {error?:{message?:string}};if(!r.ok)throw Error(data.error?.message||'Sign-in failed.');
   window.location.assign(returnTo);
  }catch(err){setError((err as Error).message);setBusy(false);}
 }}>
  <div className="field"><label htmlFor="code-email">Email</label><input id="code-email" name="email" type="email" autoComplete="username" required/></div>
  <div className="field"><label htmlFor="code-code">Code</label><input id="code-code" name="code" type="password" autoComplete="current-password" required/></div>
  <button className="button primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  {error&&<p className="auth-error" role="alert">{error}</p>}
 </form>;
}
