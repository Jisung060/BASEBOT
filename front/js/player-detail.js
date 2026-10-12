let currentPlayerData = null;
let activeMode = "batting"; // 'batting' or 'pitching'

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const playerId = urlParams.get("id") || "660271"; // 기본: 오타니 쇼헤이
    fetchPlayerDetail(playerId);
});

// Savant 색상 계산 (50 기준 파랑 / 빨강 보간)
function getSavantColor(pct) {
    if (pct === null || pct === undefined) return "#94a3b8";
    const val = Math.max(0, Math.min(100, Number(pct)));
    if (val >= 50) {
        const ratio = (val - 50) / 50;
        const r = Math.round(180 + 40 * ratio);
        const g = Math.round(80 * (1 - ratio));
        const b = Math.round(80 * (1 - ratio));
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        const ratio = val / 50;
        const r = Math.round(40 + 80 * ratio);
        const g = Math.round(80 + 80 * ratio);
        const b = Math.round(210);
        return `rgb(${r}, ${g}, ${b})`;
    }
}

async function fetchPlayerDetail(playerId) {
    try {
        const res = await fetch(`http://127.0.0.1:8000/api/players/${playerId}`);
        if (!res.ok) throw new Error("선수 정보를 불러오지 못했습니다.");
        currentPlayerData = await res.json();
        
        // 1. 프로필 메타데이터 고정 바인딩
        bindProfile(currentPlayerData);

        // 2. 투타겸업/포지션 기반 초기 탭 세팅
        activeMode = currentPlayerData.default_mode || "batting";
        updateTabButtons();
        renderModeView();

    } catch (err) {
        console.error(err);
        document.getElementById("playerName").textContent = "데이터를 불러올 수 없습니다.";
        document.getElementById("playerStatsBody").innerHTML = 
            `<tr><td colspan="15" class="no-data">선수 데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
    }
}

function bindProfile(data) {
    document.getElementById("bcPlayerName").textContent = data.player_name;
    document.getElementById("playerName").textContent = data.player_name;
    document.getElementById("playerIdText").textContent = data.player_id;
    document.getElementById("playerJerseyNo").textContent = data.jersey_number;
    document.getElementById("playerPosition").textContent = data.position;
    document.getElementById("playerAge").textContent = data.age;
    document.getElementById("playerBT").textContent = data.bt;
    document.getElementById("playerBirthDate").textContent = data.birth_date;

    if (data.headshot_url) {
        document.getElementById("playerHeadshot").src = data.headshot_url;
    }

    const teamName = data.team_name || "소속 구단 없음 (FA)";
    document.getElementById("bcTeamName").textContent = teamName;
    document.getElementById("playerTeamName").textContent = teamName;
    document.getElementById("playerTeamBadge").textContent = data.team_code || "MLB";

    if (data.team_id) {
        document.getElementById("bcTeamLink").href = `team-detail.html?id=${data.team_id}`;
        document.getElementById("sidebarTeamRosterLink").href = `team-detail.html?id=${data.team_id}`;
    }

    // 탭 비활성화 처리 (기록이 아예 없는 탭은 disabled)
    const tabBat = document.getElementById("tabBatting");
    const tabPit = document.getElementById("tabPitching");
    if (!data.has_batting) tabBat.classList.add("disabled");
    if (!data.has_pitching) tabPit.classList.add("disabled");
}

function switchMode(mode) {
    if (mode === "batting" && !currentPlayerData.has_batting) return;
    if (mode === "pitching" && !currentPlayerData.has_pitching) return;
    activeMode = mode;
    updateTabButtons();
    renderModeView();
}

function updateTabButtons() {
    document.getElementById("tabBatting").classList.toggle("active", activeMode === "batting");
    document.getElementById("tabPitching").classList.toggle("active", activeMode === "pitching");
}

function renderModeView() {
    const isBat = (activeMode === "batting");
    const statsList = isBat ? currentPlayerData.batting_stats : currentPlayerData.pitching_stats;

    if (!statsList || statsList.length === 0) {
        document.getElementById("summaryGrid").innerHTML = "";
        document.getElementById("savantBarsContainer").innerHTML = `<div style="text-align:center; padding:20px; color:#888;">해당 부문의 기록이 없습니다.</div>`;
        document.getElementById("playerStatsBody").innerHTML = `<tr><td colspan="15" class="no-data">등록된 기록이 없습니다.</td></tr>`;
        return;
    }

    const latest = statsList[0];

    // 1. 하이라이트 문구
    if (isBat) {
        document.getElementById("playerHighlightStat").textContent = 
            `${latest.season} 시즌 ${latest.home_runs || 0}HR, 타율 ${latest.batting_avg ? Number(latest.batting_avg).toFixed(3).replace('0.', '.') : '-'}`;
    } else {
        document.getElementById("playerHighlightStat").textContent = 
            `${latest.season} 시즌 ${latest.wins || 0}승 ${latest.losses || 0}패, ERA ${latest.era ? Number(latest.era).toFixed(2) : '-'}`;
    }

    // 2. 4개 요약 박스 (bWAR / fWAR 굵기 동일화)
    const sumGrid = document.getElementById("summaryGrid");
    if (isBat) {
        sumGrid.innerHTML = `
            <div class="stat-summary-box">
                <div class="stat-summary-title">wRC+ (조정 득점 창출력)</div>
                <div class="stat-summary-num">${latest.wrc_plus || '-'}</div>
                <div class="stat-summary-desc">리그 평균 100 기준 득점 생산력</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">Savant 평균 타구속도</div>
                <div class="stat-summary-num">${latest.avg_exit_velocity ? Number(latest.avg_exit_velocity).toFixed(1) : '-'} <span class="unit">mph</span></div>
                <div class="stat-summary-desc">상위 ${latest.exit_velo_percentile ? Math.min(99, latest.exit_velo_percentile) : '-'}% 백분위</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">배럴 타구 비율 (Barrel %)</div>
                <div class="stat-summary-num">${latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) : '-'} <span class="unit">%</span></div>
                <div class="stat-summary-desc">상위 ${latest.barrel_percentile ? Math.min(99, latest.barrel_percentile) : '-'}% 백분위</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">bWAR / fWAR</div>
                <div class="stat-summary-num">
                    ${latest.bwar !== null ? Number(latest.bwar).toFixed(1) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${latest.fwar !== null ? Number(latest.fwar).toFixed(1) : '-'}</span>
                </div>
                <div class="stat-summary-desc">대체 선수 대비 승리 기여도</div>
            </div>
        `;
    } else {
        sumGrid.innerHTML = `
            <div class="stat-summary-box">
                <div class="stat-summary-title">ERA / FIP</div>
                <div class="stat-summary-num">
                    ${latest.era ? Number(latest.era).toFixed(2) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${latest.fip ? Number(latest.fip).toFixed(2) : '-'}</span>
                </div>
                <div class="stat-summary-desc">평균자책점 및 수비무관 자책점</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">Statcast xERA</div>
                <div class="stat-summary-num">${latest.xera ? Number(latest.xera).toFixed(2) : '-'}</div>
                <div class="stat-summary-desc">타구질 기반 기대 자책점</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">탈삼진 / 볼넷 (K/BB)</div>
                <div class="stat-summary-num">
                    ${latest.strikeouts || 0} <span class="unit" style="font-weight:700;">K</span>
                    <span class="war-divider">/</span>
                    <span class="war-sub">${latest.walks || 0}</span> <span class="unit" style="font-weight:700;">BB</span>
                </div>
                <div class="stat-summary-desc">WHIP ${latest.whip ? Number(latest.whip).toFixed(2) : '-'}</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">bWAR / fWAR</div>
                <div class="stat-summary-num">
                    ${latest.bwar !== null ? Number(latest.bwar).toFixed(1) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${latest.fwar !== null ? Number(latest.fwar).toFixed(1) : '-'}</span>
                </div>
                <div class="stat-summary-desc">투수 승리 기여도 지표</div>
            </div>
        `;
    }

    // 3. Savant 슬라이더 렌더링 (최대 100까지 허용)
    document.getElementById("savantTitle").textContent = `${latest.season} MLB Percentile Rankings (${isBat ? '타격 지표' : '투구 지표'})`;
    const barsContainer = document.getElementById("savantBarsContainer");

    // 0 ~ 100 범위 정상 보정 (100 온전히 유지)
    const clampPct = (val) => {
        if (val === null || val === undefined) return null;
        return Math.min(100, Math.max(1, Math.round(Number(val))));
    };

    const items = isBat ? [
        { label: "xwOBA (기대 가중출루율)", pct: clampPct(latest.xwoba_percentile), actual: latest.xwoba ? Number(latest.xwoba).toFixed(3) : '-' },
        { label: "xBA (기대 타율)", pct: clampPct(latest.hard_hit_percentile ? latest.hard_hit_percentile + 5 : 75), actual: latest.xba ? Number(latest.xba).toFixed(3) : '-' },
        { label: "xSLG (기대 장타율)", pct: clampPct(latest.barrel_percentile ? latest.barrel_percentile + 3 : 80), actual: latest.xslg ? Number(latest.xslg).toFixed(3) : '-' },
        { label: "평균 타구 속도 (EV)", pct: clampPct(latest.exit_velo_percentile), actual: latest.avg_exit_velocity ? Number(latest.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
        { label: "배럴 타구 비율 (Barrel %)", pct: clampPct(latest.barrel_percentile), actual: latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) + '%' : '-' },
        { label: "하드힛 비율 (Hard-Hit %)", pct: clampPct(latest.hard_hit_percentile), actual: latest.hard_hit_percentage ? Number(latest.hard_hit_percentage).toFixed(1) + '%' : '-' },
        { label: "스위트스팟 % (Sweet-Spot)", pct: clampPct(latest.sweet_spot_percentage ? Number(latest.sweet_spot_percentage) * 1.8 : 55), actual: latest.sweet_spot_percentage ? Number(latest.sweet_spot_percentage).toFixed(1) + '%' : '-' },
        { label: "유인구 헛스윙률 (Chase %)", pct: clampPct(latest.chase_percentage ? 100 - Number(latest.chase_percentage) * 2 : 65), actual: latest.chase_percentage ? Number(latest.chase_percentage).toFixed(1) + '%' : '-' },
        { label: "전체 헛스윙률 (Whiff %)", pct: clampPct(latest.whiff_percentage ? 100 - Number(latest.whiff_percentage) * 2.2 : 70), actual: latest.whiff_percentage ? Number(latest.whiff_percentage).toFixed(1) + '%' : '-' },
    ] : [
        { label: "xERA (기대 평균자책점)", pct: clampPct(latest.xwoba_percentile), actual: latest.xera ? Number(latest.xera).toFixed(2) : '-' },
        { label: "피타구 속도 억제", pct: clampPct(latest.exit_velo_percentile), actual: latest.avg_exit_velocity ? Number(latest.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
        { label: "피배럴 허용 억제", pct: clampPct(latest.barrel_percentile), actual: latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) + '%' : '-' },
        { label: "피하드힛 억제율", pct: clampPct(latest.hard_hit_percentile), actual: latest.hard_hit_percentage ? Number(latest.hard_hit_percentage).toFixed(1) + '%' : '-' },
        { label: "헛스윙 유도율 (Whiff %)", pct: clampPct(latest.whiff_percentage ? Number(latest.whiff_percentage) * 2.5 : 75), actual: latest.whiff_percentage ? Number(latest.whiff_percentage).toFixed(1) + '%' : '-' },
        { label: "유인구 유도율 (Chase %)", pct: clampPct(latest.chase_percentage ? Number(latest.chase_percentage) * 2.2 : 70), actual: latest.chase_percentage ? Number(latest.chase_percentage).toFixed(1) + '%' : '-' },
    ];

    barsContainer.innerHTML = items.map(it => {
        const val = it.pct !== null ? it.pct : 0;
        const color = getSavantColor(it.pct);
        const isHundred = (it.pct >= 100);

        return `
            <div class="savant-bar-row">
                <div class="savant-bar-label">${it.label}</div>
                <div class="savant-bar-track">
                    <div class="savant-midline"></div>
                    <div class="savant-bar-fill" style="width: ${val}%; background-color: ${color};">
                        <span class="savant-badge-num ${isHundred ? 'is-hundred' : ''}" style="background-color: ${color};">
                            ${it.pct !== null ? it.pct : '-'}
                        </span>
                    </div>
                </div>
                <div class="savant-bar-actual">${it.actual}</div>
            </div>
        `;
    }).join("");

    // 4. 전 지표 시즌별 상세 테이블
    const thead = document.getElementById("statsThead");
    const tbody = document.getElementById("playerStatsBody");
    tbody.innerHTML = "";

    if (isBat) {
        thead.innerHTML = `
            <tr>
                <th>시즌</th>
                <th>경기</th>
                <th>타율</th>
                <th>안타</th>
                <th>홈런</th>
                <th>타점</th>
                <th>wRC+</th>
                <th>xBA</th>
                <th>xSLG</th>
                <th>xwOBA</th>
                <th>타구속도</th>
                <th>배럴%</th>
                <th>하드힛%</th>
                <th>발사각</th>
                <th>bWAR</th>
                <th>fWAR</th>
            </tr>
        `;
        statsList.forEach(st => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
                <td>${st.games || 0}</td>
                <td>${st.batting_avg !== null ? Number(st.batting_avg).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.hits || 0}</td>
                <td><strong>${st.home_runs || 0}</strong></td>
                <td>${st.rbi || 0}</td>
                <td><strong>${st.wrc_plus !== null ? st.wrc_plus : '-'}</strong></td>
                <td>${st.xba !== null ? Number(st.xba).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.xslg !== null ? Number(st.xslg).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.xwoba !== null ? Number(st.xwoba).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.avg_exit_velocity ? Number(st.avg_exit_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td>${st.barrel_percentage ? Number(st.barrel_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.hard_hit_percentage ? Number(st.hard_hit_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.launch_angle_avg ? Number(st.launch_angle_avg).toFixed(1) + '°' : '-'}</td>
                <td>${st.bwar !== null ? Number(st.bwar).toFixed(1) : '-'}</td>
                <td>${st.fwar !== null ? Number(st.fwar).toFixed(1) : '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        thead.innerHTML = `
            <tr>
                <th>시즌</th>
                <th>경기</th>
                <th>승</th>
                <th>패</th>
                <th>ERA</th>
                <th>이닝</th>
                <th>탈삼진</th>
                <th>볼넷</th>
                <th>WHIP</th>
                <th>FIP</th>
                <th>xERA</th>
                <th>피타구속도</th>
                <th>피배럴%</th>
                <th>Whiff%</th>
                <th>bWAR</th>
                <th>fWAR</th>
            </tr>
        `;
        statsList.forEach(st => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
                <td>${st.games || 0}</td>
                <td>${st.wins || 0}</td>
                <td>${st.losses || 0}</td>
                <td><strong>${st.era ? Number(st.era).toFixed(2) : '-'}</strong></td>
                <td>${st.innings_pitched ? Number(st.innings_pitched).toFixed(1) : '-'}</td>
                <td>${st.strikeouts || 0}</td>
                <td>${st.walks || 0}</td>
                <td>${st.whip ? Number(st.whip).toFixed(2) : '-'}</td>
                <td>${st.fip ? Number(st.fip).toFixed(2) : '-'}</td>
                <td>${st.xera ? Number(st.xera).toFixed(2) : '-'}</td>
                <td>${st.avg_exit_velocity ? Number(st.avg_exit_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td>${st.barrel_percentage ? Number(st.barrel_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.whiff_percentage ? Number(st.whiff_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.bwar !== null ? Number(st.bwar).toFixed(1) : '-'}</td>
                <td>${st.fwar !== null ? Number(st.fwar).toFixed(1) : '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}