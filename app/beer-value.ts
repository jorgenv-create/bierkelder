import type { Beer } from './beer';

type Price = {
  amount: number;
  source: string;
  url: string;
  note?: string;
  reference?: boolean;
};
type PriceMatch = Price & { brewery: string; name: RegExp; volume: number; vintage?: string };

export const pricesCheckedOn = '2026-11-07';

const prices: PriceMatch[] = [
  {brewery:'boon',name:/^(?:oude geuze )?(?:boon )?black label (?:edition )?(?:n )?4$/,volume:750,amount:21.50,
    source:'Huis van de Geuze',url:'https://www.huisvandegeuze.be/product-categorie/vintage/'},
  {brewery:'boon',name:/^(?:oude geuze )?(?:boon )?black label (?:edition )?(?:n )?5$/,volume:750,amount:12.98,
    source:'Belgian Beer Heaven',url:'https://www.belgianbeerheaven.com/be/nl/producten/boon-gueuze-black-label-n5-75cl'},
  {brewery:'boon',name:/^(?:oude geuze )?(?:boon )?black label (?:edition )?(?:n )?6$/,volume:750,amount:11.82,
    source:'Belgian Beer Heaven',url:'https://www.belgianbeerheaven.com/be/nl/producten/boon-gueuze-black-label-n6-75cl'},
  {brewery:'boon',name:/^(?:oude geuze )?(?:boon )?black label (?:edition )?(?:n )?10$/,volume:750,amount:10.99,
    source:'De Drankenmarkt',url:'https://www.dedrankenmarkt.nl/belgie/4826-boon-oude-geuze-black-label-10.html'},
  {brewery:'boon',name:/^(?:boon )?(?:geuze )?mariage parfait$/,volume:750,vintage:'2016',amount:14.99,reference:true,
    source:'Belgian Beer Heaven',url:'https://www.belgianbeerheaven.com/be/nl/producten/boon-gueuze-mariage-parfait-2016-75cl',note:'Prijs van dezelfde jaargang, uitverkocht bij controle.'},
  {brewery:'boon',name:/^(?:boon )?(?:geuze )?mariage parfait 10$/,volume:375,amount:5.99,reference:true,
    source:'Biernet',url:'https://www.biernet.nl/bier/merken/boon-geuze-mariage-parfait-10',note:'Vermelde winkelprijs bij Gall & Gall.'},
  {brewery:'boon',name:/^(?:boon )?oude geuze(?: boon)?$/,volume:375,amount:4.10,reference:true,
    source:'Belgian Beer Factory',url:'https://www.belgianbeerfactory.com/nl/boon-oude-geuze-375cl.html',note:'Jaargang van de winkelprijs niet vermeld.'},
  {brewery:'liefmans',name:/^(?:liefmans )?goudenband$/,volume:750,amount:13.30,reference:true,
    source:'Belgian Beer Heaven',url:'https://www.belgianbeerheaven.com/be/nl/producten/liefmans-goudenband-75cl-6',note:'Jaargang van de winkelprijs niet vermeld.'},
  {brewery:'liefmans',name:/^(?:liefmans )?goudenband$/,volume:330,amount:2.20,reference:true,
    source:'Liefmans',url:'https://shop.liefmans.be/nl/bieren/963stk-1',note:'Jaargang van de winkelprijs niet vermeld.'},
  {brewery:'3 fonteinen',name:/^(?:oude geuze )?(?:cuvee )?armand gaston$/,volume:375,vintage:'2017',amount:11.49,reference:true,
    source:'Geuzeshop',url:'https://geuzeshop.com/shop/3-fonteinen-oude-geuze-cuvee-armand-gaston-37-5cl/',note:'Vergelijkbare assemblage uit 2017.'},
];

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'')
    .replace(/gueuze/g,'geuze').replace(/[^a-z0-9]+/g,' ').trim();
}

export function bottleValue(beer: Pick<Beer,'brewery'|'name'|'volume'|'vintage'|'price'>) {
  const brewery=normalize(beer.brewery).replace(/^brouwerij /,'');
  const name=normalize(beer.name);
  const match=prices.find(p=>p.brewery===brewery&&p.volume===beer.volume&&p.name.test(name)
    &&(!p.vintage||p.vintage===beer.vintage.trim()));

  if(match&&!match.reference)return {amount:match.amount,kind:'Winkelprijs',evidence:match};
  if(beer.price!=null)return {amount:beer.price,kind:'Aankoopprijs',evidence:null};
  if(match)return {amount:match.amount,kind:'Winkelreferentie',evidence:match};
  return {amount:null,kind:'Geen waarde bekend',evidence:null};
}

export function stockValue(beers: Beer[]) {
  let cents=0;
  let unknown=0;
  let known=0;
  for(const beer of beers){
    if(beer.quantity<=0)continue;
    const {amount}=bottleValue(beer);
    if(amount===null){unknown+=beer.quantity;continue;}
    cents+=Math.round(amount*100)*beer.quantity;
    known+=beer.quantity;
  }
  return {amount:known?cents/100:null,unknown};
}

export function compareBeerStyle(a: Beer,b: Beer) {
  const aStyle=a.style.trim();
  const bStyle=b.style.trim();
  if(Boolean(aStyle)!==Boolean(bStyle))return aStyle?-1:1;
  return aStyle.localeCompare(bStyle,'nl-BE',{sensitivity:'base'})||a.name.localeCompare(b.name,'nl-BE');
}
