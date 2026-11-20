function supplierBlock(status){return status?.code==='blocked_by_supplier'||/just a moment|access denied|zugriff verweigert|verify you are human|security check/i.test(status?.diagnostics?.title||'');}
const reason='Der Lieferant blockiert den automatischen Zugriff oder verlangt eine zusätzliche Sicherheitsbestätigung.';
module.exports={supplierBlock,reason};
