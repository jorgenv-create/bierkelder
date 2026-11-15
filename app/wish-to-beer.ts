import {emptyBeer,type Beer} from './beer';

type WishSource={name:string;brewery:string;url:string;years:number[];details:{image:string;style:string;abv:number|null;rating:number|null;description:string}|null};
/** Start a new purchase; a wish and its target years remain available. */
export function beerFromWish(wish:WishSource):Beer {
 return {...emptyBeer(),name:wish.name,brewery:wish.brewery,
  vintage:wish.years.length===1?String(wish.years[0]):'',
  style:wish.details?.style||'',abv:wish.details?.abv??null,
  image:wish.details?.image||'',untappdUrl:wish.url,
  untappdCommunityRating:wish.details?.rating??null,
  untappdDescription:wish.details?.description||''};
}
