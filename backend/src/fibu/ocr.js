const {fork}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs/promises');
const {fail}=require('./core');
let tail=Promise.resolve(),models;
function modelFolder(){
 if(!models)models=(async()=>{const folder=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'astra-ocr-models-'));for(const lang of ['deu','eng'])await fs.copyFile(path.join(require('@tesseract.js-data/'+lang).langPath,lang+'.traineddata.gz'),path.join(folder,lang+'.traineddata.gz'));return folder;})();
 return models;
}
function recognize(bytes,isPdf,{header=false}={}){
 if(bytes.length>25*1024*1024)fail('OCR-Datei über 25 MB.');
 // One OCR process at a time, with a hard timeout even for damaged documents.
 const run=async()=>{const folder=await modelFolder();return new Promise((resolve,reject)=>{
  const child=fork(path.join(__dirname,'ocr-child.js'),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,execArgv:['--max-old-space-size=512']});
  let done=false;
  const finish=(err,result)=>{if(done)return;done=true;clearTimeout(timer);child.kill();err?reject(err):resolve({...result,engine:'tesseract-local-deu-eng',requiresReview:true});};
  const timer=setTimeout(()=>finish(Error('OCR-Zeitlimit erreicht; manuell prüfen.')),120000);
  child.once('message',result=>finish(result.ok?null:Error(result.error),result));
  child.once('error',e=>finish(e));child.once('exit',()=>finish(Error('OCR-Prozess beendet; Beleg manuell prüfen.')));
  child.send({data:bytes.toString('base64'),pdf:isPdf,header,modelFolder:folder});
 });};
 const result=tail.then(run);tail=result.catch(()=>{});return result;
}
module.exports={recognize};
