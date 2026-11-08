import {useEffect,useState} from 'react';
import {LogIn,Search,Wine} from 'lucide-react';

type PublicBeer={name:string;brewery:string;style:string;vintage:string};

export default function PublicCellar(){
 const [beers,setBeers]=useState<PublicBeer[]|null>(null);
 const [search,setSearch]=useState('');
 const [failed,setFailed]=useState(false);

 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   try{
    const response=await fetch('/api/public/beers',{signal:controller.signal});
    if(!response.ok)throw Error();
    setBeers(await response.json());
   }catch{if(!controller.signal.aborted)setFailed(true);}
  }
  void load();
  return ()=>controller.abort();
 },[]);

 const query=search.trim().toLocaleLowerCase('nl-BE');
 const shown=beers?.filter(beer=>[beer.name,beer.brewery,beer.style,beer.vintage].some(value=>value.toLocaleLowerCase('nl-BE').includes(query)));

 return <div className="public-cellar">
  <header className="public-header"><a className="login-brand" href="/"><Wine size={26}/> de bierkelder</a><a className="secondary" href="/login"><LogIn size={17}/> Inloggen</a></header>
  <main className="public-main">
   <span className="eyebrow">DE OPENBARE COLLECTIE</span>
   <h1>Een kijkje in de bierkelder.</h1>
   <p>Ontdek welke bieren er in de kelder liggen.</p>
   <label className="search-box public-search"><Search size={18}/><input type="search" aria-label="Zoek in de collectie" placeholder="Zoek op bier, brouwerij, stijl of jaargang" value={search} onChange={event=>setSearch(event.target.value)}/></label>
   {failed?<p role="alert">De collectie is tijdelijk niet bereikbaar.</p>:!shown?<p role="status">De collectie wordt geladen.</p>:shown.length===0?<p role="status">{query?'Geen bieren gevonden.':'Er staan nog geen bieren in de collectie.'}</p>:<ul className="public-beers" aria-label="Bieren in de collectie">
    {shown.map(beer=><li key={JSON.stringify([beer.name,beer.brewery,beer.style,beer.vintage])}>
     {beer.style&&<span className="eyebrow">{beer.style}</span>}
     <h2>{beer.name}</h2>
     {beer.brewery&&<p>{beer.brewery}</p>}
     {beer.vintage&&<span className="beer-vintage" aria-label={`Jaargang ${beer.vintage}`}>{beer.vintage}</span>}
    </li>)}
   </ul>}
  </main>
 </div>;
}
