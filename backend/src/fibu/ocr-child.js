// Separate, bounded process: no documents leave this machine.
const {createWorker}=require('tesseract.js');
process.once('message',async message=>{
 let worker;
 try{
  const bytes=Buffer.from(message.data,'base64'),images=[];
  const {createCanvas,loadImage}=require('@napi-rs/canvas');
  if(message.pdf){
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
   const doc=await task.promise;
   try{
    if(doc.numPages>10)throw Error('OCR auf zehn Seiten pro Beleg begrenzt.');
    for(let n=1;n<=(message.header?1:doc.numPages);n++){
     const page=await doc.getPage(n),v=page.getViewport({scale:message.header?3:2});
     if(v.width*v.height>16000000)throw Error('OCR-Seite zu groß.');
     const canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));
     await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
     if(message.header){const header=createCanvas(canvas.width,Math.ceil(canvas.height*.38));header.getContext('2d').drawImage(canvas,0,0);images.push(header.toBuffer('image/png'));}else images.push(canvas.toBuffer('image/png'));
    }
   }finally{await task.destroy();}
  }else{
   const image=await loadImage(bytes);
   if(image.width*image.height>16000000||image.width<40||image.height<40)throw Error('Bildgröße nicht für OCR geeignet.');
   images.push(bytes);
  }
  // Both language models ship as dependencies. No model downloads at runtime.
  worker=await createWorker('deu+eng',1,{langPath:message.modelFolder,cacheMethod:'none',gzip:true});
  await worker.setParameters({user_defined_dpi:'144'});
  const pages=[];
  for(const image of images){const {data}=await worker.recognize(image);pages.push({text:data.text,confidence:data.confidence});}
  process.send({ok:true,text:pages.map(p=>p.text).join('\n'),pages,confidence:Math.min(...pages.map(p=>p.confidence))});
 }catch(e){process.send({ok:false,error:e.message});}
 finally{if(worker)await worker.terminate();process.disconnect();}
});
