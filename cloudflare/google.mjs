let cached;
const enc=new TextEncoder();
const b64=a=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function googleToken(env) {
  const now=Math.floor(Date.now()/1000);
  if(cached?.email===env.GOOGLE_SERVICE_ACCOUNT_EMAIL && cached.expires>now+60) return cached.token;
  const pem=env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replaceAll('\\n','\n').replace(/-----[^-]+-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const head=b64(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const body=b64(enc.encode(JSON.stringify({iss:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/devstorage.read_write',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
  const unsigned=head+'.'+body;
  const assertion=unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned))));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!response.ok) throw Error('Google storage authentication failed');
  const result=await response.json();
  cached={email:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,token:result.access_token,expires:now+result.expires_in};
  return cached.token;
}
export const objectURL=(env,name)=>`https://storage.googleapis.com/${env.GOOGLE_CLOUD_STORAGE_BUCKET}/${name.split('/').map(encodeURIComponent).join('/')}`;
export async function initiate(env,name,size,mime,origin) {
  const url=`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.GOOGLE_CLOUD_STORAGE_BUCKET)}/o?uploadType=resumable&ifGenerationMatch=0`;
  const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+await googleToken(env),'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(size),Origin:origin},body:JSON.stringify({name,contentType:mime})});
  if(!res.ok||!res.headers.get('Location')) throw Error('Could not start Google storage upload');
  return res.headers.get('Location');
}
export async function objectInfo(env,name) {
  const res=await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.GOOGLE_CLOUD_STORAGE_BUCKET)}/o/${encodeURIComponent(name)}`,{headers:{Authorization:'Bearer '+await googleToken(env)}});
  if(!res.ok) throw Error('Upload is not complete in Google storage');
  return res.json();
}
