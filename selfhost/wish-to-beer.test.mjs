import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('wishlist creates independent purchases with metadata and without assuming a target vintage',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bier-wish-'));
 try{
  const outfile=path.join(dir,'wish.mjs');
  await build({entryPoints:['app/wish-to-beer.ts'],outfile,bundle:true,format:'esm',platform:'node'});
  const {beerFromWish}=await import(pathToFileURL(outfile).href);
  const wish={name:'Oude Geuze',brewery:'Boon',url:'https://untappd.com/b/boon-oude-geuze/123',years:[2017,2019],details:{image:'https://example.com/beer.png',style:'Lambic - Gueuze',abv:7,rating:4.1,description:'Een geuze.'}};
  const before=structuredClone(wish),first=beerFromWish(wish),second=beerFromWish(wish);
  assert.notEqual(first.id,second.id);
  assert.equal(first.name,wish.name);assert.equal(first.brewery,wish.brewery);
  assert.equal(first.image,wish.details.image);assert.equal(first.untappdUrl,wish.url);
  assert.equal(first.untappdCommunityRating,4.1);assert.equal(first.style,wish.details.style);assert.equal(first.abv,7);
  assert.equal(first.vintage,'');assert.equal(first.price,null);assert.equal(first.shop,'');
  assert.equal(first.quantity,1);assert.equal(first.purchasedQuantity,1);
  assert.deepEqual(wish,before);
  assert.equal(beerFromWish({...wish,years:[2019],details:null}).vintage,'2019');
  assert.equal(beerFromWish({...wish,years:[],details:null}).abv,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
