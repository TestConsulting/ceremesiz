let codeResolve,currentInput,reported=false;
function reportUnexpected(error){
 if(reported)return;reported=true;
 const e=error instanceof Error?error:Error('unhandled_rejection');
 let message=String(e.message||'').slice(0,2000);
 for(const secret of [currentInput?.account?.password,currentInput?.account?.username])if(secret)message=message.replaceAll(secret,'[entfernt]');
 message=message.replace(/https?:\/\/[^\s)]+/g,'[Adresse]').slice(0,400);
 process.send?.({type:'error',code:'failed',diagnostics:{step:'browser_process',errorName:e.name,errorCode:e.code||'',errorSummary:message}},()=>process.exit(1));
 setTimeout(()=>process.exit(1),1000).unref();
}
process.on('uncaughtException',reportUnexpected);
process.on('unhandledRejection',reportUnexpected);
process.on('message',async message=>{
 if(message.type==='code'){codeResolve?.(message.code);return;}
 if(message.type!=='start')return;
 currentInput=message.input;
 try{const r=await require('./portal-browser').runBrowser(message.input,{status:(state,text)=>process.send({type:'status',state,message:text}),code:()=>new Promise(resolve=>{codeResolve=resolve;})});process.send({type:'result',session:r.session,authenticated:r.authenticated,files:r.files.map(f=>({name:f.name,data:f.bytes.toString('base64')}))});}
 catch(e){process.send({type:'error',code:['interaction_required','login_not_verified'].includes(e.code)?e.code:'failed',diagnostics:e.diagnostics});}
 finally{process.disconnect();}
});
