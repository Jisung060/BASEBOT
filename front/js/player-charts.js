/* Optional local-CSV charts. The player page never triggers collection. */
let playerChartRequest = 0;
const chartEscape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chartSvg = (label, body) => `<svg viewBox="0 0 300 280" role="img" aria-label="${chartEscape(label)}">${body}</svg>`;
const hitColors = {single:'#e98b3a',double:'#8b6cdd',triple:'#edbc41',home_run:'#bc387d'};
const pitchColors = {FF:'#d64c68',SI:'#d79337',FC:'#a26c55',CU:'#59b8d0',KC:'#59b8d0',CH:'#72b766',SL:'#c9b83f',ST:'#baa34e',FS:'#68a6b3',SV:'#8172bd'};

function sprayChart(data) {
    const points=data.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&hitColors[p.events]);
    if (!points.length) return '';
    const field='<path d="M125 205 L25 105 Q125 -35 225 105 Z" fill="#dbefdf" stroke="#a5c3b3"/><path d="M125 205 L82 162 L125 119 L168 162 Z" fill="#eadbc5" stroke="white"/><path d="M125 205 L25 105 M125 205 L225 105" stroke="#b2bfc6" fill="none"/>';
    const dots=points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${hitColors[p.events]}" stroke="#334155" stroke-width=".4"><title>${chartEscape(p.events)}</title></circle>`).join('');
    return chartSvg('안타 타구 분포도',`<g transform="translate(25 5)">${field}${dots}</g>`)+`<div class="chart-legend">${Object.entries(hitColors).map(([name,color])=>`<span><i style="background:${color}"></i>${{single:'단타',double:'2루타',triple:'3루타',home_run:'홈런'}[name]}</span>`).join('')}</div>`;
}

function rollingChart(data) {
    const points=data.points.filter(p=>Number.isFinite(p.pa)&&Number.isFinite(p.value));
    if (!points.length) return '';
    const first=points[0].pa,last=points[points.length-1].pa;
    const maximum=Math.max(.6,Math.ceil(Math.max(...points.map(p=>p.value))*10)/10);
    const x=p=>40+(p.pa-first)/Math.max(1,last-first)*235;
    const y=p=>235-p.value/maximum*205;
    const grid=[0,maximum/2,maximum].map(v=>`<path d="M40 ${235-v/maximum*205} H275" stroke="#cbd5e1" stroke-dasharray="3 3"/><text x="34" y="${239-v/maximum*205}" text-anchor="end" font-size="10">${v.toFixed(3)}</text>`).join('');
    const segments=[];
    for (const point of points) {
        const segment=segments[segments.length-1];
        if (!segment || point.pa !== segment[segment.length-1].pa+1) segments.push([point]);
        else segment.push(point);
    }
    const lines=segments.map(segment=>`<polyline points="${segment.map(p=>`${x(p)},${y(p)}`).join(' ')}" fill="none" stroke="#d14d42" stroke-width="2"/>`).join('');
    return chartSvg('최근 100타석 이동 xwOBA',`${grid}${lines}${points.length===1?`<circle cx="${x(points[0])}" cy="${y(points[0])}" r="3" fill="#d14d42"/>`:''}<text x="40" y="257" font-size="10">${first} PA</text><text x="275" y="257" text-anchor="end" font-size="10">${last} PA</text>`);
}

function movementChart(data) {
    const points=data.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&/^[A-Z0-9]{1,4}$/.test(p.pitch_type));
    if (!points.length) return '';
    const extent=Math.max(24,Math.ceil(Math.max(...points.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)]))/12)*12);
    const scale=110/extent;
    const dots=points.map(p=>`<circle cx="${150+p.x*scale}" cy="${135-p.y*scale}" r="3.8" fill="${pitchColors[p.pitch_type]||'#64748b'}" opacity=".8"><title>${p.pitch_type}: 가로 ${p.x.toFixed(1)} / 세로 ${p.y.toFixed(1)} in</title></circle>`).join('');
    return chartSvg('구종별 투구 무브먼트 · 포수 시점',`<circle cx="150" cy="135" r="110" fill="#edf5f8" stroke="#cbd5e1"/><circle cx="150" cy="135" r="55" fill="none" stroke="#cbd5e1" stroke-dasharray="3 3"/><path d="M40 135 H260 M150 25 V245" stroke="#94a3b8"/>${dots}<text x="150" y="18" text-anchor="middle" font-size="10">세로 +${extent} in</text><text x="150" y="265" text-anchor="middle" font-size="10">가로 ±${extent} in · 포수 시점</text>`)+`<div class="chart-legend">${[...new Set(points.map(p=>p.pitch_type))].map(type=>`<span><i style="background:${pitchColors[type]||'#64748b'}"></i>${type}</span>`).join('')}</div>`;
}

async function loadOptionalPlayerCharts(playerId,season,mode) {
    const container=document.getElementById('optionalPlayerCharts');
    if (!container) return;
    const request=++playerChartRequest;
    container.hidden=true;container.innerHTML='';
    if (!Number.isInteger(Number(season)) || Number(season)<2015 || !Number.isInteger(Number(playerId)) || Number(playerId)<=0 || !['batting','pitching'].includes(mode)) return;
    try {
        const res=await fetch(`http://127.0.0.1:8000/api/players/${Number(playerId)}/charts?season=${Number(season)}&mode=${encodeURIComponent(mode)}`);
        if (!res.ok) return;
        const data=await res.json();
        if (request!==playerChartRequest || Number(data.season)!==Number(season) || Number(data.player_id)!==Number(playerId) || data.mode!==mode) return;
        const charts=data.charts||{};
        const cards=[];
        const add=(key,title,note,renderer)=>{
            if (!charts[key]) return;
            const body=renderer(charts[key]);
            if (body) cards.push(`<article class="player-chart-card"><h3>${title}</h3><p>${note}</p>${body}</article>`);
        };
        if (mode==='batting') {
            add('spray',`${season} 안타 분포도`,'좌표가 제공된 정규시즌 안타',sprayChart);
            add('rolling_xwoba',`${season} 최근 100타석 xwOBA`,'타석별 데이터로 재구성 · 결측 포함 구간 제외',rollingChart);
        } else add('movement',`${season} 구종별 무브먼트`,'정규시즌 균등 간격 표본 · 최대 100구 · 단위: 인치',movementChart);
        if (!cards.length) return;
        const time=data.downloaded_at?new Date(data.downloaded_at):null;
        container.innerHTML=`<div class="player-chart-grid">${cards.join('')}</div><p class="player-chart-source">출처: Baseball Savant · ${time&&!Number.isNaN(time.getTime())?`수집 ${chartEscape(time.toLocaleString('ko-KR'))}`:'저장된 데이터'} · 구장 윤곽은 설명용</p>`;
        container.hidden=false;
    } catch (_) { /* Optional charts stay hidden when files/API are unavailable. */ }
}
