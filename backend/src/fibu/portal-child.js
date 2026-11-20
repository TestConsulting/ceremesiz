let codeResolve;
process.on('message',async message=>{
 if(message.type==='code'){codeResolve?.(message.code);return;}
 if(message.type!=='start')return;
 try{const r=await require('./portal-browser').runBrowser(message.input,{status:(state,text)=>process.send({type:'status',state,message:text}),code:()=>new Promise(resolve=>{codeResolve=resolve;})});process.send({type:'result',session:r.session,files:r.files.map(f=>({name:f.name,data:f.bytes.toString('base64')}))});}
 catch(e){process.send({type:'error',code:e.code==='interaction_required'?'interaction_required':'failed'});}
 finally{process.disconnect();}
});
