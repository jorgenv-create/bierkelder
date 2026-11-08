import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ExternalLink} from 'lucide-react';
import type {Beer} from '../app/beer';
import type {ShopPrice} from '../app/beer-value';
import {priceKey} from './shop-prices.mjs';

const euros=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'});
const timestamp=new Intl.DateTimeFormat('nl-BE',{dateStyle:'medium',timeStyle:'short'});
const signedEuros=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR',signDisplay:'exceptZero'});

function PriceChart({prices}:{prices:ShopPrice[]}){
 const amounts=prices.map(price=>price.amount);
 const low=Math.min(...amounts), high=Math.max(...amounts);
 const dates=prices.map(price=>Date.parse(price.checkedAt));
 const span=Math.max(1,dates[dates.length-1]-dates[0]);
 const points=prices.map((price,index)=>[
  14+532*(dates[index]-dates[0])/span,
  126-112*(high===low?0.5:(price.amount-low)/(high-low)),
 ]);
 return <svg className="price-chart" role="img" aria-label={`Winkelprijzen van ${euros.format(low)} tot ${euros.format(high)}`} viewBox="0 0 560 140">
  <polyline points={points.map(point=>point.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="3"/>
  {points.map(([x,y],index)=><circle key={prices[index].checkedAt} cx={x} cy={y} r="4" fill="currentColor"/>)}
 </svg>;
}

export default function PriceHistory(){
 const [beers,setBeers]=useState<Beer[]|null>(null);
 const [selection,setSelection]=useState('');
 const [series,setSeries]=useState<{key:string;prices:ShopPrice[]}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/beers',{signal:controller.signal}).then(response=>{
   if(!response.ok)throw Error();
   return response.json();
  }).then(setBeers).catch(()=>{if(!controller.signal.aborted)setError('De collectie kon niet worden geladen.');});
  return ()=>controller.abort();
 },[]);

 const choices=useMemo(()=>new Map((beers??[]).map(beer=>[priceKey(beer),beer]).filter(([key])=>key) as [string,Beer][]),[beers]);
 const key=choices.has(selection)?selection:choices.keys().next().value??'';
 const selected=choices.get(key);
 const prices=series?.key===key?series.prices:null;
 useEffect(()=>{
  if(!key)return;
  const controller=new AbortController();
  setError('');
  fetch(`/api/price-history?key=${encodeURIComponent(key)}`,{signal:controller.signal}).then(response=>{
   if(!response.ok)throw Error();
   return response.json();
  }).then(prices=>{if(!controller.signal.aborted)setSeries({key,prices});})
   .catch(()=>{if(!controller.signal.aborted)setError('De prijsgeschiedenis kon niet worden geladen.');});
  return ()=>controller.abort();
 },[key]);

 const change=prices&&prices.length>1?prices[prices.length-1].amount-prices[0].amount:null;
 const search=selected&&new URLSearchParams({q:[selected.brewery,selected.name,selected.vintage,`${selected.volume/10} cl`, 'bier kopen'].filter(Boolean).join(' ')});
 return <main className="public-main price-history">
  <a className="secondary" href="/"><ArrowLeft size={17}/> Terug naar de kelder</a>
  <h1>Prijsgeschiedenis</h1>
  <p>Bekijk de laagste gevonden winkelprijs per meetmoment voor dezelfde editie, inhoud en jaargang.</p>
  {error?<p role="alert">{error}</p>:!beers?<p role="status">Je collectie wordt geladen.</p>:!selected?<p>Voeg een bier toe met brouwerij en flesinhoud om prijzen te vergelijken.</p>:<>
   <label className="price-selection">Kies een bier
    <select value={key} onChange={event=>setSelection(event.target.value)}>
     {[...choices].map(([id,beer])=><option key={id} value={id}>{[beer.vintage,beer.name,beer.brewery,`${beer.volume/10} cl`].filter(Boolean).join(' · ')}</option>)}
    </select>
   </label>
   <a className="shop-price-link" href={`https://www.google.com/search?${search}`} target="_blank" rel="noreferrer">Zoek deze fles op het web <ExternalLink size={13}/></a>
   {!prices?<p role="status">De prijzen worden geladen.</p>:prices.length===0?<p>Voor deze fles is nog geen winkelprijs opgeslagen. Gebruik Winkelprijzen verversen in de kelder.</p>:<>
    {change!==null&&<><h2>{signedEuros.format(change)} sinds de eerste getoonde prijs</h2><PriceChart prices={prices}/></>}
    <table><thead><tr><th scope="col">Gecontroleerd op</th><th scope="col">Prijs per fles</th><th scope="col">Webshop</th></tr></thead>
     <tbody>{[...prices].reverse().map(price=><tr key={price.checkedAt}>
      <td><time dateTime={price.checkedAt}>{timestamp.format(new Date(price.checkedAt))}</time></td><td>{euros.format(price.amount)}</td>
      <td><a className="shop-price-link" href={price.url} target="_blank" rel="noreferrer">{price.source} <ExternalLink size={13}/></a></td>
     </tr>)}</tbody>
    </table>
   </>}
  </>}
 </main>;
}
