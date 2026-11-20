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
async function automate(page,context,account,month,{status=()=>{},code=async()=>{throw challenge('Zusätzliche Anmeldung erforderlich.');},onFile=async()=>{}}={}){
 const s=account.selectors||{},fill=(value)=>value.replaceAll('{{month}}',month.slice(5)).replaceAll('{{year}}',month.slice(0,4)).replaceAll('{{period}}',month);
 const visible=async selector=>selector&&await page.locator(fill(selector)).first().isVisible().catch(()=>false);
 const password=s.password||'input[type=password]',user=s.username||'input[type=email],input[name=username],input[autocomplete=username]';
 await page.goto(account.loginUrl,{waitUntil:'domcontentloaded',timeout:30000});
 const cookies=page.getByRole('button',{name:/^(Nur notwendige Cookies akzeptieren|Alle ablehnen|Reject all|Only necessary cookies)$/i}).first();
 if(await cookies.isVisible().catch(()=>false))await cookies.click();
 await Promise.race([page.locator(fill(password)).first().waitFor({state:'visible',timeout:10000}),page.locator(s.invoiceRows?fill(s.invoiceRows):'tr,[data-invoice],.invoice').first().waitFor({state:'visible',timeout:10000})]).catch(()=>{});
 if(!await visible(password)&&await visible(user)){
  await page.locator(fill(user)).first().fill(account.username);
  await page.getByRole('button',{name:/^(Weiter|Next|Continue|Fortfahren)$/i}).first().click({timeout:10000});
  await page.locator(fill(password)).first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
 }
 if(await visible(password)){
  if(await visible(user))await page.locator(fill(user)).first().fill(account.username);
  await page.locator(fill(password)).first().fill(account.password);
  const submit=s.submit?page.locator(fill(s.submit)).first():page.getByRole('button',{name:/^(Einloggen|Anmelden|Login|Log in|Sign in)$/i}).first();
  await submit.click({timeout:10000});
  await page.waitForLoadState('domcontentloaded');
 }
 const otp=s.otp||'input[autocomplete=one-time-code]';
 // Wait for either the invoice surface or an authentication challenge after async login.
 await Promise.race([page.waitForURL(url=>!/login|register/i.test(url.pathname),{timeout:8000}),page.locator(fill(otp)).first().waitFor({state:'visible',timeout:8000})]).catch(()=>{});
 if(await visible(otp)){
  status('interaction_required','Bestätigungscode vom Lieferanten erforderlich.');
  const value=await code();await page.locator(fill(otp)).first().fill(value);
  const submit=s.otpSubmit?page.locator(fill(s.otpSubmit)).first():page.getByRole('button',{name:/^(Bestätigen|Weiter|Verify|Continue|Anmelden)$/i}).first();
  await submit.click({timeout:10000});await page.waitForLoadState('domcontentloaded');
 }
 if(await visible(password))throw challenge('Anmeldung nicht abgeschlossen. Zugang oder zusätzliche Prüfung kontrollieren.');
 if(account.invoiceUrl)await page.goto(fill(account.invoiceUrl),{waitUntil:'domcontentloaded',timeout:30000});
 else {const navigation=s.invoiceNavigation?page.locator(fill(s.invoiceNavigation)).first():page.getByRole('link',{name:/^(Rechnungen|Meine Rechnungen|Invoices|Rechnungsübersicht)$/i}).first();if(await navigation.isVisible().catch(()=>false)){await navigation.click({timeout:10000});await page.waitForLoadState('domcontentloaded');}}
 status('downloading','Rechnungen für '+month+' werden geprüft.');
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
 return {files,session:await context.storageState()};
}
async function runBrowser(input,callbacks){
 const {chromium}=require('playwright'),{catalog}=require('./portal-catalog'),dns=require('node:dns/promises');
 const {provider,account,month}=input;allowedUrl(provider,account.loginUrl);if(account.invoiceUrl)allowedUrl(provider,account.invoiceUrl);
 const browser=await chromium.launch({headless:true,chromiumSandbox:true}),addresses=new Map();
 try{
  const session=account.session; // Only this supplier's cookies and storage may be reused.
  if(session){session.cookies=(session.cookies||[]).filter(c=>catalog[provider].domains.some(d=>c.domain.replace(/^\./,'')===d||c.domain.endsWith('.'+d)));session.origins=(session.origins||[]).filter(o=>{try{allowedUrl(provider,o.origin);return true;}catch{return false;}});}
  const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',...(session?{storageState:session}:{})});
  await context.route('**/*',async route=>{
   try{const url=new URL(route.request().url());allowedUrl(provider,url.href);let ips=addresses.get(url.hostname);if(!ips){ips=await dns.lookup(url.hostname,{all:true});addresses.set(url.hostname,ips);}if(!ips.length||ips.some(({address})=>!publicAddress(address)))throw Error();await route.continue();}catch{await route.abort();}
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage();page.setDefaultTimeout(12000);
  return await automate(page,context,account,month,callbacks);
 }finally{await browser.close();}
}
module.exports={automate,runBrowser,periodText,publicAddress};
