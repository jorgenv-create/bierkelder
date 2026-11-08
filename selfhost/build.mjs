import { build } from 'esbuild';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'dist-selfhost');
await mkdir(path.join(out,'public'),{recursive:true});
await build({entryPoints:[path.join(root,'selfhost/main.tsx')],outdir:path.join(out,'public'),bundle:true,minify:true,splitting:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'plain-cellar-css',setup(b){b.onLoad({filter:/app[\\/]globals\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('@import "tailwindcss";',''),loader:'css'}));}}]});
await build({entryPoints:[path.join(root,'app/beer.ts')],outfile:path.join(out,'schema.mjs'),bundle:true,minify:true,format:'esm',platform:'node',target:'node24'});
await copyFile(path.join(root,'selfhost/server.mjs'),path.join(out,'server.mjs'));
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const notices=[];
for(const [directory,dependency] of Object.entries(lock.packages)){
  if(!directory||dependency.dev)continue;
  const notice=directory==='node_modules/@zxing/text-encoding'?'LICENSE.md':'LICENSE';
  try{
    const license=await readFile(path.join(root,directory,notice),'utf8');
    notices.push(`${directory.replace(/^node_modules\//,'')} ${dependency.version}\n\n${license.trim()}`);
  }catch(error){if(!dependency.optional||error.code!=='ENOENT')throw error;}
}
await writeFile(path.join(out,'THIRD_PARTY_NOTICES'),notices.join('\n\n---\n\n')+'\n');
let index=await readFile(path.join(root,'selfhost/index.html'),'utf8');
for(const asset of ['main.css','main.js']){
  const content=await readFile(path.join(out,'public',asset));
  const version=createHash('sha256').update(content).digest('hex').slice(0,12);
  index=index.replace(`"/${asset}"`,`"/${asset}?v=${version}"`);
}
await writeFile(path.join(out,'public/index.html'),index);
await copyFile(path.join(root,'public/favicon.svg'),path.join(out,'public/favicon.svg'));
console.log('Zelfhostversie gebouwd: '+out);
