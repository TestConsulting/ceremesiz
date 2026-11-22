const http=require('node:http'),net=require('node:net'),dns=require('node:dns/promises');
const {allowedUrl}=require('./portal-catalog');
// Resolve and dial the same public address: a custom host cannot rebind to an internal service.
async function portalProxy(provider,definition,{resolve=host=>dns.lookup(host,{all:true}),dial=options=>net.connect(options)}={}){
 const sockets=new Set(),server=http.createServer((req,res)=>{res.writeHead(403);res.end();});
 server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',async(req,client,head)=>{
  try{
   const target=new URL('https://'+req.url);if(target.port&&target.port!=='443')throw Error();allowedUrl(provider,target.href,definition);
   const addresses=await resolve(target.hostname);if(!addresses.length||addresses.some(a=>!require('./portal-browser').publicAddress(a.address)))throw Error();
   if(client.destroyed)return;
   const address=addresses.find(a=>net.isIP(a.address)===4)||addresses[0],upstream=dial({host:address.address,port:443});sockets.add(upstream);
   upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});
   upstream.setTimeout(30000,()=>upstream.destroy());upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
  }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
 });
 server.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={portalProxy};
