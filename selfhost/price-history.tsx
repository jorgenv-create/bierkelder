import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ExternalLink} from 'lucide-react';
import type {Beer} from '../app/beer';
import type {ShopPriceSnapshot} from '../app/beer-value';
import {priceKey} from './shop-prices.mjs';
import {euros,PriceChart,usePriceHistory} from './price-chart';

const timestamp=new Intl.DateTimeFormat('nl-BE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Brussels'});
const signedEuros=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR',signDisplay:'exceptZero'});
const label=(beer:Beer)=>[beer.name,beer.vintage,beer.brewery,beer.volume/10+' cl'].filter(Boolean).join(' · ');

export default function PriceHistory(){
 const [beers,setBeers]=useState<Beer[]|null>(null);
 const [snapshot,setSnapshot]=useState<ShopPriceSnapshot|null>(null);
 const [selection,setSelection]=useState(()=>new URLSearchParams(location.search).get('bier')??'');
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   try{
    const response=await fetch('/api/beers',{signal:controller.signal});
    if(!response.ok)throw Error();
    setBeers(await response.json());
   }catch{if(!controller.signal.aborted)setError('De collectie kon niet worden geladen.');}
  }
  void load();
  void fetch('/api/shop-prices',{signal:controller.signal}).then(response=>response.ok?response.json():null).then(setSnapshot).catch(()=>{});
  return ()=>controller.abort();
 },[]);
 const choices=useMemo(()=>new Map((beers??[]).map(beer=>[priceKey(beer),beer] as const).filter(([key])=>key)
  .sort((a,b)=>label(a[1]).localeCompare(label(b[1]),'nl-BE'))),[beers]);
 const key=choices.has(selection)?selection:choices.keys().next().value??'';
 const selected=choices.get(key);
 const series=usePriceHistory(key);
 const prices=series?.prices??[];
 const amounts=prices.map(price=>price.amount);
 const latest=prices.at(-1);
 const change=latest&&prices.length>1?latest.amount-prices[0].amount:null;
 const tracked=Object.values(snapshot?.offers??{});
 return <main className="public-main price-history">
  <a className="secondary" href="/"><ArrowLeft size={17}/> Terug naar de kelder</a>
  <h1>Prijsgeschiedenis</h1>
  <p>Vergelijk winkelprijzen per fles en volg hoe ze veranderen.</p>
  {snapshot&&<div className="price-stat-grid">
   <div><small>Bieren met winkelprijs</small><b>{tracked.length} van {snapshot.keys?.length??choices.size}</b></div>
   <div><small>Prijzen voor dezelfde jaargang</small><b>{Object.entries(snapshot.offers??{}).filter(([key,price])=>price.matchKind!=='generic'&&JSON.parse(key)[3]).length}</b></div>
   <div><small>Webshops gecontroleerd</small><b>{snapshot.sources?.filter(source=>source.available).length??0}</b></div>
   <div><small>Laatste controle</small><b>{timestamp.format(new Date(snapshot.checkedAt))}</b></div>
  </div>}
  {error?<p role="alert">{error}</p>:!beers?<p role="status">Je collectie wordt geladen.</p>:!selected?<p>Voeg een bier toe met brouwerij en flesinhoud om prijzen te vergelijken.</p>:<>
   <label className="price-selection">Kies een bier
    <select value={key} onChange={event=>setSelection(event.target.value)}>
     {[...choices].map(([id,beer])=><option key={id} value={id}>{label(beer)}</option>)}
    </select>
   </label>
   {!series?<p role="status">De prijzen worden geladen.</p>:series.error?<p role="alert">De prijsgeschiedenis kon niet worden geladen.</p>:!latest?<p>Voor deze fles is nog geen winkelprijs opgeslagen. Gebruik Winkelprijzen verversen in de kelder.</p>:<>
    <div className="price-stat-grid">
     <div><small>Laatste winkelprijs</small><b>{euros.format(latest.amount)}</b></div>
     <div><small>Laagste prijs</small><b>{euros.format(Math.min(...amounts))}</b></div>
     <div><small>Hoogste prijs</small><b>{euros.format(Math.max(...amounts))}</b></div>
     <div><small>Verschil sinds eerste meting</small><b>{change===null?'Eén meting':signedEuros.format(change)}</b></div>
    </div>
    <PriceChart prices={prices}/>
    <div className="price-table-scroll"><table><thead><tr><th scope="col">Gecontroleerd op</th><th scope="col">Per fles</th><th scope="col">Webshop</th><th scope="col">Jaargang</th></tr></thead>
     <tbody>{[...prices].reverse().map(price=><tr key={price.checkedAt}>
      <td><time dateTime={price.checkedAt}>{timestamp.format(new Date(price.checkedAt))}</time></td><td>{euros.format(price.amount)}</td>
      <td><a className="shop-price-link" href={price.url} target="_blank" rel="noreferrer">{price.source} <ExternalLink size={13}/></a></td>
      <td>{price.matchKind==='generic'?'Zonder jaartal':selected.vintage||'—'}</td>
     </tr>)}</tbody>
    </table></div>
   </>}
  </>}
 </main>;
}
