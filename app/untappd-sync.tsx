import {useEffect,useRef,useState} from 'react';
import {Download,LoaderCircle,RefreshCw} from 'lucide-react';
import type {Beer} from './beer';
import {matchUntappd,untappdBeerLink,untappdSyncKey,type UntappdEntry} from './untappd';
import {cellarOrigin,maxSyncBeers,syncChannel,syncExtensionVersion,type SyncBeer,type SyncIssue,type SyncReply} from './untappd-protocol';

type Run={id:string;total:number;timer:number;reading:boolean};
type Summary={saved:number;skipped:number;note:string};
const active=(beer:Beer)=>beer.quantity>0&&(beer.untappdAutoMatch!==false||!!beer.untappdUrl);
function missing(beer:Beer){
 const cached=beer.untappdPage;
 if(cached?.key!==untappdSyncKey(beer))return true;
 const page=cached.data;
 return page.communityRating===null||page.count===null||(page.count>0&&(page.latest===null||page.rating===null));
}
function send(id:string,kind:'ping'|'start',beers?:SyncBeer[]){
 window.postMessage({channel:syncChannel,source:'cellar',id,kind,beers},cellarOrigin);
}

export default function UntappdSync({beers,entries,onSaved,loading}:{beers:Beer[];entries:UntappdEntry[];onSaved:()=>Promise<void>;loading:boolean}){
 const [version,setVersion]=useState(0),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[summary,setSummary]=useState<Summary|null>(null);
 const [issues,setIssues]=useState<SyncIssue[]>([]),[choosing,setChoosing]=useState(false),[choiceMessage,setChoiceMessage]=useState('');
 const run=useRef<Run|null>(null);
 const reload=useRef(onSaved);
 reload.current=onSaved;
 const eligible=beers.filter(active);
 const pending=eligible.filter(missing);
 function finish(){
  if(run.current)window.clearTimeout(run.current.timer);
  run.current=null;
  setBusy(false);
 }
 function arm(current:Run){
  window.clearTimeout(current.timer);
  current.timer=window.setTimeout(()=>{
   finish();
   setStatus('De synchronisatie wacht te lang. Sluit de geopende Untappd-tab en probeer opnieuw.');
  },5*60_000);
 }

 useEffect(()=>{
  if(location.origin!==cellarOrigin)return;
  const ping=crypto.randomUUID();
  const interval=window.setInterval(()=>send(ping,'ping'),600);
  const timeout=window.setTimeout(()=>window.clearInterval(interval),6000);
  async function receive(event:MessageEvent){
   if(event.source!==window||event.origin!==cellarOrigin||event.data?.channel!==syncChannel||event.data.source!=='extension')return;
   const reply=event.data.reply as SyncReply|undefined;
   if(!reply)return;
   if(event.data.id===ping&&reply.kind==='available'){
    if((reply.version??1)>=syncExtensionVersion)window.clearInterval(interval);
    setVersion(previous=>Math.max(previous,reply.version??1));
    return;
   }
   const current=run.current;
   if(!current||event.data.id!==current.id)return;
   arm(current);
   switch(reply.kind){
    case 'login':
     if(!current.reading)setStatus('Meld je zo nodig aan in de geopende Untappd-tab. De synchronisatie begint zodra je bent aangemeld.');
     break;
    case 'progress':
     current.reading=true;
     setStatus('Bier '+Math.min(reply.completed+1,current.total)+' van '+current.total+' wordt gecontroleerd.');
     break;
    case 'error':
     setStatus(reply.message);
     finish();
     break;
    case 'result': {
     window.clearTimeout(current.timer);
     setStatus('Gevonden gegevens worden opgeslagen.');
     let saved=0;
     setIssues(reply.issues??[]);
     let note=reply.blocked?'Untappd heeft de synchronisatie onderbroken. Je kunt later opnieuw proberen.':'';
     try{
      for(let index=0;index<reply.results.length;index+=30){
       const response=await fetch('/api/untappd/sync',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:'bierkelder-untappd-results',results:reply.results.slice(index,index+30)})});
       const result=await response.json();
       if(!response.ok)throw Error(result.error||'Opslaan is mislukt.');
       saved+=result.saved;
      }
      if(saved)await reload.current();
     }catch(error){
      note=(error as Error).message;
     }finally{
      setStatus('');
      setSummary({saved,skipped:current.total-saved,note});
      finish();
     }
     break;
    }
   }
  }
  window.addEventListener('message',receive);
  send(ping,'ping');
  return ()=>{
   window.removeEventListener('message',receive);
   window.clearInterval(interval);
   window.clearTimeout(timeout);
   if(run.current)window.clearTimeout(run.current.timer);
  };
 },[]);
 function start(selection:Beer[]){
  if(run.current||!version||choosing)return;
  if(selection.length>maxSyncBeers){
   setStatus('Deze synchronisatie ondersteunt maximaal '+maxSyncBeers+' bieren per keer.');
   return;
  }
  const items=selection.map(beer=>{
   const key=untappdSyncKey(beer);
   const saved=beer.untappdPage?.key===key?beer.untappdPage.data.url:'';
   return {id:beer.id,key,name:beer.name,brewery:beer.brewery,vintage:beer.vintage,auto:beer.untappdAutoMatch!==false,
    url:beer.untappdUrl||saved||matchUntappd(beer,entries,beers)?.url||''};
  });
  const current={id:crypto.randomUUID(),total:items.length,timer:0,reading:false};
  run.current=current;
  arm(current);
  setSummary(null);
  setIssues([]);
  setChoiceMessage('');
  setBusy(true);
  setStatus('Untappd wordt geopend.');
  send(current.id,'start',items);
 }
 async function choose(issue:SyncIssue,url:string){
  if(choosing||busy||!issue.candidates.some(candidate=>candidate.url===url))return;
  setChoosing(true);
  setChoiceMessage('');
  try{
   const response=await fetch('/api/untappd/link',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:issue.id,key:issue.key,url})});
   if(!response.ok)throw Error((await response.json()).error||'De koppeling kon niet worden opgeslagen.');
   setIssues(previous=>previous.filter(item=>item.id!==issue.id));
   await reload.current();
   setChoiceMessage('Koppeling opgeslagen. Klik op Ontbrekende gegevens synchroniseren om de gegevens van het gekozen bier op te halen.');
  }catch(error){setChoiceMessage((error as Error).message);}
  finally{setChoosing(false);}
 }
 return <section className="lookup-box untappd-sync" aria-labelledby="untappd-sync-title">
  <h2 id="untappd-sync-title">Synchroniseren met Untappd</h2>
  <p>De Bierkelder opent Untappd in een nieuw tabblad. Meld je daar aan als dat nodig is en laat beide tabbladen open tot de synchronisatie klaar is.</p>
  {version>=syncExtensionVersion?<p className="untappd-connected">Browserextensie verbonden</p>:<div className="untappd-setup">
   <h3>{version?'Browserextensie bijwerken':'Eenmalig instellen op je pc'}</h3>
   {version>0&&<p>Installeer versie 1.3 om bieren vanuit Untappd op je wishlist te zetten.</p>}
   <a className="secondary" href="/bierkelder-untappd-1.3.zip" download><Download size={16}/> Browserextensie downloaden</a>
   <ol>
    <li>Pak het zipbestand uit.</li>
    <li>Open <code>chrome://extensions</code> in Chrome of <code>edge://extensions</code> in Edge.</li>
    <li>{version>0&&<>Verwijder eerst de vorige <strong>Bierkelder voor Untappd</strong>-extensie. </>}Zet <strong>Ontwikkelaarsmodus</strong> aan, klik op <strong>Uitgepakte extensie laden</strong> en kies de uitgepakte map met <code>manifest.json</code>.</li>
    <li>Herlaad deze pagina.</li>
   </ol>
  </div>}
  <div className="untappd-actions">
   <button className="primary" type="button" disabled={!version||loading||busy||choosing||!pending.length} onClick={()=>start(pending)}>
    {busy?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>} Ontbrekende gegevens synchroniseren ({pending.length})
   </button>
   <button className="secondary" type="button" disabled={!version||loading||busy||choosing||!eligible.length} onClick={()=>start(eligible)}>Alles opnieuw synchroniseren ({eligible.length})</button>
  </div>
  <div role="status" aria-live="polite" className="untappd-status">
   {status&&<p>{status}</p>}
   {summary&&<><p><strong>{summary.saved} {summary.saved===1?'bier gesynchroniseerd':'bieren gesynchroniseerd'}</strong>{summary.skipped>0&&' · '+summary.skipped+' overgeslagen'}</p>
    {summary.note&&<p>{summary.note}</p>}</>}
  </div>
  {choiceMessage&&<p role="status">{choiceMessage}</p>}
  {issues.length>0&&<section className="untappd-review" aria-label="Overgeslagen bieren">
   <h3>Overgeslagen bieren</h3>
   {issues.map(issue=>{
    const beer=beers.find(item=>item.id===issue.id);
    if(!beer)return null;
    const stale=untappdSyncKey(beer)!==issue.key;
    return <article key={issue.id}>
     <h4>{beer.name}{beer.vintage&&' · '+beer.vintage}</h4>
     <p>{stale?'Dit bier is intussen gewijzigd. Start de synchronisatie opnieuw.':issue.reason==='choice'?'Kies het juiste bier op Untappd.':issue.reason==='page-error'?'De Untappd-pagina kon niet worden gelezen.':'Geen geschikte zoekresultaten op Untappd gevonden.'}</p>
     <p><a href={'https://untappd.com/search?q='+encodeURIComponent([beer.brewery,beer.name].filter(Boolean).join(' '))} target="_blank" rel="noreferrer">Bekijk alle zoekresultaten op Untappd</a></p>
     {!stale&&issue.candidates.length>0&&<ul>{issue.candidates.map(candidate=>{
      const link=untappdBeerLink(candidate.url);
      return link&&<li key={link.id}>
       <div><a href={link.url} target="_blank" rel="noreferrer">{candidate.name}</a><small>{[candidate.brewery,candidate.style].filter(Boolean).join(' · ')}</small></div>
       <button type="button" className="secondary" disabled={choosing||busy} onClick={()=>void choose(issue,candidate.url)} aria-label={'Koppel '+beer.name+' aan '+candidate.name}>Kies dit bier</button>
      </li>;
     })}</ul>}
    </article>;
   })}
  </section>}
  <p>Je kunt de Untappd-link ook invullen via <strong>Bewerken</strong>.</p>
 </section>;
}
