"""Download and validate source CSVs; never calculate statistics or write the DB."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import parse_qsl, urlencode, urlsplit
import pandas as pd
import requests

BACK_DIR = Path(__file__).resolve().parents[1]
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))
from scripts.collector_stat_sources import SOURCE_DIR

BASE = 'https://baseballsavant.mlb.com'
HEADERS = {'User-Agent':'Mozilla/5.0', 'Accept':'text/csv,*/*'}
MAX_BYTES = 128 * 1024 * 1024


def request_key(url, params=None):
    parsed=urlsplit(url)
    query=dict(parse_qsl(parsed.query,keep_blank_values=True))
    query.update({k:str(v) for k,v in (params or {}).items()})
    for name in ('csv','sort','sortDir','sortdir'):
        query.pop(name,None)
    query={k:v for k,v in query.items() if v != ''}
    if 'selections' in query:
        query['selections']=','.join(sorted(set(query['selections'].split(','))))
    return parsed.netloc.lower()+parsed.path+'?'+urlencode(sorted(query.items()))


def source_specs(season):
    if not 2015 <= season <= date.today().year:
        raise ValueError('지원 시즌은 2015년부터 현재 연도까지입니다.')
    result=[]
    def add(name,path,params,metric):
        result.append(dict(name=name,url=BASE+path,params={**params,'csv':'true'},
                           filename=f'{name}_{season}.csv',season=season,metric=metric))
    for role in ('batter','pitcher'):
        add(f'savant_percentiles_{role}','/leaderboard/percentile-rankings',{'type':role,'year':season,'position':'','team':''},'k_percent')
        fields=('player_id,exit_velocity_avg,launch_angle_avg,sweet_spot_percent,barrel_batted_rate,hard_hit_percent,xba,xslg,xwoba,sprint_speed' if role=='batter' else 'player_id,exit_velocity_avg,launch_angle_avg,barrel_batted_rate,hard_hit_percent,xera')
        add(f'savant_{role}_statcast','/leaderboard/custom',{'year':season,'type':role,'min':10,'selections':fields},'exit_velocity_avg')
        fields='player_id,whiff_percent,oz_swing_percent,chase_percent'+(',k_percent,bb_percent' if role=='batter' else '')
        add(f'savant_{role}_discipline','/leaderboard/custom',{'year':season,'type':role,'min':10,'selections':fields},'whiff_percent')
    add('savant_pitch_run_values','/leaderboard/custom',{'year':season,'type':'pitcher','min':10,'selections':'pitch_run_value_fastball,pitch_run_value_breaking,pitch_run_value_offspeed'},'pitch_run_value_fastball')
    add('savant_pitcher_extra','/leaderboard/custom',{'year':season,'type':'pitcher','min':10,'selections':'player_id,xba,groundballs_percent,release_extension,ff_avg_speed,k_percent,bb_percent'},'xba')
    add('savant_fielding','/leaderboard/fielding-run-value',{'type':'fielder','seasonStart':season,'seasonEnd':season},'total_runs')
    for role in ('Batter','Pitcher'):
        add(f'savant_{role.lower()}_run_value','/leaderboard/swing-take',{'year':season,'team':'','leverage':'Neutral','group':role,'type':'All','sub_type':'null','min':'q'},'runs_all')
    if season >= 2024:
        add('savant_bat_tracking','/leaderboard/bat-tracking',{'seasonStart':season,'seasonEnd':season,'minSwings':0},'avg_bat_speed')
    for role in ('batting','pitching'):
        result.append(dict(name=f'bref_{role}',url=f'https://www.baseball-reference.com/data/war_daily_{"bat" if role=="batting" else "pitch"}.txt',params={},filename=f'bref_{role}_{season}.csv',season=season,metric='war'))
    for role in ('batting','pitching'):
        result.append(dict(name=f'fangraphs_{role}',url='https://www.fangraphs.com/api/leaders/major-league/data',params={'season':season,'stats':'pit' if role=='pitching' else 'bat'},filename=f'fangraphs_{role}_{season}.csv',season=season,metric='fwar'))
    return result


def validate_csv(data,spec):
    if not data or len(data)>MAX_BYTES or data.lstrip(b'\xef\xbb\xbf \r\n\t').startswith(b'<'):
        raise ValueError('비어 있거나 HTML 응답/허용 크기 초과입니다.')
    frame=pd.read_csv(io.BytesIO(data),encoding='utf-8-sig')
    frame.columns=frame.columns.str.strip().str.lower()
    id_column=next((c for c in ('player_id','id','mlb_id') if c in frame),None)
    if frame.empty or id_column is None or spec['metric'] not in frame:
        raise ValueError('필수 선수 ID/지표 열 또는 데이터가 없습니다.')
    ids=pd.to_numeric(frame[id_column],errors='coerce')
    if not (ids.gt(0) & ids.mod(1).eq(0)).any():
        raise ValueError('유효한 선수 ID가 없습니다.')
    year_column=next((c for c in ('year','year_id','season') if c in frame),None)
    if year_column:
        years=pd.to_numeric(frame[year_column],errors='coerce').dropna()
        if not years.eq(spec['season']).any():
            raise ValueError('요청 시즌 데이터가 없습니다.')
        if not spec['name'].startswith('bref_') and not years.eq(spec['season']).all():
            raise ValueError('응답 시즌이 요청과 다릅니다.')
    if not pd.to_numeric(frame[spec['metric']],errors='coerce').replace([float('inf'),-float('inf')],float('nan')).notna().any():
        raise ValueError('원본 지표가 전부 비어 있습니다.')
    return frame


def read_prepared(spec):
    path=SOURCE_DIR/spec['filename']
    data=path.read_bytes()
    metadata=json.loads(path.with_suffix('.meta.json').read_text(encoding='utf-8'))
    if metadata['sha256']!=hashlib.sha256(data).hexdigest() or metadata['request_key']!=request_key(spec['url'],spec['params']):
        raise ValueError('파일 해시 또는 요청 정보가 일치하지 않습니다.')
    validate_csv(data,spec)
    frame=pd.read_csv(io.BytesIO(data),encoding='utf-8-sig')
    frame.attrs['source']=f"local_csv:{path.name}"
    return frame


def read_prepared_for_request(url,params=None):
    key=request_key(url,params)
    query=dict(parse_qsl(urlsplit(url).query));query.update(params or {})
    season=next((int(query[k]) for k in ('year','seasonStart','startYear') if k in query),None)
    if season is None:
        return pd.DataFrame()
    try:
        spec=next((s for s in source_specs(season) if request_key(s['url'],s['params'])==key),None)
        return read_prepared(spec) if spec else pd.DataFrame()
    except (OSError,ValueError,KeyError,pd.errors.ParserError):
        return pd.DataFrame()


def write_snapshot(data, spec, directory=None):
    directory=SOURCE_DIR if directory is None else directory
    frame=validate_csv(data,spec)
    metadata={**spec,'request_key':request_key(spec['url'],spec['params']),
              'downloaded_at':datetime.now(timezone.utc).isoformat(),
              'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'rows':len(frame),'format_version':1}
    directory.mkdir(parents=True,exist_ok=True)
    # Validate before replacing either existing file. Unique temporaries avoid races.
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        csv=Path(temporary)/spec['filename'];csv.write_bytes(data)
        meta=csv.with_suffix('.meta.json');meta.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
        target=directory/spec['filename']; target_meta=target.with_suffix('.meta.json')
        old_csv=target.read_bytes() if target.exists() else None
        old_meta=target_meta.read_bytes() if target_meta.exists() else None
        try:
            os.replace(csv,target)
            os.replace(meta,target_meta)
        except OSError:
            # Preserve a usable older snapshot if the second replacement fails.
            if old_csv is not None: target.write_bytes(old_csv)
            elif target.exists(): target.unlink()
            if old_meta is not None: target_meta.write_bytes(old_meta)
            raise


def download_one(spec,force=False):
    try:
        if not force:
            try:
                frame=read_prepared(spec)
                return {'source':spec['name'],'status':'cached','rows':len(frame)}
            except (OSError,ValueError,KeyError,pd.errors.ParserError):
                pass
        if spec['name'].startswith('fangraphs_'):
            from scripts.collector_stat_sources import fetch_fangraphs_with_fallback, fetch_fangraphs_http
            frame=fetch_fangraphs_with_fallback(spec['season'],spec['name']=='fangraphs_pitching',fetch_fangraphs_http,save_snapshot=False,local_fallback=False)
            if frame.empty:
                raise ValueError('FanGraphs 온라인 수집 실패; 기존 CSV는 유지합니다.')
            frame=frame.drop(columns=[c for c in frame if c.endswith('__source')])
            frame['season']=spec['season']
            data=frame.to_csv(index=False).encode('utf-8')
            write_snapshot(data,spec)
            return {'source':spec['name'],'status':'downloaded','rows':len(frame),'bytes':len(data)}
        response=requests.get(spec['url'],params=spec['params'],headers=HEADERS,timeout=(5,20),stream=True)
        try:
            response.raise_for_status()
            pieces=[];size=0
            for piece in response.iter_content(65536):
                size+=len(piece)
                if size>MAX_BYTES:raise ValueError('다운로드 크기 제한 초과')
                pieces.append(piece)
            data=b''.join(pieces)
        finally:
            response.close()
        frame=validate_csv(data,spec)
        write_snapshot(data,spec)
        return {'source':spec['name'],'status':'downloaded','rows':len(frame),'bytes':len(data)}
    except (requests.RequestException,OSError,ValueError,KeyError,pd.errors.ParserError) as exc:
        return {'source':spec['name'],'status':'failed','error':str(exc)[:400]}


def prepare_source_csvs(season,force=False):
    specs=source_specs(season)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results=list(executor.map(lambda spec:download_one(spec,force),specs))
    summary={'season':season,'results':results}
    for status in ('downloaded','cached','failed'):
        summary[status]=sum(r['status']==status for r in results)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--season',type=int,required=True)
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    result=prepare_source_csvs(args.season,args.force)
    return 1 if result['failed'] else 0

if __name__=='__main__':
    raise SystemExit(main())
