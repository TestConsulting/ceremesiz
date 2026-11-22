const fs=require('node:fs/promises');
const {allowedUrl}=require('./portal-catalog');
const challenge=message=>Object.assign(new Error(message),{code:'interaction_required'});
function publicAddress(address){
 const net=require('node:net'),family=net.isIP(address);
 if(family===6)return /^[23]/i.test(address)&&!/^2001:db8:/i.test(address);
 if(family!==4)return false;
 const blocked=new net.BlockList();for(const [network,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',3]])blocked.addSubnet(network,bits,'ipv4');
 return !blocked.check(address,'ipv4');
}
function periodText(month){return [month,month.slice(5)+'.'+month.slice(0,4),month.slice(5)+'/'+month.slice(0,4)];}
function resourceRequestAllowed(resources,url,method,type,subframe){
 const cloudflare=resources.includes('challenges.cloudflare.com')&&(url.hostname==='challenges.cloudflare.com'||url.hostname.endsWith('.challenges.cloudflare.com'));
 const google=['www.google.com','www.gstatic.com'].includes(url.hostname);
 const recaptcha=google&&resources.includes(url.hostname)&&url.pathname.startsWith('/recaptcha/');
 if(google&&!recaptcha)return false;
 const security=cloudflare||recaptcha;
 const securityResource=security&&(['GET','POST'].includes(method)&&['xhr','fetch','ping','other'].includes(type)||method==='GET'&&type==='document'&&subframe);
 const staticResource=method==='GET'&&['script','stylesheet','image','font'].includes(type);
 const cardApi=resources.includes('productsapi.petafuel.net')&&url.hostname==='productsapi.petafuel.net'&&['GET','POST','OPTIONS'].includes(method)&&['xhr','fetch'].includes(type);
 const cookieData=resources.includes('cdn.cookielaw.org')&&url.hostname==='cdn.cookielaw.org'&&method==='GET'&&['xhr','fetch'].includes(type);
 return (resources.includes(url.hostname)||cloudflare)&&(securityResource||staticResource||cardApi||cookieData);
}
async function automate(page,context,account,month,{status=()=>{},step=()=>{},code=async()=>{throw challenge('Zusätzliche Anmeldung erforderlich.');},onFile=async()=>{},testOnly=false}={}){
 const s=account.selectors||{},fill=(value)=>value.replaceAll('{{month}}',month.slice(5)).replaceAll('{{year}}',month.slice(0,4)).replaceAll('{{period}}',month);
 const visible=async selector=>selector&&await page.locator(fill(selector)).first().isVisible().catch(()=>false);
 const password=s.password||'input[type=password]:visible',user=s.username||(new URL(account.loginUrl).hostname==='www.sachbezugskarte.eu'?'input[type=text]:visible':'input[type=email]:visible,input[name=username]:visible,input[autocomplete=username]:visible');
 const host=new URL(account.loginUrl).hostname,stawag=host==='www.stawag.de',strato=host==='www.strato.de',huk=host==='www.huk.de',card=host==='www.sachbezugskarte.eu';
 const entry=account.session&&stawag?new URL('/portal/home',account.loginUrl).href:account.loginUrl;
 step('login_page');await page.goto(entry,{waitUntil:'domcontentloaded',timeout:30000});
 const cookies=page.getByRole('button',{name:/^(Nur notwendige Cookies akzeptieren|Alle ablehnen|Ablehnen|Reject all|Reject All|Only necessary cookies|Mit erforderlichen Einstellungen fortfahren)$/i}).filter({visible:true}).first();
 // Consent overlays may appear after the form, while a click is already waiting.
 // Locator handlers dismiss them at action time instead of checking only on load.
 await page.addLocatorHandler(cookies,async()=>{step('cookie_consent');await cookies.click();});
 if(strato)await page.addLocatorHandler(page.locator('#cookie_initial_modal'),async()=>{
  step('cookie_consent');await page.locator('#cookie_initial_modal').getByRole('button',{name:'Einstellungen',exact:true}).click();
  await page.getByRole('button',{name:'Auswahl bestätigen',exact:true}).filter({visible:true}).click();
 });
 if(card){
  const start=page.getByRole('button',{name:'Login',exact:true}).filter({visible:true}).first();
  await Promise.any([page.locator(password).first().waitFor({state:'visible',timeout:15000}),start.waitFor({state:'visible',timeout:15000})]).catch(()=>{});
  if(!await visible(password)&&await start.isVisible().catch(()=>false)){step('login_next');await start.click();}
 }
 await Promise.race([page.locator(fill(password)).first().waitFor({state:'visible',timeout:30000}),page.locator(fill(user)).first().waitFor({state:'visible',timeout:30000}),page.locator(s.invoiceRows?fill(s.invoiceRows):'tr,[data-invoice],.invoice').first().waitFor({state:'visible',timeout:30000}),page.getByRole('link',{name:/Abmelden|Logout|Log out|Sign out/i}).filter({visible:true}).first().waitFor({state:'visible',timeout:30000})]).catch(()=>{});
 if(!await visible(password)&&await visible(user)){
  {step('username');await page.locator(fill(user)).first().fill(account.username);}
  step('login_next');await (huk?page.locator('main'):page).getByRole('button',{name:/^(Weiter|Next|Continue|Fortfahren)$/i}).filter({visible:true}).first().click({timeout:10000});
  await page.locator(fill(password)).first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
 }
 if(await visible(password)){
  if(await visible(user)){step('username');await page.locator(fill(user)).first().fill(account.username);}
  step('password');await page.locator(fill(password)).first().fill(account.password);
  const submit=s.submit?page.locator(fill(s.submit)).filter({visible:true}).first():page.getByRole('button',{name:/^(Einloggen|Anmelden|Login|Log in|Sign in)$/i}).filter({visible:true}).first();
  step('login_submit');await submit.click({timeout:10000});
  await page.waitForLoadState('domcontentloaded');
 }
 const otp=s.otp||'input[autocomplete=one-time-code]';
 // Wait for either the invoice surface or an authentication challenge after async login.
 await Promise.race([page.waitForURL(url=>!/login|register/i.test(url.pathname),{timeout:8000}),page.locator(fill(otp)).first().waitFor({state:'visible',timeout:8000})]).catch(()=>{});
 if(await visible(otp)){step('confirmation');
  status('interaction_required','Bestätigungscode vom Lieferanten erforderlich.');
  const value=await code();await page.locator(fill(otp)).first().fill(value);
  const submit=s.otpSubmit?page.locator(fill(s.otpSubmit)).first():page.getByRole('button',{name:/^(Bestätigen|Weiter|Verify|Continue|Anmelden)$/i}).first();
  await submit.click({timeout:10000});await page.waitForLoadState('domcontentloaded');
 }
 if(account.invoiceUrl){step('invoice_page');await page.goto(fill(account.invoiceUrl),{waitUntil:'domcontentloaded',timeout:30000});}
 step('verify_login');
 const logout=page.getByRole('button',{name:/Abmelden|Logout|Log out|Sign out/i}).or(page.getByRole('link',{name:/Abmelden|Logout|Log out|Sign out/i})).filter({visible:true}).first();
 const invoiceNavigation=s.invoiceNavigation?page.locator(fill(s.invoiceNavigation)).first():page.getByRole('link',{name:/^(Rechnungen|Meine Rechnungen|Invoices|Rechnungsübersicht)$/i}).first();
 const packageSelection=strato?page.getByText('Alle Pakete',{exact:true}).filter({visible:true}).first():null;
 // A redirect can finish before an asynchronously rendered dashboard is ready.
 // Require positive account evidence; a changed URL alone never proves login.
 await Promise.any([logout.waitFor({state:'visible',timeout:15000}),invoiceNavigation.waitFor({state:'visible',timeout:15000}),page.locator(s.invoiceRows?fill(s.invoiceRows):'tr,[data-invoice],.invoice').filter({hasText:/Rechnung|Invoice/i}).first().waitFor({state:'visible',timeout:15000})]).catch(()=>{});
 let authenticated=await logout.isVisible().catch(()=>false)||await invoiceNavigation.isVisible().catch(()=>false);
 if(!authenticated&&packageSelection&&!await visible(password)&&await packageSelection.isVisible().catch(()=>false))authenticated=true;
 if(!authenticated){const rows=page.locator(s.invoiceRows?fill(s.invoiceRows):'tr,[data-invoice],.invoice');for(const row of (await rows.all()).slice(0,200)){if(/Rechnung|Invoice/i.test(await row.innerText())&&!/login|register/i.test(new URL(page.url()).pathname)){authenticated=true;break;}}}
 if(!authenticated){if(await visible(password))throw challenge('Anmeldung nicht abgeschlossen. Zugang oder zusätzliche Prüfung kontrollieren.');throw Object.assign(Error('login_not_verified'),{code:'login_not_verified'});}
 if(testOnly)return {files:[],session:await context.storageState(),authenticated:true};
 step('invoice_page');if(!account.invoiceUrl){const navigation=s.invoiceNavigation?page.locator(fill(s.invoiceNavigation)).first():page.getByRole('link',{name:/^(Rechnungen|Meine Rechnungen|Invoices|Rechnungsübersicht)$/i}).first();if(await navigation.isVisible().catch(()=>false)){await navigation.click({timeout:10000});await page.waitForLoadState('domcontentloaded');}}
 step('download');status('downloading','Rechnungen für '+month+' werden geprüft.');
 const rows=s.invoiceRows?page.locator(fill(s.invoiceRows)):page.locator('tr, [data-invoice], .invoice');
 const files=[],seen=new Set();let size=0;
 for(const row of (await rows.all()).slice(0,200)){
  const text=await row.innerText();if(!periodText(month).some(p=>text.includes(p)))continue;
  const download=s.download?row.locator(fill(s.download)).first():row.getByRole('link',{name:/Rechnung|Invoice|PDF|Download|Herunterladen/i}).or(row.getByRole('button',{name:/PDF|Download|Herunterladen/i})).first();
  if(!await download.isVisible().catch(()=>false))continue;
  const href=await download.getAttribute('href');if(href&&seen.has(href))continue;if(href)seen.add(href);
  const [item]=await Promise.all([page.waitForEvent('download',{timeout:20000}),download.click({timeout:10000})]);
  const file=await item.path();if(!file)throw Error('download_failed');
  const stat=await fs.stat(file);if(stat.size>25*1024*1024||size+stat.size>50*1024*1024)throw Error('download_limit');
  const bytes=await fs.readFile(file);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('not_pdf');
  const name=require('node:path').basename(item.suggestedFilename()).replace(/[\x00-\x1f]/g,'').slice(0,200);if(!/\.pdf$/i.test(name))throw Error('not_pdf');
  size+=bytes.length;files.push({name,bytes});await onFile({name,bytes});if(files.length===10)break;
 }
 return {files,session:await context.storageState(),authenticated:true};
}
async function runBrowser(input,callbacks){
 const {chromium}=require('playwright'),{catalog}=require('./portal-catalog'),dns=require('node:dns/promises');
 const {provider,account,month}=input,definition=input.definition||catalog[provider];allowedUrl(provider,account.loginUrl,definition);if(account.invoiceUrl)allowedUrl(provider,account.invoiceUrl,definition);
 const resources=definition.resourceDomains||[],networkDefinition={...definition,domains:[...definition.domains,...resources]};
 const proxy=await require('./portal-proxy').portalProxy(provider,networkDefinition);let browser,page,currentStep='browser_start';const addresses=new Map(),blocked=new Set();
 try{
  browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:proxy.url}});
  const session=account.session; // Only this supplier's cookies and storage may be reused.
  if(session){session.cookies=(session.cookies||[]).filter(c=>definition.domains.some(d=>c.domain.replace(/^\./,'')===d||!definition.exactHosts&&c.domain.endsWith('.'+d)));session.origins=(session.origins||[]).filter(o=>{try{allowedUrl(provider,o.origin,definition);return true;}catch{return false;}});}
  const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',...(session?{storageState:session}:{})});
  await context.route('**/*',async route=>{
   try{const request=route.request(),url=new URL(request.url());try{allowedUrl(provider,url.href,definition);}catch{if(!resourceRequestAllowed(resources,url,request.method(),request.resourceType(),request.resourceType()==='document'&&request.frame()!==page.mainFrame()))throw Error();allowedUrl(provider,url.href,networkDefinition);}let ips=addresses.get(url.hostname);if(!ips){ips=await dns.lookup(url.hostname,{all:true});addresses.set(url.hostname,ips);}if(!ips.length||ips.some(({address})=>!publicAddress(address)))throw Error();await route.continue();}catch{try{blocked.add(new URL(route.request().url()).hostname+':'+route.request().resourceType());}catch{}await route.abort();}
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  page=await context.newPage();page.setDefaultTimeout(12000);
  return await automate(page,context,account,month,{...callbacks,step:value=>{currentStep=value;},testOnly:input.testOnly===true});
 }catch(e){let route='';try{const u=new URL(page.url());route=u.origin+u.pathname;}catch{}let title='';try{title=(await page.title()).slice(0,160);}catch{}if(e.code==='login_not_verified'&&/just a moment|einen moment|verify|security check|access denied|zugriff verweigert/i.test(title))e.code='interaction_required';let signals=[];try{const text=await page.locator('body').innerText({timeout:2000});for(const [id,pattern] of [['credentials_rejected',/invalid (?:email|password|credentials)|incorrect (?:email|password|credentials)|passwort (?:ist )?(?:falsch|ungültig)|anmeldedaten (?:sind )?(?:falsch|ungültig)/i],['account_not_found',/kein Benutzerkonto (?:gefunden|vorhanden)|account (?:was )?not found/i],['captcha_rejected',/(?:captcha|security verification|Sicherheitsprüfung).{0,40}(?:failed|fehlgeschlagen|erneut)/i],['package_selection',/Alle Pakete/i]])if(pattern.test(text))signals.push(id);}catch{}e.diagnostics={signals,step:currentStep,failureKind:/intercepts pointer events|subtree intercepts/i.test(e.message||'')?'overlay':/not enabled|element is disabled/i.test(e.message||'')?'disabled':/waiting for.*locator|waiting for getByRole/i.test(e.message||'')?'element_unavailable':'unclassified',route,title,blockedHosts:[...blocked].slice(0,25)};throw e;
 }finally{await browser?.close();await proxy.close();}
}
module.exports={automate,runBrowser,periodText,publicAddress,resourceRequestAllowed};
