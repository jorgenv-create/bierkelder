const shops=[
 {name:'Huis van de Geuze',origin:'https://www.huisvandegeuze.be',productPath:'/winkel/'},
 {name:'Geuzeshop',origin:'https://geuzeshop.com',productPath:'/shop/'},
];
const editions={2:'2016',4:'2017',5:'2019',6:'2020',7:'2021',8:'2022',9:'2022'};
const volumePattern=/(?<!\d)(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/gi;
const yearPattern=/\b(?:19|20)\d{2}\b/g;

function plain(value){
 return String(value??'').replace(/&#(\d{1,6});/g,(_,code)=>Number(code)<=0x10ffff?String.fromCodePoint(Number(code)):' ')
  .replace(/&(?:amp|nbsp|ndash|mdash|deg|quot|apos);/g,' ');
}

function words(value){
 return plain(value).toLowerCase().normalize('NFD').replace(/\p{M}/gu,'')
  .replace(/gueuze/g,'geuze').replace(/[^a-z0-9]+/g,' ').trim();
}

function breweryName(value){return words(value).replace(/^(?:brouwerij|brasserie|brewery) /,'');}

function titleKey(title,brewery){
 let key=words(plain(title).replace(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]((?:19|20)\d{2})\b/g,'$1').replace(yearPattern,' ').replace(volumePattern,' '));
 if(brewery&&key.startsWith(brewery+' '))key=key.slice(brewery.length+1);
 if(brewery&&key.endsWith(' '+brewery))key=key.slice(0,-brewery.length-1);
 const blackLabel=brewery==='boon'&&key.match(/^(?:(?:oude )?geuze (?:boon )?)?black label (?:edition |editie )?(?:(?:n|no|nr|number|nummer) ?)?0?([1-9]\d?)(?:(?:e|de|th) ?(?:edition|editie)| (?:edition|editie))?$/);
 return blackLabel?'black label '+blackLabel[1]:key;
}

function editionYear(title,brewery){return brewery==='boon'?editions[title.match(/^black label (\d+)$/)?.[1]]:undefined;}

export function priceKey(beer){
 const brewery=breweryName(beer.brewery);
 const title=titleKey(beer.name,brewery);
 const vintage=String(beer.vintage??'').trim();
 const years=[...new Set(plain(beer.name).match(yearPattern)??[])];
 const year=vintage||years[0]||editionYear(title,brewery)||'';
 if(!brewery||!title||!Number.isFinite(beer.volume)||beer.volume<=0||years.length>1||
    (year&&!/^(?:19|20)\d{2}$/.test(year))||(years.length&&years[0]!==year))return '';
 return JSON.stringify([brewery,title,beer.volume,year]);
}

function productOffer(product,shop){
 const price=product?.prices;
 if(product?.type!=='simple'||product.is_in_stock!==true||product.is_purchasable!==true||product.is_on_backorder===true||
    typeof product.name!=='string'||price?.currency_code!=='EUR'||price.currency_minor_unit!==2||price.price_range!=null||
    typeof price.price!=='string'||!/^\d{1,8}$/.test(price.price)||Number(price.price)===0)return null;
 const title=plain(product.name);
 if(/\b(?:pack|pakket|bundle|doos|magnum set)\b|\b\d+\s*[x×]\s*\d/i.test(title))return null;
 const attributes=Array.isArray(product.attributes)?product.attributes:[];
 const terms=pattern=>attributes.filter(attribute=>pattern.test(attribute.name)).flatMap(attribute=>attribute.terms??[]).map(term=>String(term.name??''));
 const producer=[...new Set(terms(/^(?:merken?|brand|blender\/brewer|brewery|brouwerij)$/i).map(breweryName).filter(Boolean))];
 const volumes=[...new Set([...title.matchAll(volumePattern),...terms(/^(?:content|inhoud|volume)$/i).flatMap(value=>[...value.matchAll(volumePattern)])]
  .map(([,value,unit])=>Number(value.replace(',','.'))*({ml:1,cl:10,l:1000}[unit.toLowerCase()])) )];
 const years=[...new Set([title,...terms(/vintage|jaargang|bottl/i)].flatMap(value=>value.match(yearPattern)??[]))];
 if(producer.length!==1||volumes.length!==1||years.length>1||typeof product.permalink!=='string')return null;
 let url;
 try{url=new URL(product.permalink);}catch{return null;}
 if(url.origin!==shop.origin||!url.pathname.startsWith(shop.productPath)||url.pathname===shop.productPath||url.username||url.password)return null;
 const brewery=producer[0];
 const name=titleKey(title,brewery);
 const vintage=years[0]||editionYear(name,brewery)||'';
 const key=priceKey({name:title,brewery,volume:volumes[0],vintage});
 return key?{key,amount:Number(price.price)/100,url:url.origin+url.pathname,source:shop.name}:null;
}

async function readCatalog(shop,fetcher){
 const offers=[];
 const signal=AbortSignal.timeout(18000);
 const readPage=async page=>{
  const fields='name,type,permalink,prices,attributes,is_in_stock,is_purchasable,is_on_backorder';
  const response=await fetcher(`${shop.origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}&_fields=${fields}`,{
   headers:{Accept:'application/json'},redirect:'error',signal,
  });
  if(!response.ok)throw Error('Catalogus onbereikbaar');
  const products=await response.json();
  if(!Array.isArray(products)||products.length>100)throw Error('Onverwachte catalogus');
  return {products,totalPages:Number(response.headers.get('X-WP-TotalPages')??1)};
 };
 const first=await readPage(1);
 if(!Number.isSafeInteger(first.totalPages)||first.totalPages<0||first.totalPages>25||
   (first.totalPages===1&&first.products.length===100))throw Error('Onvolledige catalogus');
 const collect=products=>{for(const product of products){const offer=productOffer(product,shop);if(offer)offers.push(offer);}};
 collect(first.products);
 for(let page=2;page<=first.totalPages;page+=3){
  const pages=Array.from({length:Math.min(3,first.totalPages-page+1)},(_,offset)=>readPage(page+offset));
  for(const result of await Promise.all(pages))collect(result.products);
 }
 return offers;
}

export async function fetchShopPrices(beers,fetcher=fetch){
 const checkedAt=new Date().toISOString();
 const keys=new Set(beers.map(priceKey).filter(Boolean));
 const results=await Promise.allSettled(shops.map(shop=>readCatalog(shop,fetcher)));
 const sources=shops.map((shop,index)=>({name:shop.name,available:results[index].status==='fulfilled'}));
 if(!sources.some(source=>source.available))throw Error('De winkelcatalogi zijn niet bereikbaar');
 const offers={};
 for(const result of results){
  if(result.status!=='fulfilled')continue;
  for(const {key,...offer} of result.value){
   if(keys.has(key)&&(!offers[key]||offer.amount<offers[key].amount))offers[key]={...offer,checkedAt};
  }
 }
 return {checkedAt,sources,offers,keys:[...keys],scanned:beers.length};
}
