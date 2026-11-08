import { build } from 'esbuild';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'dist-selfhost');
const configuredOrigin=new URL(process.env.BIERKELDER_EXTENSION_ORIGIN||'http://127.0.0.1:3080');
if(configuredOrigin.protocol!=='https:'&&!(configuredOrigin.protocol==='http:'&&['localhost','127.0.0.1'].includes(configuredOrigin.hostname)))throw Error('Gebruik HTTPS of localhost voor de Untappd-extensie.');
const extensionOrigin=JSON.stringify(configuredOrigin.origin);
await mkdir(path.join(out,'public'),{recursive:true});
await build({entryPoints:[path.join(root,'selfhost/main.tsx')],outdir:path.join(out,'public'),bundle:true,minify:true,splitting:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',define:{__BIERKELDER_ORIGIN__:extensionOrigin,'process.env.NODE_ENV':'"production"'},plugins:[{name:'plain-cellar-css',setup(b){b.onLoad({filter:/app[\\/]globals\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('@import "tailwindcss";',''),loader:'css'}));}}]});
await build({entryPoints:[path.join(root,'app/beer.ts')],outfile:path.join(out,'schema.mjs'),bundle:true,minify:true,format:'esm',platform:'node',target:'node24'});
for(const file of ['server.mjs','shop-prices.mjs','wish-details.mjs'])await copyFile(path.join(root,'selfhost',file),path.join(out,file));
let index=await readFile(path.join(root,'selfhost/index.html'),'utf8');
for(const asset of ['main.css','main.js']){
  const content=await readFile(path.join(out,'public',asset));
  const version=createHash('sha256').update(content).digest('hex').slice(0,12);
  index=index.replace(`"/${asset}"`,`"/${asset}?v=${version}"`);
}
await writeFile(path.join(out,'public/index.html'),index);
await copyFile(path.join(root,'public/favicon.svg'),path.join(out,'public/favicon.svg'));
const extensionDir=path.join(root,'selfhost/untappd-extension');
const extension=await build({entryPoints:['worker.ts','cellar.ts','untappd.ts'].map(file=>path.join(extensionDir,file)),
 outdir:extensionDir,bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,define:{__BIERKELDER_ORIGIN__:extensionOrigin}});
const extensionFiles=Object.fromEntries(extension.outputFiles.map(file=>[path.basename(file.path),file.contents]));
const manifest=JSON.parse(await readFile(path.join(extensionDir,'manifest.json'),'utf8'));
manifest.content_scripts[0].matches=[configuredOrigin.protocol+'//'+configuredOrigin.hostname+'/*'];
extensionFiles['manifest.json']=new TextEncoder().encode(JSON.stringify(manifest,null,2));
await writeFile(path.join(out,'public/bierkelder-untappd-1.3.zip'),zipSync(extensionFiles));
console.log('Zelfhostversie gebouwd: '+out);
