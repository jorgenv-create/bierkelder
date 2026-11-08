import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,statSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {beerSchema,maxPhotoLength} from './schema.mjs';
const scrypt=promisify(scryptCallback);
const hash=value=>createHash('sha256').update(value).digest('hex');
const COOKIE='bierkelder_session';
const TTL=30*24*60*60;
process.umask(0o007);

const lookupError=(message,status)=>Object.assign(Error(message),{status});
const httpsLink=value=>typeof value==='string'&&/^https:\/\//.test(value)&&value.length<=1000?value:'';
const normalizeCode=code=>String(code??'').replace(/^0+/,'');
export async function lookupBarcode(code,{fetcher=fetch,canFallback=()=>true}={}) {
 let firstUnavailable=false;
 try {
  const url='https://world.openfoodfacts.org/api/v3/product/'+code+'.json?fields=product_name,product_name_nl,brands,quantity,image_front_url,nutriments';
  const upstream=await fetcher(url,{headers:{'User-Agent':'DeBierkelder/1.0'},signal:AbortSignal.timeout(5000)});
  if(upstream.ok){
   const {product:p}=await upstream.json();
   const name=String(p?.product_name_nl||p?.product_name||'').trim().slice(0,160);
   if(name){
    const q=String(p.quantity||'').replace(',','.').match(/([\d.]+)\s*(ml|cl|l)\b/i);
    const units={ml:1,cl:10,l:1000};
    const volume=q?Number(q[1])*units[q[2].toLowerCase()]:null;
    const abv=p.nutriments?.alcohol_100g==null||p.nutriments.alcohol_100g===''?NaN:Number(p.nutriments.alcohol_100g);
    return {name,brewery:String(p.brands||'').slice(0,160),image:httpsLink(p.image_front_url),abv:Number.isFinite(abv)&&abv>=0&&abv<=100?abv:null,volume:volume>=1&&volume<=30000?volume:null,source:'https://world.openfoodfacts.org/product/'+code};
   }
  } else if(upstream.status!==404) firstUnavailable=true;
 } catch { firstUnavailable=true; }

 if(!canFallback())throw lookupError('De tweede barcodebron is even aan haar limiet. Probeer over een minuut of vul het bier zelf in.',429);
 let fallback;
 let result;
 try {
  fallback=await fetcher('https://api.upcitemdb.com/prod/trial/lookup?upc='+code,{signal:AbortSignal.timeout(5000)});
  if(fallback.ok)result=await fallback.json();
 } catch { throw lookupError('De tweede barcodebron reageert niet. Probeer later opnieuw of vul het bier zelf in.',502); }
 if(fallback.status===429)throw lookupError('De tweede barcodebron is aan haar limiet. Probeer later opnieuw of vul het bier zelf in.',429);
 if(!fallback.ok&&fallback.status!==404)throw lookupError('De tweede barcodebron is tijdelijk niet bereikbaar. Je kunt het bier zelf invullen.',502);
 const item=Array.isArray(result?.items)&&result.items.find(item=>typeof item?.title==='string'&&item.title.trim()
  &&[item.ean,item.upc,item.gtin].some(id=>id&&normalizeCode(id)===normalizeCode(code)));
 if(item)return {name:item.title.trim().slice(0,160),brewery:typeof item.brand==='string'?item.brand.trim().slice(0,160):'',
  image:Array.isArray(item.images)?item.images.map(httpsLink).find(Boolean)||'':'',source:'https://www.upcitemdb.com/upc/'+code};
 if(firstUnavailable)throw lookupError('Open Food Facts reageert niet en de tweede bron vond niets. Probeer later opnieuw of vul het bier zelf in.',502);
 throw lookupError('Geen product gevonden bij beide barcodebronnen. Vul het bier zelf in.',404);
}

