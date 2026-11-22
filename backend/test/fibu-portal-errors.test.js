const test=require('node:test'),assert=require('node:assert/strict');
const {portalErrorMessage}=require('../src/fibu/portal-errors'),{publicAccount}=require('../src/fibu/portal-catalog');
test('Supplier HTTP rejection distinguishes explicit credentials from CAPTCHA and unknown responses',()=>{
 const {authFailureReason}=require('../src/fibu/portal-browser');
 assert.equal(authFailureReason({message:'Invalid credentials.'}),'credentials_rejected');
 assert.equal(authFailureReason({message:'Invalid captcha token'}),'captcha_rejected');
 assert.equal(authFailureReason({status:401,username:'private',message:'Unauthorized'}),'unclassified');
 assert.equal(authFailureReason(undefined),'unclassified');
});
test('Portal messages distinguish failed steps without exposing browser exceptions or claiming bad credentials',()=>{
 for(const [step,expected] of [['browser_start','Browser nicht starten'],['login_page','Anmeldeseite'],['username','Benutzerfeld'],['password','Passwortfeld'],['login_submit','Anmeldebutton'],['invoice_page','Rechnungsübersicht'],['download','Rechnungsdownload']]){
 const message=portalErrorMessage({message:'secret-password',diagnostics:{step,route:'https://example.invalid/?secret-password'}});assert.ok(message.includes(expected),message);assert.ok(!message.includes('secret-password'));
 }
 assert.match(portalErrorMessage({code:'interaction_required'}),/nicht nachgewiesen/);
 assert.match(portalErrorMessage({code:'login_not_verified'}),/nicht bestätigen/);
 assert.match(portalErrorMessage({diagnostics:{step:'secret-password'}}),/nicht erfasst/);
 const old=publicAccount('strato',null,{state:'failed',message:'Abruf fehlgeschlagen. Zugang, Rechnungsseite und Browserinstallation prüfen.',diagnostics:{title:'STRATO Kunden-Login'}});
 assert.match(old.status.message,/genaue Fehlerstelle/);assert.ok(!old.status.message.includes('Browserinstallation'));
});
