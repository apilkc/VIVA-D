(() => {
  let configPromise, scriptPromise;
  const config=()=>configPromise||(configPromise=fetch('/api/config').then(r=>r.json()));
  async function metadata(file) {
    if(!file?.type.startsWith('image/'))return null;
    try {
      const exif=await exifr.parse(file,{gps:true,exif:true});
      if(!exif)return null;
      const lat=exif.latitude,lng=exif.longitude;
      const date=exif.DateTimeOriginal;
      return {gps:Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=26&&lat<=31&&lng>=79.5&&lng<=89?{lat,lng}:null,capturedAt:date instanceof Date?`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`:''};
    }catch{return null;}
  }
  async function challenge() {
    const cfg=await config();
    if(!cfg.directUploadsEnabled)throw Error('The site owner must finish connecting storage before uploads are available.');
    if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=()=>reject(Error('Could not load security check'));document.head.append(s);});
    await scriptPromise;
    return new Promise((resolve,reject)=>{
      const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:100000;background:#0009;display:grid;place-items:center';
      const box=document.createElement('div');box.style.cssText='background:white;color:#222;padding:24px;border-radius:12px;max-width:95vw';
      const text=document.createElement('p');text.textContent='Complete the security check to continue.';
      const widget=document.createElement('div'),cancel=document.createElement('button');cancel.textContent='Cancel';
      box.append(text,widget,cancel);overlay.append(box);document.body.append(overlay);
      let id; const timer=setTimeout(()=>finish(null,'Security check timed out'),120000);
      function finish(token,error){clearTimeout(timer);if(id!==undefined)turnstile.remove(id);overlay.remove();error?reject(Error(error)):resolve(token);}
      cancel.onclick=()=>finish(null,'Cancelled');
      id=turnstile.render(widget,{sitekey:cfg.turnstileSiteKey,callback:token=>finish(token),'error-callback':()=>finish(null,'Security check failed')});
    });
  }
  const errorResponse=error=>Response.json({error:error.message||'Upload failed'},{status:400});
  async function submit(form) {
    try {
      const file=form.get('media');
      if(!(file instanceof File))throw Error('Automatic social downloads are disabled. Save the media to your device, then upload it here.');
      if(file.size>50*1024*1024)throw Error('Each file must be no larger than 50 MB.');
      const data=Object.fromEntries([...form.entries()].filter(([key])=>key!=='media'));
      // Use each photo’s own GPS instead of copying the first photo’s GPS across a batch.
      if(data.location_source==='EXIF GPS'||/exif/i.test(data.location_source||'')) {
        const own=await metadata(file);
        if(!own?.gps)throw Error('This file has no GPS data. Upload it separately and choose its location.');
        data.lat=own.gps.lat;data.lng=own.gps.lng;
        if(own.capturedAt)data.captured_at=own.capturedAt;
      }
      Object.assign(data,{file_size:file.size,mime_type:file.type,original_filename:file.name,turnstileToken:await challenge()});
      const init=await fetch('/api/uploads/initiate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!init.ok)return init;
      const session=await init.json();
      const uploaded=await fetch(session.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
      if(!uploaded.ok)throw Error('Google storage upload failed. Please try again.');
      return await fetch('/api/uploads/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token})});
    }catch(error){return errorResponse(error);}
  }
  async function mutate(url,options={}) {
    try {const data=options.body?JSON.parse(options.body):{};data.turnstileToken=await challenge();return await fetch(url,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}catch(error){return errorResponse(error);}
  }
  window.VIVAD_EDGE={metadata,submit,mutate};
  document.addEventListener('DOMContentLoaded',()=>{
    const hint=document.createElement('p');hint.textContent='Direct uploads: up to 50 MB per file. Automatic social downloads are unavailable; save the file to your device and upload it.';hint.style.cssText='padding:10px;font-size:13px';document.querySelector('#archiveStatus')?.after(hint);
  });
})();