export function createBierServer(options={}) {
 const dataDir=options.dataDir||process.env.DATA_DIR||'/data';
 const publicOrigin=options.publicOrigin||process.env.PUBLIC_ORIGIN||'';
 const publicHost=publicOrigin?new URL(publicOrigin).host:'';
 if(publicOrigin&&new URL(publicOrigin).protocol!=='https:')throw Error('PUBLIC_ORIGIN moet een HTTPS-adres zijn.');
 const localOrigin=options.localOrigin||process.env.LOCAL_ORIGIN||'http://127.0.0.1:3080';
 const allowSetup=options.allowSetup??process.env.ALLOW_SETUP==='true';
 const origins=options.origins||new Set([publicOrigin,localOrigin]);
 const staticDir=options.staticDir||path.join(import.meta.dirname,'public');
 mkdirSync(dataDir,{recursive:true,mode:0o770});
 chmodSync(dataDir,0o770);
 const db=new DatabaseSync(path.join(dataDir,'bierkelder.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS beers(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);`);
 const getAccount=()=>db.prepare('SELECT * FROM account WHERE id=1').get();
 const windows=new Map();
 function allow(key,count,ms){const now=Date.now();let v=windows.get(key);if(!v||v.until<=now){v={n:0,until:now+ms};windows.set(key,v);}v.n++;if(windows.size>1000)for(const [k,s]of windows)if(s.until<=now)windows.delete(k);return v.n<=count;}
 let passwordWork=0;
 async function derive(password,salt){if(passwordWork>=2)throw Object.assign(Error('Even druk. Probeer over een paar seconden opnieuw.'),{status:429});passwordWork++;try{return await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});}finally{passwordWork--;}}
 async function body(req,limit=20000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Te veel gegevens.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Ongeldige gegevens.'),{status:400});}}
 function json(res,status,payload,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(payload));}
 function token(req){const part=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));return part?.slice(COOKIE.length+1)||'';}
 function authenticated(req){const value=token(req);if(!/^[a-f0-9]{64}$/.test(value))return false;return !!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').get(hash(value),Date.now());}
 function issueSession(res,secure){const value=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO sessions(token_hash,expires) VALUES(?,?)').run(hash(value),Date.now()+TTL*1000);res.setHeader('Set-Cookie',`${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL}${secure?'; Secure':''}`);}
 const security={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
 };
 const lookup=options.lookup||(code=>lookupBarcode(code,{canFallback:()=>allow('barcode-fallback',6,60000)}));
 const cached=new Map();
 const getPhoto=db.prepare("SELECT json_extract(data,'$.photo') AS photo FROM beers WHERE id=?");
 const server=http.createServer(async(req,res)=>{
  for(const [key,value]of Object.entries(security))res.setHeader(key,value);
  try{
   const host=String(req.headers.host||'');
   // No auth headers are trusted: the reverse proxy forwards the public Host unchanged.
   const requestOrigin=publicHost&&host===publicHost?publicOrigin:'http://'+host;
   const url=new URL(req.url||'/',requestOrigin);
   if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true});
   if(!origins.has(requestOrigin))return json(res,421,{error:'Onbekend websiteadres.'});
   if(requestOrigin===publicOrigin)res.setHeader('Strict-Transport-Security','max-age=31536000');
   const isLocal=requestOrigin===localOrigin;
   if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==requestOrigin)return json(res,403,{error:'Ongeldige herkomst van de aanvraag.'});
   if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{authenticated:authenticated(req),configured:!!getAccount(),canSetup:isLocal&&allowSetup});
   if(url.pathname==='/api/setup'&&req.method==='POST'){
    if(!isLocal||!allowSetup)return json(res,403,{error:'Eerste installatie kan alleen via het lokale adres van je server.'});
    if(getAccount())return json(res,409,{error:'Er bestaat al een account.'});
    if(!allow('setup',5,15*60*1000))return json(res,429,{error:'Te veel pogingen. Probeer over 15 minuten opnieuw.'});
    const input=await body(req);const username=String(input.username||'').trim();const password=input.password;
    if(!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username)||typeof password!=='string'||password.length<12||password.length>256)return json(res,400,{error:'Gebruik 3–80 tekens voor je gebruikersnaam en minstens 12 tekens voor je wachtwoord.'});
    const salt=randomBytes(16).toString('hex');const derived=await derive(password,salt);
    if(getAccount())return json(res,409,{error:'Er bestaat al een account.'});
    db.prepare('INSERT INTO account(id,username,salt,password_hash) VALUES(1,?,?,?)').run(username,salt,derived.toString('hex'));
    issueSession(res,false);return json(res,201,{ok:true});
   }
   if(url.pathname==='/api/login'&&req.method==='POST'){
    if(!allow('login',12,15*60*1000))return json(res,429,{error:'Te veel aanmeldpogingen. Probeer over 15 minuten opnieuw.'});
    const input=await body(req);const account=getAccount();
    if(!account)return json(res,409,{error:'Stel eerst lokaal je account in.'});
    if(typeof input.password!=='string'||input.password.length>256)return json(res,400,{error:'Controleer de invoer.'});
    const candidate=await derive(input.password,account.salt);
    if(!timingSafeEqual(candidate,Buffer.from(account.password_hash,'hex'))||String(input.username||'').trim()!==account.username)return json(res,401,{error:'Gebruikersnaam of wachtwoord is onjuist.'});
    issueSession(res,requestOrigin===publicOrigin);return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/logout'&&req.method==='POST'){
    const value=token(req);if(value)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(value));
    res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${requestOrigin===publicOrigin?'; Secure':''}`);return json(res,200,{ok:true});
   }
   if(url.pathname.startsWith('/api/')){
    if(!authenticated(req))return json(res,401,{error:'Meld je eerst aan om je collectie te openen.'});
    const photoMatch=url.pathname.match(/^\/api\/beers\/([0-9a-f-]{36})\/photo$/i);
    if(photoMatch&&req.method==='GET'){
     const photo=getPhoto.get(photoMatch[1])?.photo;
     if(!photo)return json(res,404,{error:'Geen eigen foto beschikbaar.'});
     const bytes=Buffer.from(photo.slice('data:image/jpeg;base64,'.length),'base64');
     res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store'});
     return res.end(bytes);
    }
    if(url.pathname==='/api/beers'&&req.method==='GET'){
     const rows=db.prepare("SELECT json_remove(data,'$.photo') AS data, json_type(data,'$.photo')='text' AS hasPhoto FROM beers ORDER BY updated_at DESC").all();
     return json(res,200,rows.map(row=>({...JSON.parse(row.data),hasPhoto:Boolean(row.hasPhoto)})));
    }
    if(url.pathname==='/api/beers'&&req.method==='POST'){
     const result=beerSchema.safeParse(await body(req,20000+maxPhotoLength));if(!result.success)return json(res,400,{error:result.error.issues[0]?.message||'Controleer je gegevens.'});
     const {photo:submittedPhoto,...beer}=result.data;
     delete beer.hasPhoto;
     beer.updatedAt=new Date().toISOString();
     const photo=submittedPhoto===undefined?getPhoto.get(beer.id)?.photo:submittedPhoto;
     db.prepare('INSERT INTO beers(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(beer.id,JSON.stringify(photo?{...beer,photo}:beer),beer.updatedAt);
     return json(res,200,{...beer,hasPhoto:Boolean(photo)});
    }
    if(url.pathname==='/api/lookup'&&req.method==='GET'){
     const code=url.searchParams.get('code')||'';if(!/^\d{8,14}$/.test(code))return json(res,400,{error:'Vul een barcode van 8 tot 14 cijfers in.'});
     const hit=cached.get(code);if(hit&&hit.until>Date.now())return json(res,200,hit.data);
     if(!allow('lookup',10,60000))return json(res,429,{error:'Even wachten: je hebt veel barcodes opgezocht. Probeer over een minuut opnieuw.'});
     const data=await lookup(code);if(cached.size>=500)cached.delete(cached.keys().next().value);cached.set(code,{data,until:Date.now()+24*3600000});return json(res,200,data);
    }
    return json(res,404,{error:'Niet gevonden.'});
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Methode niet toegestaan.'});
   let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return json(res,400,{error:'Ongeldig adres.'});}
   const relative=pathname==='/'||pathname==='/login'?'index.html':pathname.replace(/^\/+/, '');
   const filename=path.resolve(staticDir,relative);
   if(!filename.startsWith(path.resolve(staticDir)+path.sep))return json(res,403,{error:'Geen toegang.'});
   let content;try{if(!statSync(filename).isFile())throw Error();content=readFileSync(filename);}catch{return json(res,404,{error:'Niet gevonden.'});}
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
   res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Er ging iets mis. Probeer opnieuw.'});else res.end();}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 server.on('close',()=>db.close());
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const server=createBierServer();const port=Number(process.env.PORT)||3000;
 server.listen(port,'0.0.0.0',()=>console.log('De Bierkelder luistert op poort '+port));
 const shutdown=()=>server.close(()=>process.exit(0));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
