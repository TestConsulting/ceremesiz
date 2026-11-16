const {fail}=require('./core');
const fetchJson=async(url,options={})=>{
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(30000),redirect:'error'});
  const data=await r.json();
  if(!r.ok) throw Object.assign(new Error('Microsoft-Anfrage fehlgeschlagen ('+r.status+'). Anmeldung/Berechtigung prüfen.'),{status:502,oauthCode:data.error,graphStatus:r.status});
  return data;
};
function microsoft(config,{vault=null}={}) {
  const sessions=new Map(),refreshing=new Map();
  const session=(o,c)=>{const k=key(o,c);if(!sessions.has(k)){const saved=vault?.get(o,c);if(saved)sessions.set(k,saved);}return sessions.get(k);};
  const save=(o,c,s)=>{sessions.set(key(o,c),s);if(s.access_token)vault?.put(o,c,s);};
  const m=config.microsoft;
  const authority=m && /^[a-z0-9.-]+$/i.test(m.tenantId) && /^[a-z0-9-]+$/i.test(m.clientId) ? `https://login.microsoftonline.com/${m.tenantId}/oauth2/v2.0` : null;
  const key=(owner,company)=>`${owner}:${company}`;
  const form=(body)=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  async function token(owner,company) {
    const s=session(owner,company);
    if(!s?.access_token) fail('Microsoft nicht verbunden.',409);
    if(s.expiresAt<Date.now()+60000) {
      if(!s.refresh_token) fail('Microsoft-Anmeldung abgelaufen.',409);
      const k=key(owner,company);
      if(!refreshing.has(k))refreshing.set(k,fetchJson(authority+'/token',form({client_id:m.clientId,grant_type:'refresh_token',refresh_token:s.refresh_token})).then(t=>{Object.assign(s,t,{expiresAt:Date.now()+t.expires_in*1000});save(owner,company,s);}).finally(()=>refreshing.delete(k)));
      await refreshing.get(k);
    }
    return s.access_token;
  }
  async function graph(owner,company,route,options={}) {
    const url=new URL(route,'https://graph.microsoft.com/v1.0/');
    if(url.origin!=='https://graph.microsoft.com'||!url.pathname.startsWith('/v1.0/')) fail('Ungültiges Microsoft-Ziel.');
    return fetchJson(url,{...options,headers:{Authorization:'Bearer '+await token(owner,company),Prefer:'IdType="ImmutableId"','Content-Type':'application/json',...options.headers}});
  }
  const canWrite=(o,c)=>(session(o,c)?.scope||'').split(/\s+/).some(s=>/^Files\.ReadWrite$/i.test(s));
  const bankSync=require('./bank-sync').bankSync(require('./onedrive').oneDrive({graph,config}),canWrite);
  return {
    canWrite,bankSource:bankSync.source,publishBank:bankSync.publish,
    configured:!!authority,
    connected:(o,c)=>!!session(o,c)?.access_token,
    disconnect:(o,c)=>{sessions.delete(key(o,c));vault?.delete(o,c);},
    driveList:(o,c,p)=>require('./onedrive').oneDrive({graph,config}).list(o,c,p),
    driveFolder:(o,c,p)=>require('./onedrive').oneDrive({graph,config}).folder(o,c,p),
    driveDownload:(o,c,p)=>require('./onedrive').oneDrive({graph,config}).download(o,c,p),
    async begin(o,c) {
      if(!authority) fail('Microsoft-App ist nicht konfiguriert.',503);
      const t=await fetchJson(authority+'/devicecode',form({client_id:m.clientId,scope:'offline_access User.Read Mail.ReadWrite.Shared'+(config.mode==='cloud'?' Files.ReadWrite':'')}));
      sessions.set(key(o,c),{...t,nextPoll:Date.now()+t.interval*1000,expiresAt:Date.now()+t.expires_in*1000});
      return {userCode:t.user_code,verificationUri:t.verification_uri,expiresIn:t.expires_in,interval:t.interval};
    },
    async poll(o,c) {
      const s=sessions.get(key(o,c));
      if(!s || s.expiresAt<Date.now()) fail('Anmeldung abgelaufen. Erneut verbinden.',409);
      if(s.access_token) return {connected:true};
      if(Date.now()<s.nextPoll) return {connected:false};
      s.nextPoll=Date.now()+s.interval*1000;
      try {
        const t=await fetchJson(authority+'/token',form({client_id:m.clientId,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:s.device_code}));
        save(o,c,{...t,expiresAt:Date.now()+t.expires_in*1000});
        return {connected:true};
      } catch(e) {
        if(e.oauthCode==='authorization_pending') return {connected:false};
        if(e.oauthCode==='slow_down') {s.interval+=5;return {connected:false};}
        sessions.delete(key(o,c));throw e;
      }
    },
    async probe(o,c,mailbox) {
      const user=await graph(o,c,'me?$select=displayName,mail,userPrincipalName');
      const inbox=await graph(o,c,`users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=displayName,totalItemCount`);
      return {user:{name:user.displayName,email:user.mail||user.userPrincipalName},mailbox,inbox:{name:inbox.displayName,itemCount:inbox.totalItemCount},checkedAt:new Date().toISOString()};
    },
    async list(o,c,mailbox) {
      let route=`users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=hasAttachments eq true&$select=id,subject,categories,flag&$top=50`,result=[];
      for(let n=0;route&&n<20;n++) {const page=await graph(o,c,route);result.push(...page.value);route=page['@odata.nextLink'];}
      if(route) fail('Posteingang enthält mehr als 1000 Anhangsnachrichten. Import eingrenzen.');
      const spelling=result.flatMap(m=>m.categories||[]).find(s=>s.toLowerCase()==='astra');
      const session=sessions.get(key(o,c));if(session&&spelling)session.preferredCategory=spelling;
      return result;
    },
    async attachments(o,c,mailbox,id) {
      let route=`users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}/attachments`,result=[];
      while(route) {const page=await graph(o,c,route);result.push(...page.value);route=page['@odata.nextLink'];if(result.length>100)fail('Zu viele Anhänge.');}
      return result;
    },
    async search(o,c,mailbox,reference) {
      if(typeof reference!=='string'||! /^[A-Z0-9][A-Z0-9/.-]{4,79}$/i.test(reference))fail('Ungültige historische Belegreferenz.',400);
      const page=await graph(o,c,`users/${encodeURIComponent(mailbox)}/messages?$search=${encodeURIComponent('"'+reference+'"')}&$select=id,subject,categories,flag&$top=100`);
      if(page['@odata.nextLink'])fail('Historische Suche ist nicht eindeutig genug. Referenz eingrenzen.');
      return page.value;
    },
    async complete(o,c,mailbox,id) {
      const route=`users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`;
      const latest=await graph(o,c,route+'?$select=categories');
      const categories=latest.categories||[],existing=categories.find(s=>s.toLowerCase()==='astra');
      if(!existing) categories.push(sessions.get(key(o,c))?.preferredCategory||'Astra');
      await graph(o,c,route,{method:'PATCH',headers:latest['@odata.etag']?{'If-Match':latest['@odata.etag']}:{},body:JSON.stringify({categories,flag:{flagStatus:'complete'}})});
    }
  };
}
module.exports={microsoft};
