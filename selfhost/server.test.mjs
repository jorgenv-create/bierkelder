import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createBierServer,lookupBarcode} from '../dist-selfhost/server.mjs';
import {emptyBeer,beerSchema} from '../dist-selfhost/schema.mjs';
import {drinkStart,suggestDrinkWindow} from '../app/drink-window.ts';
test('handmatige invoer werkt ook op een lokaal HTTP-adres zonder randomUUID',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis.crypto,'randomUUID');
 Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true});
 try{const a={...emptyBeer(),name:'Lokaal testbier'},b=emptyBeer();assert.equal(beerSchema.safeParse(a).success,true);assert.notEqual(a.id,b.id);}finally{if(previous)Object.defineProperty(globalThis.crypto,'randomUUID',previous);else delete globalThis.crypto.randomUUID;}
});
test('drinkvenster gebruikt bronadvies, behoudt oudere planningen en laat onbekende bieren vrij',()=>{
 const beer={...emptyBeer(),name:'Oude Geuze Boon Black Label',vintage:'2019',purchaseDate:'2026-11-06'};
 const advice=suggestDrinkWindow(beer);
 assert.equal(advice.drinkFromYear,2022);
 assert.equal(advice.drinkUntilYear,2029);
 assert.equal(suggestDrinkWindow({...beer,name:'Liefmans Goudenband',vintage:'assemblage 6'}).drinkUntilYear,2036);
 assert.equal(suggestDrinkWindow({...beer,name:'Onbekend bier'}),null);
 assert.equal(drinkStart({...beer,drinkDate:'2027-05-12'}),'2027-05-12');
 assert.equal(drinkStart({...beer,drinkFromYear:2028}),'2028-01-01');
});
test('barcode zoekt eerst bij Open Food Facts en gebruikt alleen een exacte tweede match',async()=>{
 const code='5410041001238';
 const calls=[];
 const fetcher=async url=>{
  calls.push(new URL(url).hostname);
  return calls.length===1?new Response(null,{status:404}):Response.json({items:[
   {ean:'5410041001237',title:'Ander product'},
   {ean:code,title:'Testbier',brand:'Testbrouwer',images:['http://example.test/old','https://example.test/beer.jpg']}
  ]});
 };
 const match=await lookupBarcode(code,{fetcher});
 assert.deepEqual(calls,['world.openfoodfacts.org','api.upcitemdb.com']);
 assert.equal(match.name,'Testbier');
 assert.equal(match.image,'https://example.test/beer.jpg');
 assert.match(match.source,/upcitemdb/);
 const first=await lookupBarcode(code,{canFallback:()=>false,fetcher:async()=>Response.json({product:{product_name:'Eerste bron',quantity:'33 cl'}})});
 assert.equal(first.volume,330);
 await assert.rejects(lookupBarcode(code,{fetcher:async()=>new Response(null,{status:404})}),{status:404});
 await assert.rejects(lookupBarcode(code,{fetcher:async()=>new Response(null,{status:404}),canFallback:()=>false}),{status:429});
});
test('selfhost: lokale setup, sessies, autorisatie, opslag en herstart',async()=>{
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const origin='http://127.0.0.1:'+port,publicOrigin='https://bier.example.com';
 const dataDir=mkdtempSync(path.join(tmpdir(),'bierkelder-test-'));let lookups=0;
 const config={dataDir,localOrigin:origin,publicOrigin,allowSetup:true,lookup:async code=>{lookups++;return {name:'Testbier',barcode:code};}};
 let server=createBierServer(config);
 async function start(){server.listen(port,'127.0.0.1');await once(server,'listening');}
 async function stop(){server.closeAllConnections();await new Promise(r=>server.close(r));}
 async function request(route,{method='GET',data,cookie,originHeader=origin,host,extraHeaders={}}={}){const headers={...extraHeaders};if(method!=='GET'){headers.Origin=originHeader;headers['Content-Type']='application/json';}if(cookie)headers.Cookie=cookie;if(host)headers.Host=host;return new Promise((resolve,reject)=>{const r=http.request(origin+route,{method,headers},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));});r.on('error',reject);if(data!==undefined)r.write(JSON.stringify(data));r.end();});}
 let running=false;
 try{
  await start();running=true;
  assert.equal((await request('/api/beers')).status,401);
  assert.equal((await request('/api/session')).status,200);
  const password=randomBytes(24).toString('base64url'),credentials={username:'testgebruiker',password};
  assert.equal((await request('/api/setup',{method:'POST',data:credentials,originHeader:publicOrigin,host:'bier.example.com'})).status,403,'setup via openbaar adres moet geweigerd worden');
  assert.equal((await request('/api/setup',{method:'POST',data:credentials,originHeader:'https://evil.example'})).status,403);
  assert.equal((await request('/api/setup',{method:'POST',data:{...credentials,password:'kort'}})).status,400);
  const setup=await request('/api/setup',{method:'POST',data:credentials});assert.equal(setup.status,201);
  let cookie=setup.headers.get('set-cookie').split(';')[0];assert.match(setup.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await request('/api/setup',{method:'POST',data:credentials})).status,409);
  assert.equal((await request('/api/login',{method:'POST',data:{...credentials,password:'onjuist'}})).status,401);
  const publicLogin=await request('/api/login',{method:'POST',data:credentials,host:'bier.example.com',originHeader:publicOrigin});assert.equal(publicLogin.status,200);assert.match(publicLogin.headers.get('set-cookie'),/; Secure/);
  const beer={...emptyBeer(),name:'Testaankoop',quantity:3,purchasedQuantity:3,price:4,purchaseDate:'2026-11-06',drinkDate:'2028-07-01'};
  const window={drinkFromYear:2029,drinkUntilYear:2035};
  const untappdUrl='https://untappd.com/b/brouwerij-boon-oude-geuze-boon-black-label/1254816';
  const photoBytes=Buffer.from([0xff,0xd8,0xff,0xe0,0xff,0xd9]);
  const photo='data:image/jpeg;base64,'+photoBytes.toString('base64');
  const photoPath=`/api/beers/${beer.id}/photo`;
  assert.equal((await request('/api/beers',{method:'POST',data:beer,cookie,originHeader:'https://evil.example'})).status,403);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,quantity:-1},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:beer,cookie})).status,200);
  assert.equal((await (await request('/api/beers',{cookie})).json())[0].drinkDate,'2028-07-01');
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,drinkFromYear:2029},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,...window,drinkUntilYear:2027},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,untappdUrl:'https://untappd.com.example/b/beer/1254816'},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,photo:'data:image/svg+xml;base64,AAAA'},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,...window,drinkDate:'',untappdUrl,photo},cookie})).status,200);
  assert.equal((await request(photoPath)).status,401);
  await stop();running=false;server=createBierServer(config);await start();running=true;
  assert.equal((await (await request('/api/session',{cookie})).json()).authenticated,true,'sessie moet herstart overleven');
  const restored=await (await request('/api/beers',{cookie})).json();assert.equal(restored.length,1);assert.equal(restored[0].price,4);
  assert.equal(restored[0].untappdUrl,untappdUrl);
  assert.equal(restored[0].drinkFromYear,2029);
  assert.equal(restored[0].drinkUntilYear,2035);
  assert.equal(restored[0].hasPhoto,true);
  assert.equal(restored[0].photo,undefined);
  assert.equal((await request('/api/beers',{method:'POST',data:{...restored[0],quantity:2},cookie})).status,200);
  assert.equal((await (await request('/api/beers',{cookie})).json())[0].quantity,2);
  const imageResponse=await request(photoPath,{cookie});
  assert.equal(imageResponse.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),photoBytes);
  assert.equal((await request('/api/beers',{method:'POST',data:{...restored[0],photo:null},cookie})).status,200);
  assert.equal((await request(photoPath,{cookie})).status,404);
  for(let i=0;i<2;i++)assert.equal((await request('/api/lookup?code=5410000000000',{cookie})).status,200);
  assert.equal(lookups,1,'herhaalde barcode moet uit cache komen');
  assert.equal((await request('/api/logout',{method:'POST',cookie})).status,200);
  assert.equal((await request('/api/beers',{cookie})).status,401,'afgemelde sessie moet ongeldig zijn');
  assert.equal((await request('/api/beers',{extraHeaders:{'oai-authenticated-user-id':'fake'}})).status,401,'oude hostingheaders geven geen toegang');
 }finally{if(running)await stop();const prefix=path.resolve(tmpdir())+path.sep+'bierkelder-test-';if(path.resolve(dataDir).startsWith(prefix))rmSync(dataDir,{recursive:true,force:true});}
});
