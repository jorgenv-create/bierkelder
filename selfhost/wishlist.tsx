import {useEffect,useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink,Heart,Plus,Trash2} from 'lucide-react';
import {cellarOrigin,syncChannel} from '../app/untappd-protocol';
import {beerFamily,beerYear} from '../app/beer-family';
import type {Beer} from '../app/beer';
import Modal from '../app/modal';
import {beerFromWish} from '../app/wish-to-beer';
import {syncedUntappdPage,untappdBeerLink} from '../app/untappd';

type Details={image:string;style:string;description:string;abv:number|null;ibu:number|null;rating:number|null};
type Offer={amount:number;source:string;url:string;volume:number;year:number|null};
type ShopPrices={checkedAt:string;offers:Offer[];partial:boolean};
type Wish={id:string;name:string;brewery:string;url:string;addedAt:string;years:number[];details:Details|null;shopPrices?:ShopPrices|null};
const blank={name:'',brewery:'',url:'',years:''};
const blankDetails:Details={image:'',style:'',description:'',abv:null,ibu:null,rating:null};
const number=(value:string)=>value===''?null:Number(value);
const score=(value:number)=>value.toLocaleString('nl-BE',{maximumFractionDigits:2})+' / 5';
const currency=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'});
const formatVolume=(volume:number)=>`${(volume/10).toLocaleString('nl-BE')} cl`;
function priceSummary(item:Wish){
 const comparable=new Map<string,Offer[]>();
 for(const offer of item.shopPrices?.offers??[]){
  const key=`${offer.volume}:${offer.year??''}`;
  if(!comparable.has(key))comparable.set(key,[]);
  comparable.get(key)!.push(offer);
 }
 const best=[...comparable.values()].sort((a,b)=>
  Number(item.years.includes(b[0].year??0))-Number(item.years.includes(a[0].year??0))||
  b.length-a.length||Number(b[0].year===null)-Number(a[0].year===null)||a[0].volume-b[0].volume)[0];
 if(!best)return '';
 const {volume,year}=best[0];
 const amount=best.reduce((sum,offer)=>sum+offer.amount,0)/best.length;
 const vintage=year??(item.years.length?'zonder jaartal':null);
 return `${best.length>1?'Gem. ':''}${currency.format(amount)} · ${formatVolume(volume)}${vintage?' · '+vintage:''}`;
}
function WishImage({src,name}:{src:string;name:string}){
 const [failed,setFailed]=useState(false);
 return src&&!failed?<img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Heart aria-hidden="true" size={23}/>;
}
function parseYears(text:string){
 const years=new Set<number>();
 for(const part of text.trim().replace(/\s*[-–]\s*/g,'-').split(/[,;\s]+/).filter(Boolean)){
  const range=part.match(/^((?:19|20)\d{2})(?:-((?:19|20)\d{2}))?$/);
  if(!range||Number(range[2]??range[1])<Number(range[1]))throw Error('Gebruik jaartallen zoals 2017, 2018 of 2017–2021.');
  for(let year=Number(range[1]);year<=Number(range[2]??range[1]);year++)years.add(year);
 }
 return [...years].sort((a,b)=>a-b);
}
function YearChips({years}:{years:number[]}){
 return <div className="year-chips">{years.map(year=><span className="beer-vintage" key={year}>{year}</span>)}</div>;
}
export default function Wishlist({signedIn,collection,onAddToCollection}:{signedIn:boolean;collection:Beer[];onAddToCollection:(beer:Beer)=>void}){
 const [items,setItems]=useState<Wish[]|null>(null);
 const [draft,setDraft]=useState(blank);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState('');
 const [editedYears,setEditedYears]=useState('');
 const [editDetails,setEditDetails]=useState<Details|null>(null);
 const detail=items?.find(item=>item.id===selected);
 const family=detail?beerFamily(detail):null;
 const sameFamily=family?collection.filter(beer=>beerFamily(beer).key===family.key):[];
 const linkId=detail&&untappdBeerLink(detail.url)?.id;
 const known=sameFamily.find(beer=>linkId&&untappdBeerLink(beer.untappdUrl||syncedUntappdPage(beer)?.url||'')?.id===linkId);
 const knownPage=known&&syncedUntappdPage(known);
 const imageFor=(item:Wish)=>item.details?.image||collection.find(beer=>beer.image&&beerFamily(beer).key===beerFamily(item).key)?.image||'';
 const collectionStyles=new Map(collection.filter(beer=>beer.style.trim()||syncedUntappdPage(beer)?.style)
  .map(beer=>[beerFamily(beer).key,beer.style.trim()||syncedUntappdPage(beer)?.style||'']));
 const styleFor=(item:Wish)=>item.details?.style.trim()||collectionStyles.get(beerFamily(item).key)||'';
 const style=detail?styleFor(detail):'';
 const categories=new Map<string,{label:string;items:Wish[]}>();
 for(const item of items??[]){
  const rawStyle=styleFor(item).replace(/\s*[-–—]\s+/g,' - ').replace(/\s+/g,' ');
  const geuze=/^(?:lambic - )?gue?uze$/i.test(rawStyle)||(!rawStyle&&/\bgue?uze\b/i.test(item.name));
  const label=geuze?'Geuze':rawStyle;
  const key=label.toLocaleLowerCase('nl-BE');
  if(!categories.has(key))categories.set(key,{label:label||'Zonder bierstijl',items:[]});
  categories.get(key)!.items.push(item);
 }
 const groups=[...categories.entries()].sort(([a],[b])=>Number(!a)-Number(!b)||a.localeCompare(b,'nl-BE'));
 const abv=detail?.details?.abv??known?.abv??knownPage?.abv;
 const ibu=detail?.details?.ibu??knownPage?.ibu;
 const rating=detail?.details?.rating??known?.untappdCommunityRating??knownPage?.communityRating;
 const description=detail?.details?.description||known?.untappdDescription||knownPage?.description;
 const owned=family?[...new Set(collection.filter(beer=>beer.quantity>0&&beerFamily(beer).key===family.key).flatMap(beer=>{
  const year=beerYear(beer);
  return year===null?[]:[year];
 }))].sort((a,b)=>a-b):[];
 const first=owned[0],last=owned.at(-1);
 const gaps=last!==undefined&&last-first>1&&last-first<=40?Array.from({length:last-first-1},(_,index)=>first+index+1).filter(year=>!owned.includes(year)):[];
 useEffect(()=>{
  const controller=new AbortController();
  function load(){
   void fetch('/api/wishlist',{signal:controller.signal}).then(async response=>{
    if(!response.ok)throw Error();
    const data=await response.json() as Wish[];
    if(!controller.signal.aborted)setItems(data);
   }).catch(()=>{if(!controller.signal.aborted)setMessage('De wishlist kon niet worden geladen.');});
  }
  function receive(event:MessageEvent){
   if(event.source!==window||event.origin!==cellarOrigin||event.data?.channel!==syncChannel||event.data.source!=='extension'||event.data.kind!=='wishlist-saved')return;
   setMessage(event.data.added?'Bier toegevoegd vanuit Untappd.':'Dit bier staat al op de wishlist.');
   load();
  }
  window.addEventListener('message',receive);
  load();
  return ()=>{controller.abort();window.removeEventListener('message',receive);};
 },[]);
 async function save(method:'POST'|'PUT'|'DELETE',data:object){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/wishlist',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'De wishlist kon niet worden bijgewerkt.');
   setItems(method==='POST'?result.items:result);
   if(method==='POST')setDraft(blank);
   if(method==='DELETE')setSelected('');
   setMessage(method==='PUT'?'Gezochte jaargangen opgeslagen.':method==='DELETE'?'Bier verwijderd.':result.added?'Bier toegevoegd.':'Dit bier staat al op de wishlist.');
  }catch(error){setMessage((error as Error).message);}
  finally{setBusy(false);}
 }
 async function saveDetails(item:Wish,data?:Details){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/wishlist/details',{method:data?'PUT':'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:item.id,details:data})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'De bierinformatie kon niet worden opgeslagen.');
   setItems(result);
   setEditDetails(null);
   setMessage(data?'Bierinformatie opgeslagen.':'Bierinformatie opgehaald bij Untappd.');
  }catch(error){setMessage((error as Error).message);}
  finally{setBusy(false);}
 }
 async function refreshShopPrices(item:Wish){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/wishlist/shop-prices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Winkelprijzen zoeken is niet gelukt.');
   setItems(result);
  }catch(error){setMessage((error as Error).message);}
  finally{setBusy(false);}
 }
 function submitYears(method:'POST'|'PUT',data:object,text:string){
  try{void save(method,{...data,years:parseYears(text)});}
  catch(error){setMessage((error as Error).message);}
 }
 function open(item:Wish){
  setSelected(item.id);
  setEditedYears(item.years.join(', '));
  setEditDetails(null);
  setMessage('');
  if(signedIn&&item.url&&!item.details)void saveDetails(item);
 }
 return <>
  <div className="page-heading"><div><span className="eyebrow">BIEREN OM TE ONTDEKKEN</span><h1>Wishlist</h1><p>Bieren die ik nog graag wil proeven of bewaren.</p></div></div>
  {signedIn&&<details className="wishlist-add">
   <summary className="wishlist-disclosure"><Plus size={17} aria-hidden="true"/> Bier toevoegen <ChevronDown size={17} aria-hidden="true"/></summary>
   <form className="lookup-box wishlist-form" onSubmit={event=>{event.preventDefault();submitYears('POST',draft,draft.years);}}>
   <div className="form-grid">
    <label>Biernaam<input value={draft.name} required maxLength={160} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
    <label>Brouwerij<input value={draft.brewery} maxLength={160} onChange={event=>setDraft({...draft,brewery:event.target.value})}/></label>
    <label className="full">Untappd-link<input type="url" value={draft.url} maxLength={1000} onChange={event=>setDraft({...draft,url:event.target.value})}/></label>
    <label className="full">Gezochte jaargangen<input value={draft.years} maxLength={1200} placeholder="Bijvoorbeeld 2017, 2018 of 2017–2021" onChange={event=>setDraft({...draft,years:event.target.value})}/></label>
   </div>
   <button className="primary" disabled={busy||!draft.name.trim()}><Plus size={17}/> Toevoegen aan wishlist</button>
   <p>Met <a href="/bierkelder-untappd-1.3.zip" download>extensie 1.3</a> kun je ook op een Untappd-bierpagina op <strong>Op Bierkelder-wishlist</strong> klikken.</p>
   </form>
  </details>}
  {message&&!detail&&<p role="status">{message}</p>}
  {!items?<p role="status">Wishlist laden…</p>:!items.length?<div className="empty"><Heart size={24}/><h3>De wishlist is nog leeg.</h3></div>:
   <div className="wishlist-groups">{groups.map(([key,group])=><details key={key}>
   <summary className="wishlist-disclosure"><span>{group.label} <small>{group.items.length}</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
   <ul className="wishlist-list">{group.items.map(item=>{const price=priceSummary(item);return <li className="lookup-box wishlist-card" key={item.id}>
    <button type="button" className="wishlist-card-open" onClick={()=>open(item)} aria-label={'Bekijk '+item.name+' op wishlist'}>
     <span className="wishlist-thumb"><WishImage key={imageFor(item)} src={imageFor(item)} name={item.name}/></span>
     <span className="wishlist-card-title"><strong>{item.name}</strong>{item.brewery&&<small>{item.brewery}</small>}{price&&<small className="wishlist-card-price">{price}</small>}</span><ChevronRight size={19}/>
    </button>
    {item.years.length>0&&<div className="wishlist-years"><small>Gezochte jaargangen</small><YearChips years={item.years}/></div>}
   </li>;})}</ul></details>)}</div>}
  {detail&&<Modal title={detail.name} onClose={()=>{setSelected('');setMessage('');}}>
   <div className="detail-hero wishlist-detail-hero">
    <div className="wishlist-thumb"><WishImage key={imageFor(detail)} src={imageFor(detail)} name={detail.name}/></div>
    <div>{style&&<span className="eyebrow">{style}</span>}<h3>{detail.brewery||'Brouwerij niet ingevuld'}</h3>{abv!=null&&<p>{abv}% alcohol</p>}</div>
   </div>
   <dl className="detail-grid">
    {rating!=null&&<div><dt>Algemene Untappd-score</dt><dd><span className="beer-rating-stars" aria-hidden="true">★★★★★<span style={{width:rating*20+'%'}}>★★★★★</span></span> {score(rating)}</dd></div>}
    {signedIn&&knownPage?.rating!=null&&<div><dt>Jouw laatst gegeven score</dt><dd>{score(knownPage.rating)}</dd></div>}
    {ibu!=null&&<div><dt>Bitterheid</dt><dd>{ibu} IBU</dd></div>}
   </dl>
   {description&&<div className="detail-notes"><span className="eyebrow">OVER DIT BIER</span><p>{description}</p></div>}
   {signedIn&&<div className="photo-actions">
    <button type="button" className="primary" disabled={busy} onClick={()=>{const beer=beerFromWish({...detail,details:{image:imageFor(detail),style,abv:abv??null,rating:rating??null,description:description||''}});setSelected('');onAddToCollection(beer);}}><Plus size={17}/> Toevoegen aan collectie</button>
    {detail.url&&<button type="button" className="secondary" disabled={busy} onClick={()=>void saveDetails(detail)}>Bierinfo ophalen bij Untappd</button>}
    <button type="button" className="secondary" disabled={busy} onClick={()=>setEditDetails(detail.details??blankDetails)}>Bierinfo en afbeelding aanpassen</button>
   </div>}
   {signedIn&&editDetails&&<form className="form-grid wishlist-year-editor" onSubmit={event=>{event.preventDefault();void saveDetails(detail,editDetails);}}>
    <label className="full">Afbeelding (HTTPS-link)<input type="url" maxLength={1000} value={editDetails.image} onChange={event=>setEditDetails({...editDetails,image:event.target.value})}/></label>
    <label>Bierstijl<input maxLength={100} value={editDetails.style} onChange={event=>setEditDetails({...editDetails,style:event.target.value})}/></label>
    <label>Alcohol (%)<input type="number" min="0" max="100" step="0.1" value={editDetails.abv??''} onChange={event=>setEditDetails({...editDetails,abv:number(event.target.value)})}/></label>
    <label>Bitterheid (IBU)<input type="number" min="0" max="1000" step="1" value={editDetails.ibu??''} onChange={event=>setEditDetails({...editDetails,ibu:number(event.target.value)})}/></label>
    <label>Algemene Untappd-score<input type="number" min="0.1" max="5" step="0.01" value={editDetails.rating??''} onChange={event=>setEditDetails({...editDetails,rating:number(event.target.value)})}/></label>
    <label className="full">Beschrijving<textarea maxLength={1200} value={editDetails.description} onChange={event=>setEditDetails({...editDetails,description:event.target.value})}/></label>
    <div className="full photo-actions"><button className="primary" disabled={busy}>Bierinfo opslaan</button><button type="button" className="secondary" onClick={()=>setEditDetails(null)}>Annuleren</button></div>
   </form>}
   <section className="wishlist-year-section" aria-label="Gezochte jaargangen">
    <h3>Gezochte jaargangen</h3>
    {detail.years.length?<YearChips years={detail.years}/>:<p>Alle jaargangen welkom.</p>}
    {owned.length>0&&<><h4>Al in de kelder</h4><YearChips years={owned}/></>}
    {signedIn&&<form className="form-grid wishlist-year-editor" onSubmit={event=>{event.preventDefault();submitYears('PUT',{id:detail.id},editedYears);}}>
     <label className="full">Jaargangen aanpassen<input maxLength={1200} value={editedYears} placeholder="Bijvoorbeeld 2017–2021" onChange={event=>setEditedYears(event.target.value)}/></label>
     <div className="full photo-actions">
      {gaps.length>0&&<button type="button" className="secondary" onClick={()=>{try{setEditedYears([...new Set([...parseYears(editedYears),...gaps])].sort((a,b)=>a-b).join(', '));setMessage('');}catch(error){setMessage((error as Error).message);}}}>Voeg ontbrekende jaren toe</button>}
      <button className="primary" disabled={busy}>Jaargangen opslaan</button>
     </div>
    </form>}
   </section>
   <section className="wishlist-year-section" aria-label="Webshops">
    <h3>Webshops</h3>
    {detail.shopPrices?.offers.length?<ul className="wishlist-offers">{detail.shopPrices.offers.map(offer=><li key={`${offer.source}:${offer.volume}:${offer.year}`}>
     <a href={offer.url} target="_blank" rel="noreferrer">{offer.source} <ExternalLink size={13}/></a>
     <small>{formatVolume(offer.volume)} · {offer.year??'zonder jaartal'}</small>
     <strong>{currency.format(offer.amount)}</strong>
    </li>)}</ul>:<p>{detail.shopPrices?'Geen passende aanbieding op voorraad gevonden.':'Nog geen winkelprijzen opgezocht.'}</p>}
    {detail.shopPrices&&<p className="wishlist-price-note">Gecontroleerd op {new Date(detail.shopPrices.checkedAt).toLocaleDateString('nl-BE')}. Prijs per fles, zonder verzending.{detail.shopPrices.partial&&' Sommige webshops waren onbereikbaar.'}</p>}
    {signedIn&&detail.brewery&&<button className="secondary" type="button" disabled={busy} onClick={()=>void refreshShopPrices(detail)}>{detail.shopPrices?'Winkelprijzen verversen':'Zoek bij webshops'}</button>}
   </section>
   {message&&<p role="status">{message}</p>}
   <div className="form-bottom">
    <a className="secondary" href={detail.url||'https://untappd.com/search?q='+encodeURIComponent([detail.brewery,detail.name].filter(Boolean).join(' '))} target="_blank" rel="noreferrer">{detail.url?'Bekijk op Untappd':'Zoek op Untappd'} <ExternalLink size={14}/></a>
    {signedIn&&<button className="secondary" type="button" disabled={busy} onClick={()=>void save('DELETE',{id:detail.id})}><Trash2 size={17}/> Verwijder van wishlist</button>}
   </div>
  </Modal>}
 </>;
}
