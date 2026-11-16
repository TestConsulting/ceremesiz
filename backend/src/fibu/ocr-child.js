// Separate, bounded process: no documents leave this machine.
const {createWorker}=require('tesseract.js');
const path=require('node:path');
const fs=require('node:fs/promises');
process.once('message',async message=>{
 let worker,modelFolder;
 try{
  const bytes=Buffer.from(message.data,'base64'),images=[];
  const {createCanvas,loadImage}=require('@napi-rs/canvas');
  if(message.pdf){
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
   const doc=await task.promise;
   try{
    if(doc.numPages>10)throw Error('OCR auf zehn Seiten pro Beleg begrenzt.');
    for(let n=1;n<=doc.numPages;n++){
     const page=await doc.getPage(n),v=page.getViewport({scale:2});
     if(v.width*v.height>16000000)throw Error('OCR-Seite zu groß.');
     const canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));
     await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
     images.push(canvas.toBuffer('image/png'));
    }
   }finally{await task.destroy();}
  }else{
   const image=await loadImage(bytes);
   if(image.width*image.height>16000000||image.width<40||image.height<40)throw Error('Bildgröße nicht für OCR geeignet.');
   images.push(bytes);
  }
  // Both language models ship as dependencies. No model downloads at runtime.
  modelFolder=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'astra-ocr-models-'));
  for(const lang of ['deu','eng'])await fs.copyFile(path.join(require('@tesseract.js-data/'+lang).langPath,lang+'.traineddata.gz'),path.join(modelFolder,lang+'.traineddata.gz'));
  worker=await createWorker('deu+eng',1,{langPath:modelFolder,cacheMethod:'none',gzip:true});
  await worker.setParameters({user_defined_dpi:'144'});
  const pages=[];
  for(const image of images){const {data}=await worker.recognize(image);pages.push({text:data.text,confidence:data.confidence});}
  process.send({ok:true,text:pages.map(p=>p.text).join('\n'),pages,confidence:Math.min(...pages.map(p=>p.confidence))});
 }catch(e){process.send({ok:false,error:e.message});}
 finally{if(worker)await worker.terminate();if(modelFolder)await fs.rm(modelFolder,{recursive:true,force:true});process.disconnect();}
});
