const { Zlib: { Zip } } = require('zlibjs/bin/zip.min.js');

const xml = value => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[c]);

function word(content) {
  const zip = new Zip();
  const add = (name, data) => zip.addFile(Buffer.from(data), { filename:Buffer.from(name) });
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  add('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = content.split(/\r?\n/).map(line =>
    '<w:p><w:r><w:t xml:space="preserve">' + xml(line) + '</w:t></w:r></w:p>').join('');
  add('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'</w:body></w:document>');
  return Buffer.from(zip.compress());
}

async function pdf(content) {
  const { PDFDocument, StandardFonts } = await import('../../vendor/pdf-lib.mjs');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());
  if ([...content].some(c => !/[\r\n\t]/.test(c) && !encodable.has(c.codePointAt(0)))) {
    throw Object.assign(new Error('Die eingebaute PDF-Schrift enthält mindestens ein verwendetes Zeichen nicht. Word-Datei zum PDF-Export öffnen.'), { status:422 });
  }
  let page, y=0;
  for (const line of content.split(/\r?\n/)) {
    const chunks = [];
    let current='';
    for (const char of line.replaceAll('\t','    ')) {
      if (current && font.widthOfTextAtSize(current+char,11)>505) {
        const split=current.lastIndexOf(' ');
        if (split>0) {
          chunks.push(current.slice(0,split));
          current=current.slice(split+1);
        } else {
          chunks.push(current);
          current='';
        }
      }
      current+=char;
    }
    chunks.push(current);
    for (const chunk of chunks) {
      if (y<55) { page=doc.addPage([595,842]); y=790; }
      if (chunk) page.drawText(chunk,{x:45,y,size:11,font});
      y-=15;
    }
  }
  return Buffer.from(await doc.save());
}

module.exports={word,pdf};
