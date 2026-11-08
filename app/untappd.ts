import { z } from 'zod';
import type { Beer } from './beer';
import { priceKey } from '../selfhost/shop-prices.mjs';

export function untappdBeerLink(input: string) {
 try {
  const url=new URL(input.trim(), 'https://untappd.com');
  const match=url.pathname.match(/^\/(?:b\/(?:[^/]+\/)?|beer\/)(\d{1,15})\/?$/);
  if(!match||!['https://untappd.com','https://www.untappd.com'].includes(url.origin)||url.username||url.password)return null;
  return {id:match[1],url:`https://untappd.com${url.pathname.replace(/\/$/,'')}`};
 }catch{return null;}
}

const score=z.number().min(0.1).max(5);
export const untappdPageSchema=z.object({
 url:z.string().max(1000).refine(value=>/^https:\/\//.test(value)&&!!untappdBeerLink(value)),
 name:z.string().min(1).max(160),brewery:z.string().max(160),style:z.string().max(100),
 communityRating:score.nullable(),rating:score.nullable(),abv:z.number().min(0).max(100).nullable(),
 ibu:z.number().min(0).max(1000).nullable(),count:z.number().int().min(0).max(250000).nullable(),
 latest:z.string().datetime().nullable(),description:z.string().max(1200),checkedAt:z.string().datetime(),
});
export const untappdPageSyncSchema=z.object({kind:z.literal('bierkelder-untappd-results'),results:z.array(z.object({
 id:z.string().uuid(),key:z.string().max(1600),page:untappdPageSchema,
})).min(1).max(30)});
export type UntappdPage=z.infer<typeof untappdPageSchema>;

export function untappdSyncKey(beer:Pick<Beer,'name'|'brewery'|'vintage'|'barcode'|'untappdUrl'|'untappdAutoMatch'>){
 return JSON.stringify([beer.name,beer.brewery,beer.vintage,beer.barcode,beer.untappdUrl??'',beer.untappdAutoMatch!==false]);
}
export function syncedUntappdPage(beer:Beer){
 const page=beer.untappdPage;
 return page?.key===untappdSyncKey(beer)?page.data:undefined;
}
const entrySchema=z.object({
 id:z.string().regex(/^\d{1,15}$/),url:z.string().max(1000),name:z.string().min(1).max(160),brewery:z.string().max(160),
 style:z.string().max(100),abv:z.number().min(0).max(100).nullable(),ibu:z.number().min(0).max(1000).nullable(),
 barcode:z.string().regex(/^$|^\d{8,14}$/),vintage:z.string().regex(/^$|^(?:19|20)\d{2}$/),
 count:z.number().int().min(1).max(250000),latest:z.string().datetime().nullable(),ratedAt:z.string().datetime().nullable(),rating:score.nullable(),
}).refine(entry=>untappdBeerLink(entry.url)?.id===entry.id,'Ongeldige bierlink');
export const untappdCatalogSchema=z.array(entrySchema).min(1).max(20000).refine(items=>new Set(items.map(item=>item.id)).size===items.length);
export type UntappdEntry=z.infer<typeof entrySchema>;

function csvRows(text:string){
 const delimiter=text.split(/\r?\n/,1)[0].includes(';')?';':',';
 const rows:string[][]=[];
 let row:string[]=[],field='',quoted=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==='"'&&quoted&&text[index+1]==='"'){field+='"';index++;}
  else if(char==='"'&&(quoted||!field))quoted=!quoted;
  else if(!quoted&&(char===delimiter||char==='\n')){
   row.push(field.replace(/\r$/,''));field='';
   if(char==='\n'){rows.push(row);row=[];}
  }else field+=char;
 }
 if(quoted)throw Error('Dit CSV-bestand lijkt onvolledig.');
 if(row.length||field)rows.push([...row,field.replace(/\r$/,'')]);
 const headers=rows.shift()?.map(value=>value.trim().toLowerCase())??[];
 if(!headers.includes('beer_name')||!headers.includes('beer_url'))throw Error('Kies een export van je Untappd-check-ins.');
 const allowed=new Set(['beer_name','beer_url','brewery_name','beer_type','beer_abv','beer_ibu','created_at','rating_score','barcode','vintage','checkin_url','checkin_id']);
 const columns=headers.flatMap((key,index)=>allowed.has(key)?[{key,index}]:[]);
 return rows.map(values=>Object.fromEntries(columns.map(({key,index})=>[key,values[index]])));
}

function numeric(value:unknown,min:number,max:number){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!value.trim())return null;
 const number=Number(typeof value==='string'?value.replace(',','.'):value);
 return Number.isFinite(number)&&number>=min&&number<=max?number:null;
}

