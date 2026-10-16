import {execFileSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';

const {RAILWAY_SERVICE_ID,RAILWAY_ENVIRONMENT_ID,GITHUB_SHA}=process.env;
if(!RAILWAY_SERVICE_ID||!RAILWAY_ENVIRONMENT_ID||!GITHUB_SHA)throw new Error('Missing Railway target or commit SHA.');
const deadline=Date.now()+15*60*1000;
let previous;
while(Date.now()<deadline){
 const deployments=JSON.parse(execFileSync('railway',['deployment','list','--service',RAILWAY_SERVICE_ID,'--environment',RAILWAY_ENVIRONMENT_ID,'--limit','20','--json'],{encoding:'utf8',timeout:30_000}));
 const deployment=deployments.find(item=>item.meta?.cliMessage===GITHUB_SHA);
 const status=deployment?.status||'Waiting for deployment';
 if(status!==previous){console.log(`${deployment?.id||GITHUB_SHA}: ${status}`);previous=status;}
 if(status==='SUCCESS')process.exit(0);
 if(['FAILED','CRASHED','REMOVED','SKIPPED','CANCELED'].includes(status))throw new Error(`Railway deployment ${deployment.id} ${status}.`);
 await setTimeout(10_000);
}
throw new Error('Timed out waiting for this commit to become healthy on Railway.');
