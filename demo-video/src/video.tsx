import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill,CanvasImage,Img,Easing,Sequence,interpolate,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import type {CaseManifest} from '../../src/domain/schema';
import {shortHash as short,sceneText} from './copy.mjs';
export type VideoProps={caseFile:CaseManifest|null;origin:string;capturedAt:string;assets:{overview:string;delivery:string;receipts:string}};
const blue='#1d4ed8',ink='#142c50',muted='#4b617f',pale='#edf3ff';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const money=(n:string)=>{const v=BigInt(n),f=(v%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return(v/1000000n).toString()+(f?'.'+f:'');};
const font={fontFamily:'Arial, sans-serif',color:ink};
function Logos({large=false}:{large?:boolean}){
 return <div style={{display:'flex',alignItems:'center',gap:large?54:32}}>
  <Img src={staticFile('logos/internet-court.svg')} style={{height:large?100:46,width:large?275:158,objectFit:'contain'}}/>
  <span style={{fontSize:large?40:25,color:'#8ca0bb'}}>+</span>
  <Img src={staticFile('logos/genlayer.svg')} style={{height:large?100:43,width:large?270:157,objectFit:'contain'}}/>
  <span style={{fontSize:large?40:25,color:'#8ca0bb'}}>+</span>
  <div style={{padding:large?'18px 35px':'9px 20px',background:blue,borderRadius:large?20:10}}><Img src={staticFile('logos/x402.svg')} style={{height:large?60:29,width:large?145:80,objectFit:'contain'}}/></div>
 </div>;
}
function Motion({children,delay=0,style={}}:{children:ReactNode;delay?:number;style?:CSSProperties}){
 const frame=useCurrentFrame();
 return <div style={{...style,opacity:interpolate(frame,[delay,delay+16],[0,1],clamp),translate:interpolate(frame,[delay,delay+24],['0px 32px','0px 0px'],{...clamp,easing:Easing.bezier(.2,.85,.25,1)})}}>{children}</div>;
}
function Scene({title,caption,children}:{title?:string;caption:string;children:ReactNode}){
 return <AbsoluteFill style={{padding:'175px 100px 185px',...font,background:'#fff'}}>
  {title?<Motion><h1 style={{fontSize:84,lineHeight:1.07,letterSpacing:-3,margin:'0 0 42px',fontWeight:700}}>{title}</h1></Motion>:null}
  {children}<div style={{position:'absolute',bottom:90,left:100,right:100,fontSize:35,lineHeight:1.35,fontWeight:500,color:muted,borderTop:'1px solid #dbe4f2',paddingTop:22}}>{caption}</div>
 </AbsoluteFill>;
}
function Panel({children,style={}}:{children:ReactNode;style?:CSSProperties}){
 return <div style={{background:pale,borderRadius:28,padding:38,...style}}>{children}</div>;
}
function Hash({label,value}:{label:string;value:string}){
 return <div style={{fontSize:24,color:muted,marginTop:25}}><div style={{marginBottom:8}}>{label}</div><div style={{fontFamily:'monospace',fontSize:27,color:ink}}>{short(value)}</div></div>;
}
function Screen({src,height=500}:{src:string;height?:number}){
 const frame=useCurrentFrame();
 return <div style={{height,padding:20,overflow:'hidden',borderRadius:22,border:'1px solid #cdd9ef',boxShadow:'0 18px 55px rgba(25,60,115,.10)',background:'#fff'}}>
  <CanvasImage src={staticFile(src)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'top',scale:interpolate(frame,[0,240],[1,1.02],clamp)}}/>
 </div>;
}
function Hook({c,assets}: {c:CaseManifest;assets:VideoProps['assets']}){
 const frame=useCurrentFrame();
 return <Scene caption="An agent bought work. The receipts show what happened next.">
  <div style={{display:'grid',gridTemplateColumns:'1fr 1.05fr',gap:70,alignItems:'center'}}>
   <Motion delay={-16}><div style={{fontSize:28,color:blue,marginBottom:26}}>Agent Refund Court</div><h1 style={{fontSize:96,lineHeight:1.04,letterSpacing:-5,margin:0}}>Your agent paid.<br/>Did it get<br/>what it bought?</h1><p style={{fontSize:28,marginTop:30,color:muted}}>One purchase. One dispute. One verified return.</p></Motion>
   <Motion delay={8}><Screen src={assets.overview} height={570}/></Motion>
  </div>
  <div style={{position:'absolute',left:-120,top:-150,width:470,height:470,border:'42px solid '+pale,borderRadius:'50%',zIndex:-1,rotate:interpolate(frame,[0,120],['0deg','24deg'],clamp)}}/>
 </Scene>;
}
function Purchase({c}:{c:CaseManifest}){
 return <Scene title="A small purchase. A clear promise." caption="The skill buys a launch plan through x402, against three agreed quality criteria.">
  <div style={{display:'grid',gridTemplateColumns:'1.06fr 1fr',gap:40}}>
   <Motion><Panel style={{height:392,background:ink,color:'#fff'}}><div style={{fontSize:24,color:'#c4d8fa',marginBottom:22}}>Run the agent skill</div><pre style={{fontSize:26,lineHeight:1.55,margin:0,whiteSpace:'pre-wrap'}}>{"npm run demo -- \\\n  --origin https://agent-refund-court.vercel.app \\\n  --scenario bad"}</pre><div style={{fontSize:25,color:'#b4cdf8',marginTop:34}}>{money(c.payment!.amount)} USDC · Base Sepolia</div></Panel></Motion>
   <Motion delay={6}><Panel style={{height:392}}><h2 style={{fontSize:43,margin:'0 0 25px'}}>Five hours.<br/>No advertising budget.</h2><p style={{fontSize:29,lineHeight:1.45,margin:0}}>A solo builder needs three practical launch actions and a useful way to collect feedback.</p><div style={{fontSize:24,color:blue,marginTop:29}}>Relevance · Actionability · Grounding</div></Panel></Motion>
  </div>
 </Scene>;
}
function Answer({c,assets}:{c:CaseManifest;assets:VideoProps['assets']}){
 return <Scene title="The payment cleared. The work fell short." caption="The original answer offers generic advice. The buyer evaluates its actual content.">
  <div style={{display:'grid',gridTemplateColumns:'0.77fr 1.4fr',gap:45}}>
   <Motion><Panel style={{height:420}}><div style={{fontSize:28,color:muted}}>x402 payment confirmed</div><div style={{fontSize:94,fontWeight:700,letterSpacing:-4,marginTop:16,color:blue}}>{money(c.payment!.amount)}<span style={{fontSize:32,marginLeft:13}}>USDC</span></div><Hash label="Original payment transaction" value={c.payment!.transactionHash}/><p style={{fontSize:25,color:muted,marginTop:28}}>Verified on Base Sepolia.</p></Panel></Motion>
   <Motion delay={9}><Screen src={assets.delivery} height={420}/></Motion>
  </div>
 </Scene>;
}
function Claim({c}:{c:CaseManifest}){
 return <Scene title="The buyer disputes a material failure." caption="The signed complaint points to the original answer. Its evidence is frozen before judgment.">
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:45}}>
   <Motion><Panel style={{height:410,background:ink,color:'#fff'}}><div style={{fontSize:25,color:'#b9cef4',marginBottom:30}}>An exact excerpt from the answer</div><blockquote style={{fontSize:44,lineHeight:1.35,margin:0,letterSpacing:-1}}>“{sceneText(c).quote}”</blockquote></Panel></Motion>
   <Motion delay={7}><Panel style={{height:410}}><div style={{fontSize:26,color:blue,marginBottom:25}}>Buyer’s independent assessment</div><p style={{fontSize:32,lineHeight:1.4,margin:'0 0 24px'}}>{sceneText(c).claim}</p><div style={{fontSize:25,color:muted}}>{c.buyerClaim!.criterionIds.join(' · ')}</div><Hash label="Sealed original evidence" value={c.evidenceHash!}/></Panel></Motion>
  </div>
 </Scene>;
}
function Judgment({c}:{c:CaseManifest}){
 return <Scene title="GenLayer judges the original evidence." caption="Validators independently assess whether the answer materially met the accepted brief.">
  <Motion><Panel style={{padding:'34px 45px',border:'2px solid '+blue}}>
   <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:28}}><span style={{fontSize:28,color:muted}}>Internet Court review adapter</span><span style={{fontSize:25,color:blue,background:'#fff',borderRadius:50,padding:'12px 24px'}}>Finalized GenLayer ruling</span></div>
   <div style={{display:'grid',gridTemplateColumns:'0.72fr 1.8fr',gap:50,alignItems:'center'}}><div style={{fontSize:90,color:blue,fontWeight:700,letterSpacing:-3}}>REFUND</div><p style={{fontSize:34,lineHeight:1.4,margin:0}}>{sceneText(c).reasoning}</p></div>
   <div style={{display:'flex',gap:150}}><Hash label="Judgment transaction" value={c.court!.transactionHash!}/><Hash label="Evidence judged" value={c.evidenceHash!}/></div>
  </Panel></Motion>
 </Scene>;
}
function Return({c,assets}:{c:CaseManifest;assets:VideoProps['assets']}){
 return <Scene title="A final ruling. A real return." caption="A cooperating seller’s worker applies the final ruling and confirms the USDC transfer.">
  <div style={{display:'grid',gridTemplateColumns:'0.77fr 1.4fr',gap:45}}>
   <Motion><Panel style={{height:438,background:blue,color:'#fff'}}><div style={{fontSize:28}}>Refund confirmed</div><div style={{fontSize:94,fontWeight:700,letterSpacing:-4,marginTop:16}}>{money(c.refund!.amount)}<span style={{fontSize:32,marginLeft:13}}>USDC</span></div><p style={{fontSize:27,lineHeight:1.4}}>Original paid principal.<br/>Original buyer.</p><div style={{fontSize:24,marginTop:29,color:'#dbe7ff'}}>Base Sepolia refund</div><div style={{fontFamily:'monospace',fontSize:25,marginTop:10}}>{short(c.refund!.transactionHash!)}</div></Panel></Motion>
   <Motion delay={10}><Screen src={assets.receipts} height={438}/></Motion>
  </div>
 </Scene>;
}
function Match({c}:{c:CaseManifest}){
 return <Scene title="The same buyer. The exact principal." caption="A refund means a confirmed transfer, with the token, payer and amount matched to the purchase.">
  <Motion><div style={{display:'grid',gridTemplateColumns:'1fr 140px 1fr',gap:25,alignItems:'center'}}>
   <Panel style={{height:365}}><div style={{fontSize:28,color:muted}}>Original payment</div><div style={{fontSize:88,fontWeight:700,marginTop:22,color:blue}}>{money(c.payment!.amount)} <span style={{fontSize:32}}>USDC</span></div><p style={{fontSize:25,color:muted}}>Paid by {short(c.payment!.payer)}</p><Hash label="Payment receipt" value={c.payment!.transactionHash}/></Panel>
   <div style={{textAlign:'center',fontSize:65,color:blue}}>✓</div>
   <Panel style={{height:365}}><div style={{fontSize:28,color:muted}}>Confirmed refund</div><div style={{fontSize:88,fontWeight:700,marginTop:22,color:blue}}>{money(c.refund!.amount)} <span style={{fontSize:32}}>USDC</span></div><p style={{fontSize:25,color:muted}}>Returned to {short(c.refund!.payer)}</p><Hash label="Refund receipt" value={c.refund!.transactionHash!}/></Panel>
  </div><div style={{fontSize:24,fontFamily:'monospace',textAlign:'center',marginTop:25,color:muted}}>{c.agreement.buyer}</div></Motion>
 </Scene>;
}
function End({origin}:{origin:string}){
 return <Scene caption="Run the public skill. Inspect every receipt.">
  <Motion style={{textAlign:'center'}}><h1 style={{fontSize:110,lineHeight:1.04,letterSpacing:-4,margin:'15px 0 50px'}}>Agents can contest<br/>the work they buy.</h1><div style={{display:'flex',justifyContent:'center',marginBottom:40}}><Logos large/></div><div style={{fontSize:33,color:blue,marginBottom:16}}>{origin.replace('https://','')}</div><div style={{fontSize:27,color:muted}}>github.com/TS-mfon/agent-refund-court</div></Motion>
 </Scene>;
}
export function CaseVideo(props:VideoProps){
 const {fps}=useVideoConfig(),c=props.caseFile;
 if(!c)return <AbsoluteFill style={{...font,background:'#fff',justifyContent:'center',alignItems:'center',fontSize:58}}>Supply a verified, completed testnet case to render.</AbsoluteFill>;
 return <AbsoluteFill style={{background:'#fff',...font}}>
  <Sequence from={0} durationInFrames={4*fps}><Hook c={c} assets={props.assets}/></Sequence>
  <Sequence from={4*fps} durationInFrames={5*fps}><Purchase c={c}/></Sequence>
  <Sequence from={9*fps} durationInFrames={6*fps}><Answer c={c} assets={props.assets}/></Sequence>
  <Sequence from={15*fps} durationInFrames={6*fps}><Claim c={c}/></Sequence>
  <Sequence from={21*fps} durationInFrames={8*fps}><Judgment c={c}/></Sequence>
  <Sequence from={29*fps} durationInFrames={7*fps}><Return c={c} assets={props.assets}/></Sequence>
  <Sequence from={36*fps} durationInFrames={4*fps}><Match c={c}/></Sequence>
  <Sequence from={40*fps} durationInFrames={4*fps}><End origin={props.origin}/></Sequence>
  <div style={{position:'absolute',top:60,left:100,right:100,display:'flex',alignItems:'center',justifyContent:'space-between'}}><Logos/><div style={{textAlign:'right',fontSize:23,color:muted}}>Recorded testnet case<br/><span style={{fontSize:21}}>{c.mode==='fixture'?'Fictional brief; delivery fixture. Real payment, buyer, court and refund.':'Fictional brief. Live seller, buyer, payment, court and refund.'}</span></div></div>
  <div style={{position:'absolute',bottom:28,left:100,right:100,display:'flex',justifyContent:'space-between',fontSize:19,color:muted}}><span>GenLayer adjudicates. A cooperating seller executes the refund.</span><span>Case {short(c.id)}</span></div>
 </AbsoluteFill>;
}
