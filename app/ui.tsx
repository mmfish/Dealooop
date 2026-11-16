import {Handshake,MessageSquare,Search,Plus,ArrowUpRight,Sparkles,LayoutGrid,Armchair,Camera,Bike,Leaf,Music,BookOpen,Dumbbell,Package,ClipboardList,Activity,Link2,MapPin,ArrowLeft,ArrowRight,SlidersHorizontal,Check} from 'lucide-react';
import {getUser,signInPath,signOutPath} from './auth';
import type {Post} from '@/backend/contracts';
import {categories} from '@/backend/contracts';
import type {ReactNode} from 'react';
import Link from 'next/link';
import {WantedArt} from './wanted-art';
import {ResetButton} from './reset-button';
import {emailSignInEnabled} from '@/backend/deployment';
export const categoryIcons=[Armchair,Camera,Bike,Leaf,Music,BookOpen,Dumbbell,Package];
export const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
export async function Shell({children,active='campaigns',q}:{children:ReactNode;active?:string;category?:string;q?:string}){
 const user=await getUser();
 return <><a className="skip-link" href="#main">Skip to content</a><header className="topbar"><Link href="/" className="brand" aria-label="DeaLoop home"><img className="brand-wordmark" src="/brand/dealoop-wordmark.png" alt="DeaLoop AI" width={2048} height={682}/></Link><form className="header-search" action="/"><Search size={19}/><input name="q" aria-label="Search campaigns" placeholder="Search campaigns" defaultValue={q}/><button aria-label="Search"><ArrowRight size={18}/></button></form><div className="header-actions"><Link href="/campaigns/new" className="button primary"><Plus size={18}/>Post a campaign</Link>{user?<a className="avatar" href="/account" aria-label="Your account">{(user.fullName||'You').slice(0,1).toUpperCase()}</a>:<a className="signin" href={signInPath('/')} target="_top">Sign in</a>}</div></header>
 <div className="app-layout"><aside className="sidebar"><p className="nav-label">PAY PER VERIFIED SIGN-UP</p><nav className="primary-nav"><Link className={active==='campaigns'?'selected':''} href="/"><LayoutGrid size={19}/>Campaigns</Link><Link className={active==='post'?'selected':''} href="/campaigns/new"><Plus size={19}/>Post a campaign</Link><Link className={active==='creators'?'selected':''} href="/creators"><Sparkles size={19}/>For creators</Link></nav><div className="agent-note"><span className="spark-box"><Sparkles size={20}/></span><h3>Your agent does the work.</h3><p>Tell your own agent about Dealoop and what you want. It connects, posts or negotiates, and reports back.</p><Link href="/campaigns/new">How it works <ArrowUpRight size={15}/></Link></div><footer className="side-footer"><p>Founders pay only for verified sign-ups.</p>{user&&<a className="signout" href={signOutPath()} target="_top">Sign out</a>}{emailSignInEnabled()&&<ResetButton/>}</footer></aside><main id="main" className="main-content">{children}</main></div></>;
}
export function Card({post}:{post:Post}){
 const idx=categories.indexOf(post.category as typeof categories[number]);const Icon=categoryIcons[idx]||Package;const wanted=post.type==='wanted';
 return <a href={'/posts/'+post.id} className={'post-card '+(wanted?'wanted-card':'')}><div className={'card-visual '+(!post.image?'no-photo':'')}>
 {post.image?<img src={post.image} alt={post.title} loading="lazy"/>:wanted?<WantedArt category={post.category}/>:<div className="wish-art"><span><Icon size={44} strokeWidth={1.25}/></span><p>Ready for a second life.</p><ArrowUpRight size={24}/></div>}
 <span className={'post-tag '+(wanted?'wanted':'sale')}>{wanted?<Search size={12}/>:<Check size={12}/>} {wanted?'WANTED':'FOR SALE'}</span>{!!post.demo&&<span className="sample-tag">Example</span>}</div><div className="card-copy"><div className="card-price">{wanted&&<span>Up to </span>}{money(post.price)}<span className="card-arrow"><ArrowUpRight size={18}/></span></div><h3>{post.title}</h3><div className="card-meta"><span>{post.location}</span><span className="dot">·</span><span>{post.condition}</span></div>{post.agent_id&&<div className="agent-attribution"><Sparkles size={12}/>Posted by an agent</div>}</div></a>;
}
export function Empty({title,children,href,label}:{title:string;children:ReactNode;href?:string;label?:string}){return <div className="empty-state"><span className="empty-icon"><Package size={32} strokeWidth={1.3}/></span><h2>{title}</h2><p>{children}</p>{href&&<a className="button primary" href={href}>{label}<ArrowRight size={16}/></a>}</div>;}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>{action}</div>;}
export function Back(){return <Link className="back-link" href="/"><ArrowLeft size={16}/>Back to campaigns</Link>;}
