"""Optional player charts backed by validated, local Statcast CSVs; no database writes."""
from datetime import date
import io
import json
from pathlib import Path
import pandas as pd
import requests
from scripts.prepare_source_csvs import write_snapshot, read_prepared

CHART_DIR = Path(__file__).resolve().parents[1] / 'data' / 'player_charts'
COLUMNS = ['player_id','game_date','game_pk','at_bat_number','pitch_number','events','hc_x','hc_y',
           'estimated_woba_using_speedangle','woba_value','woba_denom','pitch_type','pfx_x','pfx_z','release_speed','release_extension']


def chart_spec(season, player_id, mode):
    if not 2015 <= season <= date.today().year or player_id <= 0 or mode not in ('batting','pitching'):
        raise ValueError('Invalid season, player ID or mode')
    pitcher = mode == 'pitching'
    params = {'all':'true','type':'details','player_type':'pitcher' if pitcher else 'batter',
              'hfSea':f'{season}|','hfGT':'R|','game_date_gt':f'{season}-01-01','game_date_lt':f'{season}-12-31',
              'pitchers_lookup[]' if pitcher else 'batters_lookup[]':player_id}
    return dict(name=f'player_chart_{mode}',filename=f'{mode}.csv',season=season,player_id=player_id,mode=mode,
                url='https://baseballsavant.mlb.com/statcast_search/csv',params=params,metric='game_pk')


def validate_frame(frame, spec):
    required = {'player_id','game_date','game_pk','at_bat_number','pitch_number','events'}
    if frame.empty or not required.issubset(frame):
        raise ValueError('No valid Statcast event rows')
    ids = pd.to_numeric(frame.player_id,errors='coerce')
    dates = pd.to_datetime(frame.game_date,errors='coerce')
    if not ids.eq(spec['player_id']).all() or not dates.dt.year.eq(spec['season']).all():
        raise ValueError('Response player or season mismatch')
    keys = ['game_pk','at_bat_number','pitch_number']
    if frame[keys].isna().any().any() or frame.duplicated(keys).any():
        raise ValueError('Missing or duplicate pitch identifiers')
    return frame


def collect_player_charts(season, player_id, mode):
    spec = chart_spec(season,player_id,mode)
    response = requests.get(spec['url'],params=spec['params'],headers={'User-Agent':'Mozilla/5.0'},timeout=(5,60),stream=True)
    try:
        response.raise_for_status()
        chunks=[];size=0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 64*1024*1024:
                raise ValueError('Player download exceeds 64 MB')
            chunks.append(chunk)
        raw = pd.read_csv(io.BytesIO(b''.join(chunks)),encoding='utf-8-sig')
    finally:
        response.close()
    if 'game_type' in raw and not raw.game_type.eq('R').all():
        raise ValueError('Response contains non-regular-season pitches')
    identity = 'pitcher' if mode=='pitching' else 'batter'
    if identity not in raw:
        raise ValueError('Statcast response has no player identifier')
    frame = raw[[c for c in COLUMNS if c != 'player_id' and c in raw]].copy()
    frame.insert(0,'player_id',raw[identity])
    validate_frame(frame,spec)
    folder = CHART_DIR / str(season) / str(player_id)
    write_snapshot(frame.to_csv(index=False).encode('utf-8'),spec,directory=folder)
    return {'rows':len(frame),'player_id':player_id,'season':season,'mode':mode}


def chart_points(frame, mode):
    result={}
    if mode=='batting':
        if {'hc_x','hc_y'}.issubset(frame):
            hits=frame[frame.events.isin(['single','double','triple','home_run'])].copy()
            hits['x']=pd.to_numeric(hits.hc_x,errors='coerce');hits['y']=pd.to_numeric(hits.hc_y,errors='coerce')
            hits=hits[hits.x.between(0,250)&hits.y.between(0,250)].drop_duplicates(['game_pk','at_bat_number'])
            if not hits.empty:
                result['spray']={'points':hits[['x','y','events']].to_dict('records')}
        fields={'estimated_woba_using_speedangle','woba_value','woba_denom'}
        if fields.issubset(frame):
            pa=frame[frame.events.notna() & frame.events.ne('')].sort_values(['game_date','game_pk','at_bat_number','pitch_number']).drop_duplicates(['game_pk','at_bat_number'],keep='last').copy()
            denom=pd.to_numeric(pa.woba_denom,errors='coerce')
            # Intentional walks count as PA but are excluded from the wOBA denominator.
            denom=denom.mask(pa.events.eq('intent_walk'),0)
            expected=pd.to_numeric(pa.estimated_woba_using_speedangle,errors='coerce')
            noncontact=pa.events.isin(['walk','hit_by_pitch','strikeout','strikeout_double_play'])
            expected=expected.fillna(pd.to_numeric(pa.woba_value,errors='coerce').where(noncontact))
            expected=expected.mask(denom.eq(0),0)
            valid=denom.isin([0,1]) & expected.between(0,3)
            numerator=expected.where(valid).rolling(100,min_periods=100).sum()
            denominator=denom.where(valid).rolling(100,min_periods=100).sum()
            values=numerator/denominator.where(denominator.gt(0))
            points=[{'pa':index+1,'date':str(row.game_date)[:10],'value':round(float(values.iloc[index]),4)} for index,(_,row) in enumerate(pa.iterrows()) if pd.notna(values.iloc[index])]
            if points:result['rolling_xwoba']={'window':100,'points':points}
    elif {'pitch_type','pfx_x','pfx_z'}.issubset(frame):
        pitches=frame.copy()
        pitches['x']=pd.to_numeric(pitches.pfx_x,errors='coerce')*12
        pitches['y']=pd.to_numeric(pitches.pfx_z,errors='coerce')*12
        pitches=pitches[pitches.x.between(-48,48)&pitches.y.between(-48,48)&pitches.pitch_type.astype('string').str.fullmatch('[A-Z0-9]{1,4}',na=False)]
        if not pitches.empty:
            pitches=pitches.sort_values(['game_date','game_pk','at_bat_number','pitch_number'])
            indices=[int(i*(len(pitches)-1)/max(1,min(100,len(pitches))-1)) for i in range(min(100,len(pitches)))]
            result['movement']={'units':'inches','total_pitches':len(pitches),'points':pitches.iloc[indices][['x','y','pitch_type']].to_dict('records')}
    return result


def read_chart_frame(spec,folder):
    frame=validate_frame(read_prepared(spec,directory=folder),spec)
    metadata=json.loads((folder/spec['filename']).with_suffix('.meta.json').read_text(encoding='utf-8'))
    if any(metadata.get(key)!=spec[key] for key in ('season','player_id','mode')):
        raise ValueError('Chart metadata player, season or role mismatch')
    return frame,metadata


def load_player_charts(season, player_id, mode):
    spec=chart_spec(season,player_id,mode)
    identity={'season':season,'player_id':player_id,'mode':mode}
    folder=CHART_DIR/str(season)/str(player_id)
    try:
        frame,metadata=read_chart_frame(spec,folder)
        return {**identity,'charts':chart_points(frame,mode),'downloaded_at':metadata['downloaded_at']}
    except (OSError,ValueError,KeyError,pd.errors.ParserError):
        return {**identity,'charts':{}}
