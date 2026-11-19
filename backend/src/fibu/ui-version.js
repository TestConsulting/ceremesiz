const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=()=>{const h=crypto.createHash('sha256');for(const file of ['fibu.js','fibu-cockpit.js','fibu-cockpit.css'])h.update(fs.readFileSync(path.join(__dirname,'../../private',file)));return h.digest('hex').slice(0,12);};
