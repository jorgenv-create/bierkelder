import {cellarOrigin,syncChannel,syncExtensionVersion} from '../../app/untappd-protocol';

async function saveWish(){
 const draft=await chrome.runtime.sendMessage({kind:'wishlist-pull'});
 if(!draft?.name)return;
 const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({name:draft.name,brewery:draft.brewery,url:draft.url})});
 if(response.status===401){location.assign('/login?next=wishlist');return;}
 if(!response.ok)return;
 const result=await response.json();
 await chrome.runtime.sendMessage({kind:'wishlist-done'});
 const notify=()=>window.postMessage({channel:syncChannel,source:'extension',kind:'wishlist-saved',added:result.added},cellarOrigin);
 notify();
 window.setTimeout(notify,600);
}
if(location.pathname==='/wishlist')void saveWish().catch(()=>{});

const onPage=()=>location.pathname==='/untappd';
function deliver(id:string,reply:unknown){
 if(onPage())window.postMessage({channel:syncChannel,source:'extension',id,reply},cellarOrigin);
}
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==cellarOrigin||!onPage())return;
 const data=event.data;
 if(data?.channel!==syncChannel||data.source!=='cellar'||typeof data.id!=='string')return;
 if(data.kind==='ping')deliver(data.id,{kind:'available',version:syncExtensionVersion});
 if(data.kind==='start')void chrome.runtime.sendMessage({kind:'start',id:data.id,beers:data.beers})
  .then(reply=>deliver(data.id,reply))
  .catch(()=>deliver(data.id,{kind:'error',message:'Herlaad de Bierkelder om de extensie te verbinden.'}));
});
chrome.runtime.onMessage.addListener((message,sender)=>{
 if(sender.id===chrome.runtime.id&&message.kind==='reply')deliver(message.id,message.reply);
});
