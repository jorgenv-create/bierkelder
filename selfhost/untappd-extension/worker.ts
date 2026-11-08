import {cellarOrigin,maxSyncBeers,untappdOrigin,type SyncBeer,type SyncCandidate,type SyncReply} from '../../app/untappd-protocol';
import {untappdBeerLink} from '../../app/untappd';

type Job={id:string;cellarTab:number;untappdTab:number;searchTab?:number;beers:SyncBeer[];expires:number;running:boolean};
const key='untappdJob';
const pending=async()=> (await chrome.storage.session.get(key))[key] as Job|undefined;
let starting=false;
const wishKey=(tab:number)=>'wishlist:'+tab;

async function openWishlist(senderUrl:string,input:any){
 const link=untappdBeerLink(senderUrl);
 const name=typeof input?.name==='string'?input.name.trim().slice(0,160):'';
 const brewery=typeof input?.brewery==='string'?input.brewery.trim().slice(0,160):'';
 if(!link||!name)return {ok:false};
 const {id}=await chrome.tabs.create({url:'about:blank',active:true});
 if(id===undefined)return {ok:false};
 await chrome.storage.session.set({[wishKey(id)]:{name,brewery,url:link.url,expires:Date.now()+15*60_000}});
 await chrome.tabs.update(id,{url:cellarOrigin+'/wishlist'});
 return {ok:true};
}

async function pendingWish(tab:number,done:boolean){
 const key=wishKey(tab);
 if(done){await chrome.storage.session.remove(key);return;}
 const stored=(await chrome.storage.session.get(key))[key] as {expires:number}|undefined;
 if(stored&&stored.expires>Date.now())return stored;
 if(stored)await chrome.storage.session.remove(key);
}
let waiting:{tab:number;query:string;profile:string;complete:(candidates:SyncCandidate[]|null)=>void}|undefined;

