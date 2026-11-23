const { inflateRawSync } = require('node:zlib');

function docxText(bytes) {
  const maxExpanded=2*1024*1024;
  const tail=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(tail<0 || tail+22>bytes.length)throw new Error('ZIP-Verzeichnis fehlt.');
  const count=bytes.readUInt16LE(tail+10);
  let offset=bytes.readUInt32LE(tail+16);
  if(count>2000 || offset>=tail)throw new Error('ZIP-Verzeichnis ungültig.');
  for(let i=0;i<count;i++){
    if(offset+46>tail || bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('ZIP-Eintrag ungültig.');
    const flags=bytes.readUInt16LE(offset+8), method=bytes.readUInt16LE(offset+10);
    const packed=bytes.readUInt32LE(offset+20), size=bytes.readUInt32LE(offset+24);
    const nameLength=bytes.readUInt16LE(offset+28), extra=bytes.readUInt16LE(offset+30);
    const comment=bytes.readUInt16LE(offset+32), local=bytes.readUInt32LE(offset+42);
    const name=bytes.toString('utf8',offset+46,offset+46+nameLength);
    const next=offset+46+nameLength+extra+comment;
    if(next>tail)throw new Error('ZIP-Eintrag unvollständig.');
    if(name==='word/document.xml'){
      if((flags&1) || size>maxExpanded || local+30>offset || bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Word-Dokument ungültig.');
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      if(start+packed>offset || ![0,8].includes(method) || (method===0&&packed!==size))throw new Error('Word-Dokument ungültig.');
      const data=bytes.subarray(start,start+packed);
      const clear=method===0?data:inflateRawSync(data,{maxOutputLength:maxExpanded});
      if(clear.length!==size)throw new Error('Word-Dokument unvollständig.');
      return wordText(clear.toString('utf8'));
    }
    offset=next;
  }
  throw new Error('Word-Text fehlt im Dokument.');
}

function wordText(xml) {
  const entities={amp:'&',lt:'<',gt:'>',apos:"'",quot:'"'};
  return [...xml.matchAll(/<w:p(?=[\s>])[^>]*>([\s\S]*?)<\/w:p>/g)].map(paragraph=>
    [...paragraph[1].matchAll(/<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>/g)].map(run=>
      run[1].replace(/&(amp|lt|gt|apos|quot|#\d+|#x[\da-f]+);/gi,(literal,key)=>{
        if(!key.startsWith('#'))return entities[key]||literal;
        const hex=key[1].toLowerCase()==='x',value=parseInt(key.slice(hex?2:1),hex?16:10);
        return value<=0x10ffff?String.fromCodePoint(value):literal;
      })).join('')).filter(Boolean).join('\n');
}

module.exports=docxText;
