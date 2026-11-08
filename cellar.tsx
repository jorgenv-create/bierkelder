'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowLeft, ArrowRight, Barcode, Beer as BeerIcon, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, GlassWater, LayoutGrid, Leaf, List, LoaderCircle, LogOut, MapPin, Plus, RefreshCw, Heart, LogIn, ScanLine, Search, Settings2, ShieldCheck, Sparkles, Wine, X } from 'lucide-react';
import { Beer, beerSchema, emptyBeer, today } from './beer';
import { drinkStart, suggestDrinkWindow } from './drink-window';
import { bottleValue, compareBeerAge, compareBeerStyle, pricesCheckedOn, stockValue, type ShopPriceSnapshot } from './beer-value';
import { beerImages, beerPhotoUrl, ownBeerPhoto, photoDataUrl, prepareBeerPhoto } from './beer-photo';
import { matchUntappd, parseUntappdExport, syncedUntappdPage, untappdBeerLink, type UntappdEntry } from './untappd';
import UntappdSync from './untappd-sync';
import {BeerPriceHistory} from '../selfhost/price-chart';
import Wishlist from '../selfhost/wishlist';
import Modal from './modal';
import {beerFamily,beerYear} from './beer-family';
import {priceKey} from '../selfhost/shop-prices.mjs';

const euro = (n:number) => new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'}).format(n);
const date = (s:string) => s ? new Date(s+'T12:00:00').toLocaleDateString('nl-BE',{day:'numeric',month:'short',year:'numeric'}) : 'Niet ingevuld';
const isReady = (beer: Beer, currentDay: string) => {
 const start = drinkStart(beer);
 return !!start && start <= currentDay && beer.quantity > 0;
};
const untappdSearch = (beer: Pick<Beer, 'brewery' | 'name'>) =>
 'https://untappd.com/search?q=' + encodeURIComponent([beer.name, beer.brewery].filter(Boolean).join(' '));
const untappdScore=(value:number)=>`${value.toLocaleString('nl-BE',{maximumFractionDigits:2})} / 5`;
const barcodeSource = (url:string) => url.startsWith('https://www.upcitemdb.com/')?'UPCitemdb':'Open Food Facts';
const shopKey = (name:string) => name.trim().replace(/\s+/g,' ').toLocaleLowerCase('nl-BE');
function Bottle({name,mini=false}:{name:string;mini?:boolean}) {return <div className={'bottle-art '+(mini?'mini':'')} aria-hidden="true"><div className="bottle-cork"/><div className="bottle-neck"/><div className="bottle-body"><div className="bottle-label"><span>RÉSERVE</span><b>{name.slice(0,24)||'BIER'}</b><i>COLLECTION</i></div></div></div>;}
function BeerPicture({beer,guest=false}:{beer:Beer;guest?:boolean}){
 const images=beerImages(beer,guest);
 return <BeerPictureSources key={JSON.stringify(images)} name={beer.name} images={images} own={ownBeerPhoto(beer,guest)}/>;
}
function BeerPictureSources({name,images,own}:{name:string;images:string[];own:string}){
 const [index,setIndex]=useState(0);
 const src=images[index];
 return src?<img className={src===own?'beer-own-photo':undefined} src={src} alt={name} referrerPolicy="no-referrer" loading="lazy" onError={()=>setIndex(index+1)}/>:<div><Bottle name={name}/></div>;
}
function BeerRating({label,score}:{label:string;score?:number|null}){
 return <div className="beer-rating">
  <span>{label}</span>
  {score!=null?<><span className="beer-rating-stars" aria-hidden="true">★★★★★<span style={{width:score*20+'%'}}>★★★★★</span></span>
   <strong>{untappdScore(score)}</strong></>:<small>Geen score</small>}
 </div>;
}
function BeerValue({value}:{value:ReturnType<typeof bottleValue>}){
 if(value.amount===null)return value.kind;
 if(!value.evidence)return euro(value.amount);
 return <a className="shop-price-link" href={value.evidence.url} target="_blank" rel="noreferrer" aria-label={`${euro(value.amount)} bij ${value.evidence.source}, opent in nieuw tabblad`}>{euro(value.amount)} <ExternalLink size={13}/></a>;
}
const demo:Beer[] = [
 {name:'Oude Geuze',brewery:'Brouwerij Boon',style:'Geuze',vintage:'2024',quantity:3,price:6.5,notes:'Een voorbeeld van een bewaarbier.'},
 {name:'Goudenband',brewery:'Liefmans',style:'Vlaams oud bruin',vintage:'2023',quantity:2,price:5.9,notes:'Hier kun je je eigen proef- en bewaarnotities kwijt.'},
 {name:'Oude Gueuze',brewery:'3 Fonteinen',style:'Geuze',vintage:'2024',quantity:2,price:11.5,notes:'Voorbeeldgegevens, geen echte voorraad.'}
].map((x,i)=>({...x,id:'demo-'+i,barcode:'',abv:null,volume:750,purchasedQuantity:x.quantity,purchaseDate:'2026-11-01',shop:'Voorbeeldwinkel',location:'Rek A',drinkDate:'2029-11-01',bestBefore:'',image:'',source:'',createdAt:'2026-11-01T12:00:00.000Z',updatedAt:'2026-11-01T12:00:00.000Z'}));

