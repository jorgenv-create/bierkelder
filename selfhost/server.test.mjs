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
import {fetchShopPrices,priceKey} from '../dist-selfhost/shop-prices.mjs';
import {matchUntappd,parseUntappdExport,untappdSyncKey} from '../app/untappd.ts';
import {emptyBeer,beerSchema} from '../dist-selfhost/schema.mjs';
import {drinkStart,suggestDrinkWindow} from '../app/drink-window.ts';
import {bottleValue,stockValue} from '../app/beer-value.ts';
import {beerFamily,beerYear} from '../app/beer-family.ts';
test('collectiegroepen houden jaargangen en edities van dezelfde bierreeks samen',()=>{
 const classic={name:'Liefmans Goudenband',brewery:'Liefmans',vintage:'2016'};
 assert.equal(beerFamily(classic).key,beerFamily({name:'Goudenband (2022)',brewery:'Brouwerij Liefmans'}).key);
 assert.notEqual(beerFamily(classic).key,beerFamily({...classic,name:'Goudenband Barrel Aged'}).key);
 const black={name:'Boon Oude Geuze Black Label Edition N°4',brewery:'Boon',vintage:'2017'};
 assert.equal(beerFamily(black).key,beerFamily({...black,name:'Oude Geuze Boon Black Label Edition N°10'}).key);
 assert.equal(beerFamily(black).name,'Boon Black Label');
 assert.equal(beerYear({name:'Oude Geuze (2022–2023)',brewery:'Boon'}),2022);
});
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
test('Black Label gebruikt de winkelprijs voor de juiste editie en flesinhoud',()=>{
 const beers=[
  {...emptyBeer(),brewery:'Brouwerij Boon',name:'Boon Oude Gueuze Black Label Edition N°4 – 75 cl',price:3,quantity:2},
  {...emptyBeer(),brewery:'Boon',name:'Oude Geuze Boon Black Label 5th Edition',price:3},
  {...emptyBeer(),brewery:'Boon',name:'Black Label nr. 06 (2020)',price:3},
 ];
 const prices=beers.map(beer=>bottleValue(beer));
 assert.deepEqual(prices.map(price=>price.amount),[21.50,19.50,18]);
 assert.ok(prices.every(price=>price.kind==='Winkelprijs'&&price.evidence.source==='Huis van de Geuze'));
 assert.deepEqual(stockValue(beers),{amount:80.50,unknown:0});
 for(const beer of [{...beers[0],volume:375},{...beers[1],brewery:'Andere brouwerij'},{...beers[2],name:'Black Label'}]){
  assert.deepEqual(bottleValue(beer),{amount:3,kind:'Aankoopprijs',evidence:null});
 }
 const checkedAt='2026-11-09T10:00:00.000Z';
 const key=priceKey(beers[0]);
 const offer={amount:25,url:'https://www.huisvandegeuze.be/winkel/boon-4/',source:'Huis van de Geuze',checkedAt};
 const live={checkedAt,keys:beers.map(priceKey),offers:{[key]:offer}};
 assert.equal(bottleValue(beers[0],live).evidence.url,offer.url);
 assert.equal(bottleValue(beers[1],live).kind,'Aankoopprijs');
 assert.deepEqual(stockValue(beers,live),{amount:56,unknown:0});
});
const shopProduct={name:'Boon Oude Geuze Black Label Edition N°4 &#8211; 75 cl',type:'simple',permalink:'https://www.huisvandegeuze.be/winkel/boon-4/',is_in_stock:true,is_purchasable:true,attributes:[{name:'Merken',terms:[{name:'Boon'}]}],prices:{price:'2450',currency_code:'EUR',currency_minor_unit:2}};
const pricedBeer={...emptyBeer(),name:'Oude Geuze Boon Black Label #4',brewery:'Brouwerij Boon',vintage:'2017'};
const untappdCsv=`beer_name,brewery_name,beer_type,beer_abv,beer_ibu,rating_score,created_at,beer_url,checkin_id,comment
"Boon Oude Geuze Black Label Edition N°4",Boon,Geuze,7,0,4.25,2026-10-02 18:30:00,/b/boon-black-label-4/101,10,"proefnotitie,
met nieuwe regel"
"Boon Oude Geuze Black Label Edition N°4",Boon,Geuze,7,0,0,2026-10-03 18:30:00,/b/boon-black-label-4/101,11,
`;
test('Untappd-import houdt jaargangen, handmatige koppelingen en de laatste gegeven score apart',()=>{
 const entries=parseUntappdExport(untappdCsv);
 assert.equal(entries.length,1);
 assert.equal(entries[0].count,2);
 assert.equal(entries[0].rating,4.25);
 assert.equal(entries[0].latest,'2026-10-03T18:30:00.000Z');
 assert.equal(entries[0].ratedAt,'2026-10-02T18:30:00.000Z');
 assert.ok(!('comment' in entries[0]));
 assert.equal(matchUntappd(pricedBeer,entries,[])?.id,'101');
 assert.equal(matchUntappd({...pricedBeer,vintage:'2019'},entries,[]),null);
 assert.equal(matchUntappd({...pricedBeer,untappdAutoMatch:false},entries,[]),null);
 assert.equal(matchUntappd({...pricedBeer,untappdUrl:'https://untappd.com/b/andere-editie/102'},entries,[])?.entry,undefined);
 assert.equal(matchUntappd({...pricedBeer,barcode:'5412345678901'},entries,[{...pricedBeer,barcode:'5412345678901',untappdUrl:'https://untappd.com/b/gematcht/102'}])?.id,'102');
 const json=parseUntappdExport(JSON.stringify([{beer_name:'Testbier',beer_url:'http://untappd.com/beer/102',rating_score:'3,5'}]));
 assert.equal(json[0].url,'https://untappd.com/beer/102');
 assert.equal(json[0].rating,3.5);
});
test('winkelprijzen vergelijken beide webshops en houden inhoud en jaargang uit elkaar',async()=>{
 const newer={...pricedBeer,vintage:'2018'};
 const geuze={...pricedBeer,name:'Oude Geuze',vintage:'2024'};
 const otherYear={...geuze,vintage:'2023'};
 const secondUrl='https://geuzeshop.com/shop/boon-4/';
 const snapshot=await fetchShopPrices([pricedBeer,newer,geuze,otherYear,{...pricedBeer,volume:375}],async input=>{
  const url=new URL(input);
  assert.ok(['black label','boon oude geuze'].includes(url.searchParams.get('search')));
  if(url.hostname==='geuzeshop.com')return Response.json([{...shopProduct,permalink:secondUrl,prices:{...shopProduct.prices,price:'2200'}}]);
  assert.equal(url.hostname,'www.huisvandegeuze.be');
  return Response.json([shopProduct,{...shopProduct,name:'Boon Oude Geuze 75cl (2024)',permalink:'https://www.huisvandegeuze.be/winkel/boon-2024/'},
   {...shopProduct,name:'Boon Oude Geuze 75cl (2023)',is_in_stock:false}]);
 });
 assert.equal(Object.keys(snapshot.offers).length,2);
 assert.equal(snapshot.offers[priceKey(pricedBeer)].amount,22);
 assert.equal(snapshot.offers[priceKey(pricedBeer)].url,secondUrl);
 assert.equal(snapshot.offers[priceKey(geuze)].amount,24.50);
 await assert.rejects(fetchShopPrices([pricedBeer],async()=>new Response(null,{status:503})));
});
test('winkelprijzen geven voorrang aan de juiste jaargang en labelen terugval zonder jaartal',async()=>{
 const older={...emptyBeer(),name:'Liefmans Goudenband',brewery:'Liefmans',vintage:'2022',volume:750};
 const recent={...older,vintage:'2025'};
 const snapshot=await fetchShopPrices([older,recent],async input=>{
  const url=new URL(input);
  if(url.pathname.includes('wp-json')){
   return Response.json(url.hostname==='www.huisvandegeuze.be'?[{...shopProduct,name:'Liefmans Goudenband 75cl (2022)',
    permalink:'https://www.huisvandegeuze.be/winkel/goudenband-2022/',attributes:[{name:'Merk',terms:[{name:'Liefmans'}]}]}]:[]);
  }
  const product={'@type':'Product',name:'Liefmans Goudenband 75Cl',offers:{priceCurrency:'EUR',price:13.90,availability:'https://schema.org/InStock'}};
  return new Response('<script type="application/ld+json">'+JSON.stringify(product)+'</script>');
 });
 assert.equal(snapshot.offers[priceKey(older)].amount,24.50);
 assert.equal(snapshot.offers[priceKey(older)].matchKind,'exact');
 assert.equal(snapshot.offers[priceKey(recent)].amount,13.90);
 assert.equal(snapshot.offers[priceKey(recent)].matchKind,'generic');
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
 let shopAvailable=true;
 const config={dataDir,localOrigin:origin,publicOrigin,allowSetup:true,publicCollection:true,lookup:async code=>{lookups++;return {name:'Testbier',barcode:code};},
  wishFetcher:async()=>new Response('<h1>Testbier</h1><p class="style">Geuze</p><p class="abv">7% ABV</p><div class="caps" data-rating="4.1234"></div>'),
  shopFetcher:async()=>shopAvailable?Response.json([shopProduct]):new Response(null,{status:503})};
 let server=createBierServer(config);
 async function start(){server.listen(port,'127.0.0.1');await once(server,'listening');}
 async function stop(){server.closeAllConnections();await new Promise(r=>server.close(r));}
 async function request(route,{method='GET',data,cookie,originHeader=origin,host,extraHeaders={}}={}){const headers={...extraHeaders};if(method!=='GET'){headers.Origin=originHeader;headers['Content-Type']='application/json';}if(data!==undefined)headers['Content-Length']=Buffer.byteLength(JSON.stringify(data));if(cookie)headers.Cookie=cookie;if(host)headers.Host=host;return new Promise((resolve,reject)=>{const r=http.request(origin+route,{method,headers},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));});r.on('error',reject);if(data!==undefined)r.write(JSON.stringify(data));r.end();});}
 let running=false;
 try{
  await start();running=true;
  assert.equal((await request('/api/beers')).status,401);
  assert.equal((await request('/api/untappd')).status,401);
  assert.deepEqual(await (await request('/api/public/beers')).json(),[]);
  assert.equal((await request('/api/shop-prices',{method:'POST'})).status,401);
  assert.equal((await request('/api/session')).status,200);
  const password=randomBytes(24).toString('base64url'),credentials={username:'jorgen',password};
  assert.equal((await request('/api/setup',{method:'POST',data:credentials,originHeader:publicOrigin,host:'bier.example.com'})).status,403,'setup via openbaar adres moet geweigerd worden');
  assert.equal((await request('/api/setup',{method:'POST',data:credentials,originHeader:'https://evil.example'})).status,403);
  assert.equal((await request('/api/setup',{method:'POST',data:{...credentials,password:'kort'}})).status,400);
  const setup=await request('/api/setup',{method:'POST',data:credentials});assert.equal(setup.status,201);
  let cookie=setup.headers.get('set-cookie').split(';')[0];assert.match(setup.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await request('/api/untappd',{method:'PUT',data:[],cookie})).status,400);
  const entries=parseUntappdExport(untappdCsv);
  assert.equal((await request('/api/untappd',{method:'PUT',data:entries,cookie})).status,200);
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
  const publicList=await (await request('/api/public/beers')).json();
  assert.equal(publicList.length,1);
  assert.equal(publicList[0].name,beer.name);
  assert.equal(publicList[0].price,undefined);
  assert.equal(publicList[0].purchaseDate,undefined);
  assert.equal(publicList[0].quantity,beer.quantity);
  const wish={name:'Wishlist testbier',brewery:'Boon',url:'https://untappd.com/b/testbier/101'};
  assert.equal((await request('/api/wishlist',{method:'POST',data:wish})).status,401);
  assert.equal((await (await request('/api/wishlist',{method:'POST',data:wish,cookie})).json()).added,true);
  assert.equal((await (await request('/api/wishlist',{method:'POST',data:wish,cookie})).json()).added,false);
  assert.equal((await (await request('/api/wishlist')).json())[0].name,wish.name);
  const wishId=(await (await request('/api/wishlist')).json())[0].id;
  assert.equal((await request('/api/wishlist/details',{method:'POST',data:{id:wishId}})).status,401);
  const updatedWish=await (await request('/api/wishlist/details',{method:'POST',data:{id:wishId},cookie})).json();
  assert.equal(updatedWish[0].details.rating,4.12);
  assert.equal(updatedWish[0].details.abv,7);
  assert.equal((await request('/api/wishlist',{method:'PUT',data:{id:wishId,years:[2017]}})).status,401);
  assert.equal((await request('/api/wishlist',{method:'PUT',data:{id:wishId,years:[1800]},cookie})).status,400);
  assert.equal((await request('/api/wishlist',{method:'PUT',data:{id:wishId,years:[2020,2017,2017]},cookie})).status,200);
  assert.equal((await request('/api/beers',{method:'POST',data:beer})).status,401);
  assert.equal((await request('/api/public/beers',{method:'POST',data:beer})).status,401);
  assert.equal((await request('/api/shop-prices',{method:'POST',cookie,originHeader:'https://evil.example'})).status,403);
  assert.equal((await request('/api/price-history?key=test')).status,401);
  assert.equal((await request('/api/beers',{method:'POST',data:pricedBeer,cookie})).status,200);
  const refresh=await request('/api/shop-prices',{method:'POST',cookie});
  assert.equal(refresh.status,200);
  const snapshot=await refresh.json();
  const priceId=priceKey(pricedBeer);
  const historyPath='/api/price-history?key='+encodeURIComponent(priceId);
  assert.equal(snapshot.offers[priceId].amount,24.50);
  assert.deepEqual(await (await request(historyPath,{cookie})).json(),[snapshot.offers[priceId]]);
  assert.equal((await request('/api/shop-prices',{method:'POST',cookie})).status,429);
  assert.equal((await (await request('/api/beers',{cookie})).json()).find(item=>item.id===beer.id).drinkDate,'2028-07-01');
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,drinkFromYear:2029},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,...window,drinkUntilYear:2027},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,untappdUrl:'https://untappd.com.example/b/beer/1254816'},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,photo:'data:image/svg+xml;base64,AAAA'},cookie})).status,400);
  assert.equal((await request('/api/beers',{method:'POST',data:{...beer,...window,drinkDate:'',untappdUrl,photo},cookie})).status,200);
  const syncKey=untappdSyncKey({...beer,untappdUrl});
  const page={url:untappdUrl,name:'Testbier',brewery:'Testbrouwer',style:'Geuze',communityRating:4.25,rating:4.5,
   abv:7,ibu:null,count:1,latest:'2026-11-06T12:00:00.000Z',description:'Testbeschrijving',checkedAt:'2026-11-08T12:00:00.000Z'};
  const sync={kind:'bierkelder-untappd-results',results:[{id:beer.id,key:syncKey,page}]};
  assert.equal((await request('/api/untappd/sync',{method:'POST',data:sync})).status,401);
  assert.deepEqual(await (await request('/api/untappd/sync',{method:'POST',data:sync,cookie})).json(),{saved:1,skipped:0});
  const stale={...sync,results:[{...sync.results[0],key:untappdSyncKey(beer)}]};
  assert.deepEqual(await (await request('/api/untappd/sync',{method:'POST',data:stale,cookie})).json(),{saved:0,skipped:1});
  const publicBeer=(await (await request('/api/public/beers')).json()).find(item=>item.id===beer.id);
  assert.equal(publicBeer.untappdPage,undefined);
  assert.equal(publicBeer.untappdCommunityRating,page.communityRating);
  assert.equal(publicBeer.hasPhoto,true);
  const guestPhoto=await request('/api/public/beers/'+beer.id+'/photo');
  assert.deepEqual(Buffer.from(await guestPhoto.arrayBuffer()),photoBytes);
  assert.equal((await request(photoPath)).status,401);
  await stop();running=false;shopAvailable=false;server=createBierServer(config);await start();running=true;
  const wishes=await (await request('/api/wishlist')).json();
  assert.equal(wishes[0].name,wish.name);
  assert.deepEqual(wishes[0].years,[2017,2020]);
  assert.deepEqual(await (await request('/api/wishlist',{method:'DELETE',data:{id:wishes[0].id},cookie})).json(),[]);
  assert.deepEqual((await (await request('/api/untappd',{cookie})).json()).entries,entries);
  assert.equal((await request('/api/shop-prices',{method:'POST',cookie})).status,502);
  assert.deepEqual(await (await request('/api/shop-prices',{cookie})).json(),snapshot);
  assert.deepEqual(await (await request(historyPath,{cookie})).json(),[snapshot.offers[priceId]]);
  assert.equal((await (await request('/api/session',{cookie})).json()).authenticated,true,'sessie moet herstart overleven');
  const restored=(await (await request('/api/beers',{cookie})).json()).filter(item=>item.id===beer.id);assert.equal(restored.length,1);assert.equal(restored[0].price,4);
  assert.equal(restored[0].untappdUrl,untappdUrl);
  assert.deepEqual(restored[0].untappdPage,{key:syncKey,data:page});
  assert.equal(restored[0].drinkFromYear,2029);
  assert.equal(restored[0].drinkUntilYear,2035);
  assert.equal(restored[0].hasPhoto,true);
  assert.equal(restored[0].photo,undefined);
  assert.equal((await request('/api/beers',{method:'POST',data:{...restored[0],image:'https://example.test/bottle.png',photoPreference:'online'},cookie})).status,200);
  const withPreference=(await (await request('/api/beers',{cookie})).json()).find(item=>item.id===beer.id);
  assert.equal(withPreference.photoPreference,'online');
  assert.equal(withPreference.image,'https://example.test/bottle.png');
  assert.equal(withPreference.hasPhoto,true);
  assert.equal((await request('/api/beers',{method:'POST',data:{...restored[0],quantity:2},cookie})).status,200);
  assert.equal((await (await request('/api/beers',{cookie})).json())[0].quantity,2);
  const imageResponse=await request(photoPath,{cookie});
  assert.equal(imageResponse.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),photoBytes);
  assert.equal((await request('/api/beers',{method:'POST',data:{...restored[0],photo:null},cookie})).status,200);
  assert.equal((await request(photoPath,{cookie})).status,404);
  const selection={id:beer.id,key:syncKey,url:'https://untappd.com/b/juiste-editie/102'};
  assert.equal((await request('/api/untappd/link',{method:'POST',data:selection})).status,401);
  assert.equal((await request('/api/untappd/link',{method:'POST',data:{...selection,url:'https://example.test/b/juiste-editie/102'},cookie})).status,400);
  assert.equal((await request('/api/untappd/link',{method:'POST',data:selection,cookie})).status,200);
  assert.equal((await request('/api/untappd/link',{method:'POST',data:selection,cookie})).status,409);
  const linked=(await (await request('/api/beers',{cookie})).json()).find(item=>item.id===beer.id);
  assert.equal(linked.untappdUrl,selection.url);
  assert.equal(linked.untappdPage,undefined);
  assert.equal(linked.price,beer.price);
  for(let i=0;i<2;i++)assert.equal((await request('/api/lookup?code=5410000000000',{cookie})).status,200);
  assert.equal(lookups,1,'herhaalde barcode moet uit cache komen');
  assert.equal((await request('/api/logout',{method:'POST',cookie})).status,200);
  assert.equal((await request('/api/beers',{cookie})).status,401,'afgemelde sessie moet ongeldig zijn');
  assert.equal((await request('/api/beers',{extraHeaders:{'oai-authenticated-user-id':'fake'}})).status,401,'oude hostingheaders geven geen toegang');
 }finally{if(running)await stop();const prefix=path.resolve(tmpdir())+path.sep+'bierkelder-test-';if(path.resolve(dataDir).startsWith(prefix))rmSync(dataDir,{recursive:true,force:true});}
});
