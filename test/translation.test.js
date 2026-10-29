import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { openDb } from '../relay/src/db.js';
import { createStore } from '../relay/src/store.js';
import { createServer } from '../relay/src/server.js';
import { createWorkspaceManager } from '../relay/src/workspaces.js';
import { createTranslator } from '../relay/src/translate.js';

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const until = async predicate => { for(let i=0;i<80;i++) {if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Translation timeout'); };
async function fixture(t, translator) {
  const db=openDb(':memory:'), store=createStore(db);store.createProject({key:'TEST',name:'Test'});
  const server=createServer({store,translator});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const call=async(route,body,method=body?'POST':'GET')=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};};
  return {store,call};
}
const fake = () => ({available:true,provider:'test',translate:async({summary,description,targetLang})=>({summary:`${targetLang}:${summary}`,description:`${targetLang}:${description}`,provider:'test'})});

test('existing/imported tasks automatically acquire all three translations on read',async t=>{
  const {store,call}=await fixture(t,fake());
  const issue=store.createIssue({projectKey:'TEST',summary:'Existing',description:'Original'});
  await call('/issues?project=TEST');
  await until(()=>Object.keys(store.getIssue(issue.key).translations).length===3);
  assert.equal(store.getIssue(issue.key).translations.hu.description,'hu:Original');
});

test('translate action uses body.lang and rejects unsupported languages before contacting provider',async t=>{
  const calls=[];const translator=fake();const original=translator.translate;translator.translate=args=>{calls.push(args);return original(args);};
  const {store,call}=await fixture(t,translator);const issue=store.createIssue({projectKey:'TEST',summary:'Original'});
  const result=await call(`/issues/${issue.key}/translate`,{lang:'ro'});
  assert.equal(result.status,200);assert.equal(result.body.translations.ro.summary,'ro:Original');assert.equal(calls[0].targetLang,'ro');
  assert.equal((await call(`/issues/${issue.key}/translate`,{lang:'fr'})).status,400);assert.equal(calls.length,1);
});

test('source text edits invalidate translations; status changes retain them',async t=>{
  const {store,call}=await fixture(t,fake());const issue=store.createIssue({projectKey:'TEST',summary:'Original'});
  store.setTranslation(issue.key,'en',{summary:'Old',description:''});
  await call(`/issues/${issue.key}`,{status:'done'},'PATCH');
  assert.equal(store.getIssue(issue.key).translations.en.summary,'Old');
  await call(`/issues/${issue.key}`,{summary:'Changed'},'PATCH');
  assert.notEqual(store.getIssue(issue.key).translations.en?.summary,'Old');
  await until(()=>store.getIssue(issue.key).translations.en?.summary==='en:Changed');
});

test('late provider responses never overwrite edited source or manual translations',async t=>{
  const releases=[];const {store,call}=await fixture(t,{available:true,translate:args=>new Promise(resolve=>releases.push(()=>resolve({summary:'stale',description:'stale'})))});
  const issue=store.createIssue({projectKey:'TEST',summary:'Before'});
  await call(`/issues/${issue.key}`);assert.equal(releases.length,3);
  store.updateIssue(issue.key,{summary:'After'});store.setTranslation(issue.key,'en',{summary:'Manual',description:''});
  releases.forEach(release=>release());await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(Object.keys(store.getIssue(issue.key).translations),['en']);assert.equal(store.getIssue(issue.key).translations.en.summary,'Manual');
});

test('failed translations are reported and are not retried on every poll',async t=>{
  let calls=0;const {store,call}=await fixture(t,{available:true,translate:async()=>{calls++;throw Error('upstream secret must not be logged');}});
  const issue=store.createIssue({projectKey:'TEST',summary:'Original'});await call(`/issues/${issue.key}`);
  await until(()=>calls===3);await new Promise(r=>setTimeout(r,20));
  const result=await call(`/issues/${issue.key}`);assert.equal(result.body.translationsFailed,3);assert.equal(calls,3);
});

test('translation settings require owner, stay isolated, hide keys and survive restart',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'relay-translation-'));let manager=createWorkspaceManager(directory);
  const supabase={available:true,verify:async(token,organization)=>({id:'qa',role:token==='owner'?'owner':'member',organization})};
  let server=createServer({workspaceManager:manager,supabase,translator:fake()});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const call=async(org,token,body)=>fetch(`http://127.0.0.1:${server.address().port}/api/settings/translation`,{method:body?'PATCH':'GET',headers:{authorization:`Bearer ${token}`,'x-organization-id':org,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  t.after(async()=>{await new Promise(r=>server.close(r));manager.close();rmSync(directory,{recursive:true,force:true});});
  assert.equal((await call(A,'member')).status,403);assert.equal((await call(A,'member',{enabled:false})).status,403);
  assert.equal((await (await call(A,'owner',{enabled:false})).json()).available,false);
  assert.equal((await (await call(B,'owner')).json()).available,true);
  manager.get(A).db.prepare("UPDATE workspace_settings SET value=? WHERE name='translation-v1'").run(JSON.stringify({enabled:false,apiKey:'PRIVATE-COMPANY-KEY'}));
  const publicStatus=await (await call(A,'owner')).text();assert.ok(!publicStatus.includes('PRIVATE-COMPANY-KEY'));assert.ok(!publicStatus.includes('apiKey'));
  await new Promise(r=>server.close(r));manager.close();manager=createWorkspaceManager(directory);
  server=createServer({workspaceManager:manager,supabase,translator:fake()});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  assert.equal((await (await call(A,'owner')).json()).enabled,false);
});

test('shared dictionaries cover login, admin and connection settings in four languages',()=>{
  const storage=new Map();const window={};const document={documentElement:{},querySelectorAll:()=>[]};
  vm.runInNewContext(readFileSync(new URL('../access-i18n.js',import.meta.url),'utf8'),{window,document,localStorage:{getItem:k=>storage.get(k)}});
  const dict=window.TasksI18n.dictionaries, keys=Object.keys(dict.es).sort();
  assert.ok(keys.length>65);
  for(const lang of ['en','ro','hu']) {assert.deepEqual(Object.keys(dict[lang]).sort(),keys);for(const text of Object.values(dict[lang]))assert.ok(text.trim());assert.notEqual(dict[lang].translationHelp,dict.es.translationHelp);}
});

test('provider errors cannot leak its response and successful results must contain a non-empty title',async t=>{
  const http=await import('node:http');let invalid=false;
  const provider=http.createServer((req,res)=>{res.writeHead(invalid?200:401,{'content-type':'application/json'});res.end(invalid?JSON.stringify({choices:[{message:{content:'{"description":"empty title"}'}}]}):'PRIVATE-KEY');});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>provider.close(r)));
  const translator=createTranslator({LLM_API_KEY:'private',LLM_BASE_URL:`http://127.0.0.1:${provider.address().port}`});
  await assert.rejects(()=>translator.translate({summary:'Test',targetLang:'hu'}),e=>e.status===502&&!e.message.includes('PRIVATE-KEY'));
  invalid=true;await assert.rejects(()=>translator.translate({summary:'Test',targetLang:'hu'}),e=>e.status===502);
});
