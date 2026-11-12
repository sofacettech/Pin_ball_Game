import resolutionVariants from "./claim-resolutions.json";
import {artworkAssetURL} from '../../shared/artwork-assets.js';
export default function initialize(scope) {
const {document,window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,addEventListener,matchMedia,ResizeObserver,IntersectionObserver,MutationObserver} = scope;
const mobileOpening=matchMedia('(max-width:900px)').matches;
const openingContent=[...document.querySelectorAll('.page>.brand,.page>.content,.claim-back')];
let mobileOpeningStarted=false;
function revealMobileContent(){
 if(!document.documentElement.classList.contains('claim-art-intro'))return;
 document.documentElement.classList.remove('claim-art-intro');
 document.documentElement.dataset.claimTextRevealedAt=performance.now().toFixed(1);
 openingContent.forEach(node=>{node.inert=false;});
}
function startMobileOpening(){
 if(!mobileOpening||mobileOpeningStarted)return;
 mobileOpeningStarted=true;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  document.documentElement.dataset.claimArtShownAt=performance.now().toFixed(1);
  setTimeout(revealMobileContent,1300);
 }));
}
if(mobileOpening){openingContent.forEach(node=>{node.inert=true;});setTimeout(revealMobileContent,6000);}
else {
 document.documentElement.classList.remove('claim-art-intro');
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('wave-intro-pending');setTimeout(()=>document.documentElement.classList.remove('wave-intro-pending'),6000);}
}

