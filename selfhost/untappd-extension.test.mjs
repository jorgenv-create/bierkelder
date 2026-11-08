import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Script,runInNewContext} from 'node:vm';
import {unzipSync,strFromU8} from 'fflate';
const origin=new URL(process.env.BIERKELDER_EXTENSION_ORIGIN||'http://127.0.0.1:3080').origin;

test('Untappd-extensie wacht op login en stuurt resultaten uitsluitend terug naar de oorspronkelijke Bierkelder-tab',async()=>{
 const zip=unzipSync(readFileSync(new URL('../dist-selfhost/public/bierkelder-untappd-1.3.zip',import.meta.url)));
 const manifest=JSON.parse(strFromU8(zip['manifest.json']));
 for(const file of [manifest.background.service_worker,...manifest.content_scripts.flatMap(script=>script.js)]){
  assert.doesNotThrow(()=>new Script(strFromU8(zip[file])));
 }
 const store={},updates=[],replies=[];
 let listener;
 const chrome={
  runtime:{id:'bierkelder',onMessage:{addListener(fn){listener=fn;}}},
  storage:{session:{
   async get(key){return {[key]:store[key]};},
   async set(value){Object.assign(store,value);},
   async remove(key){delete store[key];},
  }},
  tabs:{
   async create({active}){return {id:active?7:8};},
   async update(tab,value){updates.push({tab,...value});},
   async sendMessage(tab,message){replies.push({tab,...message});},
   async remove(){},
   onRemoved:{addListener(){}},
  },
 };
 runInNewContext(strFromU8(zip[manifest.background.service_worker]),{chrome,URL,setTimeout,clearTimeout});
 const sender=(url,id)=>({id:'bierkelder',frameId:0,tab:{id},url,origin:new URL(url).origin});
 const send=(message,from)=>new Promise(resolve=>{
  if(!listener(message,from,resolve))resolve(undefined);
 });
 const owner=sender(origin+'/untappd',3);
 const untappd=sender('https://untappd.com/home',7);
 const request={kind:'start',id:'test',beers:[{id:'beer',key:'key',name:'Test',brewery:'Brouwer',vintage:'',auto:true,url:''}]};
 assert.equal(await send(request,sender(origin+'/',3)),undefined);
 assert.equal((await send(request,owner)).kind,'login');
 assert.equal(updates[0].url,'https://untappd.com/home');
 assert.equal(await send({kind:'ready',signedIn:false},untappd),undefined);
 assert.equal(await send({kind:'ready',signedIn:true},sender('https://untappd.com/home',8)),undefined);
 assert.equal((await send({kind:'ready',signedIn:true},untappd)).beers[0].name,'Test');
 const query='Liefmans Goudenband';
 const search=send({kind:'search',id:'test',query,profile:'/user/eigen-profiel'},untappd);
 await new Promise(resolve=>setImmediate(resolve));
 const searchUrl=updates.at(-1).url;
 assert.equal(new URL(searchUrl).searchParams.get('q'),query);
 const candidates=[{name:'Goudenband (2022)',url:'https://untappd.com/b/brouwerij-liefmans-goudenband-2022/4866781'}];
 await send({kind:'search-result',query,profile:'/user/eigen-profiel',candidates},sender(searchUrl,8));
 assert.equal((await search).candidates,candidates);
 await send({kind:'report',id:'test',reply:{kind:'result',results:[],blocked:false}},untappd);
 assert.equal(replies.at(-1).tab,3);
 assert.equal(replies.at(-1).reply.kind,'result');
 assert.equal(updates.at(-1).tab,3);
 assert.equal(Object.keys(store).length,0);
 const beerUrl='https://untappd.com/b/boon-test/123';
 assert.equal((await send({kind:'wishlist-open',name:'Testbier',brewery:'Boon'},sender(beerUrl,9))).ok,true);
 assert.equal(updates.at(-1).url,origin+'/wishlist');
 assert.equal(await send({kind:'wishlist-pull'},sender(origin+'/wishlist',8)),undefined);
 const wishTab=sender(origin+'/wishlist',7);
 assert.equal((await send({kind:'wishlist-pull'},wishTab)).url,beerUrl);
 await send({kind:'wishlist-done'},wishTab);
 assert.equal(Object.keys(store).length,0);
});

