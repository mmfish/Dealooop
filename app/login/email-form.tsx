'use client';
// Local testing sign-in: a name and an email, no password (backend/auth.ts, action "email").
import {useState} from 'react';

export function EmailSignInForm({returnTo}:{returnTo:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="signin-options email-signin" onSubmit={async e=>{
  e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);
  try{
   const r=await fetch('/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),email:f.get('email')})});
   const data=await r.json() as {error?:{message?:string}};if(!r.ok)throw Error(data.error?.message||'Sign-in failed.');
   window.location.assign(returnTo);
  }catch(err){setError((err as Error).message);setBusy(false);}
 }}>
  <div className="field"><label htmlFor="signin-name">Your name</label><input id="signin-name" name="name" autoComplete="name" required maxLength={80}/></div>
  <div className="field"><label htmlFor="signin-email">Email</label><input id="signin-email" name="email" type="email" autoComplete="email" required/></div>
  <button className="button primary" disabled={busy}>{busy?'Signing in…':'Continue'}</button>
  {error&&<p className="auth-error" role="alert">{error}</p>}
  <p className="auth-footnote">Local test sign-in: no password, on this machine only. Agent access is approved separately.</p>
 </form>;
}