// Fixed vertices and connections traced from the supplied 1672 x 941 reference.
const referenceMesh={"points":[[83.43,4.84],[1230.85,15.78],[572.06,16.53],[1599.9,18.04],[674.11,25.59],[1192.49,28.21],[26.4,33.24],[818.13,39.34],[1492.46,50.86],[1056.54,57.86],[343.57,58.35],[123.06,85.2],[465.8,88.01],[942.74,93.57],[1631.34,93.66],[1390.95,93.88],[1264.79,100.35],[598.2,102.87],[1157.11,110.86],[717.42,118.41],[402.01,128.68],[1039.24,140.87],[264.63,142.05],[1502.46,143.5],[792.62,157.87],[1139.2,165.76],[1581.31,176.98],[343.34,181.94],[522.89,189.35],[83.01,191.51],[1316.19,191.69],[191.63,193.51],[1481.94,204.52],[907.71,206.9],[660.69,211.29],[392.62,214.9],[1383.99,221.93],[1204.74,230.13],[311.59,240.35],[789.62,266.18],[1035.06,270.85],[589.42,280.08],[140.68,285.41],[1274.01,297.29],[476.99,300.64],[1578.96,301.77],[1426.11,307.05],[358.58,319.5],[693.52,321.73],[885.22,321.77],[1130.61,326.17],[243.07,338.32],[989.17,362.25],[540.9,368.54],[1505.09,370.29],[771.41,373.11],[1306.1,389.59],[332.03,390.39],[1201.44,392.75],[1639.65,400.66],[198.25,407.34],[325.63,411.06],[44.16,414.82],[669.79,415.02],[1077.67,417.74],[400.77,420.19],[878.54,423.76],[1415.3,425.97],[1519.07,449.71],[812.85,463.52],[500.23,463.76],[977.7,473.33],[1163.0,477.92],[1093.61,481.89],[115.59,484.71],[86.13,485.7],[607.69,486.27],[254.93,487.62],[1276.12,489.84],[1013.13,490.26],[921.13,505.07],[357.87,516.79],[1607.27,519.19],[1355.94,526.52],[1089.37,528.43],[737.77,528.98],[1309.58,544.19],[533.78,548.24],[837.25,554.48],[442.16,560.85],[53.9,564.4],[173.57,565.48],[640.53,573.23],[1206.8,583.09],[1456.67,584.24],[964.23,587.2],[1072.95,588.46],[295.5,589.07],[1335.42,589.29],[1553.52,609.49],[516.08,620.48],[729.57,622.81],[868.41,626.96],[378.91,641.87],[796.57,646.4],[1079.78,654.29],[1438.92,658.39],[619.1,659.74],[857.0,661.07],[111.93,661.32],[1148.79,666.29],[991.11,669.02],[475.75,670.86],[1304.51,699.13],[213.47,701.86],[702.07,704.15],[575.29,720.43],[1067.29,720.58],[1555.66,724.16],[986.5,725.54],[446.56,728.67],[607.41,730.31],[321.49,731.13],[877.23,739.91],[646.64,749.62],[773.62,749.87],[1406.98,751.97],[1192.29,767.4],[1664.07,783.65],[977.47,784.05],[528.29,788.55],[189.51,792.25],[1282.01,799.27],[85.97,803.88],[1519.34,810.05],[423.65,812.36],[1096.62,831.68],[806.83,833.6],[672.15,834.75],[275.64,842.4],[898.74,859.84],[1354.17,869.31],[1209.86,869.31],[463.77,874.12],[76.9,876.51],[1456.74,893.26],[176.77,897.54],[1622.83,900.65],[371.8,902.25],[1026.51,902.95],[579.59,923.95],[754.89,936.97],[945.63,0.0],[1672.0,208.09],[1672.0,630.62],[1672.0,315.52],[1672.0,502.38],[1672.0,896.88],[0.0,500.24],[1672.0,642.3],[1672.0,780.85],[918.69,941.0],[0.0,277.14],[0.0,383.74],[591.47,0.0],[1416.22,0.0],[1307.35,941.0],[1225.99,0.0],[1011.67,0.0],[436.21,0.0],[511.69,0.0],[751.78,941.0],[485.08,941.0],[309.96,941.0],[215.4,0.0],[881.01,0.0],[239.55,0.0],[200.78,0.0],[0.0,122.88],[1322.5,0.0],[1672.0,394.29],[222.39,941.0],[0.0,755.36],[1159.69,941.0],[1100.77,0.0],[1672.0,736.47],[972.03,941.0],[1271.93,941.0],[0.0,531.15],[409.59,0.0],[1672.0,438.77],[244.77,0.0],[0.0,335.84],[1434.94,0.0],[1672.0,362.7],[0.0,882.86],[1672.0,224.27],[0.0,630.25],[95.88,0.0],[1672.0,174.44],[331.14,941.0],[1672.0,615.99],[1672.0,722.46],[0.0,271.35],[90.18,0.0],[0.0,636.52],[0.0,191.13],[1169.14,0.0],[1566.71,941.0],[1672.0,406.66],[1672.0,180.77],[1426.4,941.0],[1004.01,0.0],[1083.58,941.0],[705.77,0.0],[1314.78,0.0],[759.95,941.0],[430.9,941.0],[0.0,774.55],[0.0,43.93],[1342.19,941.0],[131.59,0.0],[90.65,941.0],[0.0,894.93],[0.0,20.36],[436.21,941.0],[0.0,130.72],[1575.65,0.0],[112.35,0.0],[1213.48,0.0],[799.68,0.0],[554.89,941.0],[135.64,941.0],[4.49,941.0],[1672.0,27.47],[1491.37,941.0],[0.0,470.83],[0.0,0.0],[1672.0,0.0],[1672.0,941.0],[0.0,941.0],[1114.0,536.0],[1008.24,4.66],[5.12,271.86],[973.09,512.28],[1084.55,546.07],[763.79,932.2],[748.4,936.49]],"edges":[[0,6],[0,11],[0,198],[0,204],[1,5],[1,16],[1,167],[2,4],[2,12],[2,17],[2,164],[3,8],[3,14],[3,23],[3,227],[3,234],[3,238],[4,7],[4,17],[4,19],[4,214],[5,9],[5,18],[5,207],[5,229],[6,11],[6,219],[6,224],[7,13],[7,19],[7,24],[7,175],[7,230],[8,15],[8,23],[8,193],[9,13],[9,18],[9,21],[9,25],[9,168],[9,184],[9,242],[10,12],[10,20],[10,22],[10,189],[10,191],[11,22],[11,29],[11,31],[11,177],[11,178],[11,226],[12,17],[12,20],[12,28],[12,169],[12,170],[13,21],[13,24],[13,33],[13,152],[13,212],[13,242],[14,23],[14,26],[14,199],[15,16],[15,23],[15,30],[15,36],[15,165],[15,179],[16,18],[16,25],[16,30],[16,37],[16,215],[17,19],[17,28],[17,34],[18,25],[19,24],[19,34],[20,22],[20,27],[20,28],[20,35],[21,25],[21,33],[21,40],[22,27],[22,31],[22,38],[22,174],[23,26],[23,32],[23,36],[24,33],[24,34],[24,39],[25,37],[25,40],[26,32],[26,45],[26,153],[27,35],[27,38],[28,34],[28,35],[28,41],[28,44],[29,31],[29,42],[29,203],[29,206],[29,226],[29,243],[30,36],[30,37],[30,43],[31,38],[31,42],[32,36],[32,45],[32,46],[33,39],[33,40],[33,49],[34,39],[34,41],[34,48],[35,38],[35,44],[35,47],[36,43],[36,46],[37,40],[37,43],[37,50],[38,42],[38,47],[38,51],[39,48],[39,49],[39,55],[40,49],[40,50],[40,52],[41,44],[41,48],[41,53],[42,51],[42,60],[42,62],[42,162],[42,192],[42,243],[43,46],[43,50],[43,56],[43,58],[44,47],[44,53],[44,65],[45,46],[45,54],[45,59],[45,155],[45,196],[46,54],[46,56],[46,67],[47,51],[47,57],[47,65],[48,53],[48,55],[48,63],[49,52],[49,55],[49,66],[50,52],[50,58],[50,64],[51,57],[51,60],[52,64],[52,66],[52,71],[52,80],[53,63],[53,65],[53,70],[53,76],[54,59],[54,67],[54,68],[55,63],[55,69],[56,58],[56,67],[56,78],[57,61],[57,65],[58,64],[58,72],[58,78],[59,68],[59,82],[59,180],[59,190],[59,194],[59,209],[60,61],[60,62],[60,74],[60,77],[61,65],[61,77],[61,81],[62,75],[62,163],[62,236],[63,69],[63,76],[63,85],[64,71],[64,72],[64,73],[64,79],[65,70],[65,81],[66,69],[66,80],[67,68],[67,78],[67,83],[68,82],[68,83],[68,94],[69,80],[69,85],[69,88],[70,76],[70,81],[70,87],[70,89],[71,79],[71,80],[71,244],[72,78],[72,93],[72,241],[73,79],[73,84],[73,241],[74,75],[74,77],[74,90],[74,91],[75,158],[76,85],[76,87],[76,92],[77,81],[77,91],[77,97],[78,83],[78,86],[78,93],[79,84],[80,88],[80,95],[80,102],[80,244],[81,89],[81,97],[82,94],[82,99],[82,156],[82,201],[83,86],[83,94],[83,98],[84,241],[84,244],[84,245],[85,88],[85,92],[85,101],[86,93],[86,98],[87,89],[87,92],[87,100],[88,101],[88,102],[89,97],[89,100],[89,103],[90,91],[90,109],[90,188],[90,197],[91,97],[91,109],[91,114],[92,100],[92,101],[92,107],[93,96],[93,98],[93,110],[93,113],[94,98],[94,99],[94,106],[95,96],[95,102],[95,111],[95,244],[95,245],[96,105],[96,110],[96,111],[96,241],[96,245],[97,103],[97,114],[98,106],[98,113],[99,106],[99,118],[99,154],[100,103],[100,107],[100,112],[101,102],[101,107],[101,115],[102,104],[102,108],[102,115],[103,112],[103,114],[103,122],[105,110],[105,111],[105,117],[106,113],[106,118],[106,126],[107,112],[107,115],[107,116],[108,111],[108,115],[108,123],[108,125],[109,114],[109,133],[109,182],[109,205],[110,113],[110,117],[110,127],[111,117],[111,119],[111,123],[112,116],[112,120],[112,122],[113,126],[113,127],[113,132],[114,122],[114,131],[114,133],[115,116],[115,124],[115,125],[116,120],[116,121],[116,130],[117,119],[117,127],[117,129],[117,136],[118,126],[118,128],[118,134],[118,159],[119,123],[119,129],[120,122],[120,130],[120,135],[120,139],[121,124],[122,131],[122,139],[123,125],[123,129],[123,137],[123,140],[124,125],[124,130],[124,138],[125,137],[125,138],[126,132],[126,134],[126,141],[126,145],[127,132],[127,136],[127,142],[128,134],[128,147],[128,160],[128,185],[129,136],[129,140],[129,149],[130,135],[130,138],[130,143],[130,150],[131,133],[131,139],[131,144],[131,146],[132,141],[132,142],[133,144],[133,195],[133,218],[134,145],[134,147],[135,139],[135,143],[135,148],[136,142],[136,149],[137,138],[137,140],[137,151],[137,246],[138,150],[138,151],[138,247],[139,146],[139,148],[139,173],[140,149],[140,161],[140,216],[140,246],[141,142],[141,145],[141,166],[142,149],[142,183],[142,187],[143,148],[143,150],[143,172],[144,146],[144,222],[144,223],[144,233],[145,147],[145,211],[145,220],[145,235],[146,181],[146,232],[147,157],[147,208],[147,239],[148,200],[148,217],[149,186],[149,213],[150,171],[150,231],[150,247],[151,216],[151,246],[151,247],[152,175],[152,212],[153,196],[153,210],[154,159],[154,201],[155,194],[155,196],[156,190],[156,201],[157,160],[157,239],[158,188],[158,236],[159,202],[160,185],[161,186],[161,216],[162,192],[162,203],[162,243],[163,192],[163,236],[164,170],[164,214],[165,179],[165,193],[166,187],[166,220],[167,215],[167,229],[168,184],[168,212],[168,242],[169,170],[169,189],[171,216],[171,231],[171,247],[172,225],[172,231],[173,181],[173,200],[174,176],[174,177],[175,230],[176,191],[177,221],[178,219],[178,226],[179,215],[180,194],[180,209],[181,232],[182,205],[182,218],[183,187],[183,213],[184,207],[185,202],[186,213],[188,197],[189,191],[190,209],[193,227],[195,218],[195,223],[197,205],[198,204],[198,228],[199,210],[199,234],[200,217],[203,206],[203,243],[204,237],[206,226],[207,229],[208,235],[208,239],[211,220],[211,235],[212,242],[214,230],[216,246],[217,225],[219,224],[221,228],[222,232],[222,233],[223,240],[224,237],[227,238],[233,240],[234,238],[241,245]],"triangles":[[204,0,6],[204,6,224],[224,237,204],[6,0,11],[177,11,0],[177,0,198],[198,0,204],[167,1,5],[5,229,167],[18,5,1],[1,16,18],[215,16,1],[1,167,215],[2,4,17],[214,4,2],[2,164,214],[164,2,12],[12,170,164],[12,2,17],[227,3,8],[8,193,227],[8,3,23],[3,14,23],[199,14,3],[3,234,199],[3,227,238],[234,3,238],[4,7,19],[230,7,4],[4,214,230],[17,4,19],[207,5,9],[9,184,207],[9,5,18],[5,207,229],[219,6,11],[11,178,219],[6,219,224],[7,13,24],[152,13,7],[7,175,152],[19,7,24],[175,7,230],[193,8,15],[15,165,193],[15,8,23],[9,13,242],[13,9,21],[9,18,25],[21,9,25],[9,168,184],[168,9,242],[10,12,20],[169,12,10],[10,189,169],[10,20,22],[191,10,22],[191,22,174],[189,10,191],[11,22,31],[174,22,11],[11,177,174],[11,29,226],[29,11,31],[178,11,226],[12,17,28],[20,12,28],[12,169,170],[13,21,33],[24,13,33],[13,152,212],[13,212,242],[23,14,26],[153,26,14],[153,14,199],[179,15,16],[16,215,179],[16,15,30],[15,23,36],[30,15,36],[165,15,179],[18,16,25],[25,16,37],[16,30,37],[17,19,34],[28,17,34],[19,24,34],[22,20,27],[27,20,35],[20,28,35],[21,25,40],[33,21,40],[22,27,38],[31,22,38],[23,26,32],[23,32,36],[24,33,39],[34,24,39],[25,37,40],[32,26,45],[196,45,26],[26,153,196],[27,35,38],[28,34,41],[35,28,44],[28,41,44],[29,31,42],[29,42,243],[29,203,206],[203,29,243],[29,206,226],[30,36,43],[37,30,43],[31,38,42],[36,32,46],[32,45,46],[39,33,49],[33,40,49],[34,39,48],[41,34,48],[38,35,47],[35,44,47],[43,36,46],[40,37,50],[37,43,50],[42,38,51],[38,47,51],[48,39,55],[39,49,55],[49,40,52],[40,50,52],[44,41,53],[41,48,53],[42,51,60],[42,60,62],[192,42,62],[62,163,192],[42,162,243],[162,42,192],[43,46,56],[50,43,58],[43,56,58],[47,44,65],[44,53,65],[46,45,54],[54,45,59],[194,59,45],[45,155,194],[155,45,196],[46,54,67],[56,46,67],[51,47,57],[57,47,65],[53,48,63],[48,55,63],[49,52,66],[69,55,49],[49,66,69],[52,50,64],[50,58,64],[60,51,57],[57,61,60],[52,64,71],[66,52,80],[52,71,80],[53,63,76],[65,53,70],[70,53,76],[54,59,68],[67,54,68],[63,55,69],[58,56,78],[56,67,78],[61,57,65],[64,58,72],[72,58,78],[68,59,82],[156,82,59],[59,190,156],[59,180,209],[180,59,194],[190,59,209],[60,61,77],[75,62,60],[60,74,75],[74,60,77],[61,65,81],[77,61,81],[236,62,75],[75,158,236],[163,62,236],[63,69,85],[76,63,85],[71,64,79],[73,64,72],[72,241,73],[64,73,79],[65,70,81],[69,66,80],[67,68,83],[78,67,83],[68,82,94],[83,68,94],[69,80,88],[85,69,88],[70,76,87],[81,70,89],[70,87,89],[244,71,79],[79,84,244],[80,71,244],[72,78,93],[241,72,93],[93,96,241],[79,73,84],[84,73,241],[158,75,74],[158,74,90],[90,188,158],[74,77,91],[90,74,91],[76,85,92],[87,76,92],[77,81,97],[91,77,97],[78,83,86],[78,86,93],[88,80,102],[80,95,102],[95,80,244],[81,89,97],[94,82,99],[154,99,82],[82,201,154],[82,156,201],[86,83,98],[83,94,98],[84,241,245],[95,244,84],[84,245,95],[85,88,101],[92,85,101],[93,86,98],[89,87,100],[87,92,100],[101,88,102],[97,89,103],[89,100,103],[90,91,109],[197,90,109],[109,205,197],[188,90,197],[91,97,114],[109,91,114],[100,92,107],[92,101,107],[96,93,110],[93,98,113],[110,93,113],[98,94,106],[94,99,106],[95,96,111],[96,95,245],[108,102,95],[95,111,108],[96,105,111],[105,96,110],[241,96,245],[97,103,114],[98,106,113],[106,99,118],[159,118,99],[99,154,159],[103,100,112],[100,107,112],[101,102,115],[107,101,115],[102,108,115],[103,112,122],[114,103,122],[105,110,117],[111,105,117],[113,106,126],[106,118,126],[112,107,116],[107,115,116],[108,111,123],[115,108,125],[108,123,125],[109,114,133],[182,109,133],[133,218,182],[109,182,205],[110,113,127],[117,110,127],[111,117,119],[111,119,123],[112,116,120],[112,120,122],[113,126,132],[127,113,132],[114,122,131],[114,131,133],[121,116,115],[115,124,121],[124,115,125],[120,116,130],[130,116,121],[121,124,130],[119,117,129],[117,127,136],[129,117,136],[126,118,134],[118,128,134],[185,128,118],[185,118,159],[123,119,129],[122,120,139],[120,130,135],[120,135,139],[131,122,139],[125,123,137],[123,129,140],[137,123,140],[124,125,138],[130,124,138],[125,137,138],[132,126,141],[126,134,145],[141,126,145],[127,132,142],[136,127,142],[134,128,147],[157,147,128],[128,160,157],[160,128,185],[129,136,149],[140,129,149],[135,130,143],[130,138,150],[143,130,150],[133,131,144],[131,139,146],[144,131,146],[132,141,142],[195,133,144],[144,223,195],[133,195,218],[145,134,147],[139,135,148],[135,143,148],[136,142,149],[138,137,151],[137,140,246],[151,137,246],[150,138,247],[138,151,247],[181,146,139],[139,173,181],[173,139,148],[148,200,173],[161,140,149],[149,186,161],[140,161,216],[140,216,246],[187,142,141],[141,166,187],[166,141,145],[145,220,166],[213,149,142],[142,183,213],[183,142,187],[217,148,143],[217,143,172],[172,143,150],[150,231,172],[222,144,146],[146,232,222],[144,222,233],[240,223,144],[144,233,240],[235,145,147],[147,208,235],[145,211,220],[211,145,235],[146,181,232],[147,157,239],[208,147,239],[200,148,217],[186,149,213],[150,171,231],[171,150,247],[247,151,216],[216,171,247],[216,151,246],[162,203,243],[212,168,242]]};
function createTopology(width,height){
  // Preserve reference facet proportions; crop the same mesh on narrower viewports.
  const factor=Math.max(width/1672,height/941),offsetX=(width-1672*factor)/2,offsetY=(height-941*factor)/2;
  const points=referenceMesh.points.map(([x,y])=>({x:x*factor+offsetX,y:y*factor+offsetY}));
  let seed=21987;
  return {points,triangles:referenceMesh.triangles,edges:referenceMesh.edges,shades:referenceMesh.triangles.map(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;})};
}



