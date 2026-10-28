import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../relay/src/server.js';
import { createWorkspaceManager } from '../relay/src/workspaces.js';
import { createSupabaseVerifier } from '../relay/src/supabase-auth.js';
import { importLegacy } from '../relay/src/legacy-import.js';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('verified membership scopes every route, data survives restart, revoked membership fails closed', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'relay-tenants-'));
  let revoked = false;
  const supabase = createSupabaseVerifier({ url: 'https://example.supabase.co', anonKey: 'public', requireMembership: true,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/auth/v1/user')) return Response.json(init.headers.Authorization === 'Bearer valid' ? { id:'user-1', user_metadata:{organization_id:B} } : {}, {status:init.headers.Authorization === 'Bearer valid' ? 200 : 401});
      return Response.json(!revoked && (url.includes(A) || url.includes(B)) ? [{organization_id:url.includes(A) ? A : B, role:'member'}] : []);
    }
  });
  // This fixture exercises membership only; import is verified separately.
  delete supabase.legacyBoards; delete supabase.members;
  let manager = createWorkspaceManager(directory);
  let server = createServer({ workspaceManager:manager, supabase });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let base=`http://127.0.0.1:${server.address().port}`;
  const call = (route, org, method='GET', body, token='valid') => fetch(base+route, {method,headers:{authorization:`Bearer ${token}`, 'x-organization-id':org || '', 'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  t.after(async()=>{ await new Promise(r=>server.close(r)); manager.close(); rmSync(directory,{recursive:true,force:true}); });
  assert.equal((await call('/api/projects',A,'POST',{key:'AA',name:'Empresa A'})).status,200);
  assert.deepEqual(await (await call('/api/projects',B)).json(),[]);
  assert.equal((await call('/api/projects/AA',B)).status,404);
  assert.equal((await call('/api/projects',null)).status,401);
  assert.equal((await call('/api/projects','../../private')).status,401);
  assert.equal((await call('/api/projects',A,'GET',undefined,'invalid')).status,401);
  assert.equal((await call('/api/users',A,'POST',{displayName:'Fake member'})).status,403);
  revoked=true;
  assert.equal((await call('/api/projects',A)).status,401);
  revoked=false;
  await new Promise(r=>server.close(r)); manager.close();
  manager=createWorkspaceManager(directory); server=createServer({workspaceManager:manager,supabase});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await call('/api/projects',A)).json())[0].name,'Empresa A');
});

test('workspace server cannot start without authentication', () => {
  assert.throws(()=>createServer({workspaceManager:{get(){}}}),/requires Supabase/);
});

test('legacy snapshot is idempotent and preserves dates, evidence, status and assignee', () => {
  const directory=mkdtempSync(path.join(tmpdir(),'relay-import-')); const manager=createWorkspaceManager(directory);
  try {
    const workspace=manager.get(A);
    const row={board_id:A,board_name:'Pruebas',list_name:'Falla',card_id:B,title:'No guarda',description:'Descripción',kind:'bug',severity:'blocker',expected:'Guardar',actual:'Error',verified_at:null,start_date:'2026-10-29',due_date:'2026-10-30',assignees:[{user_id:'one'}]};
    importLegacy(workspace,[row],[{user_id:'one',email:'one@example.test'}]);
    importLegacy(workspace,[row],[{user_id:'one',email:'one@example.test'}]);
    const issues=workspace.store.listIssues();assert.equal(issues.length,1);const issue=issues[0];
    assert.equal(issue.status,'blocked');assert.equal(issue.type,'bug');assert.equal(issue.priority,'highest');
    assert.equal(issue.startDate,'2026-10-29');assert.equal(issue.assignee.email,'one@example.test');
    assert.match(issue.description,/Qué debería pasar:\nGuardar/);assert.equal(workspace.db.prepare('SELECT COUNT(*) n FROM legacy_imports').get().n,1);
  } finally { manager.close();rmSync(directory,{recursive:true,force:true}); }
});

test('failed membership lookup never accepts user metadata as permission', async () => {
  const verifier=createSupabaseVerifier({url:'https://example.supabase.co',anonKey:'public',requireMembership:true,fetchImpl:async url=>url.endsWith('/user')?Response.json({id:'user',user_metadata:{organization_id:A}}):new Response('{}',{status:503})});
  assert.equal(await verifier.verify('valid',A),null);
});


test('intentional empty dates survive reopening a workspace', () => {
  const directory=mkdtempSync(path.join(tmpdir(),'relay-empty-dates-'));
  let manager=createWorkspaceManager(directory);
  try {
    const store=manager.get(A).store;store.createProject({key:'DD',name:'Dates'});
    const issue=store.createIssue({projectKey:'DD',summary:'No dates',startDate:null,dueDate:null});
    manager.close();manager=createWorkspaceManager(directory);
    const restored=manager.get(A).store.getIssue(issue.key);
    assert.equal(restored.startDate,null);assert.equal(restored.dueDate,null);
  } finally {manager.close();rmSync(directory,{recursive:true,force:true});}
});
