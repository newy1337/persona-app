import { test } from 'vitest';
import assert from 'node:assert/strict';
const modulePromise = import('./action-store');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function api(write){return {get:async()=>42,post:write,put:write,delete:write}}
const tick=()=>new Promise(done=>setTimeout(done, 0));
test('shows pending and success, retains return values, and expires notice',async()=>{
 const {createActionStore}=await modulePromise,wait=deferred(),timers=[];
 const client=api(()=>wait.promise),store=createActionStore(client,fn=>timers.push(fn));
 const promise=client.put('/api/managers/2',{region_code:'0077'});
 assert.equal(store.getSnapshot().notices[0].text,'Сохраняем…');
 assert.deepEqual(store.getSnapshot().pending,['put:/api/managers/2']);
 wait.resolve({ok:true});assert.deepEqual(await promise,{ok:true});
 assert.equal(store.getSnapshot().notices[0].text,'Сохранено');assert.deepEqual(store.getSnapshot().pending,[]);
 timers[0]();assert.equal(store.getSnapshot().notices.length,0);
});
test('deduplicates identical in-flight writes without dropping or reordering distinct values',async()=>{
 const {createActionStore}=await modulePromise,gates=[deferred(),deferred(),deferred()],values=[];
 const client=api((url,value)=>{values.push(value.region_code);return gates[values.length-1].promise}),store=createActionStore(client,()=>{});
 const one=client.put('/api/managers/2',{region_code:'0077'}),duplicate=client.put('/api/managers/2',{region_code:'0077'});
 assert.equal(one,duplicate);
 const two=client.put('/api/managers/2',{region_code:'0999'}),three=client.put('/api/managers/2',{region_code:'0077'});
 await tick();assert.deepEqual(values,['0077']);gates[0].resolve(1);assert.equal(await one,1);
 await tick();assert.deepEqual(values,['0077','0999']);assert.equal(store.getSnapshot().pending.length,1);
 gates[1].resolve(2);assert.equal(await two,2);await tick();assert.deepEqual(values,['0077','0999','0077']);
 gates[2].resolve(3);assert.equal(await three,3);assert.deepEqual(store.getSnapshot().pending,[]);
});
test('failed saves reject with readable error and allow a retry',async()=>{
 const {createActionStore}=await modulePromise;let attempts=0;
 const client=api(async()=>{if(++attempts===1)throw Object.assign(Error('internal details'),{status:500});return 'saved'}),store=createActionStore(client,()=>{});
 await assert.rejects(client.put('/api/managers/2',{}),error=>error.detail==='Сервер не смог выполнить действие. Попробуйте ещё раз.');
 assert.equal(store.getSnapshot().notices[0].status,'error');assert.deepEqual(store.getSnapshot().pending,[]);
 assert.equal(await client.put('/api/managers/2',{}),'saved');assert.equal(attempts,2);
});
test('error popups expire after seven seconds and still reject the failed operation', async()=>{
 const {createActionStore}=await modulePromise,timers=[];
 const client=api(async()=>{throw Error('Не удалось сохранить')}),store=createActionStore(client,(fn,delay)=>timers.push({fn,delay}));
 await assert.rejects(client.put('/api/managers/2',{}),/Не удалось сохранить/);
 assert.equal(store.getSnapshot().notices[0].status,'error');assert.equal(timers[0].delay,7000);
 timers[0].fn();assert.deepEqual(store.getSnapshot().notices,[]);
});
test('GET/auth stay silent; credentials and message bodies never enter feedback state',async()=>{
 const {createActionStore}=await modulePromise,client=api(async()=>({password:'secret-return'})),store=createActionStore(client,()=>{});
 await client.get('/api/managers');await client.post('/auth/login',{password:'secret-login'});await client.post('/api/tg-accounts/auth/abc/cancel',{});
 assert.deepEqual(store.getSnapshot(),{notices:[],pending:[]});
 const write=client.post('/api/managers/2/password',{password:'secret-new'});
 assert.ok(!JSON.stringify(store.getSnapshot()).includes('secret'));await write;
 assert.ok(!JSON.stringify(store.getSnapshot()).includes('secret'));
});
test('network and permissions errors have actionable messages',async()=>{
 const {readableError}=await modulePromise;
 assert.match(readableError(new TypeError('Failed to fetch')),/Нет связи/);
 assert.match(readableError({status:403}),/прав/);assert.match(readableError({status:401}),/Войдите/);
 assert.equal(readableError({detail:['Первое','Второе']}),'Первое. Второе');
});

test('queued messages are not falsely reported as delivered', async () => {
 const {createActionStore}=await modulePromise;
 const client=api(async()=>({ok:true,pending_reply_id:15})),store=createActionStore(client,()=>{});
 await client.post('/api/conversations/1/message',{text:'test'});
 assert.equal(store.getSnapshot().notices[0].text,'Принято в очередь отправки');
});

test('voicer task creation produces one resource-scoped success notification', async()=>{
 const {createActionStore}=await modulePromise,client=api(async()=>({id:1})),store=createActionStore(client,()=>{});
 await client.post('/api/voicer/tasks',{title:'Тест'});
 assert.equal(store.getSnapshot().notices.length,1);
 assert.equal(store.getSnapshot().notices[0].text,'Задание добавлено в очередь');
});