(() => {
  const surface=document.getElementById('mesh'),canvas=surface.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)return;
  const background=document.createElement('canvas'),bg=background.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let width=1,height=1,scale=1,topology,wave=null,raf=0,introCue=null;
  const sweep=2100,tail=1100;
  function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(render);}
  function radial(cx,cy,r,color){const g=bg.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(20,5,28,0)');bg.fillStyle=g;bg.fillRect(cx-r,cy-r,r*2,r*2);}
  function resize(){
    if(topology&&width===surface.clientWidth&&height===surface.clientHeight&&scale===Math.min(devicePixelRatio||1,1.5))return;
    width=Math.max(1,surface.clientWidth);height=Math.max(1,surface.clientHeight);scale=Math.min(devicePixelRatio||1,1.5);
    for(const c of [canvas,background]){c.width=Math.ceil(width*scale);c.height=Math.ceil(height*scale);}
    bg.setTransform(scale,0,0,scale,0,0);bg.fillStyle='#08040c';bg.fillRect(0,0,width,height);
    radial(width*.5,height*.16,Math.max(width,height)*.63,'rgba(20,5,28,.40)');
    radial(width*.61,height*.72,Math.max(width,height)*.49,'rgba(22,5,31,.40)');
    topology=createTopology(width,height);releaseIntro();wave=null;schedule();
  }
  function releaseIntro(){if(introCue===null)return;introCue=null;surface.dataset.introHit='true';dispatchEvent(new Event('so:opening-wave-hit'));}
  function start(x,y,source="input",textArea=null){
    if(source!=='opening')releaseIntro();
    surface.dataset.waveSource=source;surface.dataset.waveCount=String(Number(surface.dataset.waveCount||0)+1);
    wave={x,y,start:performance.now(),reach:Math.max(Math.hypot(x,y),Math.hypot(width-x,y),Math.hypot(x,height-y),Math.hypot(width-x,height-y)),reduced:reduced.matches};
    if(source==='opening'&&textArea){
      const dx=Math.max(textArea.left-x,0,x-textArea.right),dy=Math.max(textArea.top-y,0,y-textArea.bottom);
      introCue=Math.hypot(dx,dy);
    }
    surface.dataset.waveOrigin=`${Math.round(x)},${Math.round(y)}`;schedule();
  }
  function strength(x,y,elapsed){
    const age=wave.reduced?elapsed:elapsed-Math.hypot(x-wave.x,y-wave.y)/wave.reach*sweep;
    if(age<=0||age>=tail)return 0;
    if(age<150){const t=age/150;return t*t*(3-2*t);}
    if(age<330)return 1;
    const t=(age-330)/(tail-330);return 1-t*t*(3-2*t);
  }
  function render(now){
    raf=0;ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(background,0,0);ctx.setTransform(scale,0,0,scale,0,0);
    surface.dataset.animating='false';
    if(!wave)return;
    const elapsed=now-wave.start;
    if(introCue!==null&&(wave.reduced||elapsed/sweep*wave.reach>=introCue))releaseIntro();
    if(elapsed>=(wave.reduced?tail:sweep+tail)){wave=null;return;}
    ctx.save();
    if(!wave.reduced){ctx.beginPath();ctx.arc(wave.x,wave.y,Math.max(0,elapsed/sweep*wave.reach),0,Math.PI*2);ctx.clip();}
    const points=topology.points;
    topology.triangles.forEach(([a,b,c],i)=>{
      const A=points[a],B=points[b],C=points[c],cx=(A.x+B.x+C.x)/3,cy=(A.y+B.y+C.y)/3;
      const light=strength(cx,cy,elapsed);if(light<.001)return;
      const shade=topology.shades[i],alpha=light*(.30+shade*.25);
      const g=ctx.createLinearGradient(A.x,A.y,(B.x+C.x)/2,(B.y+C.y)/2);
      g.addColorStop(0,`rgba(68,10,87,${alpha})`);g.addColorStop(1,`rgba(48,6,66,${alpha*.5})`);ctx.fillStyle=g;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.lineTo(C.x,C.y);ctx.closePath();ctx.fill();
    });
    // Sample along each original edge so its reveal and fade travel smoothly.
    for(const [a,b]of topology.edges){
      const A=points[a],B=points[b],steps=Math.max(1,Math.ceil(Math.hypot(B.x-A.x,B.y-A.y)/14));
      for(let j=0;j<steps;j++){
        const t=(j+.5)/steps,light=strength(A.x+(B.x-A.x)*t,A.y+(B.y-A.y)*t,elapsed);if(light<.001)continue;
        ctx.beginPath();ctx.moveTo(A.x+(B.x-A.x)*j/steps,A.y+(B.y-A.y)*j/steps);ctx.lineTo(A.x+(B.x-A.x)*(j+1)/steps,A.y+(B.y-A.y)*(j+1)/steps);
        ctx.lineWidth=2.2;ctx.strokeStyle=`rgba(77,16,108,${light*.09})`;ctx.stroke();
        ctx.lineWidth=.7;ctx.strokeStyle=`rgba(85,22,112,${light*.68})`;ctx.stroke();
      }
    }
    ctx.restore();surface.dataset.animating='true';schedule();
  }
  function clear(){releaseIntro();wave=null;schedule();}
  reduced.addEventListener('change',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseIntro();wave=null;cancelAnimationFrame(raf);raf=0;}else schedule();});
  canvas.addEventListener('contextlost',()=>{cancelAnimationFrame(raf);raf=0;wave=null;canvas.style.visibility='hidden';});
  canvas.addEventListener('contextrestored',()=>{canvas.style.visibility='visible';resize();});
  window.__startMeshWave=start;window.__clearMeshWave=clear;
  surface.dataset.renderer='canvas2d';new ResizeObserver(resize).observe(surface);resize();
})();


