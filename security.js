import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
const limits = new Map();
const aiRoutes = new Set(['/api/chat','/api/scan','/api/products','/api/admin/strain-autofill']);
const publicFiles = new Set(['index.html','about.html','contact.html','pricing.html','for-dispensaries.html','budtender-quiz.html','budtender-quiz-2.html','theme.js','gate.js','strains.json','PsychodelicDemo.ttf','michael.jpg']);
export function publicPath(root, rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts=decoded.split('/').filter(Boolean);
  if(parts.some(p=>p==='..'||p.startsWith('.')))return null;
  const relative=parts.join('/');
  const isAsset=/^(public|fonts|psychodelic-font)\/.+\.(css|js|png|jpg|jpeg|webp|svg|ico|ttf|otf|woff|woff2)$/i.test(relative);
  if(!publicFiles.has(relative)&&!isAsset)return null;
  const resolved=path.resolve(root,relative);
  if(!resolved.startsWith(root+path.sep))return null;
  // A symlink must not make a public asset escape the checkout.
  try { if(!fs.realpathSync(resolved).startsWith(fs.realpathSync(root)+path.sep))return null; } catch {}
  return resolved;
}
export async function prepareRequest(req,res) {
  const reject=(code,error)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));return null;};
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  let url;
  try {url=new URL(req.url,'http://localhost');decodeURIComponent(url.pathname);}catch{return reject(400,'Invalid URL');}
  if(!['GET','HEAD','POST','OPTIONS'].includes(req.method))return reject(405,'Method not allowed');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return null;}
  if((url.pathname.startsWith('/api/admin/')||url.pathname==='/admin'||url.pathname==='/add-strain')&&!process.env.ADMIN_KEY)return reject(503,'Administration is not configured');
  if((url.pathname==='/dashboard'||url.pathname==='/api/dashboard-login')&&!process.env.DASH_PASSWORD)return reject(503,'Dashboard is not configured');
  if(aiRoutes.has(url.pathname)&&!process.env.ANTHROPIC_API_KEY)return reject(503,'AI is not configured. The reference library is available without AI.');
  // Keep query strings available for the existing admin handlers; normalize all other routes.
  req.url=['/admin','/add-strain'].includes(url.pathname)?url.pathname+url.search:url.pathname;
  req.parsedUrl=url;
  if(req.method!=='POST')return req;
  if(req.headers.origin){
    let origin;try{origin=new URL(req.headers.origin);}catch{return reject(403,'Origin not allowed');}
    if(origin.host!==req.headers.host)return reject(403,'Origin not allowed');
  }
  const ip=req.socket.remoteAddress||'unknown', now=Date.now();
  for(const [k,v] of limits)if(v.reset<=now)limits.delete(k);
  if(!limits.has(ip)&&limits.size>=10000)return reject(503,'Please try again later');
  const limit=limits.get(ip)||{count:0,reset:now+60000};limit.count++;limits.set(ip,limit);
  if(limit.count>30){res.setHeader('Retry-After','60');return reject(429,'Too many requests');}
  if(!(req.headers['content-type']||'').startsWith('application/json'))return reject(415,'Use application/json');
  const max=url.pathname==='/api/scan'||url.pathname==='/api/admin/add-strain'?6*1024*1024:64*1024;
  if(Number(req.headers['content-length'])>max)return reject(413,'Request too large');
  const chunks=[];let size=0;
  try{for await(const chunk of req){size+=chunk.length;if(size>max)return reject(413,'Request too large');chunks.push(chunk);}}
  catch{return res.destroyed?null:reject(400,'Incomplete request');}
  const replacement=Readable.from([Buffer.concat(chunks)]);
  Object.assign(replacement,{url:req.url,parsedUrl:url,method:req.method,headers:req.headers,socket:req.socket});
  return replacement;
}
