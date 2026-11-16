const {fail,norm}=require('./core');
function validateReview(body,c){
 if(body.companyName!==c.documentCompanyName||body.confirmOriginal!==true)fail('Firma und Prüfung am Original ausdrücklich bestätigen.',400);
 if(typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>2000)fail('Nachvollziehbaren Prüfgrund angeben.',400);
 if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>1e9||Math.abs(body.amount*100-Math.round(body.amount*100))>1e-5||body.currency!=='EUR')fail('Eindeutigen Bruttobetrag in EUR angeben.',400);
 if(typeof body.supplier!=='string'||body.supplier.trim().length<2||body.supplier.length>200||typeof body.invoice!=='string'||body.invoice.length>100)fail('Rechnungssteller und gültige Referenz angeben.',400);
 if(body.invoiceDate&&(!/^20\d{2}-\d{2}-\d{2}$/.test(body.invoiceDate)||Number.isNaN(Date.parse(body.invoiceDate))||new Date(body.invoiceDate).toISOString().slice(0,10)!==body.invoiceDate))fail('Gültiges Rechnungsdatum angeben.',400);
 return {companyName:c.documentCompanyName,supplier:body.supplier.trim(),invoice:body.invoice.trim(),invoiceDate:body.invoiceDate||'',amount:body.amount,currency:'EUR',reason:body.reason.trim(),checkedAt:new Date().toISOString()};
}
function applyReview(document,review,c){
 if(!review||norm(review.companyName)!==norm(c.documentCompanyName))return document;
 return {...document,extractedMetadata:document.extractedMetadata||{verified:document.verified,amounts:document.amounts,supplier:document.supplier,invoice:document.invoice},verified:true,requiresReview:false,amounts:[review.amount],supplier:review.supplier,invoice:review.invoice,invoiceDate:review.invoiceDate,manualVerification:review,reason:'Am Original manuell geprüft'};
}
module.exports={validateReview,applyReview};
