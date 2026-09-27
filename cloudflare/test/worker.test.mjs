import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{validate,serialize} from '../worker.mjs';
const valid={title:'Flood photo',media_type:'photo',lat:28,lng:85,acknowledged:'1'};
test('rejects invalid locations, acknowledgement and source schemes',()=>{
 for(const extra of [{lat:''},{lat:100},{lng:'NaN'},{acknowledged:0},{document_source_url:'javascript:alert(1)'},{website:'spam'}])assert.throws(()=>validate({...valid,...extra}));
 assert.equal(validate(valid).lat,28);
});
test('read-only deployment preserves published records and fails closed for uploads',async()=>{
 const res=await worker.fetch(new Request('https://archive.example/api/items'),{});
 const data=await res.json();assert.ok(data.items.length>=122);
 assert.ok(data.items.every(i=>Number.isInteger(i.id)&&i.status==='published'));
 const config=await(await worker.fetch(new Request('https://archive.example/api/config'),{})).json();assert.equal(config.directUploadsEnabled,false);assert.equal(config.socialImportsEnabled,false);
 const upload=await worker.fetch(new Request('https://archive.example/api/uploads/initiate',{method:'POST',headers:{Origin:'https://archive.example'},body:'{}'}),{});assert.equal(upload.status,503);
});
test('thumbnail uses Google URL rather than old Railway proxy',()=>{
 assert.equal(serialize({id:1,media_type:'photo',drive_url:'https://storage.googleapis.com/b/a',thumbnailUrl:'/api/items/1/thumbnail'}).thumbnailUrl,'https://storage.googleapis.com/b/a');
});
test('schema and seed preserve IDs, and concurrent quota claims cannot exceed cap',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../seed.sql',import.meta.url),'utf8'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,125);
 db.exec(readFileSync(new URL('../seed.sql',import.meta.url),'utf8'));assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,125);
 const stmt=db.prepare('INSERT INTO quotas(day,count,bytes) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET count=count+1,bytes=bytes+excluded.bytes WHERE count<20 AND bytes+excluded.bytes<=209715200 RETURNING count');
 for(let i=0;i<20;i++)assert.ok(stmt.get('today',1));assert.equal(stmt.get('today',1),undefined);
 db.close();
});
test('upload completion verifies Google object and is idempotent',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};}};}};
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const key=Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
 const env={DB,GOOGLE_CLOUD_STORAGE_BUCKET:'test-bucket',GOOGLE_SERVICE_ACCOUNT_EMAIL:'test@example.com',GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'test'};
 const original=globalThis.fetch;let size=12;
 globalThis.fetch=async url=>{
   if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'archive.example'});
   if(String(url).includes('oauth2'))return Response.json({access_token:'test',expires_in:3600});
   if(String(url).includes('uploadType=resumable'))return new Response(null,{headers:{Location:'https://storage.googleapis.com/upload/test'}});
   if(String(url).includes('/storage/v1/'))return Response.json({size:String(size),contentType:'image/jpeg'});
   throw Error('Unexpected outbound request '+url);
 };
 const post=(path,data,origin='https://archive.example')=>worker.fetch(new Request('https://archive.example'+path,{method:'POST',headers:{Origin:origin},body:JSON.stringify(data)}),env);
 try {
   assert.equal((await post('/api/uploads/initiate',{},'https://evil.example')).status,403);
   const initial=await post('/api/uploads/initiate',{...valid,turnstileToken:'verified',file_size:12,mime_type:'image/jpeg',original_filename:'test.jpg'});assert.equal(initial.status,200);
   const session=await initial.json();assert.equal(sqlite.prepare('SELECT count(*) n FROM records').get().n,0);
   size=13;assert.equal((await post('/api/uploads/complete',{token:session.token})).status,400);
   size=12;const complete=await post('/api/uploads/complete',{token:session.token});assert.equal(complete.status,201);
   const first=(await complete.json()).item;assert.match(first.drive_url,/^https:\/\/storage.googleapis.com\/test-bucket\/media\/cloudflare\//);
   const retry=await post('/api/uploads/complete',{token:session.token});assert.equal((await retry.json()).item.id,first.id);
   assert.equal(sqlite.prepare('SELECT count(*) n FROM records').get().n,1);
 }finally{globalThis.fetch=original;sqlite.close();}
});