test('bij een ontbrekende jaargang stuurt de extensie kandidaten terug voor een handmatige keuze',async()=>{
 const zip=unzipSync(readFileSync(new URL('../dist-selfhost/public/bierkelder-untappd-1.3.zip',import.meta.url)));
 const node=(textContent,href)=>({textContent,getAttribute:()=>href});
 const profile=node('', '/user/eigen-profiel');
 const document={
  querySelector:()=>node('Logout'),
  querySelectorAll:()=>[profile],
 };
 const job={id:'test',beers:[{id:'beer',key:'key',name:'Testgeuze (2020)',brewery:'Testbrouwer',vintage:'2020',auto:true,url:''}]};
 const requested=[];
 let finish;
 const result=new Promise(resolve=>{finish=resolve;});
 runInNewContext(strFromU8(zip['untappd.js']),{
  document,URL,location:{pathname:'/home'},
  chrome:{runtime:{async sendMessage(message){
   if(message.kind==='ready')return job;
   if(message.kind==='search'){
    requested.push(message.query);
    return {candidates:[
     {name:'Testgeuze',url:'https://untappd.com/b/testgeuze/101',brewery:'Testbrouwer',style:'Geuze'},
     {name:'Testgeuze (2019)',url:'https://untappd.com/b/testgeuze-2019/102',brewery:'Testbrouwer',style:'Geuze'},
    ]};
   }
   if(message.reply?.kind==='result'||message.reply?.kind==='error')finish(message.reply);
  }}},
 });
 const reply=await result;
 assert.equal(reply.kind,'result');
 assert.equal(reply.results.length,0);
 assert.equal(reply.issues[0].reason,'choice');
 assert.equal(reply.issues[0].candidates.length,2);
 assert.equal(reply.issues[0].candidates[0].url,'https://untappd.com/b/testgeuze/101');
 assert.equal(requested[0],'Testbrouwer Testgeuze 2020');
});

test('de zoekpagina stuurt kandidaten pas door nadat Untappd ze in de pagina heeft gezet',async()=>{
 const zip=unzipSync(readFileSync(new URL('../dist-selfhost/public/bierkelder-untappd-1.3.zip',import.meta.url)));
 const node=(textContent,href)=>({textContent,getAttribute:()=>href});
 let results=[],notify,report;
 const response=new Promise(resolve=>{report=resolve;});
 const document={
  body:{textContent:''},
  querySelector:selector=>selector.includes('logout')?node('Logout'):null,
  querySelectorAll:selector=>selector.includes('header')?[node('Profiel','/user/eigen-profiel')]:results,
 };
 runInNewContext(strFromU8(zip['untappd.js']),{
  document,URL,URLSearchParams,setTimeout,clearTimeout,
  location:{pathname:'/search',search:'?q=Liefmans%20Goudenband'},
  MutationObserver:class {
   constructor(callback){notify=callback;}
   observe(){}
   disconnect(){}
  },
  chrome:{runtime:{async sendMessage(message){report(message);}}},
 });
 await new Promise(resolve=>setImmediate(resolve));
 results=[{querySelector:selector=>({
  '.name a':node('Goudenband (2022)','/b/brouwerij-liefmans-goudenband-2022/4866781'),
  '.brewery':node('Brouwerij Liefmans'),'.style':node('Sour - Flanders Oud Bruin'),
 })[selector]}];
 notify();
 const message=await response;
 assert.equal(message.query,'Liefmans Goudenband');
 assert.equal(message.candidates[0].name,'Goudenband (2022)');
});
