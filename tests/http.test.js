import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=new URL('../',import.meta.url);
test('HTTP routes, preserved features, and request boundaries',async t=>{
  const env={...process.env,PORT:'0'};
  for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ADMIN_KEY','DASH_PASSWORD','PUBLIC_ORIGIN'])delete env[key];
  const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();if(child.exitCode===null)await once(child,'exit');});
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),15000);
    let output='';child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});
    child.stderr.on('data',chunk=>{output+=chunk;});
  });
  for(const path of ['/','/?utm_source=test','/discover?q=Blue+Dream','/learn/start','/guide','/encyclopedia','/learn','/strains','/strains/blue-dream','/quiz','/quiz-2','/scan','/about','/contact','/history','/public/css/revamp.css','/css/main.css','/michael.jpg']){
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('x-content-type-options'),'nosniff');await response.arrayBuffer();
  }
  for(const path of ['/server.js','/security.js','/.env','/.git/config','/leads.json','/contacts.json','/subscribers.jsonl','/package.json']){
    const response=await fetch(base+path);assert.equal(response.status,404,path);await response.text();
  }
  for(const path of ['/admin','/add-strain','/dashboard']){const r=await fetch(base+path);assert.equal(r.status,503,path);await r.text();}
  const chat=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'What is THC?'}]})});assert.equal(chat.status,503);await chat.text();
  const origin=await fetch(base+'/api/track',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(origin.status,403);await origin.text();
  const large=await fetch(base+'/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({padding:'x'.repeat(70000)})});assert.equal(large.status,413);await large.text();
  const invalid=await fetch(base+'/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});assert.equal(invalid.status,400);await invalid.text();
  const db=await fetch(base+'/api/strains/all?version=test');assert.equal((await db.json()).length,394);
  const robots=await fetch(base+'/robots.txt');assert.match(await robots.text(),/Disallow: \//);
  const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
