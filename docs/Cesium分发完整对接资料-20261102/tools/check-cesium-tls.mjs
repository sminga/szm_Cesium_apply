/** 只读核验既定实验室HTTPS及公开CA；不安装证书、不修改服务。 */
import tls from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [caFile, output] = process.argv.slice(2);
if (!caFile || !output) throw new Error('Usage: node check-cesium-tls.mjs CA_FILE OUTPUT_JSON');
const ca=readFileSync(caFile);
const digest=createHash('sha256').update(ca).digest('hex');
if (digest !== '72d2dabc82a17ad4068a627b44ea1d06deaf252f1a106141bad6896fc9141dc2')
  throw new Error('Public CA differs from reviewed fingerprint');
mkdirSync(dirname(output),{recursive:true});
const result={date:'2026-11-02',host:'10.11.203.182',port:8443,read_only:true,ca_file_sha256:digest,
  verified:false,check_hostname:true,production_changed:false};
let finished=false;
function finish(code) {
  if(finished)return;finished=true;
  writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result));process.exitCode=code;socket.destroy();
}
const socket=tls.connect({host:result.host,port:result.port,ca,rejectUnauthorized:true,
  checkServerIdentity:(_hostname,cert)=>tls.checkServerIdentity(result.host,cert)},()=>{
  result.verified=socket.authorized;
  result.protocol=socket.getProtocol();result.chain=[];
  let cert=socket.getPeerCertificate(true);const seen=new Set();
  while(cert?.raw && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    const parsed=new X509Certificate(cert.raw);
    result.chain.push({subject:parsed.subject,issuer:parsed.issuer,fingerprint256:parsed.fingerprint256,
      valid_from:parsed.validFrom,valid_to:parsed.validTo,subject_alt_name:parsed.subjectAltName,pem:parsed.toString()});
    cert=cert.issuerCertificate;
  }
  finish(result.verified?0:1);
});
socket.setTimeout(5000,()=>{result.error='NETWORK_TIMEOUT';finish(1)});
socket.on('error',err=>{result.error=err.code || err.name;finish(1)});
