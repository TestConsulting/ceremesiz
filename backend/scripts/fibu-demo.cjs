// Isolated synthetic review environment; never loads backend/.env or real accounting data.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
async function main(){
 if(process.env.NODE_ENV==='production')throw Error('Demo ist im Produktionsmodus gesperrt.');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'astra-fibu-demo-'));process.env.DB_PATH=path.join(temp,'demo.db');
 delete process.env.FIBU_CONFIG_PATH;
 const {createApp}=require('../src/app'),{upsertUser}=require('../src/users'),db=require('../src/db');
 const {PDFDocument}=await import('../vendor/pdf-lib.mjs');
 const folder=path.join(temp,'2026','10'),collection=path.join(temp,'collection');await fs.mkdir(folder,{recursive:true});await fs.mkdir(collection);
 async function make(lines){const d=await PDFDocument.create(),p=d.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:35,y:790-i*28,size:11}));return Buffer.from(await d.save());}
 const bank=path.join(folder,'Sparkasse_DEMO.pdf');await fs.writeFile(bank,await make(['SYNTHETISCHE TESTDATEN - KEINE ECHTEN BELEGE','TestConsulting CC GmbH','DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','12.10.2026 Microsoft | Rechnung G194101447 -136,45 EUR','16.10.2026 PayCenter | Sachbezugsabrechnung 09/2026 -30,00 EUR','20.10.2026 Hays | Rechnung HAYS12345 +500,00 EUR','21.10.2026 Mitarbeiter | Kto Lohn -2.000,00 EUR']));
 await fs.writeFile(path.join(folder,'Microsoft_DEMO.pdf'),await make(['SYNTHETISCHE TESTDATEN','TestConsulting CC GmbH','Rechnungssteller: Microsoft','Rechnungsnummer: G194101447','Gesamtbetrag: 136,45 EUR']));
 const email='fibu-demo@example.invalid',password='Nur-lokale-Demo-2026!';await upsertUser({email,firstName:'FIBU',lastName:'Demo',password});
 const config={mode:'local',demo:true,companies:{tc:{enabled:true,root:temp,collectionFolder:collection,accountHolder:'TestConsulting CC GmbH',iban:'DE02120300000000202051',documentCompanyName:'TestConsulting CC GmbH',allowedUsers:[email],payrollExceptions:true,greenCounterparties:['Hays']}}};
 const app=createApp({sessionSecret:require('node:crypto').randomBytes(32).toString('hex'),fibu:{config}});
 const store=require('../src/fibu/store').createStore(db),worker=require('../src/fibu/engine').engine({store,config,ms:{connected:()=>false}});
 const owner=db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
 const j=store.enqueue(owner,{companyId:'tc',...await worker.validate(config.companies.tc,{monthFolderPath:folder,bankPdfPath:bank})});await worker.run(j.id,owner,config.companies.tc);
 const server=app.listen(Number(process.env.FIBU_DEMO_PORT)||4088,'127.0.0.1',()=>console.log('Demo: http://127.0.0.1:'+server.address().port+'/#login\nBenutzer: '+email+'\nDemo-Passwort: '+password+'\nNach Login: /intern#fibu-tc\nAusschließlich synthetische Daten.'));
 const stop=()=>server.close(()=>{db.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
