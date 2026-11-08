import {useEffect,useState} from 'react';
import type {ShopPrice} from '../app/beer-value';

export const euros=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'});
const shortDate=new Intl.DateTimeFormat('nl-BE',{day:'numeric',month:'short',timeZone:'Europe/Brussels'});

export function usePriceHistory(key:string){
 const [result,setResult]=useState<{key:string;prices:ShopPrice[];error:boolean}|null>(null);
 useEffect(()=>{
  if(!key)return;
  const controller=new AbortController();
  fetch('/api/price-history?key='+encodeURIComponent(key),{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error();
   const prices=await response.json() as ShopPrice[];
   if(!controller.signal.aborted)setResult({key,prices,error:false});
  }).catch(()=>{if(!controller.signal.aborted)setResult({key,prices:[],error:true});});
  return ()=>controller.abort();
 },[key]);
 return result?.key===key?result:null;
}

export function PriceChart({prices}:{prices:ShopPrice[]}){
 const amounts=prices.map(price=>price.amount);
 const low=Math.min(...amounts),high=Math.max(...amounts);
 const pad=Math.max((high-low)*0.12,0.1);
 const dates=prices.map(price=>Date.parse(price.checkedAt));
 const span=dates[dates.length-1]-dates[0];
 const points=prices.map((price,index)=>({
  x:span?72+460*(dates[index]-dates[0])/span:302,
  y:143-118*(price.amount-low+pad)/(high-low+2*pad),
 }));
 return <figure className="price-figure"><svg className="price-chart" role="img" aria-label={'Winkelprijzen van '+euros.format(low)+' tot '+euros.format(high)} viewBox="0 0 560 182">
  {[0,0.5,1].map(step=><g key={step}><line x1="68" x2="540" y1={143-118*step} y2={143-118*step} stroke="#dce2d8"/>
   <text x="60" y={147-118*step} textAnchor="end">{euros.format(Math.max(0,low-pad+(high-low+2*pad)*step))}</text></g>)}
  <polyline points={points.map(point=>point.x+','+point.y).join(' ')} fill="none" stroke="currentColor" strokeWidth="3"/>
  {points.map(({x,y},index)=><circle key={prices[index].checkedAt} cx={x} cy={y} r="4.5" fill={prices[index].matchKind==='generic'?'#a16a27':'currentColor'}>
   <title>{shortDate.format(dates[index])+' · '+euros.format(prices[index].amount)+' · '+prices[index].source}</title></circle>)}
  <text x={points[0].x} y="166" textAnchor={span?'start':'middle'}>{shortDate.format(dates[0])}</text>
  {span>0&&<text x="532" y="166" textAnchor="end">{shortDate.format(dates[dates.length-1])}</text>}
 </svg><figcaption>{prices.length===1?'Eerste prijsmeting':prices.length+' prijsmetingen'}{prices.some(price=>price.matchKind==='generic')?' · Oranje punten zijn prijzen zonder vermelde jaargang.':''}</figcaption></figure>;
}
export function BeerPriceHistory({beerKey}:{beerKey:string}){
 const result=usePriceHistory(beerKey);
 return <section className="lookup-box beer-price-history" aria-label="Prijsverloop">
  <h3>Prijsverloop</h3>
  {!beerKey?<p>Voor dit bier is nog geen vergelijkbare winkelprijs beschikbaar.</p>:!result?<p role="status">Prijsgeschiedenis laden…</p>:result.error?<p role="alert">De prijsgeschiedenis kon niet worden geladen.</p>:!result.prices.length?<p>Nog geen prijsmetingen. Gebruik Winkelprijzen verversen in de kelder.</p>:<PriceChart prices={result.prices}/>}
  {beerKey&&<a href={'/prijzen?bier='+encodeURIComponent(beerKey)}>Bekijk alle prijsmetingen</a>}
 </section>;
}
