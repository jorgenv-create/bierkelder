type FamilyBeer={name:string;brewery:string;vintage?:string};
const yearPattern=/\b(?:19|20)\d{2}\b/g;
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/gueuze/g,'geuze').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function beerFamily(beer:FamilyBeer){
 const brewery=beer.brewery.trim().replace(/^(?:brouwerij|brewery|brasserie)\s+/i,'');
 let name=beer.name.trim().replace(/\s*(?:[\[(]\s*)?(?:19|20)\d{2}(?:\s*[-/]\s*(?:19|20)\d{2})?(?:\s*[\])])?\s*$/,'').trim();
 if(brewery&&name.toLowerCase().startsWith(brewery.toLowerCase()+' '))name=name.slice(brewery.length+1);
 let title=normalized(name);
 const producer=normalized(brewery);
 if(producer&&title.endsWith(' '+producer))title=title.slice(0,-producer.length-1);
 if(producer==='boon'&&/^(?:(?:oude )?geuze (?:boon )?)?black label (?:edition |editie )?(?:(?:n|nr|no|nummer) )?\d{1,2}$/.test(title)){
  title='black label';
  name='Boon Black Label';
 }
 return {key:JSON.stringify([producer,title||normalized(beer.name)]),name:name||beer.name,brewery};
}

export function beerYear(beer:FamilyBeer){
 const years=String(beer.vintage??'').match(yearPattern)??beer.name.match(yearPattern);
 return years?.length?Number(years[0]):null;
}