async function deliver(job:Job,reply:SyncReply){
 try{await chrome.tabs.sendMessage(job.cellarTab,{kind:'reply',id:job.id,reply});}catch{}
}
async function finish(job:Job,reply:SyncReply){
 await chrome.storage.session.remove(key);
 if(job.searchTab!==undefined){
  if(waiting?.tab===job.searchTab)waiting.complete(null);
  await chrome.tabs.remove(job.searchTab).catch(()=>{});
 }
 await deliver(job,reply);
 if(reply.kind==='result')await chrome.tabs.update(job.cellarTab,{active:true}).catch(()=>{});
}
async function search(job:Job,query:string,profile:string){
 if(typeof query!=='string'||!query.trim()||query.length>360||typeof profile!=='string'||!/^\/user\/[^/]+$/.test(profile)||waiting)return;
 let tab=job.searchTab;
 if(tab===undefined){
  tab=(await chrome.tabs.create({url:'about:blank',active:false})).id;
  if(tab===undefined)return;
  const current=await pending();
  if(current?.id!==job.id){await chrome.tabs.remove(tab).catch(()=>{});return;}
  await chrome.storage.session.set({[key]:{...current,searchTab:tab}});
 }
 return new Promise<{candidates:SyncCandidate[]|null}>(resolve=>{
  const timer=setTimeout(()=>complete(null),15_000);
  function complete(candidates:SyncCandidate[]|null){
   clearTimeout(timer);
   if(waiting?.complete===complete)waiting=undefined;
   resolve({candidates});
  }
  waiting={tab,query,profile,complete};
  void chrome.tabs.update(tab,{url:untappdOrigin+'/search?q='+encodeURIComponent(query)}).catch(()=>complete(null));
 });
}
function validBeer(beer:SyncBeer){
 return beer&&typeof beer.auto==='boolean'&&(['id','key','name','brewery','vintage','url'] as const)
  .every(field=>typeof beer[field]==='string'&&beer[field].length<=1600);
}
async function start(id:string,beers:SyncBeer[],cellarTab:number):Promise<SyncReply>{
 if(starting)return {kind:'error',message:'Er wordt al een synchronisatie gestart.'};
 starting=true;
 let untappdTab:number|undefined;
 try{
  const existing=await pending();
  if(existing&&existing.expires>Date.now())return {kind:'error',message:'Er loopt al een synchronisatie. Rond die eerst af of sluit de bijbehorende Untappd-tab.'};
  if(typeof id!=='string'||!Array.isArray(beers)||!beers.length||beers.length>maxSyncBeers||!beers.every(validBeer))return {kind:'error',message:'De zoekopdracht is ongeldig.'};
  untappdTab=(await chrome.tabs.create({url:'about:blank',active:true})).id;
  if(untappdTab===undefined)throw Error();
  const job:Job={id,cellarTab,untappdTab,beers,expires:Date.now()+5*60_000,running:false};
  await chrome.storage.session.set({[key]:job});
  await chrome.tabs.update(untappdTab,{url:untappdOrigin+'/home'});
  return {kind:'login'};
 }catch{
  if(untappdTab!==undefined)await chrome.tabs.remove(untappdTab).catch(()=>{});
  await chrome.storage.session.remove(key);
  return {kind:'error',message:'De Untappd-tab kon niet worden geopend.'};
 }finally{starting=false;}
}
async function fromUntappd(message:any,tab:number){
 const job=await pending();
 if(!job||job.untappdTab!==tab||job.expires<Date.now())return;
 if(message.kind==='ready'){
  if(job.running){
   await finish(job,{kind:'error',message:'De Untappd-tab is herladen tijdens het synchroniseren. Start de synchronisatie opnieuw.'});
   return;
  }
  if(!message.signedIn)return;
  await chrome.storage.session.set({[key]:{...job,running:true,expires:Date.now()+40*60_000}});
  await deliver(job,{kind:'progress',completed:0});
  return {id:job.id,beers:job.beers};
 }
 if(message.id!==job.id||!job.running)return;
 if(message.kind==='search')return search(job,message.query,message.profile);
 if(message.kind!=='report')return;
 const reply=message.reply as SyncReply;
 if(reply.kind==='progress')await deliver(job,reply);
 if(reply.kind==='error'||reply.kind==='result')await finish(job,reply);
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||sender.frameId!==0||sender.tab?.id===undefined)return;
 const tab=sender.tab.id;
 if(sender.origin===untappdOrigin&&message.kind==='search-result'){
  const url=sender.url?new URL(sender.url):null;
  const current=waiting;
  if(current&&current.tab===tab&&url?.pathname==='/search'&&url.searchParams.get('q')===current.query&&message.query===current.query){
   current.complete(message.profile===current.profile&&Array.isArray(message.candidates)?message.candidates:null);
  }
  return;
 }
 let task;
 if(sender.origin===untappdOrigin&&sender.url&&message.kind==='wishlist-open')task=openWishlist(sender.url,message);
 else if(sender.origin===cellarOrigin&&sender.url&&new URL(sender.url).pathname==='/wishlist'&&['wishlist-pull','wishlist-done'].includes(message.kind))task=pendingWish(tab,message.kind==='wishlist-done');
 if(sender.origin===cellarOrigin&&sender.url&&new URL(sender.url).pathname==='/untappd'&&message.kind==='start')task=start(message.id,message.beers,tab);
 if(sender.origin===untappdOrigin&&!task)task=fromUntappd(message,tab);
 if(!task)return;
 void task.then(respond).catch(()=>respond({kind:'error',message:'De browserextensie kon de synchronisatie niet voltooien.'}));
 return true;
});
chrome.tabs.onRemoved.addListener(tab=>{
 void chrome.storage.session.remove(wishKey(tab)).catch(()=>{});
 void pending().then(async job=>{
  if(job?.untappdTab===tab)await finish(job,{kind:'error',message:'De Untappd-tab is gesloten. Start de synchronisatie opnieuw.'});
  if(job?.cellarTab===tab)await finish(job,{kind:'error',message:'De Bierkelder-tab is gesloten.'});
  if(job?.searchTab===tab){
   await chrome.storage.session.set({[key]:{...job,searchTab:undefined}});
   if(waiting?.tab===tab)waiting.complete(null);
  }
 }).catch(()=>{});
});