function timestamp(value:unknown){
 if(typeof value!=='string'||!value.trim())return null;
 const clean=value.trim();
 const utc=clean.replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/,'$1T$2Z');
 const date=new Date(utc);
 return Number.isFinite(date.valueOf())?date.toISOString():null;
}

export function parseUntappdExport(source:string){
 const text=source.replace(/^\uFEFF/,'').trim();
 const parsed=/^[\[{]/.test(text)?JSON.parse(text):csvRows(text);
 const rows=Array.isArray(parsed)?parsed:parsed?.checkins??parsed?.data;
 if(!Array.isArray(rows)||rows.length>250000)throw Error('Kies een geldig Untappd-bestand met maximaal 250.000 check-ins.');
 const entries=new Map<string,UntappdEntry>();
 const checkins=new Set<string>();
 const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const name=clean(row.beer_name,160),link=untappdBeerLink(clean(row.beer_url,1000).replace(/^http:\/\/(www\.)?untappd\.com\//i,'https://untappd.com/'));
  if(!name||!link)continue;
  const checkin=String(row.checkin_id||row.checkin_url||'');
  if(checkin&&checkins.has(checkin))continue;
  if(checkin)checkins.add(checkin);
  const latest=timestamp(row.created_at);
  const rating=numeric(row.rating_score,0.1,5);
  const rawBarcode=String(row.barcode??'').trim();
  const rawVintage=clean(String(row.vintage??''),30);
  const entry=entries.get(link.id)??{
   ...link,name,brewery:clean(row.brewery_name,160),style:clean(row.beer_type,100),
   abv:numeric(row.beer_abv,0,100),ibu:numeric(row.beer_ibu,0,1000),
   barcode:/^\d{8,14}$/.test(rawBarcode)?rawBarcode:'',vintage:/^(?:19|20)\d{2}$/.test(rawVintage)?rawVintage:'',
   count:0,latest:null,ratedAt:null,rating:null,
  };
  entry.count++;
  if(latest&&(!entry.latest||latest>entry.latest))entry.latest=latest;
  if(rating!==null&&(entry.rating===null||(latest&&(!entry.ratedAt||latest>entry.ratedAt)))){
   entry.rating=rating;entry.ratedAt=latest;
  }
  entries.set(link.id,entry);
 }
 if(!entries.size)throw Error('Geen check-ins met een geldige Untappd-bierlink gevonden.');
 return untappdCatalogSchema.parse([...entries.values()]);
}

const words=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/gueuze/g,'geuze').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function untappdIdentity(beer:{name:string;brewery:string;vintage:string}){
 const brewery=words(beer.brewery).replace(/^(?:brouwerij|brewery|brasserie) /,'');
 let title=words(beer.name);
 const years=[...new Set([title,beer.vintage].flatMap(value=>value.match(/\b(?:19|20)\d{2}\b/g)??[]))];
 if(years.length>1||(beer.vintage.trim()&&!years.length))return '';
 if(brewery==='boon'){
  const priced=priceKey({...beer,vintage:years[0]??'',volume:750});
  if(priced){
   const [,edition,,year]=JSON.parse(priced);
   if(/^black label \d+$/.test(edition))return JSON.stringify([brewery,edition,year]);
  }
 }
 if(brewery&&title.startsWith(brewery+' '))title=title.slice(brewery.length+1);
 title=title.replace(/\b(?:19|20)\d{2}\b/g,' ').replace(/\s+/g,' ').trim();
 return title&&brewery?JSON.stringify([brewery,title,years[0]??'']):'';
}

export function matchUntappd(beer:Beer,entries:UntappdEntry[],collection:Beer[]){
 const link=untappdBeerLink(beer.untappdUrl??'');
 if(link)return {...link,entry:entries.find(entry=>entry.id===link.id),method:'Handmatig gekoppeld'};
 if(beer.untappdAutoMatch===false)return null;
 const key=untappdIdentity(beer);
 if(!key)return null;
 const nameMatches=entries.filter(entry=>untappdIdentity(entry)===key);
 if(beer.barcode){
  const byBarcode=[...nameMatches.filter(entry=>entry.barcode===beer.barcode)];
  const savedLinks=collection.filter(item=>item.barcode===beer.barcode&&untappdIdentity(item)===key)
   .flatMap(item=>{const saved=untappdBeerLink(item.untappdUrl??'');return saved?[saved]:[];});
  const linked=new Map([...byBarcode,...savedLinks].map(item=>[item.id,item]));
  if(linked.size>1)return null;
  const first=linked.values().next().value;
  if(first)return {...first,entry:entries.find(entry=>entry.id===first.id),method:'Gematcht op barcode'};
 }
 const [entry]=nameMatches;
 return nameMatches.length===1?{id:entry.id,url:entry.url,entry,method:'Gematcht op naam, brouwerij en jaargang'}:null;
}
