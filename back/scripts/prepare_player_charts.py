"""Collect optional chart CSVs for one player or all DB players in a selected season."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import sys
import tempfile
import time
BACK=Path(__file__).resolve().parents[1]
if str(BACK) not in sys.path:sys.path.insert(0,str(BACK))
from services import player_chart_data as chart_data
from services.player_chart_data import collect_player_charts


def collect_season_charts(season, players, refresh=False, progress=None):
    # Targets must be the selected season's DB player/role rows, supplied by the caller.
    targets=sorted({(int(player['player_id']),player['mode']) for player in players})
    if not targets:raise ValueError('No player statistics for the selected season')
    for pid,mode in targets:chart_data.chart_spec(season,pid,mode)
    summary={'season':season,'total':len(targets),'downloaded':0,'cached':0,'failed':0,'results':[]}
    def collect(target):
        pid,mode=target
        try:
            if not refresh:
                try:
                    spec=chart_data.chart_spec(season,pid,mode)
                    folder=chart_data.CHART_DIR/str(season)/str(pid)
                    chart_data.read_chart_frame(spec,folder)
                    return {'player_id':pid,'mode':mode,'status':'cached'}
                except (OSError,ValueError,KeyError):
                    pass
            result=collect_player_charts(season,pid,mode)
            return {**result,'status':'downloaded'}
        except Exception as exc:
            return {'player_id':pid,'mode':mode,'status':'failed','error':str(exc)[:250]}
    last_update=time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as executor:
        for future in as_completed([executor.submit(collect,target) for target in targets]):
            result=future.result()
            summary['results'].append(result);summary[result['status']]+=1
            done=len(summary['results'])
            if progress and (done==len(targets) or done%10==0 or time.monotonic()-last_update>=5):
                progress(done,len(targets),summary)
                last_update=time.monotonic()
    summary['results'].sort(key=lambda r:(r['player_id'],r['mode']))
    folder=chart_data.CHART_DIR/str(season);folder.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder) as temp:
        path=Path(temp)/'batch_summary.json'
        path.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(path,folder/'batch_summary.json')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',required=True,type=int)
    target=parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--player-id',type=int)
    target.add_argument('--all',action='store_true',dest='all_players')
    parser.add_argument('--mode',choices=['batting','pitching'])
    parser.add_argument('--refresh',action='store_true',help='Refresh existing snapshots in batch mode')
    args=parser.parse_args()
    if args.all_players:
        if args.mode:parser.error('--all collects each player role registered in the selected season; omit --mode')
        chart_data.chart_spec(args.season,1,'batting')
        from database.db_connection import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            rows=conn.execute(text('SELECT DISTINCT player_id,is_pitcher FROM player_season_stats WHERE season=:season AND games>0'),{'season':args.season}).mappings().all()
        players=[{'player_id':r['player_id'],'mode':'pitching' if r['is_pitcher'] else 'batting'} for r in rows]
        if not players:parser.error('No player statistics for the selected season')
        result=collect_season_charts(args.season,players,args.refresh,progress=lambda done,total,s:print(f'{done}/{total}: downloaded={s["downloaded"]}, cached={s["cached"]}, failed={s["failed"]}',flush=True))
        print(json.dumps({k:v for k,v in result.items() if k!='results'},ensure_ascii=False))
        raise SystemExit(1 if result['failed'] else 0)
    if not args.mode:parser.error('--mode is required with --player-id')
    print(collect_player_charts(args.season,args.player_id,args.mode))
