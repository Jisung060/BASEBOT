const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert/strict');
const file=path.resolve(__dirname,'../../../front/js/player-detail.js');
const elements=new Map();
function element(){
  let html='';
  return {children:[],value:'2025',style:{},classList:{toggle(){},add(){}},
    get innerHTML(){return html;},set innerHTML(value){html=value;this.children=[];},
    appendChild(child){this.children.push(child);},addEventListener(){},add(){}};
}
const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const context={console,document:{addEventListener(){},getElementById:get,createElement:element}};
vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
const originalPredict=context.loadDlPrediction;
vm.runInContext('syncDlSeasonSelector=()=>{};loadDlPrediction=()=>{};',context);
const estimated={status:'estimated',label:'추정값 · 자체 계산'};
const published={status:'published',label:'Baseball-Reference · 온라인 원본'};
const csv={status:'published',label:'FanGraphs · 원본 CSV'};
const data={player_id:1,position:'P',batting_stats:[
 {season:2025,bwar:2,fwar:0,wrc_plus:120,stat_sources:{bwar:published,fwar:estimated,wrc_plus:estimated}},
 {season:2024,bwar:1,fwar:3,wrc_plus:100,stat_sources:{fwar:csv}}
],pitching_stats:[{season:2025,bwar:0,fwar:-1,stat_sources:{bwar:estimated,fwar:csv}}]};
context.fixture=data;
vm.runInContext("currentPlayerData=fixture; activeMode='batting';selectedSeason=2025;renderModeView();",context);
assert.match(get('summaryGrid').innerHTML,/추정값/);
assert.match(get('summaryGrid').innerHTML,/Baseball-Reference/);
assert.match(get('summaryGrid').innerHTML,/>0\.0<small/);
assert.match(get('playerStatsBody').children[0].innerHTML,/추정값/);
assert.match(get('playerStatsBody').children[1].innerHTML,/FanGraphs · 원본 CSV/);
assert.match(get('playerStatsBody').children[1].innerHTML,/원본 미확보 · 기존 값 유지/);
vm.runInContext("selectedSeason=2024;renderModeView();",context);
assert.match(get('summaryGrid').innerHTML,/원본 미확보 · 기존 값 유지/);
assert.match(get('summaryGrid').innerHTML,/FanGraphs · 원본 CSV/);
vm.runInContext("activeMode='pitching';selectedSeason=2025;renderModeView();",context);
assert.match(get('summaryGrid').innerHTML,/추정값/);
assert.match(get('playerStatsBody').children[0].innerHTML,/추정값/);
assert.match(get('summaryGrid').innerHTML,/>-1\.0<small/);
assert.equal(context.formatSourcedStat({fwar:null},'fwar',1),'-');
assert.equal(context.formatSourcedStat({},'fwar',1),'-');
assert.match(context.formatSourcedStat({fwar:1,stat_sources:{fwar:{status:'published',label:'<img src=x>'}}},'fwar'),/&lt;img/);
context.fetch=async()=>({ok:true,json:async()=>({mode:'batting',target_season:2025,baseline_season:2024,
 predicted:{bwar:1,fwar:2,wrc_plus:100},deltas:{},actual:{bwar:2,fwar:0,wrc_plus:120},prior_seasons_used:[2024]})});
(async()=>{
  await originalPredict();
  assert.match(get('dlPredCardsGrid').innerHTML,/DB 기록 2025/);
  assert.match(get('dlPredCardsGrid').innerHTML,/추정값/);
  assert.doesNotMatch(get('dlPredCardsGrid').innerHTML,/실제 2025 WAR/);
  console.log('Player stat provenance UI checks passed (cards, tables, season/role switches, DL comparisons).');
})().catch(error=>{console.error(error);process.exitCode=1;});
