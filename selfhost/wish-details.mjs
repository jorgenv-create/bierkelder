import {untappdBeerLink} from './schema.mjs';

const clean=value=>String(value??'').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(\d{1,6});/g,(_,code)=>Number(code)<=0x10ffff?String.fromCodePoint(Number(code)):' ')
 .replace(/&(?:amp|nbsp|quot|apos|lt|gt);/g,entity=>({'&amp;':'&','&nbsp;':' ','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'})[entity]).replace(/\s+/g,' ').trim();
const bounded=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
export function wishDetails(input){
 const image=typeof input?.image==='string'?input.image.trim():'';
 if(image){
  let url;try{url=new URL(image);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||image.length>1000)return null;
 }
 return {image,style:clean(input?.style).slice(0,100),description:clean(input?.description).slice(0,1200),
  abv:bounded(input?.abv,0,100),ibu:bounded(input?.ibu,0,1000),rating:bounded(input?.rating,0.1,5)};
}

export async function readWishDetails(link,fetcher=fetch){
 const beer=untappdBeerLink(link);
 if(!beer)return null;
 const response=await fetcher(beer.url,{redirect:'error',signal:AbortSignal.timeout(6500),headers:{Accept:'text/html'}});
 if(!response.ok)return null;
 const html=await response.text();
 if(html.length>3_000_000||!/<h1\b/i.test(html))return null;
 const paragraph=className=>clean(html.match(new RegExp('<p\\b[^>]*class=["\'][^"\']*\\b'+className+'\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/p>','i'))?.[1]);
 const description=clean(html.match(/<div\b[^>]*class=["'][^"']*\bbeer-descrption-read-less\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]).replace(/\s*Show Less$/i,'');
 const image=html.match(/<img\b[^>]*\bsrc=["'](https:\/\/assets\.untappd\.com\/site\/(?:beer_logos|brewery_logos)\/[^"']+)["'][^>]*\balt=["'][^"']*\blabel["'][^>]*>/i)?.[1]??'';
 const numeric=value=>value?.trim()&&/^\d+(?:\.\d+)?/.test(value)?Number(value.match(/^\d+(?:\.\d+)?/)[0]):null;
 const rating=numeric(html.match(/<div\b[^>]*class=["']caps["'][^>]*data-rating=["']([\d.]+)["']/i)?.[1]);
 const details=wishDetails({image,style:paragraph('style'),description,abv:numeric(paragraph('abv')),ibu:numeric(paragraph('ibu')),rating:rating===null?null:Math.round(rating*100)/100});
 return details&&(details.style||details.image||details.abv!==null||details.rating!==null)?details:null;
}
