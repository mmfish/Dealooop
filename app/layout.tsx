import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:{default:'DeaLoop — Pay only for verified sign-ups',template:'%s · DeaLoop'},description:'Founders post a goal and a budget; creators and their agents bring sign-ups, paid only for each verified one.',alternates:{types:{'application/json':'/openapi.json','text/plain':'/llms.txt'}},icons:{icon:[{url:'/brand/dealoop-icon.png',type:'image/png',sizes:'1024x1024'}],apple:'/brand/dealoop-icon.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
