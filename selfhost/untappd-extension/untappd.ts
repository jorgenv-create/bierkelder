import {readSearchResults,readUntappd,signedInProfile} from './read-beers';
import {untappdBeerLink} from '../../app/untappd';

function addWishlistButton(){
 if(!untappdBeerLink(location.href))return;
 const heading=document.querySelector('.name h1');
 const name=heading?.textContent?.trim();
 if(!heading||!name)return;
 const brewery=document.querySelector('.name .brewery')?.textContent?.trim()??'';
 const button=document.createElement('button');
 button.type='button';
 button.textContent='♡ Op Bierkelder-wishlist';
 button.style.cssText='display:block;margin:8px 0;padding:6px 10px;border:1px solid #50704c;border-radius:6px;background:#f2f6e9;color:#223d28;cursor:pointer;font:inherit';
 button.addEventListener('click',async()=>{
  button.disabled=true;
  const result=await chrome.runtime.sendMessage({kind:'wishlist-open',name,brewery}).catch(()=>null);
  button.textContent=result?.ok?'Wishlist geopend':'Wishlist openen mislukt · probeer opnieuw';
  button.disabled=!!result?.ok;
 });
 heading.after(button);
}

async function reportSearch(){
 const query=new URLSearchParams(location.search).get('q');
 if(!query)return;
 const profile=signedInProfile(document);
 const candidates=await new Promise<ReturnType<typeof readSearchResults>|null>(resolve=>{
  const observer=new MutationObserver(check);
  const timer=setTimeout(()=>finish(null),10_000);
  function finish(result:ReturnType<typeof readSearchResults>|null){
   clearTimeout(timer);
   observer.disconnect();
   resolve(result);
  }
  function check(){
   const results=readSearchResults(document);
   const summary=document.querySelector('#algolia-search-results, .algolia-search-results')??document.body;
   if(results.length)finish(results);
   else if(summary&&/\b(?:0\s+drink results|no (?:drink )?results)\b/i.test(summary.textContent??''))finish([]);
  }
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  check();
 });
 await chrome.runtime.sendMessage({kind:'search-result',query,profile,candidates});
}

async function run(){
 const profile=signedInProfile(document);
 const job=await chrome.runtime.sendMessage({kind:'ready',signedIn:Boolean(profile)});
 if(!profile||!job?.beers)return;
 try{
  const reply=await readUntappd(job.beers,profile,completed=>{
   void chrome.runtime.sendMessage({kind:'report',id:job.id,reply:{kind:'progress',completed}}).catch(()=>{});
  },async query=>{
   const result=await chrome.runtime.sendMessage({kind:'search',id:job.id,query,profile});
   if(!Array.isArray(result?.candidates))throw Error('Untappd heeft de zoekresultaten niet geladen.');
   return result.candidates;
  });
  await chrome.runtime.sendMessage({kind:'report',id:job.id,reply:{kind:'result',...reply}});
 }catch{
  await chrome.runtime.sendMessage({kind:'report',id:job.id,reply:{kind:'error',message:'De Untappd-pagina kon niet worden uitgelezen.'}});
 }
}
if(location.pathname==='/search')void reportSearch().catch(()=>{});
else{
 if(location.pathname.startsWith('/b/')||location.pathname.startsWith('/beer/'))addWishlistButton();
 void run().catch(()=>{});
}
