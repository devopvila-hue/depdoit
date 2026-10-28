import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../backend-client.js',import.meta.url),'utf8');
function storage(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function authContext({invite='invite-one',failure=false}={}){
 const sessionStorage=storage();const localStorage=storage();const events=[];
 const location={search:invite?'?invite='+invite:'',hash:'',origin:'https://tasks.departify.app',pathname:'/'};
 const API={enabled:()=>true,consumeOAuthRedirect(){events.push('oauth');},token:async()=>'jwt',currentUser:()=>({id:'user'}),rpc:async(fn,args)=>{events.push({fn,args});if(failure)throw new Error('wrong email');return 'org-new';},loadContext:async()=>({organizationId:'org-new',organizations:[]})};
 const window={DepdoitAPI:API,addEventListener(){}};
 vm.runInNewContext(source,{window,sessionStorage,localStorage,location,history:{replaceState(){}},URL,URLSearchParams,document:{},console});
 return {window,sessionStorage,localStorage,events};
}
test('invitation survives auth redirect and is redeemed before loading team',async()=>{
 const fixture=authContext();assert.equal(fixture.sessionStorage.getItem('depdoit:invite'),'invite-one');
 await fixture.window.DepdoitAuth.ensure();assert.equal(fixture.sessionStorage.getItem('depdoit:invite'),null);
 assert.equal(fixture.localStorage.getItem('depdoit:org'),'org-new');assert.equal(fixture.events[1].fn,'task_redeem_invitation');
});
test('wrong or expired invitation stays visible as error and is not discarded',async()=>{
 const fixture=authContext({failure:true});await assert.rejects(()=>fixture.window.DepdoitAuth.ensure(),/wrong email/);
 assert.equal(fixture.sessionStorage.getItem('depdoit:invite'),'invite-one');
});
test('same-origin Supabase magic link uses the existing project and retains invitation',async()=>{
 const calls=[];const window={DEPDOIT_CONFIG:{supabaseUrl:'https://same.supabase.co',supabaseAnonKey:'public'}};
 vm.runInNewContext(client,{window,localStorage:storage(),URLSearchParams,location:{origin:'https://tasks.departify.app'},fetch:async(url,init)=>{calls.push({url,init});return Response.json({});},console});
 await window.DepdoitAPI.sendMagicLink('invited@example.test','https://tasks.departify.app/?invite=abc');
 const request=calls[0];assert.equal(request.url,'https://same.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Ftasks.departify.app%2F%3Finvite%3Dabc');
 assert.equal(JSON.parse(request.init.body).email,'invited@example.test');
});
test('explicit organization selection is honored even if another has more boards',async()=>{
 const localStorage=storage();localStorage.setItem('depdoit:org','selected');localStorage.setItem('depdoit:session',JSON.stringify({access_token:'jwt',expires_at:Date.now()+3600000}));
 const window={DEPDOIT_CONFIG:{supabaseUrl:'https://same.supabase.co',supabaseAnonKey:'public'}};
 vm.runInNewContext(client,{window,localStorage,URLSearchParams,fetch:async url=>Response.json(url.includes('organization_memberships')?[{organization_id:'other',role:'owner',organizations:{name:'Other'}},{organization_id:'selected',role:'member',organizations:{name:'Chosen'}}]:url.includes('task_boards')?[{organization_id:'other'}]:[]),console});
 assert.equal((await window.DepdoitAPI.loadContext()).organizationId,'selected');
});
