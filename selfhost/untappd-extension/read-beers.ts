import {untappdBeerLink,untappdIdentity,type UntappdPage} from '../../app/untappd';
import {untappdOrigin,type SyncBeer,type SyncCandidate,type SyncIssue} from '../../app/untappd-protocol';

export function signedInProfile(doc:Document){
 if(!doc.querySelector('header a[href="/logout"],nav a[href="/logout"]'))return;
 return [...doc.querySelectorAll('header a[href^="/user/"],nav a[href^="/user/"]')]
  .map(a=>a.getAttribute('href')?.replace(/\/$/,''))
  .find(path=>path&&/^\/user\/[^/]+$/.test(path));
}
const text=(root:ParentNode,selector:string,limit=160)=>root.querySelector(selector)?.textContent?.trim().replace(/\s+/g,' ').slice(0,limit)??'';
function number(value:string|null|undefined,min:number,max:number){
 if(!value?.trim())return null;
 const parsed=Number(value);
 return Number.isFinite(parsed)&&parsed>=min&&parsed<=max?parsed:null;
}
function date(value:string|null|undefined){
 if(!value)return null;
 const parsed=new Date(value);
 return Number.isFinite(parsed.valueOf())?parsed.toISOString():null;
}
export function readBeerPage(doc:Document,profile:string,url:string):UntappdPage|null{
 const name=text(doc,'.name h1');
 if(!name)return null;
 const stat=[...doc.querySelectorAll('.stats .stat')].find(element=>element.textContent?.trim()==='You');
 const count=number(stat?.parentElement?.querySelector('.count')?.textContent?.replace(/[^\d]/g,''),0,250000);
 const checkins=[...doc.querySelectorAll('.activity .checkin')]
  .filter(item=>item.querySelector('a.user')?.getAttribute('href')?.replace(/\/$/,'')===profile)
  .map(item=>({
   date:date(item.querySelector('a.time[data-gregtime]')?.getAttribute('data-gregtime')),
   rating:number(item.querySelector('[data-rating]')?.getAttribute('data-rating'),0.1,5),
  })).sort((a,b)=>(b.date??'').localeCompare(a.date??''));
 const community=number(doc.querySelector('.details [data-rating]')?.getAttribute('data-rating'),0.1,5);
 return {
  url,name,brewery:text(doc,'.name .brewery'),style:text(doc,'.name .style',100),
  communityRating:community===null?null:Math.round(community*100)/100,
  rating:checkins.find(item=>item.rating!==null)?.rating??null,count,latest:checkins[0]?.date??null,
  abv:number(text(doc,'.details .abv').match(/[\d.]+/)?.[0],0,100),ibu:number(text(doc,'.details .ibu').match(/[\d.]+/)?.[0],0,1000),
  description:text(doc,'.beer-descrption-read-less .beer-description, .beer-descrption-read-less',240).replace(/\s*Show Less$/i,''),
  checkedAt:new Date().toISOString(),
 };
}

export function readSearchResults(doc:Document):SyncCandidate[]{
 const results:SyncCandidate[]=[];
 for(const item of doc.querySelectorAll('.beer-item .beer-details')){
  const link=untappdBeerLink(item.querySelector('.name a')?.getAttribute('href')??'');
  const name=text(item,'.name a');
  if(link&&name)results.push({url:link.url,name,brewery:text(item,'.brewery'),style:text(item,'.style',100)});
 }
 return results;
}

export async function readUntappd(beers:SyncBeer[],profile:string,progress:(completed:number)=>void,search:(query:string)=>Promise<SyncCandidate[]>){
 let blocked=false;
 async function page(path:string){
  await new Promise(resolve=>setTimeout(resolve,550));
  const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(12000)});
  const location=new URL(response.url);
  if([401,403,429].includes(response.status)||location.pathname.startsWith('/login')){
   blocked=true;
   throw Error('Untappd heeft de aanvragen gestopt.');
  }
  if(!response.ok||location.origin!==untappdOrigin)throw Error('Untappd-pagina niet beschikbaar.');
  const doc=new DOMParser().parseFromString(await response.text(),'text/html');
  if(signedInProfile(doc)!==profile){
   blocked=true;
   throw Error('Je Untappd-sessie is veranderd.');
  }
  return doc;
 }
 const searches=new Map<string,SyncCandidate[]>();
 async function candidates(query:string){
  const cached=searches.get(query);
  if(cached)return cached;
  const results=await search(query);
  searches.set(query,results);
  return results;
 }
 async function find(beer:SyncBeer){
  const identity=untappdIdentity(beer);
  const alias=beer.name.replace(/^Boon (Oude Geuze) /i,'$1 Boon ');
  const shortName=alias.replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?$/,'').trim();
  const brewery=beer.brewery.replace(/^(?:brouwerij|brewery|brasserie) /i,'').trim();
  const branded=brewery&&!shortName.toLowerCase().includes(brewery.toLowerCase())?brewery+' '+shortName:shortName;
  const year=beer.vintage.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const found=new Map<string,SyncCandidate>();
  const exact=new Map<string,SyncCandidate>();
  let read=false;
  for(const query of new Set([year&&branded?branded+' '+year:'',branded,alias,shortName])){
   if(!query)continue;
   const matches=await candidates(query).catch(()=>null);
   if(!matches)continue;
   read=true;
   for(const candidate of matches){
    const id=untappdBeerLink(candidate.url)!.id;
    found.set(id,candidate);
    if(identity&&untappdIdentity({...candidate,vintage:''})===identity)exact.set(id,candidate);
   }
   if(exact.size)break;
  }
  if(!read)throw Error('Untappd heeft de zoekresultaten niet geladen.');
  if(exact.size===1)return {link:untappdBeerLink(exact.values().next().value!.url),candidates:[]};
  const brewerKey=(name:string)=>name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/^(?:brouwerij|brewery|brasserie) /,'').trim();
  const sameBrewery=[...found.values()].filter(item=>brewerKey(item.brewery)===brewerKey(beer.brewery));
  const options=exact.size?[...exact.values()]:sameBrewery.length?sameBrewery:[...found.values()];
  return {link:null,candidates:options.slice(0,8)};
 }
 const results:{id:string;key:string;page:UntappdPage}[]=[];
 const issues:SyncIssue[]=[];
 const pages=new Map<string,UntappdPage>();
 for(const [index,beer] of beers.entries()){
  if(blocked)break;
  progress(index);
  const {id,key}=beer;
  try{
   let link=untappdBeerLink(beer.url);
   if(!link){
    const match=beer.auto?await find(beer):null;
    link=match?.link??null;
    if(!link){
     const candidates=match?.candidates??[];
     issues.push({id,key,candidates,reason:candidates.length?'choice':'no-match'});
     continue;
    }
   }
   let snapshot=pages.get(link.id);
   if(!snapshot){
    const doc=await page(new URL(link.url).pathname+'?filter=you');
    const canonical=untappdBeerLink(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')??'');
    if(canonical&&canonical.id!==link.id)throw Error('Andere bierpagina.');
    snapshot=readBeerPage(doc,profile,canonical?.url??link.url)??undefined;
    if(!snapshot)throw Error('Geen biergegevens.');
    pages.set(link.id,snapshot);
   }
   results.push({id:beer.id,key:beer.key,page:snapshot});
  }catch{issues.push({id,key,candidates:[],reason:'page-error'});}
 }
 return {results,blocked,issues};
}