// Three one-shot, compositor-driven entrances. No frame loop or motion library.
function preparePage2Flights(art,reduced){
 const nodes=[...art.querySelectorAll('.butterfly-position')],records=[];
 const restingPositions=new Map(nodes.map(node=>[node,{left:node.style.left,top:node.style.top}]));
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const bezier=(s,t)=>s[0].map((_,i)=>(1-t)**3*s[0][i]+3*(1-t)**2*t*s[1][i]+3*(1-t)*t*t*s[2][i]+t**3*s[3][i]);
 function endPosition(node){
  Object.assign(node.style,restingPositions.get(node));
  const stage=art.querySelector('.art-stage').getBoundingClientRect(),r=node.getBoundingClientRect(),style=getComputedStyle(node);
  const hx=parseFloat(style.getPropertyValue('--hinge-x'))/100,hy=parseFloat(style.getPropertyValue('--hinge-y'))/100;
  if(node.dataset.flight==='yellow'){
   const heading=document.querySelector('.claim-invitation')||document.querySelector('.claim-confirmation h1'),range=document.createRange();range.selectNodeContents(heading);const text=range.getBoundingClientRect(),style=getComputedStyle(heading),transform=new DOMMatrixReadOnly(style.transform==='none'?undefined:style.transform);
   const x=clamp(text.right-transform.m41+clamp(innerWidth*.019,26,50),r.width*hx+12,innerWidth-r.width*(1-hx)-14);
   const y=text.bottom-transform.m42-4;
   node.style.left=(x-stage.left-r.width*hx)+'px';node.style.top=(y-stage.top-r.height*hy)+'px';
  }else if(innerWidth<=900){
   // Keep the same resting composition, with the entire butterfly on screen.
   const x=clamp(r.left+r.width*hx,r.width*hx+10,innerWidth-r.width*(1-hx)-10);
   node.style.left=(x-stage.left-r.width*hx)+'px';
  }
  const box=node.getBoundingClientRect();return {x:box.left+box.width*hx,y:box.top+box.height*hy,w:box.width,h:box.height};
 }
 function framesFor(node,duration){
  const end=endPosition(node),W=innerWidth,H=innerHeight,E=[end.x,end.y],kind=node.dataset.flight;
  let segments;
  if(kind==='red'){
   const rise=H-end.y,start=[W*.025,H+end.h],mid=[end.x*.54,end.y+rise*.60];
   segments=[[start,[W*.09,H*.91],[mid[0]-end.x*.15,mid[1]+rise*.10],mid],[mid,[mid[0]+end.x*.15,mid[1]-rise*.10],[end.x-W*.035,end.y+H*.16],E]];
  }else if(kind==='cyan'){
   segments=[[[W+end.w,end.y+H*.20],[W-W*.015,end.y+H*.19],[end.x+W*.025,end.y+H*.10],E]];
  }else{
   const start=[W*.94,H+end.h],mid=[W*.67,end.y+(H-end.y)*.57];
   segments=[[start,[W*.82,H*.97],[mid[0]+W*.075,mid[1]+H*.13],mid],[mid,[mid[0]-W*.10,mid[1]-H*.14],[end.x+W*.035,end.y+H*.15],E]];
  }
  // Arc-length sampling avoids changes in speed at the Bézier join.
  const samples=[];let length=0,last=null;
  for(const segment of segments)for(let i=0;i<=100;i++){
   const p=bezier(segment,i/100);if(last)length+=Math.hypot(p[0]-last[0],p[1]-last[1]);samples.push({p,length});last=p;
  }
  // One sampled clock drives propulsion, lift, steering and both wing hinges.
  // The wings close on recovery; reopening supplies the forward/lifting impulse.
  const style=getComputedStyle(node),ax=parseFloat(style.getPropertyValue('--ax')),ay=parseFloat(style.getPropertyValue('--ay'));
  const open=parseFloat(style.getPropertyValue('--open')),left=parseFloat(style.getPropertyValue('--left-fold'))+24,right=parseFloat(style.getPropertyValue('--right-fold'))-24;
  // 1.2x the wingbeat rate: six strokes within the original travel duration.
  const ends=[0,.2,.41,.63,.83,1,1.2].map(t=>t/1.2),peaks=[.4,.381,.364,.4,.412,.4],strengths=[1,.86,1,.85,.65,.4];
  const seed=kind==='red'?.3:kind==='cyan'?1.6:2.8,steps=240,poses=[];
  const bell=(phase,peak)=>.5-.5*Math.cos(Math.PI*(phase<peak?phase/peak:(1-phase)/(1-peak)));
  function strokeAt(t){
   let beat=0;while(beat<5&&t>ends[beat+1])beat++;
   const phase=(t-ends[beat])/(ends[beat+1]-ends[beat]),strength=strengths[beat];
   return {phase,strength,fold:bell(phase,peaks[beat])*strength};
  }
  let distance=0,previousSpeed=0;
  for(let i=0;i<=steps;i++){
   const t=i/steps,{phase,strength,fold}=strokeAt(t);
   // A fixed 100 ms response lag gives the body weight; settle without a jump.
   const settle=clamp((1-t)*duration/150,0,1),lift=strokeAt(Math.max(0,t-100/duration)).fold*settle*settle*(3-2*settle);
   const speed=Math.sin(Math.PI*t)**.75*(1-.3*t)*(1+.24*strength*Math.sin(2*Math.PI*phase-.95*Math.PI)+.06*Math.sin(2*Math.PI*t+seed));
   if(i)distance+=(previousSpeed+speed)/2;previousSpeed=speed;
   poses.push({t,fold,lift,distance});
  }
  let index=1;
  for(const pose of poses){
   const d=pose.distance/distance*length;while(index<samples.length-1&&samples[index].length<d)index++;
   const a=samples[index-1],b=samples[index],u=(d-a.length)/(b.length-a.length||1),p=a.p.map((v,k)=>v+(b.p[k]-v)*u);
   const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],span=Math.hypot(dx,dy)||1,envelope=Math.sin(Math.PI*pose.t)**2;
   const drift=envelope*clamp(W*.01,6,16)*(kind==='cyan'?1:.5)*(.7*Math.sin(2*Math.PI*1.25*pose.t+seed)+.3*Math.sin(2*Math.PI*2.1*pose.t+seed*.6));
   pose.x=p[0]-dy/span*drift;pose.pathY=p[1]+dx/span*drift;
   pose.y=pose.pathY-clamp(W*.0009,.64,1.4)*pose.lift*(kind==='red'?.5:1);
  }
  const frames={arrival:[],left:[],right:[]},forward=Math.atan2(-ay,-ax),degrees=180/Math.PI;
  for(let i=0;i<poses.length;i++){
   // Steer along the flight curve; wing-driven lift must not rock the banking angle.
   const p=poses[i],before=poses[Math.max(0,i-1)],after=poses[Math.min(steps,i+1)],heading=Math.atan2(after.pathY-before.pathY,after.x-before.x);
   const turn=Math.atan2(Math.sin(heading-forward),Math.cos(heading-forward))*degrees,envelope=Math.sin(Math.PI*p.t);
   const bank=clamp(turn,-32,32)*envelope*.8,yaw=9*envelope*Math.sin(2*Math.PI*.7*p.t+seed),pitch=envelope*(2+.4*p.lift);
   frames.arrival.push({offset:p.t,transform:`translate3d(${(p.x-end.x).toFixed(3)}px,${(p.y-end.y).toFixed(3)}px,0) rotate(${bank.toFixed(3)}deg) rotateY(${yaw.toFixed(3)}deg) rotateX(${pitch.toFixed(3)}deg)`});
   frames.left.push({offset:p.t,transform:`rotate3d(${ax},${ay},0,${(open+(left-open)*p.fold).toFixed(3)}deg)`});
   frames.right.push({offset:p.t,transform:`rotate3d(${ax},${ay},0,${(right*p.fold).toFixed(3)}deg)`});
  }
  frames.arrival.at(-1).transform='translate3d(0,0,0) rotate(0deg) rotateY(0deg) rotateX(0deg)';
  node.dataset.flightStart=segments[0][0].join(',');node.dataset.flightEnd=E.join(',');
  return frames;
 }
 for(let i=0;i<nodes.length;i++){
  const compact=innerWidth<=900;
  const node=nodes[i],duration=[6000,4800,6600][i],delay=[100,400,650][i];
  endPosition(node);
  node.dataset.flightState='waiting';
  if(reduced.matches||compact){node.dataset.flightState='landed';node.classList.add('butterfly-settled');continue;}
  const frames=framesFor(node,duration);
  const animations=Object.entries(frames).map(([part,keyframes])=>{
   const animation=node.querySelector('.butterfly-'+part).animate(keyframes,{duration,delay,easing:'linear',fill:'both'});
   animation.id='p2-flight-'+part;animation.pause();animation.currentTime=0;return animation;
  });
  records.push({node,animations,started:false});
 }
 art.classList.add('flights-prepared');
 function sync(){for(const r of records){
  const master=r.animations[0];if(master.playState==='finished'||r.node.dataset.flightState==='landed')continue;
  if(reduced.matches){r.animations.forEach(animation=>animation.finish());continue;}
  const elapsed=master.currentTime||0;
  if(document.hidden||!r.started){for(const animation of r.animations){animation.pause();animation.currentTime=elapsed;}}
  else if(master.playState!=='running'){const startTime=document.timeline.currentTime-elapsed;for(const animation of r.animations){animation.play();if(document.timeline.currentTime!==null)animation.startTime=startTime;}}
 }}
 async function start(){
  if(document.documentElement.classList.contains('wave-intro-pending'))await new Promise(resolve=>{
   const observer=new MutationObserver(()=>{if(!document.documentElement.classList.contains('wave-intro-pending')){observer.disconnect();resolve();}});observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  });
  const completions=records.map(r=>{
   r.started=true;r.node.classList.add('flight-running');r.node.dataset.flightState='flying';r.node.dataset.flightStartedAt=performance.now().toFixed(1);
   return Promise.all(r.animations.map(animation=>animation.finished.catch(()=>{}))).then(()=>{
    r.node.classList.remove('flight-running');r.node.dataset.flightState='landed';r.node.dataset.flightLandedAt=performance.now().toFixed(1);r.animations.forEach(animation=>animation.cancel());
    // Continue from the neutral arrival pose on this butterfly's own clock.
    r.node.classList.add('butterfly-settled');
   });
  });sync();await Promise.all(completions);
 }
 function resize(){for(const node of nodes){const r=records.find(r=>r.node===node);if(r&&node.dataset.flightState!=='landed'){const frames=framesFor(node,r.animations[0].effect.getTiming().duration);r.animations.forEach(animation=>animation.effect.setKeyframes(frames[animation.id.replace('p2-flight-','')]));}else endPosition(node);}}
 addEventListener('resize',resize,{passive:true});document.fonts.ready.then(resize);reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
 return {finished:start(),sync};
}

