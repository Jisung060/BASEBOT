const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../../front/js/admin/baseball-data.js'),'utf8');
const body=source.slice(source.indexOf('function initManualSyncControls()'),source.indexOf('let logPollTimer'));
const elements={};let payload;
const get=id=>elements[id]||=({value:'',disabled:false,checked:false,style:{},handlers:{},options:[],addEventListener(event,fn){this.handlers[event]=fn;},add(opt){this.options.push(opt);}});
const context={document:{getElementById:get},Option:function(label,value){return {label,value};},alert:()=>{},
 fetch:async()=>({ok:true,json:async()=>({players:[{player_id:592450,name:'Aaron Judge',mode:'batting'}]})}),
 executeManualSync:value=>payload=value,saveSchedulesConfig(){},loadSyncLogs(){},loadDashboardSummary(){}};
vm.createContext(context);vm.runInContext(body+'\ninitManualSyncControls();',context);
(async()=>{
 get('manualSyncType').value='PREPARE_PLAYER_CHARTS';get('manualSeasonSelect').value='2025';
 get('manualSyncType').handlers.change();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('manualChartPlayerBox').style.display,'flex');assert.equal(get('manualChartPlayer').disabled,false);
 assert.equal(get('manualChartPlayer').options[0].value,'ALL');
 assert.equal(get('manualChartPlayer').options[1].value,'592450:batting');
 get('manualChartPlayer').value='592450:batting';get('btnRunManualSync').handlers.click();
 assert.equal(payload.player_id,592450);assert.equal(payload.chart_mode,'batting');assert.equal(payload.season,2025);
 get('manualChartPlayer').value='ALL';get('manualChartRefresh').checked=true;get('btnRunManualSync').handlers.click();
 assert.equal(payload.chart_all_players,true);assert.equal(payload.player_id,null);assert.equal(payload.chart_refresh,true);assert.equal(payload.season,2025);
 get('manualChartPlayer').disabled=true;payload=null;get('btnRunManualSync').handlers.click();assert.equal(payload,null);
 get('manualSyncType').value='STEP_BATTERS';get('manualSyncType').handlers.change();assert.equal(get('manualChartPlayerBox').style.display,'none');
 console.log('Admin chart selector UI checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
