import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {renderRevamp} from '../revamp.js';
import {publicPath} from '../security.js';
const root=path.resolve(import.meta.dirname,'..');
const strains=JSON.parse(fs.readFileSync(path.join(root,'strains.json')));
const render=p=>renderRevamp(new URL(p,'http://localhost'),strains);
test('reference search filters real records and never generates an unknown match',()=>{
  const match=render('/discover?q=Blue+Dream');assert.match(match,/<h3>Blue Dream<\/h3>/);
  assert.doesNotMatch(match,/<h3>OG Kush<\/h3>/);
  assert.match(render('/discover?q=nonexistent-987654'),/No matching entries/);
  assert.match(render('/discover?q=Blue+Dream&type=Indica'),/No matching entries/);
});
test('all records are reachable through pagination with source status',()=>{
  const names=[];
  for(let p=1;p<=Math.ceil(strains.length/18);p++){
    const html=render('/discover?page='+p);
    names.push(...[...html.matchAll(/<h3>(.*?)<\/h3>/g)].map(m=>m[1]));
    assert.match(html,/Sources pending review/);
  }
  assert.equal(names.length,strains.length);assert.equal(new Set(names).size,strains.length);
});
test('query and imported record content are escaped',()=>{
  const html=render('/discover?q='+encodeURIComponent('<img src=x onerror=alert(1)>'));
  assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);
  const imported=renderRevamp(new URL('/discover','http://localhost'),[{name:'<script>evil</script>',type:'Hybrid',flavors:['<img>']}]);
  assert.doesNotMatch(imported,/<script>evil/);assert.match(imported,/&lt;script&gt;/);
});
test('private files and traversal are denied while required public assets resolve',()=>{
  for(const p of ['/server.js','/security.js','/revamp.js','/package.json','/.env','/.git/config','/leads.json','/contacts.json','/analytics.jsonl','/scripts/expand-strains.mjs','/public/../server.js','/%2e%2e/server.js','/public/%2e%2e/server.js','/%zz'])assert.equal(publicPath(root,p),null,p);
  assert.equal(publicPath(root,'/public/css/main.css'),path.join(root,'public/css/main.css'));
  assert.equal(publicPath(root,'/theme.js'),path.join(root,'theme.js'));
});
test('primary routes render useful HTML without client JavaScript',()=>{
  for(const p of ['/','/learn/start','/guide','/discover']){
    const html=render(p);assert.match(html,/<h1>/);assert.match(html,/<title>/);assert.match(html,/name="description"/);assert.match(html,/Skip to content/);
  }
  assert.equal(render('/not-a-new-route'),null);
});