(()=>{
 const art=document.querySelector('.art-layer'),reduced=matchMedia('(prefers-reduced-motion:reduce)'),page=document.querySelector('.page');
 let canvas=art.querySelector('canvas');
 let target=[.5,.5],pointer=[.5,.5],strength=0,wanted=0,visible=true,raf=0,last=0,clock=0,draw=()=>{},facePixels=null,flights=null;
 const webkit=/iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS|OPiOS/.test(navigator.userAgent)||(/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent));
 let gl;
 try{if(!webkit)gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,powerPreference:'low-power'});}catch{}
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
 const fragment=`precision highp float;
 varying vec2 uv;uniform sampler2D art;uniform sampler2D faceMask;uniform vec2 cursor;uniform float time;uniform float power;
 // Remove only the photographed background. Retain luminous contributions,
 // including the original soft halo, with continuous alpha rather than a hard key.
 vec3 source(vec2 p){return texture2D(art,p/vec2(1568.,1003.)).rgb;}
 vec3 clearButterfly(vec2 p,vec3 c,vec2 center,vec2 radius){
  float d=length((p-center)/radius);
  vec3 glow=mix(source(center+vec2(-radius.x*1.12,0.)),source(center+vec2(radius.x*1.12,0.)),clamp((p.x-center.x)/radius.x*.5+.5,0.,1.));
  return mix(glow,c,smoothstep(.88,1.07,d));
 }
 void main(){
  vec2 p=uv*vec2(824.,873.)+vec2(744.,130.);
  vec2 delta=(uv-cursor)*vec2(824.,873.);float dist=length(delta);
  vec3 c=source(p);
  c=clearButterfly(p,c,vec2(949.,421.),vec2(110.,102.));
  c=clearButterfly(p,c,vec2(1300.,302.),vec2(83.,86.));
  c=clearButterfly(p,c,vec2(1368.,911.),vec2(44.,49.));
  vec3 base=vec3(8.,5.,13.)/255.;
  // Never move the front silhouette, bevel highlights, aperture, or halo.
  // Only light transmitted through an inset face matte has parallax.
  float face=texture2D(faceMask,p/vec2(1568.,1003.)).a;
  float intensity=1.75;
  float field=exp(-dist*dist/32000.)*power*face*intensity;
  vec2 normal=delta/max(dist,1.);
  vec2 nearShift=(normal*sin(dist*.025-time*1.3)*2.5+vec2(-2.,1.))*field;
  vec2 farShift=(normal*sin(dist*.019-time*.85+1.4)*6.+vec2(5.,8.))*field;
  vec3 nearReflection=source(p+nearShift);
  vec3 farReflection=source(p+farShift);
  float depth=field*.36;
  c=mix(c,nearReflection*.65+farReflection*.35,depth);
  // Broad reflected light and a softer rear reflection sit at different depths.
  vec2 nearLight=(delta-vec2(-19.,-25.))/vec2(75.,120.);
  vec2 farLight=(delta-vec2(25.,34.))/vec2(100.,65.);
  float nearSheen=exp(-dot(nearLight,nearLight)*2.);
  float rearSheen=exp(-dot(farLight,farLight)*2.);
  float transmitted=(.72+.28*cos(time*.85+dist*.012));
  float shade=exp(-dot((delta-vec2(40.,-15.))/95.,(delta-vec2(40.,-15.))/95.));
  c*=1.-.13*field*shade;
  c+=vec3(.105,.067,.145)*(nearSheen*.8+rearSheen*.45)*transmitted*power*face*intensity;
  c=max((c-base)/(1.-base),0.);
  float topFade=smoothstep(335.,407.,p.y);c*=topFade*smoothstep(744.,840.,p.x);
  float a=max(c.r,max(c.g,c.b));
  gl_FragColor=vec4(c,a);
 }`;
 function setupCanvas2D(source, surface){
  const context=surface.getContext('2d',{alpha:true});
  if(!context)throw new Error('Crystal canvas is unavailable');
  const texture=document.createElement('canvas');
  texture.width=1568;texture.height=1003;
  const reader=texture.getContext('2d',{willReadFrequently:true});
  reader.drawImage(source,0,0);
  const pixels=reader.getImageData(0,0,1568,1003).data;
  const width=824,height=873,left=744,top=130;
  surface.width=width;surface.height=height;
  const base=context.createImageData(width,height),reflection=context.createImageData(width,height);
  const colors=new Float32Array(width*height*3),fades=new Float32Array(width*height);
  const dark=[8,5,13],tint=[.105,.067,.145];
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function smooth(start,end,value){
   const t=clamp((value-start)/(end-start),0,1);
   return t*t*(3-2*t);
  }
  const offset=(x,y)=>4*(clamp(Math.floor(y),0,1002)*1568+clamp(Math.floor(x),0,1567));
  const butterflies=[[949,421,110,102],[1300,302,83,86],[1368,911,44,49]].map(([x,y,rx,ry])=>({
   x,y,rx,ry,left:offset(x-rx*1.12,y),right:offset(x+rx*1.12,y)
  }));
  function write(output,i,r,g,b){
   const alpha=Math.max(r,g,b);
   if(alpha>0){output[i]=255*r/alpha;output[i+1]=255*g/alpha;output[i+2]=255*b/alpha;}
   output[i+3]=255*alpha;
  }
  const contributions=[0,0,0];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const px=x+left+.5,py=y+top+.5,index=y*width+x,src=offset(px,py);
   const fade=smooth(335,407,py)*smooth(744,840,px);fades[index]=fade;
   if(!fade)continue;
   const patch=butterflies.find(({x,y,rx,ry})=>((px-x)/rx)**2+((py-y)/ry)**2<1.07**2);
   const keep=patch?smooth(.88,1.07,Math.hypot((px-patch.x)/patch.rx,(py-patch.y)/patch.ry)):1;
   const mix=patch?clamp((px-patch.x)/patch.rx*.5+.5,0,1):0;
   for(let channel=0;channel<3;channel++){
    const original=pixels[src+channel];
    const glow=patch?pixels[patch.left+channel]*(1-mix)+pixels[patch.right+channel]*mix:0;
    const color=original*keep+glow*(1-keep);
    colors[index*3+channel]=color;
    contributions[channel]=Math.max(0,(color-dark[channel])/(255-dark[channel]))*fade;
   }
   write(base.data,index*4,...contributions);
  }
  context.putImageData(base,0,0);
  let lastPaint=-Infinity,previous=null;
  return ()=>{
   if(strength&&clock-lastPaint<1/30)return;
   lastPaint=clock;
   if(previous)context.putImageData(base,0,0,...previous);
   previous=null;
   art.dataset.hoverStrength=strength.toFixed(3);
   if(!strength)return;
   const cx=pointer[0]*width,cy=pointer[1]*height;
   // shortcut: omit the reflection's sub-1% tail, widen the region if a stronger falloff is used.
   const x0=clamp(Math.floor(cx-400),0,width),y0=clamp(Math.floor(cy-400),0,height);
   const x1=clamp(Math.ceil(cx+400),0,width),y1=clamp(Math.ceil(cy+400),0,height);
   if(x0>=x1||y0>=y1)return;
   reflection.data.set(base.data);
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const index=y*width+x,out=index*4,px=x+left+.5,py=y+top+.5;
    const face=facePixels[offset(px,py)+3]/255;
    if(!face||!fades[index])continue;
    const dx=x+.5-cx,dy=y+.5-cy,dist=Math.hypot(dx,dy),normal=Math.max(dist,1);
    const field=Math.exp(-(dist*dist)/32000)*strength*face*1.75;
    const near=Math.sin(dist*.025-clock*1.3)*2.5/normal,far=Math.sin(dist*.019-clock*.85+1.4)*6/normal;
    const a=offset(px+(dx*near-2)*field,py+(dy*near+1)*field);
    const b=offset(px+(dx*far+5)*field,py+(dy*far+8)*field);
    const nearSheen=Math.exp(-2*(((dx+19)/75)**2+((dy+25)/120)**2));
    const farSheen=Math.exp(-2*(((dx-25)/100)**2+((dy-34)/65)**2));
    const sheen=(nearSheen*.8+farSheen*.45)*(.72+.28*Math.cos(clock*.85+dist*.012))*strength*face*1.75;
    const shade=Math.exp(-(((dx-40)/95)**2+((dy+15)/95)**2));
    for(let channel=0;channel<3;channel++){
     const color=colors[index*3+channel],reflected=pixels[a+channel]*.65+pixels[b+channel]*.35;
     const lit=(color+(reflected-color)*field*.36)*(1-.13*field*shade)+255*tint[channel]*sheen;
     contributions[channel]=Math.max(0,(lit-dark[channel])/(255-dark[channel]))*fades[index];
    }
    write(reflection.data,out,...contributions);
   }
   previous=[x0,y0,x1-x0,y1-y0];
   context.putImageData(reflection,0,0,...previous);
  };
 }
 async function setup(){
  const assets=resolutionVariants;
  function chooseResolution(){
   for(const image of art.querySelectorAll('[data-resolution-id]')){
    const variants=assets[+image.dataset.resolutionId],required=Math.ceil(image.clientWidth*(devicePixelRatio||1)*1.25);
    const selected=variants.find(v=>v.width>=required)||variants.at(-1);
    if(image.dataset.resolution!==String(selected.width)){
      image.crossOrigin='anonymous';image.dataset.artworkLocalSrc=selected.uri;
      image.src=image.dataset.artworkFallback?selected.uri:artworkAssetURL(selected.uri);
      image.dataset.resolution=String(selected.width);
    }
   }
  }
  chooseResolution();new ResizeObserver(chooseResolution).observe(art);addEventListener('resize',chooseResolution,{passive:true});
  const source=art.querySelector('.original-art-fallback'),matte=art.querySelector('.glass-face-matte');
  const decode=image=>image.decode().catch(error=>{
   if(image.dataset.artworkFallback)return image.decode();
   if(!image.complete||!image.naturalWidth)throw error;
  });
  await Promise.all([decode(source),decode(matte),Promise.allSettled([...art.querySelectorAll('[data-resolution-id]')].map(decode))]);
  const hit=document.createElement('canvas');hit.width=1568;hit.height=1003;
  const hitContext=hit.getContext('2d',{willReadFrequently:true});hitContext.drawImage(matte,0,0);
  facePixels=hitContext.getImageData(0,0,1568,1003).data;
  function useCanvas2D(){
   if(gl){
    const replacement=canvas.cloneNode(false);
    canvas.replaceWith(replacement);canvas=replacement;
   }
   draw=setupCanvas2D(source,canvas);
   art.dataset.renderer='canvas2d';
  }
  if(gl){
   try{setupWebGL(source,matte,useCanvas2D);}
   catch(error){console.warn('Using Canvas 2D for the crystal:',error);useCanvas2D();}
  }else useCanvas2D();
  art.classList.add('art-ready');
  flights=preparePage2Flights(art,reduced);
  startMobileOpening();
  const entrances=[...art.querySelectorAll('.art-entrance')].flatMap(el=>el.getAnimations());
  await Promise.all([...entrances.map(animation=>animation.finished.catch(()=>{})),flights.finished]);
  art.classList.add('art-landed');
  art.dataset.landedAt=performance.now().toFixed(1);
  art.classList.add('ambient-active');art.dataset.startedAt=performance.now().toFixed(1);sync();
 }
 function setupWebGL(source,matte,useCanvas2D){
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.)*.5,(1.-position.y)*.5);gl_Position=vec4(position,0.,1.);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
  gl.uniform1i(gl.getUniformLocation(program,'art'),0);
  gl.activeTexture(gl.TEXTURE1);const maskTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,maskTex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,matte);gl.uniform1i(gl.getUniformLocation(program,'faceMask'),1);
  const uCursor=gl.getUniformLocation(program,'cursor'),uTime=gl.getUniformLocation(program,'time'),uPower=gl.getUniformLocation(program,'power');
  draw=()=>{gl.uniform2fv(uCursor,pointer);gl.uniform1f(uTime,clock);gl.uniform1f(uPower,strength);gl.drawArrays(gl.TRIANGLES,0,6);art.dataset.hoverStrength=strength.toFixed(3);};
  function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));gl.viewport(0,0,canvas.width,canvas.height);draw();}
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  art.dataset.renderer='webgl';
  canvas.addEventListener('webglcontextlost',()=>{
   observer.disconnect();useCanvas2D();
  },{once:true});
 }
 function tick(now){raf=0;if(document.hidden||!visible||reduced.matches)return;const dt=Math.min((now-(last||now))/1000,.05);last=now;clock+=dt;const ease=1-Math.exp(-dt*7);pointer=pointer.map((v,i)=>v+(target[i]-v)*ease);strength+=(wanted-strength)*(1-Math.exp(-dt*(wanted?5:3)));draw();if(wanted||strength>.001)raf=requestAnimationFrame(tick);else{strength=0;draw();last=0;}}
 function schedule(){if(!raf&&art.classList.contains('ambient-active')&&!document.hidden&&visible&&!reduced.matches)raf=requestAnimationFrame(tick);}
 function inLogo(x,y){x=Math.floor(x);y=Math.floor(y);return !!facePixels&&x>=0&&x<1568&&y>=0&&y<1003&&facePixels[(y*1568+x)*4+3]>128;}
 addEventListener('pointermove',e=>{if(e.pointerType==='touch'||e.target.closest('input,select,button,a')){wanted=0;schedule();return;}const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;target=[x,y];wanted=inLogo(x*824+744,y*873+130)?1:0;schedule();},{passive:true});
 document.addEventListener('pointerleave',()=>{wanted=0;schedule();});
 function sync(){art.classList.toggle('ambient-paused',document.hidden||reduced.matches||!visible);flights?.sync();if(document.hidden||reduced.matches||!visible){cancelAnimationFrame(raf);raf=0;last=0;if(reduced.matches){strength=0;wanted=0;draw();}}else schedule();}
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();}).observe(art);
 const observer=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('offscreen',!e.isIntersecting)));art.querySelectorAll('.butterfly-position').forEach(e=>observer.observe(e));
 document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
 // Layer 1 is the previous page's exact mesh. Forward input without blocking form controls or scrolling.
 let down=null;
 const isMeshTarget = event => !event.target.closest('input,select,button,a,label,textarea,dialog');
 page.addEventListener('pointerdown',e=>{if(e.isPrimary&&e.button===0&&isMeshTarget(e))down={x:e.clientX,y:e.clientY,moved:false};});
 page.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>12)down.moved=true;},{passive:true});
 page.addEventListener('pointercancel',()=>down=null);
 page.addEventListener('pointerup',e=>{if(down&&!down.moved&&isMeshTarget(e))window.__startMeshWave?.(e.clientX,e.clientY);down=null;});
 document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.code==='Space')&&isMeshTarget(e)){e.preventDefault();window.__startMeshWave?.(innerWidth*.5,innerHeight*.5);}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')window.__clearMeshWave?.();});
 function reveal(){
  document.documentElement.classList.remove('wave-intro-pending');
  document.documentElement.dataset.textWaveStart=performance.now().toFixed(1);
 }
 addEventListener('so:opening-wave-hit',reveal,{once:true});
 async function opening(){
  await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,350))]);
  if(!window.__startMeshWave){reveal();return;}
  const box=art.getBoundingClientRect(),area=document.querySelector('.content').getBoundingClientRect();
  window.__startMeshWave(Math.max(0,Math.min(innerWidth-20,box.left+box.width*.55)),
   Math.max(0,Math.min(innerHeight-20,box.top+box.height*.65)),'opening',area);
 }
 setup().catch(error=>{console.error('Artwork setup failed:',error);art.classList.add('static-fallback');startMobileOpening();reveal();});
 opening().catch(reveal);sync();
})();

}
