import snapshot from './archive-snapshot.json' with {type:'json'};
import {initiate,objectInfo,objectURL} from './google.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const ready=env=>Boolean(env.DB&&env.GOOGLE_CLOUD_STORAGE_BUCKET&&env.GOOGLE_SERVICE_ACCOUNT_EMAIL&&env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY&&env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY);
export function serialize(item) {
  const url=item.drive_url||'';
  return {...item,id:Number(item.id),previewUrl:item.previewUrl||url,thumbnailUrl:item.thumbnail_url||(item.thumbnailUrl?.startsWith('https://')?item.thumbnailUrl:null)||(item.media_type==='photo'?url:null)};
}
export function validate(data) {
  if(data.website) throw fail('Submission rejected');
  if(String(data.acknowledged)!=='1') throw fail('Please confirm the item is authentic');
  const out={};
  for(const [key,max] of Object.entries({title:200,description:5000,location_name:200,captured_at:120,taken_by:200,owner:200,contact:300,location_source:200,publisher_type:200,document_source_url:2048})) out[key]=String(data[key]||'').trim().slice(0,max);
  if(!out.title) throw fail('A title is required');
  if(!['photo','video','document'].includes(data.media_type)) throw fail('Invalid media type');
  out.media_type=data.media_type;
  if(out.document_source_url) {let u;try{u=new URL(out.document_source_url);}catch{throw fail('Invalid source link');}if(!['http:','https:'].includes(u.protocol))throw fail('Invalid source link');}
  if(out.media_type!=='document') {
    const lat=Number(data.lat),lng=Number(data.lng);
    if(data.lat==null||data.lng==null||data.lat===''||data.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<26||lat>31||lng<79.5||lng>89) throw fail('Choose a location within Nepal');
    out.lat=lat;out.lng=lng;
  }else{out.lat=null;out.lng=null;if(!out.publisher_type)throw fail('Choose a publisher type');}
  return {...out,status:'published',storage_type:'gcs',downvotes:0,acknowledged:1,submitted_at:new Date().toISOString(),community_notes:'',metadata_history:'[]'};
}
async function body(request) {
  if(Number(request.headers.get('Content-Length'))>20000)throw fail('Request too large',413);
  const raw=await request.text();if(raw.length>20000)throw fail('Request too large',413);
  try{return JSON.parse(raw);}catch{throw fail('Invalid JSON');}
}
async function verify(request,env,data) {
  const origin=new URL(request.url).origin;
  if(request.headers.get('Origin')!==origin)throw fail('Invalid origin',403);
  if(!ready(env))throw fail('Uploads are not configured yet',503);
  if(!data.turnstileToken)throw fail('Please complete the security check',403);
  const res=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:data.turnstileToken,remoteip:request.headers.get('CF-Connecting-IP')||''})});
  const result=await res.json();
  if(!result.success||result.hostname!==new URL(origin).hostname)throw fail('Security check failed. Try again.',403);
}
async function items(env) {
  if(!env.DB)return snapshot.items.map(serialize);
  const {results}=await env.DB.prepare('SELECT id,data FROM records ORDER BY id DESC').all();
  return results.map(r=>serialize({...JSON.parse(r.data),id:r.id}));
}
async function route(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/config')return json({directUploadsEnabled:ready(env),storageType:'gcs',googleMapsApiKey:env.GOOGLE_MAPS_API_KEY||'',turnstileSiteKey:env.TURNSTILE_SITE_KEY||'',socialImportsEnabled:false});
  if(request.method==='GET'&&path==='/api/items')return json({items:(await items(env)).filter(i=>i.status==='published'&&Number(i.downvotes||0)<50)});
  const match=path.match(/^\/api\/items\/(\d+)(\/thumbnail)?$/);
  if(request.method==='GET'&&match) {
    const item=(await items(env)).find(i=>i.id===Number(match[1]));
    if(!item)return json({error:'Not found'},404);
    if(match[2])return item.thumbnailUrl?Response.redirect(item.thumbnailUrl,302):new Response(null,{status:404});
    return json({item});
  }
  if(path==='/api/places')return json({places:[]});
  if(path.includes('social')&&request.method==='GET')return json({});
  if(path==='/api/uploads/initiate'&&request.method==='POST') {
    const data=await body(request);await verify(request,env,data);
    const item=validate(data),size=Number(data.file_size),mime=String(data.mime_type||'');
    const allowed={photo:['image/jpeg','image/png','image/webp','image/heic','image/heif'],video:['video/mp4','video/quicktime','video/webm'],document:['application/pdf','image/jpeg','image/png','image/webp']}[item.media_type];
    if(!allowed.includes(mime))throw fail('Unsupported file type');
    if(!Number.isSafeInteger(size)||size<1||size>50*1024*1024)throw fail('Each file must be between 1 byte and 50 MB');
    const day=new Date().toISOString().slice(0,10);
    const quota=await env.DB.prepare('INSERT INTO quotas(day,count,bytes) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET count=count+1,bytes=bytes+excluded.bytes WHERE count<20 AND bytes+excluded.bytes<=209715200 RETURNING count').bind(day,size).first();
    if(!quota)throw fail('Daily archive upload limit reached. Try tomorrow.',429);
    const token=crypto.randomUUID()+crypto.randomUUID(),name='media/cloudflare/'+crypto.randomUUID();
    item.original_filename=String(data.original_filename||'upload').slice(0,200);item.mime_type=mime;item.file_size=size;
    const uploadUrl=await initiate(env,name,size,mime,url.origin);
    await env.DB.prepare('INSERT INTO uploads(token,object_name,data,size,mime,expires) VALUES(?,?,?,?,?,?)').bind(token,name,JSON.stringify(item),size,mime,Date.now()+3600000).run();
    return json({uploadUrl,token});
  }
  if(path==='/api/uploads/complete'&&request.method==='POST') {
    if(!ready(env))throw fail('Uploads are not configured yet',503);
    if(request.headers.get('Origin')!==url.origin)throw fail('Invalid origin',403);
    const data=await body(request);
    const existing=await env.DB.prepare('SELECT id,data FROM records WHERE upload_token=?').bind(String(data.token||'')).first();
    if(existing)return json({item:serialize({...JSON.parse(existing.data),id:existing.id})});
    const row=await env.DB.prepare('SELECT * FROM uploads WHERE token=?').bind(String(data.token||'')).first();
    if(!row||row.expires<Date.now())throw fail('Upload session expired');
    const info=await objectInfo(env,row.object_name);
    if(Number(info.size)!==row.size||info.contentType!==row.mime)throw fail('Uploaded file does not match its declared size or type');
    const item={...JSON.parse(row.data),drive_url:objectURL(env,row.object_name)};
    await env.DB.prepare('INSERT OR IGNORE INTO records(data,upload_token) VALUES(?,?)').bind(JSON.stringify(item),data.token).run();
    const saved=await env.DB.prepare('SELECT id,data FROM records WHERE upload_token=?').bind(data.token).first();
    return json({item:serialize({...JSON.parse(saved.data),id:saved.id})},201);
  }
  const mutation=path.match(/^\/api\/items\/(\d+)\/(downvote|metadata)$/);
  if(mutation&&request.method==='POST') {
    const data=await body(request);await verify(request,env,data);
    const row=await env.DB.prepare('SELECT id,data FROM records WHERE id=?').bind(Number(mutation[1])).first();
    if(!row)throw fail('Item not found',404);
    const item=JSON.parse(row.data);
    if(mutation[2]==='downvote') item.downvotes=Number(item.downvotes||0)+1;
    else {
      if(data.confirmed!==true)throw fail('Please confirm your update');
      const changes=[];
      for(const key of ['title','location_name']) {
        const value=String(data[key]||'').trim().slice(0,200);
        if(key==='title'&&!value)throw fail('A title is required');
        if(value!==String(item[key]||'')){changes.push({field:key,from:item[key]||'',to:value});item[key]=value;}
      }
      if(item.media_type!=='document') {
        const lat=Number(data.lat),lng=Number(data.lng);
        if(data.lat===''||data.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<26||lat>31||lng<79.5||lng>89)throw fail('Choose a location within Nepal');
        for(const [key,value] of Object.entries({lat,lng}))if(item[key]!==value){changes.push({field:key,from:item[key],to:value});item[key]=value;}
      }
      const note=String(data.note||'').trim().slice(0,2000),at=new Date().toISOString();
      let history;try{history=JSON.parse(item.metadata_history||'[]');}catch{history=[];}
      history.push({at,changes,note});item.metadata_history=JSON.stringify(history.slice(-100));
      if(note)item.community_notes=(String(item.community_notes||'')+'\n['+at+'] '+note).slice(-20000);
    }
    const result=await env.DB.prepare('UPDATE records SET data=? WHERE id=? AND data=?').bind(JSON.stringify(item),row.id,row.data).run();
    if(!result.meta.changes)throw fail('Someone else updated this item. Refresh and try again.',409);
    return json({item:serialize({...item,id:row.id}),message:'Thank you for your feedback.'});
  }
  if(path.startsWith('/api/')&&request.method!=='GET')return json({error:path==='/api/items'?'Automatic social downloads are disabled on this free deployment. Download the file yourself and upload it here.':'Community editing is temporarily unavailable during migration.'},503);
  if(path==='/browse')return Response.redirect(url.origin+'/',302);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  return env.ASSETS.fetch(request);
}
export default {async fetch(request,env){try{return await route(request,env);}catch(error){console.error('Request failed:',error.message);return json({error:error.status?error.message:'Storage request failed. Please try again.'},error.status||502);}}};
