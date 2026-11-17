'use client';
// Local testing only: a clean start for the demo (POST /api/v1/demo/reset).
import {useState} from 'react';
import {RotateCcw} from 'lucide-react';

export function ResetButton(){
 const [busy,setBusy]=useState(false);
 return <button className="text-button reset-demo" disabled={busy} onClick={async()=>{
  if(!window.confirm('Reset Dealoop to a clean start? This deletes your campaigns, negotiations and deals (the sample campaigns stay), signs everyone out and disconnects every agent.'))return;
  setBusy(true);
  const r=await fetch('/api/v1/demo/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!r.ok){setBusy(false);window.alert('Reset failed.');return;}
  window.location.href='/';
 }}><RotateCcw size={13}/>{busy?'Resetting…':'Reset demo'}</button>;
}