export default function Cellar({signedIn,local=false,guest=false,onSignOut}:{signedIn:boolean;local?:boolean;guest?:boolean;onSignOut?:()=>void}) { const loginPath=local?"/login":"/signin-with-chatgpt?return_to=%2F";
 const isUntappd=local&&signedIn&&typeof window!=='undefined'&&window.location.pathname==='/untappd';
 const isWishlist=local&&typeof window!=='undefined'&&window.location.pathname==='/wishlist';
 const [beers,setBeers]=useState<Beer[]>([]),[loading,setLoading]=useState(signedIn||guest),[error,setError]=useState(''),[toast,setToast]=useState('');
 const [shopPrices,setShopPrices]=useState<ShopPriceSnapshot|null>(null);
 const [pricesLoading,setPricesLoading]=useState(true),[priceMessage,setPriceMessage]=useState('');
 const [untappd,setUntappd]=useState<{importedAt:string;entries:UntappdEntry[]}|null>(null);
 const [untappdLoading,setUntappdLoading]=useState(true),[untappdMessage,setUntappdMessage]=useState('');
 const untappdFile=useRef<HTMLInputElement>(null);
 const knownShops=useMemo(()=>{
  const shops=new Map<string,string>();
  for(const {shop} of beers){
   const key=shopKey(shop);
   if(key&&!shops.has(key))shops.set(key,shop.trim());
  }
  return [...shops.values()].sort((a,b)=>a.localeCompare(b,'nl-BE'));
 },[beers]);
 const [search,setSearch]=useState(''),[view,setView]=useState(()=>{const tab=local&&typeof window!=='undefined'?new URLSearchParams(window.location.search).get('view'):null;return tab==='ready'||tab==='history'?tab:'collection';}),[style,setStyle]=useState('all'),[sort,setSort]=useState('new'),[list,setList]=useState(false),[grouped,setGrouped]=useState(local),[examples,setExamples]=useState(false);
 const [edit,setEdit]=useState<Beer|null>(null),[detail,setDetail]=useState<Beer|null>(null),[scanning,setScanning]=useState(false),[help,setHelp]=useState(false),[saving,setSaving]=useState(false),[lookup,setLookup]=useState(false),[lookupText,setLookupText]=useState('');
 const [useDrinkAdvice,setUseDrinkAdvice]=useState(false);
 const [photoLoading,setPhotoLoading]=useState(false),[photoError,setPhotoError]=useState(''),[exporting,setExporting]=useState(false);
 const cameraInput=useRef<HTMLInputElement>(null),photoInput=useRef<HTMLInputElement>(null),photoSeq=useRef(0);
 const drinkAdvice=edit?suggestDrinkWindow(edit):null;
 const autoWindow=useDrinkAdvice?drinkAdvice:null;
 const fromYear=autoWindow?.drinkFromYear??edit?.drinkFromYear;
 const untilYear=autoWindow?.drinkUntilYear??edit?.drinkUntilYear;
 const [cameraError,setCameraError]=useState(''); const video=useRef<HTMLVideoElement>(null); const scannerControls=useRef<{stop:()=>void}|null>(null); const importRef=useRef<HTMLInputElement>(null);const lookupSeq=useRef(0);
 async function load(){setLoading(true);setError('');try{const r=await fetch(guest?'/api/public/beers':'/api/beers'); const body:any=await r.json();if(!r.ok)throw Error(body.error);setBeers(guest?body.map((beer:Partial<Beer>)=>({...emptyBeer(),purchaseDate:'',createdAt:'',updatedAt:'',...beer})):body);}catch(e){setError((e as Error).message||'Laden is niet gelukt.');}finally{setLoading(false);}}
 useEffect(()=>{if(signedIn||guest)void load();},[signedIn,guest,isWishlist]);
 useEffect(()=>{
  if(!local||!signedIn)return;
  const controller=new AbortController();
  async function readUntappd(){
   try{
    const response=await fetch('/api/untappd',{signal:controller.signal});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(!controller.signal.aborted)setUntappd(data);
   }catch{if(!controller.signal.aborted)setUntappdMessage('De Untappd-geschiedenis kon niet worden geladen.');}
   finally{if(!controller.signal.aborted)setUntappdLoading(false);}
  }
  void readUntappd();
  return ()=>controller.abort();
 },[local,signedIn]);
 useEffect(()=>{
  if(!local||!signedIn)return;
  const controller=new AbortController();
  async function readPrices(){
   try{
    const response=await fetch('/api/shop-prices',{signal:controller.signal});
    if(response.ok)setShopPrices(await response.json());
   }catch{/* The original price list remains available. */}
   finally{if(!controller.signal.aborted)setPricesLoading(false);}
  }
  void readPrices();
  return ()=>controller.abort();
 },[local,signedIn]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
 function notify(text:string){setToast(text);}
 async function importUntappd(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(file.size>40_000_000){setUntappdMessage('Kies een Untappd-export van maximaal 40 MB.');return;}
  setUntappdLoading(true);setUntappdMessage('');
  try{
   const entries=parseUntappdExport(await file.text());
   const response=await fetch('/api/untappd',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(entries)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'De geschiedenis kon niet worden opgeslagen.');
   setUntappd(result);
   setUntappdMessage(`Check-ins voor ${entries.length} ${entries.length===1?'bier':'bieren'} geïmporteerd.`);
  }catch(e){setUntappdMessage(e instanceof SyntaxError?'Dit lijkt geen geldige JSON-export.':(e as Error).message);}
  finally{setUntappdLoading(false);}
 }
 function openEditor(beer:Beer, useAdvice=false){
  lookupSeq.current++;photoSeq.current++;
  setLookup(false);setLookupText('');setPhotoLoading(false);setPhotoError('');setUseDrinkAdvice(useAdvice);setEdit(beer);
 }
 async function readPhoto(e:React.ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';
  if(!file)return;
  const seq=++photoSeq.current;
  setPhotoLoading(true);setPhotoError('');
  try{
   const photo=await prepareBeerPhoto(file);
   if(seq===photoSeq.current)setEdit(prev=>prev?{...prev,photo}:prev);
  }catch(error){if(seq===photoSeq.current)setPhotoError((error as Error).message);}
  finally{if(seq===photoSeq.current)setPhotoLoading(false);}
 }
 function changeDrinkYear(field:'drinkFromYear'|'drinkUntilYear', value:string){
  setUseDrinkAdvice(false);
  setEdit(prev=>prev?{...prev,drinkDate:'',drinkFromYear:fromYear,drinkUntilYear:untilYear,[field]:value?Number(value):undefined}:prev);
 }
 function add(){if(!signedIn){location.href=loginPath;return;}setExamples(false);openEditor(emptyBeer(),true);}
 async function persist(b:Beer){const validated=beerSchema.safeParse(b);if(!validated.success)throw Error(validated.error.issues[0]?.message||'Controleer de invoer.');const r=await fetch('/api/beers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const result:any=await r.json();if(!r.ok)throw Error(result.error);setBeers(prev=>[...prev.filter(x=>x.id!==result.id),result]);return result as Beer;}
 async function save(e:React.FormEvent){e.preventDefault();if(!edit)return;setSaving(true);setLookupText('');try{await persist(autoWindow?{...edit,drinkDate:'',drinkFromYear:fromYear,drinkUntilYear:untilYear}:edit);setEdit(null);notify('Toegevoegd aan je collectie. Alles is opgeslagen.');}catch(e){setLookupText((e as Error).message);}finally{setSaving(false);}}
 async function drink(b:Beer){setSaving(true);try{const next=await persist({...b,quantity:b.quantity-1});setDetail(next);notify('Eén fles minder in je voorraad. Proost!');}catch(e){notify((e as Error).message);}finally{setSaving(false);}}
 async function findBarcode(code:string){
  const seq=++lookupSeq.current;setLookup(true);setLookupText('');
  try {if(!/^\d{8,14}$/.test(code))throw Error('Vul een barcode van 8 tot 14 cijfers in.');
   const own=beers.find(b=>b.barcode===code);
   if(own){setEdit(prev=>prev?{...prev,name:own.name,brewery:own.brewery,style:own.style,abv:own.abv,volume:own.volume,image:own.image,source:own.source}:prev);setLookupText('Herkend uit je eigen collectie. Controleer de jaargang van deze aankoop.');return;}
   const r=await fetch('/api/lookup?code='+encodeURIComponent(code)); const p:any=await r.json(); if(seq!==lookupSeq.current)return; if(!r.ok)throw Error(p.error);
   setEdit(prev=>prev && prev.barcode===code ? {...prev,...p,brewery:p.brewery||prev.brewery,image:p.image||prev.image,volume:p.volume||prev.volume}:prev);
   setLookupText(`Gevonden via ${barcodeSource(p.source||'')}. Controleer het bier, de flesinhoud en de jaargang.`);
  }catch(e){if(seq===lookupSeq.current)setLookupText((e as Error).message);}finally{if(seq===lookupSeq.current)setLookup(false);}
 }
 function stopScan(){scannerControls.current?.stop();scannerControls.current=null; if(video.current?.srcObject)(video.current.srcObject as MediaStream).getTracks().forEach(t=>t.stop());setScanning(false);}
 async function startScan(){
  if(!signedIn){add();return;}
  if(!edit){setExamples(false);openEditor(emptyBeer(),true);}setCameraError('');setScanning(true);
 }
 useEffect(()=>{
  if(!scanning)return;let cancelled=false;
  async function begin(){try{if(!navigator.mediaDevices?.getUserMedia)throw Error('De camera is hier niet beschikbaar. Open de site rechtstreeks in Safari of Chrome via https, of typ de barcode.');
   const {BrowserMultiFormatReader}=await import('@zxing/browser');
   if(cancelled || !video.current)return;
   const reader=new BrowserMultiFormatReader();const controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false},video.current,(result)=>{if(result && !cancelled){cancelled=true;const code=result.getText();scannerControls.current?.stop();setScanning(false);setEdit(prev=>prev?{...prev,barcode:code}:prev);void findBarcode(code);}});
   if(cancelled)controls.stop();else scannerControls.current=controls;
  }catch(e){if(!cancelled)setCameraError((e as Error).name==='NotAllowedError'?'Cameratoegang is geweigerd. Sta de camera toe in je browserinstellingen of typ de barcode.':(e as Error).message||'De camera kon niet starten. Typ de barcode.');}}
  void begin();return()=>{cancelled=true;scannerControls.current?.stop();scannerControls.current=null;};
 },[scanning]);
 const source=examples?demo:beers;
 const catalogue=useMemo(()=>new Map(source.map(beer=>{
  const synced=syncedUntappdPage(beer);
  const entry=untappd?.entries.length?matchUntappd(beer,untappd.entries,beers)?.entry:undefined;
  return [beer.id,{
   style:beer.style.trim()||synced?.style||entry?.style||'',
   brewery:beer.brewery.trim()||synced?.brewery||entry?.brewery||'',
   abv:beer.abv??synced?.abv??entry?.abv,
   community:beer.untappdCommunityRating??synced?.communityRating,
   personal:synced?.rating??entry?.rating,
  }];
 })),[source,untappd,beers]);
 const currentDay=today();
 const active=source.filter(b=>b.quantity>0),ready=active.filter(b=>isReady(b,currentDay));
 const estimated=useMemo(()=>stockValue(source,shopPrices),[source,shopPrices]);
 const detailValue=detail&&!guest?bottleValue(detail,shopPrices):null;
 const detailUntappd=detail&&!examples?matchUntappd(detail,untappd?.entries??[],beers):null;
 const syncedUntappd=detail?syncedUntappdPage(detail):undefined;
 const personalUntappdScore=syncedUntappd?.rating??detailUntappd?.entry?.rating;
 const untappdCount=syncedUntappd?.count??detailUntappd?.entry?.count;
 const untappdLatest=syncedUntappd?.latest??detailUntappd?.entry?.latest;
 const untappdStyle=syncedUntappd?.style||detailUntappd?.entry?.style;
 const untappdAbv=syncedUntappd?.abv??detailUntappd?.entry?.abv;
 const untappdIbu=syncedUntappd?.ibu??detailUntappd?.entry?.ibu;
 const detailStyle=detail?.style.trim()||untappdStyle;
 const detailBrewery=detail?.brewery.trim()||syncedUntappd?.brewery||detailUntappd?.entry?.brewery;
 const detailAbv=detail?.abv??untappdAbv;
 const extraPhoto=detail?.image&&detail.photoPreference!=='own'?ownBeerPhoto(detail,guest):'';
 const editUntappd=edit?matchUntappd(edit,untappd?.entries??[],beers):null;
 function changeUntappdLink(link:string){
  setEdit(previous=>{
   if(!previous)return previous;
   const before=untappdBeerLink(previous.untappdUrl??'')?.id;
   const after=untappdBeerLink(link)?.id;
   return {...previous,untappdUrl:link,...(before!==after?{untappdCommunityRating:null,untappdDescription:''}:{})};
  });
 }
 async function refreshPrices(){
  setPricesLoading(true);setPriceMessage('');
  try{
   const response=await fetch('/api/shop-prices',{method:'POST'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Winkelprijzen ophalen is niet gelukt.');
   const snapshot=result as ShopPriceSnapshot;
   setShopPrices(snapshot);
   const matched=Object.values(snapshot.offers??{}).filter(offer=>offer.checkedAt===snapshot.checkedAt).length;
   const unavailable=snapshot.sources?.filter(source=>!source.available).map(source=>source.name)??[];
   setPriceMessage(`${matched} verschillende ${matched===1?'fles met een actuele winkelprijs':'flessen met een actuele winkelprijs'}. ${snapshot.scanned??0} voorraadregels gecontroleerd.${unavailable.length?' Tijdelijk onbereikbaar: '+unavailable.join(', ')+'.':''}`);
  }catch(e){setPriceMessage((e as Error).message||'Winkelprijzen ophalen is niet gelukt.');}
  finally{setPricesLoading(false);}
 }
 const shown=useMemo(()=>source.filter(b=>view==='history'?b.quantity===0:view==='ready'?isReady(b,currentDay):b.quantity>0).filter(b=>{
  const info=catalogue.get(b.id)!;
  return (style==='all'||info.style===style)&&[b.name,info.brewery,info.style,b.vintage,b.shop,b.barcode,b.location].join(' ').toLowerCase().includes(search.toLowerCase());
 }).sort((a,b)=>sort==='style'?compareBeerStyle({name:a.name,style:catalogue.get(a.id)!.style},{name:b.name,style:catalogue.get(b.id)!.style}):sort==='oldest'||sort==='youngest'?compareBeerAge(a,b,sort==='youngest'):sort==='name'?a.name.localeCompare(b.name):sort==='drink'?(drinkStart(a)||'9999').localeCompare(drinkStart(b)||'9999'):b.createdAt.localeCompare(a.createdAt)),[source,catalogue,view,style,search,sort,currentDay]);
 async function exportData(){
  setExporting(true);
  try{
   const entries:Beer[]=[];
   for(const beer of beers){
    if(!beer.hasPhoto){entries.push(beer);continue;}
    const response=await fetch(beerPhotoUrl(beer));
    if(!response.ok)throw Error('Een eigen foto kon niet worden opgehaald. Probeer opnieuw.');
    entries.push({...beer,photo:await photoDataUrl(await response.blob())});
   }
   const blob=new Blob([JSON.stringify({format:'bierkelder-v1',exportedAt:new Date().toISOString(),beers:entries},null,2)],{type:'application/json'});
   const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='bierkelder-'+today()+'.json';link.click();
   setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify('Je back-up is gedownload.');
  }catch(error){notify((error as Error).message);}finally{setExporting(false);}
 }
 async function importData(file:File){const maxMB=local?110:5;if(file.size>maxMB*1000000){notify(`Dit bestand is te groot (maximaal ${maxMB} MB).`);return;}try{const data=JSON.parse(await file.text());if(data.format!=='bierkelder-v1'||!Array.isArray(data.beers)||data.beers.length>500)throw Error('Kies een Bierkelder-back-up met maximaal 500 aankopen.');const valid=data.beers.map((b:unknown)=>beerSchema.parse(b));if(!local&&valid.some((b:Beer)=>b.photo))throw Error('Zet een back-up met eigen foto’s terug op je NAS.');const existing=new Set(beers.map(b=>b.id));const fresh=valid.filter((b:Beer)=>!existing.has(b.id));setSaving(true);for(const b of fresh)await persist(b);notify(fresh.length+' aankopen geïmporteerd. Bestaande aankopen zijn overgeslagen.');}catch(e){notify('Import gestopt: '+(e as Error).message);}finally{setSaving(false);if(importRef.current)importRef.current.value='';}}
 function navigateView(key:string){if(isUntappd||isWishlist){window.location.assign(key==='collection'?'/':'/?view='+key);return;}setView(key);setStyle('all');}
 const groups=useMemo(()=>{
  if(!grouped)return [];
  const byFamily=new Map<string,ReturnType<typeof beerFamily>&{beers:Beer[];years:number[]}>();
  for(const beer of shown){
   const family=beerFamily({...beer,brewery:catalogue.get(beer.id)!.brewery});
   const group=byFamily.get(family.key)??{...family,beers:[],years:[]};
   group.beers.push(beer);
   const year=beerYear(beer);
   if(year!==null&&!group.years.includes(year))group.years.push(year);
   byFamily.set(family.key,group);
  }
  return [...byFamily.values()].map(group=>({...group,years:group.years.sort((a,b)=>a-b)}));
 },[grouped,shown,catalogue]);
 function renderCard(b:Beer,i:number){const value=bottleValue(b,shopPrices);const info=catalogue.get(b.id)!;return <article className={'beer-card tone-'+i%3} key={b.id}><button type="button" className="beer-card-open" aria-label={`Bekijk ${b.name}`} onClick={()=>setDetail(b)}/><div className="beer-visual"><BeerPicture beer={b} guest={guest}/><span className="quantity-tag">{b.quantity} {b.quantity===1?'fles':'flessen'}</span>{isReady(b,currentDay)&&<span className="ready-tag">{b.drinkUntilYear&&b.drinkUntilYear<Number(currentDay.slice(0,4))?'Voorbij je drinkvenster':'Op je planning'}</span>}</div><div className="beer-content"><div className="beer-type">{info.style||'Bierstijl nog invullen'}</div><h3>{b.name}</h3>{b.vintage&&<span className="beer-vintage" aria-label={`Jaargang ${b.vintage}`}>{b.vintage}</span>}<p>{info.brewery||'Brouwerij nog invullen'}</p><div className="beer-meta"><span>{b.volume/10} cl{info.abv!=null?' · '+info.abv+'%':''}</span><span>{guest?'':b.price===null?'Prijs niet ingevuld':euro(b.price)+'/fles'}</span></div>{local&&!examples&&<div className="beer-ratings"><BeerRating label="Untappd" score={info.community}/>{signedIn&&<BeerRating label="Jij" score={info.personal}/>}</div>}{!guest&&<div className="beer-value">{value.amount===null?value.kind:<>Geschat <BeerValue value={value}/> per fles</>}</div>}<div className="beer-foot">{!guest&&<span><CalendarDays size={13}/>{date(b.purchaseDate)}</span>}<ArrowRight size={16}/></div></div></article>;}
 const patch=(key:keyof Beer,value:any)=>setEdit(prev=>prev?{...prev,[key]:value}:prev);
 return <div className={"app-shell"+(guest?" guest-cellar":"")}>
  <aside className="sidebar"><a className="brand" href="/"><span className="brand-icon"><Wine size={25}/></span><span>de bierkelder<small>GOED BIER VERDIENT TIJD</small></span></a>
   <div className="nav-caption">MIJN COLLECTIE</div><nav>{[["collection","De kelder",Wine],["ready","Klaar om te proeven",GlassWater],["history","Leeggedronken",Archive]].filter(([key])=>!guest||key==="collection").map(([key,label,Icon]:any)=><button key={key} className={!isUntappd&&!isWishlist&&view===key?'nav-item selected':'nav-item'} onClick={()=>navigateView(key)}><Icon size={19}/><span>{label}</span>{key==='ready'&&ready.length>0&&<b>{ready.length}</b>}</button>)}{local&&<a href="/wishlist" className={isWishlist?"nav-item selected":"nav-item"} aria-current={isWishlist?"page":undefined}><Heart size={19}/>Wishlist</a>}</nav>
   {!guest&&<><div className="nav-caption second">BEHEER</div>{local&&signedIn&&<a href="/untappd" className={isUntappd?"nav-item selected":"nav-item"} aria-current={isUntappd?"page":undefined}><BeerIcon size={19}/>Untappd</a>}<button className="nav-item" disabled={!signedIn||!beers.length||exporting} onClick={exportData}><ArrowDownToLine size={19}/>Back-up downloaden</button><button className="nav-item" disabled={!signedIn||saving} onClick={()=>importRef.current?.click()}><Archive size={19}/>Back-up terugzetten</button><input type="file" accept="application/json,.json" ref={importRef} hidden onChange={e=>{if(e.target.files?.[0])void importData(e.target.files[0]);}}/><button className="nav-item" onClick={()=>setHelp(true)}><CircleHelp size={19}/>Over je bierkelder</button></>}
   <div className="sidebar-note"><Leaf size={23}/><p>Een mooie fles.<br/>Een goed moment.<br/><em>Alle tijd ertussen.</em></p></div><div className="profile"><span>BK</span><div><b>De Bierkelder</b><small><ShieldCheck size={12}/> {guest?"Openbare collectie":"Privécollectie"}</small></div></div>
  </aside>
  <div className="main-column"><header className="topbar"><a className="mobile-brand" href="/"><Wine size={23}/> de bierkelder</a><div className="breadcrumb">Mijn collectie <span>/</span> <b>{isWishlist?'Wishlist':isUntappd?'Untappd':view==='history'?'Leeggedronken':view==='ready'?'Klaar om te proeven':'De kelder'}</b></div><div className="top-actions">{guest&&<a className="secondary" href="/login"><LogIn size={15}/> Inloggen</a>}{local&&signedIn&&<a href="/untappd" className="untappd-mobile">Untappd</a>}{local&&signedIn&&<button className="icon-btn" aria-label="Afmelden" onClick={onSignOut}><LogOut size={18}/></button>}<span className="private-pill"><ShieldCheck size={14}/> Alleen voor jou</span><button className="icon-btn help" aria-label="Help" onClick={()=>setHelp(true)}><CircleHelp size={20}/></button><span className="avatar">BK</span></div></header>
   <main>{isWishlist?<Wishlist signedIn={signedIn} collection={beers}/>:isUntappd?<><div className="page-heading"><div><span className="eyebrow">BIERGEGEVENS EN CHECK-INS</span><h1>Untappd</h1><p>Haal scores en bierinformatie op vanuit je eigen Untappd-sessie.</p></div></div>{error&&<p role="alert">{error}</p>}<UntappdSync beers={beers} entries={untappd?.entries??[]} onSaved={load} loading={loading||untappdLoading}/>
   <details className="lookup-box untappd-import"><summary>Importeren uit een bestand</summary>
    <h3>Check-ins importeren uit een bestand</h3>
    <p>Importeer je volledige Untappd-check-ingeschiedenis als CSV of JSON. Een nieuwe import vervangt de vorige geschiedenis.</p>
    <p>Je vindt de export bij Drink History op de Untappd-website met <a href="https://insiders.untappd.com/" target="_blank" rel="noreferrer">Untappd Insiders</a>.</p>
    {untappd&&<p>{untappd.entries.length} bierprofielen uit je export · geïmporteerd op {date(untappd.importedAt.slice(0,10))}</p>}
    <input type="file" accept=".csv,.json,text/csv,application/json" ref={untappdFile} hidden onChange={importUntappd}/>
    <button type="button" className="secondary" onClick={()=>untappdFile.current?.click()} disabled={untappdLoading}>Untappd-export kiezen</button>
    <p role="status">{untappdMessage}</p>
   </details>
</>:<><div className="page-heading"><div><span className="eyebrow">JOUW PERSOONLIJKE BIERCOLLECTIE</span><h1>{view==='history'?'Mooie herinneringen.':view==='ready'?'Tijd om te proeven.':'Bewaren met smaak.'}</h1><p>{view==='history'?'De flessen zijn leeg. De verhalen blijven.':view==='ready'?'Deze bieren hebben het begin van hun drinkvenster bereikt.':'Van die bijzondere aankoop tot de eerste slok. Alles op één plek.'}</p></div>{!guest&&<button className="primary add-desktop" onClick={add}><Plus size={18}/> Bier toevoegen</button>}</div>
   {examples&&<div className="example-notice"><Sparkles size={17}/><span>Je bekijkt voorbeeldgegevens. Dit is niet je eigen voorraad.</span><button onClick={()=>{setExamples(false);setDetail(null);}}>Terug naar mijn kelder <X size={15}/></button></div>}
   {!signedIn&&!guest&&<div className="signin-banner"><ShieldCheck size={19}/><span>Meld je aan om je collectie veilig te bewaren en op je mobiel te openen.</span><a className="small-btn" href={loginPath} target="_top">{local?"Aanmelden":"Aanmelden met ChatGPT"} <ArrowRight size={15}/></a></div>}
   <div className="stats"><div><span className="stat-icon"><Wine size={21}/></span><div><small>Flessen in de kelder</small><b>{active.reduce((n,b)=>n+b.quantity,0)} <em>flessen</em></b></div></div><div><span className="stat-icon"><BeerIcon size={21}/></span><div><small>Verschillende bieren</small><b>{new Set(active.map(b=>[b.name.toLowerCase(),b.brewery.toLowerCase()].join('|'))).size} <em>om te ontdekken</em></b></div></div><div><span className="stat-icon"><Clock3 size={21}/></span><div><small>Klaar om te proeven</small><b>{ready.reduce((n,b)=>n+b.quantity,0)} <em>op jouw planning</em></b></div></div>{!guest&&<div><span className="stat-icon"><span className="euro-icon">€</span></span><div><small>Geschatte voorraadwaarde</small><b className="money">{estimated.amount===null?'—':euro(estimated.amount)}</b>
    <small className="substat">{estimated.unknown>0?estimated.unknown+' '+(estimated.unknown===1?'fles zonder schatting':'flessen zonder schatting'):'Winkelprijzen en aankoopprijzen'}</small>
    {active.some(b=>b.price!=null)&&<small className="substat">Bekende aankoopwaarde {euro(active.reduce((n,b)=>n+(b.price??0)*b.quantity,0))}</small>}</div></div>}</div>
   {local&&signedIn&&!examples&&<div className="price-tools"><button type="button" className="secondary" onClick={refreshPrices} disabled={pricesLoading}>
    {pricesLoading?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>} Winkelprijzen verversen
   </button><a className="secondary" href="/prijzen">Prijsgeschiedenis</a>{shopPrices&&<span>Laatst gecontroleerd op {date(shopPrices.checkedAt.slice(0,10))}</span>}<span role="status">{priceMessage}</span></div>}
   {!guest&&<section className="scan-banner"><div className="scan-banner-copy"><span className="scan-emblem"><ScanLine size={27}/></span><div><span className="eyebrow">VAN FLES NAAR COLLECTIE</span><h2>Een nieuwe vondst? Scan 'm in.</h2><p>Scan de barcode, controleer het bier en voeg je aankoop toe.</p></div></div><button className="scan-button" onClick={startScan}><ScanLine size={19}/> Barcode scannen <ArrowRight size={17}/></button><div className="banner-bottle" aria-hidden="true"><Bottle name="RÉSERVE" mini/></div></section>}
   <section className="collection-section"><div className="section-heading"><div><h2>{view==='history'?'Leeggedronken':view==='ready'?'Op je proefplanning':'Mijn collectie'} <span>{shown.length}</span></h2><p>{view==='collection'?'Elke aankoop heeft zijn eigen plek.':''}</p></div><div className="collection-view-actions"><div className="view-switch" role="group" aria-label="Collectie groeperen"><button className={!grouped?"on":""} aria-pressed={!grouped} onClick={()=>setGrouped(false)}>Losse bieren</button><button className={grouped?"on":""} aria-pressed={grouped} onClick={()=>setGrouped(true)}>Groepen</button></div><div className="view-switch"><button aria-label="Kaartweergave" aria-pressed={!list} className={!list?'on':''} onClick={()=>setList(false)}><LayoutGrid size={17}/></button><button aria-label="Lijstweergave" aria-pressed={list} className={list?'on':''} onClick={()=>setList(true)}><List size={19}/></button></div></div></div>
   <div className="filters"><label className="search-box"><Search size={18}/><input aria-label="Zoek in je collectie" placeholder="Zoek op bier, brouwerij of barcode…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Zoekopdracht wissen" onClick={()=>setSearch('')}><X size={16}/></button>}</label><label className="select-wrap"><Settings2 size={16}/><select aria-label="Filter op bierstijl" value={style} onChange={e=>setStyle(e.target.value)}><option value="all">Alle bierstijlen</option>{Array.from(new Set(Array.from(catalogue.values(),b=>b.style).filter(Boolean))).sort().map(s=><option key={s}>{s}</option>)}</select><ChevronDown size={15}/></label><label className="select-wrap sort"><select aria-label="Sorteren" value={sort} onChange={e=>setSort(e.target.value)}><option value="new">Laatst toegevoegd</option><option value="name">Naam A–Z</option><option value="style">Biersoort A–Z</option><option value="oldest">Oudste bier eerst</option><option value="youngest">Jongste bier eerst</option>{!guest&&<option value="drink">Begin drinkvenster</option>}</select><ChevronDown size={15}/></label></div>
   {loading?<div className="empty"><LoaderCircle className="spin"/><h3>Je kelder wordt geopend…</h3></div>:error?<div className="empty error-state"><CircleHelp/><h3>Je collectie is even niet bereikbaar</h3><p>{error}</p><button className="primary" onClick={load}>Opnieuw proberen</button></div>:!shown.length?<div className="empty"><div className="empty-bottles"><Bottle name="JOUW EERSTE VONDST"/></div><span className="eyebrow">{search||style!=='all'?'GEEN RESULTATEN':'ALLE RUIMTE VOOR IETS BIJZONDERS'}</span><h3>{search||style!=='all'?'Geen bieren gevonden':view==='ready'?'Goede dingen hebben tijd nodig':view==='history'?'Nog geen lege flessen':'Je collectie begint met één fles.'}</h3><p>{search||style!=='all'?'Probeer een andere zoekterm of bierstijl.':view==='ready'?'Vul bij een bier een drinkvenster in. Het verschijnt hier vanaf het beginjaar.':view==='history'?'Als je de laatste fles opdrinkt, bewaren we je aankoop hier.':'Voeg je eerste bewaarbier toe. Scan de barcode of vul de gegevens zelf in.'}</p>{search||style!=='all'?<button className="secondary" onClick={()=>{setSearch('');setStyle('all');}}>Filters wissen</button>:view==='collection'&&!guest?<><button className="primary" onClick={add}><Plus size={17}/> Mijn eerste bier toevoegen</button><button className="text-btn" onClick={()=>setExamples(true)}>Bekijk een voorbeeld <ArrowRight size={15}/></button></>:null}</div>:grouped?<div className="beer-groups">{groups.map(group=><details className="beer-group" key={group.key}>
    <summary><div className="beer-group-photo"><BeerPicture beer={group.beers[0]} guest={guest}/></div>
     <div className="beer-group-name"><h3>{group.name}</h3><span>{group.brewery} · {group.beers.reduce((total,beer)=>total+beer.quantity,0)} flessen</span>
      {group.years.length>0&&<div className="year-chips">{group.years.map(year=><span className="beer-vintage" key={year}>{year}</span>)}</div>}
     </div><ChevronDown className="beer-group-chevron" size={20}/>
    </summary>
    <div className={list?'beer-grid list-view':'beer-grid'}>{group.beers.map(renderCard)}</div>
   </details>)}</div>:<div className={list?'beer-grid list-view':'beer-grid'}>{shown.map(renderCard)}</div>}
   </section><footer className="page-footer"><span><Leaf size={14}/> Met zorg verzameld. Met geduld bewaard.</span><button onClick={()=>setHelp(true)}>Over de bierkelder <ArrowRight size={13}/></button></footer></>}</main>
  </div>
  <nav className="mobile-nav" aria-label="Mobiele navigatie">{guest?<><a href="/" className={!isWishlist?"active":""}><Wine size={21}/>Collectie</a><a href="/wishlist" className={isWishlist?"active":""}><Heart size={21}/>Wishlist</a></>:<><button className={!isUntappd&&view==='collection'?'active':''} onClick={()=>navigateView('collection')}><Wine size={21}/>Collectie</button><button className={!isUntappd&&view==='ready'?'active':''} onClick={()=>navigateView('ready')}><Clock3 size={21}/>Proeven</button><button className="mobile-scan" onClick={startScan}><ScanLine size={24}/><span>Scannen</span></button><button className={!isUntappd&&view==='history'?'active':''} onClick={()=>navigateView('history')}><Archive size={21}/>Archief</button><button onClick={()=>setHelp(true)}><CircleHelp size={21}/>Meer</button>{local&&<a href="/wishlist" className={isWishlist?"active":""}><Heart size={21}/>Wishlist</a>}</>}</nav>
  {edit&&<Modal title={beers.some(b=>b.id===edit.id)?'Je bier aanpassen':'Een nieuwe vondst'} wide onClose={()=>{lookupSeq.current++;setEdit(null);}}><form onSubmit={save}>
   {local&&<div className="lookup-box photo-tools">
    <b>Foto op de collectiekaart</b>
    <label>Voorkeursfoto<select value={edit.photoPreference??'online'} onChange={e=>patch('photoPreference',e.target.value)}>
     <option value="online">Online afbeelding</option><option value="own">Mijn eigen foto</option>
    </select></label>
    <label>Online afbeelding (https-link)<input type="url" maxLength={1000} value={edit.image} onChange={e=>patch('image',e.target.value)} placeholder="Bijvoorbeeld een PNG met doorzichtige achtergrond"/></label>
    <small>Als je voorkeursfoto ontbreekt, wordt de andere foto getoond als die beschikbaar is.</small>
    <div className="photo-previews">
     {edit.image&&<figure><img className="photo-preview" src={edit.image} alt="Online bierafbeelding" referrerPolicy="no-referrer"/><figcaption>Online</figcaption></figure>}
     {ownBeerPhoto(edit)&&<figure><img className="photo-preview" src={ownBeerPhoto(edit)} alt="Je eigen bierfoto"/><figcaption>Mijn foto</figcaption></figure>}
    </div>
    <input type="file" accept="image/*" capture="environment" ref={cameraInput} hidden onChange={readPhoto}/>
    <input type="file" accept="image/*" ref={photoInput} hidden onChange={readPhoto}/>
    <div className="photo-actions">
     <button type="button" className="secondary" disabled={photoLoading||saving} onClick={()=>cameraInput.current?.click()}>Foto maken</button>
     <button type="button" className="secondary" disabled={photoLoading||saving} onClick={()=>photoInput.current?.click()}>Foto kiezen</button>
     {(edit.photo||(edit.photo!==null&&edit.hasPhoto))&&<button type="button" className="text-btn" disabled={photoLoading||saving} onClick={()=>{setPhotoError('');patch('photo',null);}}>Eigen foto verwijderen</button>}
    </div>
    {photoLoading&&<small role="status">Foto voorbereiden…</small>}
    {photoError&&<p className="lookup-message" role="alert">{photoError}</p>}
   </div>}
   <div className="lookup-box"><label>Barcode<div className="barcode-row"><input aria-label="Barcode" inputMode="numeric" placeholder="Bijvoorbeeld 5410…" value={edit.barcode} onChange={e=>{lookupSeq.current++;setLookup(false);patch('barcode',e.target.value.replace(/\D/g,''));}}/><button type="button" className="secondary" disabled={lookup||!edit.barcode} onClick={()=>findBarcode(edit.barcode)}>{lookup?<LoaderCircle className="spin" size={16}/>:<Search size={16}/>}Opzoeken</button><button type="button" className="icon-btn" aria-label="Scan barcode met camera" onClick={startScan}><ScanLine size={23}/></button></div></label><small>We zoeken eerst in je collectie en daarna in Open Food Facts{local?' en UPCitemdb':''}. Alle velden blijven aanpasbaar.</small>{lookupText&&<p className="lookup-message" role="status">{lookupText}</p>}</div>
   <div className="form-section-title"><BeerIcon size={18}/><h3>Het bier</h3></div><div className="form-grid"><label className="full">Naam van het bier *<input required maxLength={160} value={edit.name} onChange={e=>patch('name',e.target.value)} placeholder="Bijvoorbeeld Oude Geuze Black Label"/></label><label>Brouwerij<input maxLength={160} value={edit.brewery} onChange={e=>patch('brewery',e.target.value)} placeholder="Bijvoorbeeld Boon"/></label><label>Bierstijl<input list="styles" maxLength={100} value={edit.style} onChange={e=>patch('style',e.target.value)} placeholder="Bijvoorbeeld Geuze"/><datalist id="styles">{['Geuze','Lambiek','Vlaams oud bruin','Quadrupel','Dubbel','Tripel','Stout','Barleywine','Saison','Fruitbier','Blond'].map(s=><option key={s}>{s}</option>)}</datalist></label><label>Jaargang / botteling<input maxLength={30} value={edit.vintage} onChange={e=>patch('vintage',e.target.value)} placeholder="Bijvoorbeeld 2024 of assemblage 6"/></label><label>Alcohol (%)<input type="number" step="0.1" min="0" max="100" value={edit.abv??''} onChange={e=>patch('abv',e.target.value===''?null:Number(e.target.value))}/></label><label>Flesinhoud (ml)<input type="number" min="1" max="30000" required value={edit.volume} onChange={e=>patch('volume',Number(e.target.value))}/></label>{!local&&<label>Afbeelding (https-link)<input type="url" value={edit.image} onChange={e=>patch('image',e.target.value)} placeholder="Optioneel"/></label>}
<div className="full"><label>Untappd-link<input type="url" maxLength={1000} value={edit.untappdUrl??''} onChange={e=>changeUntappdLink(e.target.value)} placeholder="https://untappd.com/b/…"/><small>Plak de link naar de juiste editie om de automatische match te vervangen.</small></label>
 {edit.name.trim()&&<a className="source-link" href={untappdSearch(edit)} target="_blank" rel="noreferrer">Zoek op Untappd <ArrowRight size={14}/></a>}
 {local&&<><label className="untappd-checkbox"><input type="checkbox" checked={edit.untappdAutoMatch!==false} onChange={e=>patch('untappdAutoMatch',e.target.checked)}/> Automatisch koppelen als er geen link is ingevuld</label>
  {!edit.untappdUrl&&editUntappd&&<button className="secondary" type="button" onClick={()=>changeUntappdLink(editUntappd.url)}>Gebruik match{editUntappd.entry?' · '+editUntappd.entry.name:''}</button>}
 </>}
</div>{local&&<><label>Algemene Untappd-score (op 5, handmatig)<input type="number" min="0.1" max="5" step="0.01" value={edit.untappdCommunityRating??''} onChange={e=>patch('untappdCommunityRating',e.target.value===''?null:Number(e.target.value))}/></label>
 <label className="full">Bierbeschrijving (handmatig)<textarea rows={3} maxLength={1200} value={edit.untappdDescription??''} onChange={e=>patch('untappdDescription',e.target.value)}/></label></>}</div>
   <div className="form-section-title"><MapPin size={18}/><h3>Jouw aankoop</h3></div><div className="form-grid"><label>Aankoopdatum<input type="date" value={edit.purchaseDate} onInput={e=>patch('purchaseDate',e.currentTarget.value)} onChange={e=>patch('purchaseDate',e.target.value)}/></label><label>Prijs per fles (€)<input type="number" min="0" max="100000" step="0.01" value={edit.price??''} onChange={e=>patch('price',e.target.value===''?null:Number(e.target.value))} placeholder="Optioneel"/></label><label>Aangekocht aantal<input type="number" min="1" max="10000" required value={edit.purchasedQuantity} onChange={e=>{const n=Number(e.target.value);setEdit(prev=>prev?{...prev,purchasedQuantity:n,quantity:prev.quantity===prev.purchasedQuantity?n:Math.min(prev.quantity,n)}:prev);}}/></label><label>Nog in voorraad<input type="number" min="0" max={edit.purchasedQuantity} required value={edit.quantity} onChange={e=>patch('quantity',Number(e.target.value))}/></label><div className="full">
    <label>Aankoopplaats<input maxLength={200} value={edit.shop} onChange={e=>patch('shop',e.target.value)} placeholder="Winkel, brouwerij of webshop"/></label>
    {knownShops.length>0&&<div className="shop-options" role="group" aria-label="Eerdere aankoopplaatsen">
     {knownShops.map(shop=><button type="button" className="secondary" aria-pressed={shopKey(edit.shop)===shopKey(shop)} key={shop} onClick={()=>patch('shop',shop)}>{shop}</button>)}
    </div>}
   </div></div>
   <div className="form-section-title"><Clock3 size={18}/><h3>Bewaren & proeven</h3></div><div className="form-grid"><label>Best drinken vanaf (jaar)<input type="number" inputMode="numeric" min="1900" max="2199" step="1" required={untilYear!==undefined} value={fromYear??''} onChange={e=>changeDrinkYear('drinkFromYear',e.target.value)} placeholder="Bijvoorbeeld 2028"/></label>
   <label>Best drinken t/m (jaar)<input type="number" inputMode="numeric" min={fromYear||1900} max="2199" step="1" required={fromYear!==undefined} value={untilYear??''} onChange={e=>changeDrinkYear('drinkUntilYear',e.target.value)} placeholder="Bijvoorbeeld 2033"/></label>
   <div className="full">
    {edit.drinkDate&&!autoWindow&&<p className="form-hint">Eerdere drinkplanning: {date(edit.drinkDate)}. Vul beide jaren in om die te vervangen. <button type="button" className="text-btn" onClick={()=>changeDrinkYear('drinkFromYear','')}>Planning wissen</button></p>}
    {drinkAdvice?<div className="lookup-message">
     <strong>Voorstel {drinkAdvice.drinkFromYear}–{drinkAdvice.drinkUntilYear}</strong>
     <p>{drinkAdvice.explanation} {drinkAdvice.basis}</p>
     <a className="source-link" href={drinkAdvice.source} target="_blank" rel="noreferrer">{drinkAdvice.publisher} <ArrowRight size={14}/></a>
     {!autoWindow&&<button type="button" className="text-btn" onClick={()=>setUseDrinkAdvice(true)}>Gebruik dit voorstel</button>}
    </div>:<p className="form-hint">{edit.name.trim()?'Geen onderbouwd voorstel beschikbaar. Vul het venster zelf in.':'Vul de biernaam of scan de barcode voor een voorstel waar beschikbaar.'}</p>}
   </div><label>Ten minste houdbaar tot<input type="date" value={edit.bestBefore} onInput={e=>patch('bestBefore',e.currentTarget.value)} onChange={e=>patch('bestBefore',e.target.value)}/></label><label className="full">Bewaarplek<input maxLength={160} value={edit.location} onChange={e=>patch('location',e.target.value)} placeholder="Bijvoorbeeld rek A, onderste plank"/></label><label className="full">Notities<textarea rows={3} maxLength={5000} value={edit.notes} onChange={e=>patch('notes',e.target.value)} placeholder="Waarom deze fles, bewaardoel, proefnotities…"/></label></div><p className="form-hint">Het drinkvenster is een smaakadvies en blijft aanpasbaar. De houdbaarheidsdatum staat apart. Controleer bij een barcode de jaargang.</p>{edit.source&&<a className="source-link" href={edit.source} target="_blank" rel="noreferrer">Bierinformatie van {barcodeSource(edit.source)} ↗</a>}<div className="form-bottom"><button type="button" className="secondary" onClick={()=>setEdit(null)}>Annuleren</button><button className="primary" disabled={saving||lookup||photoLoading}>{saving?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {saving?'Opslaan…':'Opslaan in mijn kelder'}</button></div></form></Modal>}
  {scanning&&<Modal title="Scan de barcode" onClose={stopScan}><p className="scan-description">Richt je camera op de streepjescode achter op de fles. Zorg voor voldoende licht.</p><div className="camera"><video ref={video} autoPlay muted playsInline/><div className="scan-guide"/></div>{cameraError?<p role="alert" className="lookup-message">{cameraError}</p>:<p className="scan-description"><LoaderCircle className="spin" size={16}/> Wachten op een barcode…</p>}<button className="secondary full-button" onClick={stopScan}><Barcode size={18}/> Barcode zelf invullen</button><p className="form-hint">De camerabeelden blijven op je toestel. Alleen de herkende barcode wordt opgezocht.</p></Modal>}
  {detail&&<Modal title={detail.name} onClose={()=>setDetail(null)}><div className="detail-hero"><BeerPicture beer={detail} guest={guest}/><div><span className="eyebrow">{detailStyle||'JOUW BEWAARBIER'}</span><h3>{detailBrewery||'Brouwerij niet ingevuld'}</h3>{detail.vintage&&<span className="beer-vintage" aria-label={`Jaargang ${detail.vintage}`}>{detail.vintage}</span>}<p>{detail.volume/10} cl{detailAbv!=null?' · '+detailAbv+'%':''}</p><span className="detail-qty">{detail.quantity} {detail.quantity===1?'fles':'flessen'} in voorraad</span></div></div>{extraPhoto&&<details className="beer-extra-photo"><summary>Mijn eigen foto</summary><img src={extraPhoto} alt={'Mijn foto van '+detail.name} loading="lazy"/></details>}{((!detail.style.trim()&&detailStyle)||(!detail.brewery.trim()&&detailBrewery)||(detail.abv===null&&detailAbv!=null))&&<p className="form-hint">Ontbrekende bierinformatie aangevuld uit Untappd.</p>}{!guest&&<><dl className="detail-grid"><div><dt>Aankoopdatum</dt><dd>{date(detail.purchaseDate)}</dd></div><div><dt>Aankoopprijs per fles</dt><dd>{detail.price===null?'Niet ingevuld':euro(detail.price)}</dd></div>
   {detailValue&&<div><dt>Geschatte waarde per fles</dt><dd><BeerValue value={detailValue}/></dd>
    {detailValue.evidence?<small className="value-source">{detailValue.kind} · <a href={detailValue.evidence.url} target="_blank" rel="noreferrer">{detailValue.evidence.source}</a> · nagekeken op {date(detailValue.evidence.checkedOn??pricesCheckedOn)}{detailValue.evidence.note&&<><br/>{detailValue.evidence.note}</>}</small>:detailValue.amount!==null&&<small className="value-source">Op basis van je aankoopprijs</small>}
   </div>}<div><dt>Gekocht bij</dt><dd>{detail.shop||'Niet ingevuld'}</dd></div><div><dt>Bewaarplek</dt><dd>{detail.location||'Niet ingevuld'}</dd></div><div><dt>Drinkvenster</dt><dd>{detail.drinkFromYear&&detail.drinkUntilYear?`${detail.drinkFromYear}–${detail.drinkUntilYear}`:date(detail.drinkDate)}</dd></div><div><dt>Houdbaar tot</dt><dd>{date(detail.bestBefore)}</dd></div><div><dt>Aangekocht</dt><dd>{detail.purchasedQuantity} flessen</dd></div><div><dt>Barcode</dt><dd>{detail.barcode||'Niet ingevuld'}</dd></div></dl>{detail.notes&&<div className="detail-notes"><span className="eyebrow">JOUW NOTITIES</span><p>{detail.notes}</p></div>}</>}{local&&!examples&&<section className="lookup-box untappd-detail" aria-label="Untappd">
 <h3>Untappd</h3>
 {syncedUntappd?<p><strong>{syncedUntappd.name}</strong> · Gesynchroniseerd op {date(syncedUntappd.checkedAt.slice(0,10))}</p>:detailUntappd&&<p><strong>{detailUntappd.entry?.name??'Bierpagina gekoppeld'}</strong> · {detailUntappd.method}</p>}
 <dl className="detail-grid">
  <div><dt>Algemene score</dt><dd>{detail.untappdCommunityRating!=null?untappdScore(detail.untappdCommunityRating)+(guest?'':' (handmatig)'):syncedUntappd?.communityRating!=null?untappdScore(syncedUntappd.communityRating):'Bekijk de actuele score op Untappd'}</dd></div>
  {!guest&&<div><dt>Jouw laatst gegeven score</dt><dd>{personalUntappdScore!=null?untappdScore(personalUntappdScore):'Geen score beschikbaar'}</dd></div>}
  {untappdCount!=null&&<div><dt>Jouw check-ins</dt><dd>{untappdCount}{untappdLatest&&' · laatste op '+date(untappdLatest.slice(0,10))}</dd></div>}
  {untappdStyle&&<div><dt>Bierstijl</dt><dd>{untappdStyle}</dd></div>}
  {untappdAbv!=null&&<div><dt>Alcohol</dt><dd>{untappdAbv}%</dd></div>}
  {untappdIbu!=null&&<div><dt>Bitterheid</dt><dd>{untappdIbu} IBU</dd></div>}
 </dl>
 {(detail.untappdDescription||syncedUntappd?.description)&&<p>{detail.untappdDescription||syncedUntappd?.description}</p>}
</section>}{local&&signedIn&&!examples&&<BeerPriceHistory beerKey={priceKey(detail)}/>}<a className="untappd-link" href={syncedUntappd?.url||detailUntappd?.url||detail.untappdUrl||untappdSearch(detail)} target="_blank" rel="noreferrer">{syncedUntappd||detailUntappd||detail.untappdUrl?'Open dit bier op Untappd':'Zoek dit bier op Untappd'} <ArrowRight size={16}/></a>{!examples&&!guest&&<div className="form-bottom"><button className="secondary" disabled={saving} onClick={()=>{openEditor(detail);setDetail(null);}}>Aanpassen</button>{detail.quantity>0&&<button className="primary" disabled={saving} onClick={()=>drink(detail)}><GlassWater size={17}/>{saving?'Opslaan…':'Eén fles opgedronken'}</button>}</div>}{examples&&<p className="form-hint">Dit is een voorbeeld. De gegevens worden niet aan je collectie toegevoegd.</p>}</Modal>}
  {help&&<Modal title="Jouw collectie, overal bij de hand" onClose={()=>setHelp(false)}><div className="help-content"><h3>Van aankoop tot eerste slok</h3><p>Scan een barcode of voeg een bier handmatig toe. Elke aankoop blijft apart bewaard, ook als je hetzelfde bier later opnieuw koopt.</p><h3>Een barcode is een begin</h3><p>Open Food Facts{local?' en UPCitemdb':''} leveren beschikbare basisinformatie. Sommige bieren ontbreken; controleer altijd het resultaat. Je kunt alle gegevens aanpassen. Sla de Untappd-link naar de juiste editie op bij een bier. Zonder link kun je vanuit de bierdetails zoeken op Untappd.</p><h3>Op jouw planning</h3><p>Kies een begin- en eindjaar voor je drinkvenster. Waar beschikbaar helpen we met een voorstel met bron. Vanaf het beginjaar verschijnt de fles bij “Klaar om te proeven”. Er worden geen meldingen verstuurd.</p><h3>Veilig bewaren</h3><p>Je collectie wordt online opgeslagen en is na aanmelden op je andere apparaten beschikbaar. Download af en toe een back-up. Op je iPhone kun je de site via Safari delen en toevoegen aan je beginscherm.</p><div className="help-buttons"><button className="secondary" disabled={!signedIn||!beers.length||exporting} onClick={exportData}><ArrowDownToLine size={16}/>Back-up downloaden</button><button className="secondary" disabled={!signedIn||saving} onClick={()=>importRef.current?.click()}>Back-up terugzetten</button></div><p className="attribution">Productinformatie: <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. Productafbeeldingen: CC BY-SA. Je aankoopgegevens worden niet met deze bron gedeeld.</p></div></Modal>}
  {toast&&<div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Melding sluiten" onClick={()=>setToast('')}><X size={17}/></button></div>}
 </div>;
}
