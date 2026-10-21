let currentPlayerData = null;
let activeMode = "batting"; // 'batting' or 'pitching'
let selectedSeason = null;  // 현재 선택된 시즌 연도

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const playerId = urlParams.get("id") || "660271"; // 기본: 오타니 쇼헤이
    const initialSeason = urlParams.get("season");
    if (initialSeason) {
        selectedSeason = Number(initialSeason);
    }
    fetchPlayerDetail(playerId);
    const btnDl = document.getElementById("btnRunDlPredict");
    const selSeason = document.getElementById("dlTargetSeasonSelect");
    const selScen = document.getElementById("dlScenarioSelect");
    if (btnDl) btnDl.addEventListener("click", loadDlPrediction);
    if (selSeason) selSeason.addEventListener("change", loadDlPrediction);
    if (selScen) selScen.addEventListener("change", loadDlPrediction);
});

// ★ Baseball Savant 공식 다중 스펙트럼 컬러맵 (재즈 치좀 주니어 그래프 색상 100% 재현)
function getSavantColor(pct) {
    if (pct === null || pct === undefined) return "#94a3b8";
    const val = Math.max(1, Math.min(100, Number(pct)));

    // Savant 실제 컬러 스톱 (Pct: [R, G, B])
    const stops = [
        { p: 1,   rgb: [43, 76, 126] },   // 1~10: 딥 네이비 블루 (K% 9, xBA 7)
        { p: 20,  rgb: [86, 113, 153] },  // 15~25: 미드 블루 (xwOBA 16, xSLG 24)
        { p: 35,  rgb: [132, 152, 176] }, // 30~40: 라이트 슬레이트 블루 (Squared-Up 33)
        { p: 50,  rgb: [168, 179, 184] }, // 48~55: 뉴트럴 쿨 그레이 (Chase% 52, Barrel% 53)
        { p: 60,  rgb: [182, 171, 167] }, // 58~63: 웜 그레이 브라운 (Hard-Hit% 62)
        { p: 72,  rgb: [197, 150, 138] }, // 68~76: 더스티 로즈 / 테라코타 (BB% 69, Exit Velo 73, Sprint 75)
        { p: 85,  rgb: [204, 96, 84] },   // 82~88: 코랄 레드 (Fielding 85)
        { p: 100, rgb: [198, 45, 40] }    // 95~100: 크림슨 딥 레드 (Baserunning 96, Range 98)
    ];

    for (let i = 0; i < stops.length - 1; i++) {
        const s1 = stops[i];
        const s2 = stops[i + 1];
        if (val >= s1.p && val <= s2.p) {
            const ratio = (val - s1.p) / (s2.p - s1.p);
            const r = Math.round(s1.rgb[0] + (s2.rgb[0] - s1.rgb[0]) * ratio);
            const g = Math.round(s1.rgb[1] + (s2.rgb[1] - s1.rgb[1]) * ratio);
            const b = Math.round(s1.rgb[2] + (s2.rgb[2] - s1.rgb[2]) * ratio);
            return `rgb(${r}, ${g}, ${b})`;
        }
    }
    return "rgb(168, 179, 184)";
}

async function fetchPlayerDetail(playerId) {
    try {
        const res = await fetch(`http://127.0.0.1:8000/api/players/${playerId}`);
        if (!res.ok) throw new Error("선수 정보를 불러오지 못했습니다.");
        currentPlayerData = await res.json();

        bindProfile(currentPlayerData);

        activeMode = currentPlayerData.default_mode || "batting";
        updateTabButtons();
        syncSeasonSelector();
        renderModeView();

    } catch (err) {
        console.error(err);
        document.getElementById("playerName").textContent = "데이터를 불러올 수 없습니다.";
        document.getElementById("playerStatsBody").innerHTML = 
            `<tr><td colspan="20" class="no-data">선수 데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
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

    // ★ 키/몸무게 (cm/kg & ft-in/lbs 병기) 바인딩
    const physEl = document.getElementById("playerPhysical");
    if (physEl) {
        physEl.textContent = data.physical_display || "-";
    }

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

    const tabBat = document.getElementById("tabBatting");
    const tabPit = document.getElementById("tabPitching");
    if (!data.has_batting) tabBat.classList.add("disabled");
    if (!data.has_pitching) tabPit.classList.add("disabled");
}

// 현재 모드(타격/투구)에 존재하는 시즌 목록으로 드롭다운 동기화
function syncSeasonSelector() {
    const isBat = (activeMode === "batting");
    const statsList = isBat ? currentPlayerData.batting_stats : currentPlayerData.pitching_stats;
    const selectEl = document.getElementById("playerSeasonSelect");
    if (!selectEl) return;

    selectEl.innerHTML = "";
    if (!statsList || statsList.length === 0) {
        selectEl.innerHTML = `<option value="">기록 없음</option>`;
        selectedSeason = null;
        return;
    }

    const modeSeasons = statsList.map(s => Number(s.season));
    modeSeasons.forEach(yr => {
        const opt = new Option(`${yr} 시즌`, yr);
        selectEl.add(opt);
    });

    // 기존 선택된 시즌이 현재 탭에도 있으면 유지, 없으면 최신 시즌(첫 번째)으로 설정
    if (!selectedSeason || !modeSeasons.includes(Number(selectedSeason))) {
        selectedSeason = modeSeasons[0];
    }
    selectEl.value = String(selectedSeason);
}

function onSeasonChange(seasonVal) {
    if (!seasonVal) return;
    selectedSeason = Number(seasonVal);
    const selectEl = document.getElementById("playerSeasonSelect");
    if (selectEl) selectEl.value = String(selectedSeason);
    renderModeView();
}

function switchMode(mode) {
    if (mode === "batting" && !currentPlayerData.has_batting) return;
    if (mode === "pitching" && !currentPlayerData.has_pitching) return;
    activeMode = mode;
    updateTabButtons();
    syncSeasonSelector();
    renderModeView();
}

function updateTabButtons() {
    document.getElementById("tabBatting").classList.toggle("active", activeMode === "batting");
    document.getElementById("tabPitching").classList.toggle("active", activeMode === "pitching");
}

function formatSourcedStat(stat, metric, decimals = null) {
    const value = stat?.[metric];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    const origin = stat.stat_sources?.[metric];
    const status = ['published', 'estimated'].includes(origin?.status) ? origin.status : 'unknown';
    const label = status === 'unknown' ? '원본 미확보 · 기존 값 유지' : origin.label;
    const safeLabel = String(label).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    const number = decimals === null ? Number(value) : Number(value).toFixed(decimals);
    return `<span class="sourced-stat">${number}<small class="stat-source-label is-${status}">${safeLabel}</small></span>`;
}


function renderModeView() {
    const isBat = (activeMode === "batting");
    const statsList = isBat ? currentPlayerData.batting_stats : currentPlayerData.pitching_stats;

    if (!statsList || statsList.length === 0) {
        document.getElementById("summaryGrid").innerHTML = "";
        document.getElementById("savantBarsContainer").innerHTML = `<div style="text-align:center; padding:20px; color:#888;">해당 부문의 기록이 없습니다.</div>`;
        document.getElementById("playerStatsBody").innerHTML = `<tr><td colspan="20" class="no-data">등록된 기록이 없습니다.</td></tr>`;
        return;
    }

    // ★ 선택된 시즌 데이터 찾기 (없으면 최신 시즌 fallback)
    const targetStat = statsList.find(s => Number(s.season) === Number(selectedSeason)) || statsList[0];

    // 1. 프로필 주요 성적 요약 (선택된 시즌 기준)
    if (isBat) {
        const sbText = targetStat.stolen_bases !== null ? `, ${targetStat.stolen_bases}SB` : '';
        const avgText = targetStat.batting_avg !== null ? Number(targetStat.batting_avg).toFixed(3).replace('0.', '.') : '-';
        document.getElementById("playerHighlightStat").textContent = 
            `${targetStat.season} 시즌 (${targetStat.season_team_code || 'MLB'}) ${targetStat.home_runs || 0}HR${sbText}, 타율 ${avgText}`;
    } else {
        const eraText = targetStat.era !== null ? Number(targetStat.era).toFixed(2) : '-';
        document.getElementById("playerHighlightStat").textContent = 
            `${targetStat.season} 시즌 (${targetStat.season_team_code || 'MLB'}) ${targetStat.wins || 0}승 ${targetStat.losses || 0}패, ERA ${eraText}`;
    }

    // 2. 4대 핵심 지표 요약 카드 (선택된 시즌 기준)
    const sumGrid = document.getElementById("summaryGrid");
    if (isBat) {
        sumGrid.innerHTML = `
            <div class="stat-summary-box">
                <div class="stat-summary-title">${targetStat.season} wRC+ (득점 창출력)</div>
                <div class="stat-summary-num">${formatSourcedStat(targetStat, 'wrc_plus')}</div>
                <div class="stat-summary-desc">리그 평균 100 기준 득점 생산력</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">Savant 평균 타구속도</div>
                <div class="stat-summary-num">${targetStat.avg_exit_velocity ? Number(targetStat.avg_exit_velocity).toFixed(1) : '-'} <span class="unit">mph</span></div>
                <div class="stat-summary-desc">상위 ${targetStat.exit_velo_percentile || '-'}% 백분위</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">배럴 타구 비율 (Barrel %)</div>
                <div class="stat-summary-num">${targetStat.barrel_percentage ? Number(targetStat.barrel_percentage).toFixed(1) : '-'} <span class="unit">%</span></div>
                <div class="stat-summary-desc">상위 ${targetStat.barrel_percentile || '-'}% 백분위</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">${targetStat.season} bWAR / fWAR</div>
                <div class="stat-summary-num stat-summary-war">
                    ${formatSourcedStat(targetStat, 'bwar', 1)}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${formatSourcedStat(targetStat, 'fwar', 1)}</span>
                </div>
                <div class="stat-summary-desc">대체 선수 대비 승리 기여도</div>
            </div>
        `;
    } else {
        sumGrid.innerHTML = `
            <div class="stat-summary-box">
                <div class="stat-summary-title">${targetStat.season} ERA / FIP</div>
                <div class="stat-summary-num">
                    ${targetStat.era ? Number(targetStat.era).toFixed(2) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${targetStat.fip ? Number(targetStat.fip).toFixed(2) : '-'}</span>
                </div>
                <div class="stat-summary-desc">평균자책점 및 수비무관 자책점</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">Statcast xERA</div>
                <div class="stat-summary-num">${targetStat.xera ? Number(targetStat.xera).toFixed(2) : '-'}</div>
                <div class="stat-summary-desc">타구질 기반 기대 자책점</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">탈삼진 / 볼넷 (K/BB)</div>
                <div class="stat-summary-num">
                    ${targetStat.strikeouts || 0} <span class="unit" style="font-weight:700;">K</span>
                    <span class="war-divider">/</span>
                    <span class="war-sub">${targetStat.walks || 0}</span> <span class="unit" style="font-weight:700;">BB</span>
                </div>
                <div class="stat-summary-desc">WHIP ${targetStat.whip ? Number(targetStat.whip).toFixed(2) : '-'}</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">${targetStat.season} bWAR / fWAR</div>
                <div class="stat-summary-num stat-summary-war">
                    ${formatSourcedStat(targetStat, 'bwar', 1)}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${formatSourcedStat(targetStat, 'fwar', 1)}</span>
                </div>
                <div class="stat-summary-desc">투수 승리 기여도 지표</div>
            </div>
        `;
    }

   // 3. Savant 4대 카테고리 시각화 (다중 색상 + 규정 미달 시 Savant 스타일 빗금 막대 지원)
    document.getElementById("savantTitle").textContent = `${targetStat.season} MLB Percentile Rankings (${targetStat.season_team_code || 'MLB'})`;
    const barsContainer = document.getElementById("savantBarsContainer");

    const renderBar = (it) => {
        if (it.pct === null || it.pct === undefined) {
            return `
                <div class="savant-bar-row">
                    <div class="savant-bar-label">${it.label}</div>
                    <div class="savant-bar-track is-nq">
                        <span class="savant-nq-text">NOT QUALIFIED</span>
                    </div>
                    <div class="savant-bar-actual">${it.actual}</div>
                </div>
            `;
        }

        const val = Math.min(100, Math.max(1, Math.round(Number(it.pct))));
        const color = getSavantColor(val);
        const isHundred = (val >= 100);

        return `
            <div class="savant-bar-row">
                <div class="savant-bar-label">${it.label}</div>
                <div class="savant-bar-track">
                    <div class="savant-midline"></div>
                    <div class="savant-bar-fill" style="width: ${val}%; background-color: ${color};">
                        <span class="savant-badge-num ${isHundred ? 'is-hundred' : ''}" style="background-color: ${color};">
                            ${val}
                        </span>
                    </div>
                </div>
                <div class="savant-bar-actual">${it.actual}</div>
            </div>
        `;
    };

    let groupsHtml = "";

    if (isBat) {
        const valueItems = [
            { label: "Batting Run Value", pct: targetStat.batting_run_value_percentile, actual: targetStat.batting_run_value !== null && targetStat.batting_run_value !== undefined ? targetStat.batting_run_value : '-' },
            { label: "Baserunning Run Value", pct: targetStat.baserunning_run_value_percentile, actual: targetStat.baserunning_run_value !== null && targetStat.baserunning_run_value !== undefined ? targetStat.baserunning_run_value : '-' },
            {
                label: "Fielding Run Value",
                pct: targetStat.fielding_run_value_percentile,
                actual: targetStat.fielding_run_value ?? '-'
            }
            // { label: "Fielding Run Value", pct: targetStat.oaa_percentile, actual: targetStat.outs_above_average !== null && targetStat.outs_above_average !== undefined ? targetStat.outs_above_average : '-' }
        ];

        const battingItems = [
            { label: "xwOBA (기대 가중출루율)", pct: targetStat.xwoba_percentile, actual: targetStat.xwoba ? Number(targetStat.xwoba).toFixed(3) : '-' },
            { label: "xBA (기대 타율)", pct: targetStat.xba_percentile, actual: targetStat.xba ? Number(targetStat.xba).toFixed(3) : '-' },
            { label: "xSLG (기대 장타율)", pct: targetStat.xslg_percentile, actual: targetStat.xslg ? Number(targetStat.xslg).toFixed(3) : '-' },
            { label: "Avg Exit Velo (평균 타구속도)", pct: targetStat.exit_velo_percentile, actual: targetStat.avg_exit_velocity ? Number(targetStat.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Barrel % (배럴 타구 비율)", pct: targetStat.barrel_percentile, actual: targetStat.barrel_percentage ? Number(targetStat.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (하드힛 비율)", pct: targetStat.hard_hit_percentile, actual: targetStat.hard_hit_percentage ? Number(targetStat.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "LA Sweet-Spot % (스위트스팟)", pct: targetStat.sweet_spot_percentile, actual: targetStat.sweet_spot_percentage ? Number(targetStat.sweet_spot_percentage).toFixed(1) + '%' : '-' },
            { label: "Bat Speed (배트 스피드)", pct: targetStat.bat_speed_percentile, actual: targetStat.bat_speed != null ? Number(targetStat.bat_speed).toFixed(1) + ' mph' : '-' },
            { label: "Squared-Up % (정타 비율)", pct: targetStat.squared_up_percentile, actual: targetStat.squared_up_percentage != null ? Number(targetStat.squared_up_percentage).toFixed(1) + '%' : '-' },
            { label: "Chase % (유인구 헛스윙률)", pct: targetStat.chase_percentile, actual: targetStat.chase_percentage ? Number(targetStat.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (전체 헛스윙률)", pct: targetStat.whiff_percentile, actual: targetStat.whiff_percentage ? Number(targetStat.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (삼진율)", pct: targetStat.k_percentile, actual: targetStat.k_percentage ? Number(targetStat.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷율)", pct: targetStat.bb_percentile, actual: targetStat.bb_percentage ? Number(targetStat.bb_percentage).toFixed(1) + '%' : '-' }
        ];

        const fieldingItems = [
            { label: "Range (OAA)", pct: targetStat.oaa_percentile, actual: targetStat.outs_above_average !== null && targetStat.outs_above_average !== undefined ? targetStat.outs_above_average : '-' },
            { label: "Arm Value (외야 송구 가치)", pct: targetStat.arm_value_percentile, actual: targetStat.arm_value ?? '-' },
            { label: "Arm Strength (송구 강도)", pct: targetStat.arm_strength_percentile, actual: targetStat.arm_strength ? Number(targetStat.arm_strength).toFixed(1) + ' mph' : '-' }
        ];

        // ★ 포수(Position == 'C')이거나 포수 수비 기록이 존재하는 경우 Catching 섹션 동적 렌더링
        const isCatcher = (currentPlayerData.position === "C") ||
            targetStat.blocks_above_average !== null && targetStat.blocks_above_average !== undefined ||
            targetStat.framing_runs !== null && targetStat.framing_runs !== undefined ||
            targetStat.pop_time !== null && targetStat.pop_time !== undefined;

        let catchingHtml = "";
        if (isCatcher) {
            const catchingItems = [
                { label: "Blocks Above Avg (블로킹)", pct: targetStat.blocks_above_average_percentile, actual: targetStat.blocks_above_average !== null && targetStat.blocks_above_average !== undefined ? targetStat.blocks_above_average : '-' },
                { label: "CS Above Avg (도루 저지)", pct: targetStat.cs_above_average_percentile, actual: targetStat.cs_above_average !== null && targetStat.cs_above_average !== undefined ? targetStat.cs_above_average : '-' },
                { label: "Framing (프레이밍)", pct: targetStat.framing_runs_percentile, actual: targetStat.framing_runs !== null && targetStat.framing_runs !== undefined ? targetStat.framing_runs : '-' },
                { label: "Pop Time (2루 팝타임)", pct: targetStat.pop_time_percentile, actual: targetStat.pop_time ? Number(targetStat.pop_time).toFixed(2) + ' s' : '-' }
            ];
            catchingHtml = `
                <div class="savant-group-header">😷 Catching</div>
                ${catchingItems.map(renderBar).join("")}
            `;
        }

        const runningItems = [
            { label: "Sprint Speed", pct: targetStat.sprint_speed_percentile, actual: targetStat.sprint_speed ? Number(targetStat.sprint_speed).toFixed(1) + ' ft/s' : '-' }
        ];

        groupsHtml = `
            <div class="savant-group-header">🏆 Value</div>
            ${valueItems.map(renderBar).join("")}
            <div class="savant-group-header">⚾ Batting</div>
            ${battingItems.map(renderBar).join("")}
            <div class="savant-group-header">🧤 Fielding</div>
            ${fieldingItems.map(renderBar).join("")}
            ${catchingHtml}
            <div class="savant-group-header">🏃 Running</div>
            ${runningItems.map(renderBar).join("")}
        `;

    } else {
        // ★ 투수(Pitching) 모드: 제이콥 디그롬 Savant 원본과 100% 동일한 구성
        const valueItems = [
            { label: "Pitching Run Value", pct: targetStat.pitching_run_value_percentile, actual: targetStat.pitching_run_value !== null && targetStat.pitching_run_value !== undefined ? targetStat.pitching_run_value : '-' },
            { label: "Fastball Run Value (속구 가치)", pct: targetStat.fastball_run_value_percentile, actual: targetStat.fastball_run_value !== null && targetStat.fastball_run_value !== undefined ? targetStat.fastball_run_value : '-' },
            { label: "Breaking Run Value (변화구 가치)", pct: targetStat.breaking_run_value_percentile, actual: targetStat.breaking_run_value !== null && targetStat.breaking_run_value !== undefined ? targetStat.breaking_run_value : '-' },
            { label: "Offspeed Run Value (오프스피드)", pct: targetStat.offspeed_run_value_percentile, actual: targetStat.offspeed_run_value !== null && targetStat.offspeed_run_value !== undefined ? targetStat.offspeed_run_value : '-' }
        ];

        const pitchingItems = [
            { label: "xERA (기대 평균자책점)", pct: targetStat.xwoba_percentile, actual: targetStat.xera ? Number(targetStat.xera).toFixed(2) : '-' },
            { label: "xBA (피기대타율)", pct: targetStat.xba_percentile, actual: targetStat.xba ? Number(targetStat.xba).toFixed(3).replace('0.', '.') : '-' },
            { label: "Fastball Velo (포심 평균구속)", pct: targetStat.fastball_velo_percentile, actual: targetStat.fastball_velocity ? Number(targetStat.fastball_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Avg Exit Velo (피타구속도 억제)", pct: targetStat.exit_velo_percentile, actual: targetStat.avg_exit_velocity ? Number(targetStat.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Chase % (유인구 유도율)", pct: targetStat.chase_percentile, actual: targetStat.chase_percentage ? Number(targetStat.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (헛스윙 유도율)", pct: targetStat.whiff_percentile, actual: targetStat.whiff_percentage ? Number(targetStat.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (탈삼진 비율)", pct: targetStat.k_percentile, actual: targetStat.k_percentage ? Number(targetStat.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷 억제율)", pct: targetStat.bb_percentile, actual: targetStat.bb_percentage ? Number(targetStat.bb_percentage).toFixed(1) + '%' : '-' },
            { label: "Barrel % (피배럴 억제)", pct: targetStat.barrel_percentile, actual: targetStat.barrel_percentage ? Number(targetStat.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (피하드힛 억제)", pct: targetStat.hard_hit_percentile, actual: targetStat.hard_hit_percentage ? Number(targetStat.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "GB % (땅볼 유도율)", pct: targetStat.gb_percentile, actual: targetStat.gb_percentage ? Number(targetStat.gb_percentage).toFixed(1) + '%' : '-' },
            { label: "Extension (릴리스 익스텐션)", pct: targetStat.extension_percentile, actual: targetStat.pitch_extension ? Number(targetStat.pitch_extension).toFixed(1) + ' ft' : '-' }
        ];

        groupsHtml = `
            <div class="savant-group-header">🏆 Value</div>
            ${valueItems.map(renderBar).join("")}
            <div class="savant-group-header">⚾ Pitching</div>
            ${pitchingItems.map(renderBar).join("")}
        `;
    }

    barsContainer.innerHTML = groupsHtml;

    // 4. 하단 시즌별 누적 기록 테이블 (배트스피드, 정타%, 피xBA, 땅볼%, 익스텐션 등 반영)
    const thead = document.getElementById("statsThead");
    const tbody = document.getElementById("playerStatsBody");
    tbody.innerHTML = "";

    if (isBat) {
        thead.innerHTML = `
            <tr>
                <th>시즌</th>
                <th>소속팀</th>
                <th>경기</th>
                <th>안타</th>
                <th>홈런</th>
                <th>타점</th>
                <th>도루</th>
                <th>볼넷</th>
                <th>삼진</th>
                <th>타율</th>
                <th>출루율</th>
                <th>장타율</th>
                <th>OPS</th>
                <th>wRC+</th>
                <th>xBA</th>
                <th>xSLG</th>
                <th>xwOBA</th>
                <th>타구속도</th>
                <th>배트스피드</th>
                <th>정타%</th>
                <th>배럴%</th>
                <th>스프린트</th>
                <th>OAA</th>
                <th>bWAR</th>
                <th>fWAR</th>
            </tr>
        `;
        const fmtSlash = v => (v !== null && v !== undefined) ? Number(v).toFixed(3).replace(/^0\./, '.') : '-';
        statsList.forEach(st => {
            const tr = document.createElement("tr");
            const isSelected = Number(st.season) === Number(targetStat.season);
            tr.className = `clickable-season-row ${isSelected ? 'active-season-row' : ''}`;
            tr.title = `${st.season} 시즌 상세 지표 보기`;
            tr.onclick = () => onSeasonChange(st.season);

            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
                <td><span class="season-team-badge">${st.season_team_code || '-'}</span></td>
                <td>${st.games || 0}</td>
                <td>${st.hits || 0}</td>
                <td><strong>${st.home_runs || 0}</strong></td>
                <td>${st.rbi || 0}</td>
                <td><strong>${st.stolen_bases !== null ? st.stolen_bases : '-'}</strong></td>
                <td>${st.walks || 0}</td>
                <td>${st.strikeouts || 0}</td>
                <td><strong>${fmtSlash(st.batting_avg)}</strong></td>
                <td>${fmtSlash(st.obp)}</td>
                <td>${fmtSlash(st.slg)}</td>
                <td><strong>${fmtSlash(st.ops)}</strong></td>
                <td><strong>${formatSourcedStat(st, 'wrc_plus')}</strong></td>
                <td>${fmtSlash(st.xba)}</td>
                <td>${fmtSlash(st.xslg)}</td>
                <td>${fmtSlash(st.xwoba)}</td>
                <td>${st.avg_exit_velocity ? Number(st.avg_exit_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td><strong>${st.bat_speed != null ? Number(st.bat_speed).toFixed(1) + ' mph' : '-'}</strong></td>
                <td>${st.squared_up_percentage != null ? Number(st.squared_up_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.barrel_percentage ? Number(st.barrel_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.sprint_speed ? Number(st.sprint_speed).toFixed(1) : '-'}</td>
                <td>${st.outs_above_average !== null ? st.outs_above_average : '-'}</td>
                <td>${formatSourcedStat(st, 'bwar', 1)}</td>
                <td>${formatSourcedStat(st, 'fwar', 1)}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        thead.innerHTML = `
            <tr>
                <th>시즌</th>
                <th>소속팀</th>
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
                <th>피xBA</th>
                <th>구속</th>
                <th>피타구속도</th>
                <th>피배럴%</th>
                <th>Whiff%</th>
                <th>땅볼%</th>
                <th>익스텐션</th>
                <th>bWAR</th>
                <th>fWAR</th>
            </tr>
        `;
        statsList.forEach(st => {
            const tr = document.createElement("tr");
            const isSelected = Number(st.season) === Number(targetStat.season);
            tr.className = `clickable-season-row ${isSelected ? 'active-season-row' : ''}`;
            tr.title = `${st.season} 시즌 상세 지표 보기`;
            tr.onclick = () => onSeasonChange(st.season);

            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
                <td><span class="season-team-badge">${st.season_team_code || '-'}</span></td>
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
                <td>${st.xba ? Number(st.xba).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.fastball_velocity ? Number(st.fastball_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td>${st.avg_exit_velocity ? Number(st.avg_exit_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td>${st.barrel_percentage ? Number(st.barrel_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.whiff_percentage ? Number(st.whiff_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.gb_percentage ? Number(st.gb_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.pitch_extension ? Number(st.pitch_extension).toFixed(1) + ' ft' : '-'}</td>
                <td>${formatSourcedStat(st, 'bwar', 1)}</td>
                <td>${formatSourcedStat(st, 'fwar', 1)}</td>
            `;
            tbody.appendChild(tr);
            syncDlSeasonSelector();
            loadDlPrediction();
        });
    }
}

// ★ 선수의 DB 보유 시즌을 기반으로 [미래 예측(+1~+3년)] + [과거 백테스트(보유 전 시즌)] 드롭다운 동적 생성
function syncDlSeasonSelector() {
    const dlSelect = document.getElementById("dlTargetSeasonSelect");
    if (!dlSelect || !currentPlayerData) return;

    const isBat = (activeMode === "batting");
    const statsList = isBat ? currentPlayerData.batting_stats : currentPlayerData.pitching_stats;
    if (!statsList || statsList.length === 0) {
        dlSelect.innerHTML = `<option value="">데이터 없음</option>`;
        return;
    }

    const prevSelected = dlSelect.value ? Number(dlSelect.value) : null;

    // 보유 시즌 정렬 (내림차순, 예: [2025, 2024, 2023, ...])
    const ownedSeasons = [...new Set(statsList.map(s => Number(s.season)))].sort((a, b) => b - a);
    const maxSeason = ownedSeasons[0]; // 데이터가 존재하는 가장 최근 시즌
    const minSeason = ownedSeasons[ownedSeasons.length - 1];

    dlSelect.innerHTML = "";

    // 1) 미래 예측 그룹: 가장 최근 데이터 시즌 +1년 ~ +3년 자동 생성
    const futureGroup = document.createElement("optgroup");
    futureGroup.label = `🔮 미래 시즌 성적 예측 (${maxSeason}년 데이터 기반)`;
    for (let yr = maxSeason + 1; yr <= maxSeason + 3; yr++) {
        const tag = (yr === maxSeason + 1) ? "차기 시즌 예측" : `+${yr - maxSeason}년 후 장기 예측`;
        const opt = new Option(`${yr} 시즌 (${tag})`, yr);
        futureGroup.appendChild(opt);
    }
    dlSelect.appendChild(futureGroup);

    // 2) 과거 백테스트 그룹: 데이터가 존재하는 모든 시즌과 비교 가능
    const pastGroup = document.createElement("optgroup");
    pastGroup.label = `🎯 과거 시즌 백테스트 (AI 예측 vs 실제 성적 비교)`;
    ownedSeasons.forEach(yr => {
        const desc = (yr > minSeason)
            ? `이전 시즌 기록 기반 예측 vs 실제 비교`
            : `단일 시즌 기대지표(xStats) vs 실제 비교`;
        const opt = new Option(`${yr} 시즌 (${desc})`, yr);
        pastGroup.appendChild(opt);
    });
    dlSelect.appendChild(pastGroup);

    // 이전에 선택한 연도가 새 옵션 목록에 존재하면 유지하고, 없으면 기본값(maxSeason + 1) 선택
    const allOptionValues = Array.from(dlSelect.options).map(o => Number(o.value));
    if (prevSelected && allOptionValues.includes(prevSelected)) {
        dlSelect.value = String(prevSelected);
    } else {
        dlSelect.value = String(maxSeason + 1);
    }
}

async function loadDlPrediction() {
    if (!currentPlayerData || !currentPlayerData.player_id) return;
    const gridEl = document.getElementById("dlPredCardsGrid");
    const insightEl = document.getElementById("dlPredInsightBox");
    if (!gridEl || !insightEl) return;

    const dlSelect = document.getElementById("dlTargetSeasonSelect");
    if (!dlSelect || !dlSelect.value) {
        syncDlSeasonSelector();
    }

    const targetSeason = dlSelect?.value || "2026";
    const scenario = document.getElementById("dlScenarioSelect")?.value || "normal";

    gridEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: #64748b; font-weight: 600;">🧠 PyTorch 신경망 시뮬레이션 계산 중...</div>`;

    try {
        const res = await fetch(
            `http://127.0.0.1:8000/api/players/${currentPlayerData.player_id}/predict-dl?target_season=${targetSeason}&mode=${activeMode}&scenario=${scenario}`
        );
        if (!res.ok) throw new Error("예측 실패");
        const data = await res.json();

        const p = data.predicted || {};
        const d = data.deltas || {};
        const act = data.actual;
        const storedStats = data.mode === 'batting' ? currentPlayerData.batting_stats : currentPlayerData.pitching_stats;
        const storedSeason = storedStats?.find(st => Number(st.season) === Number(data.target_season));
        const actualStat = act ? {...act, stat_sources: {}} : null;
        if (actualStat && storedSeason) {
            for (const metric of ['bwar', 'fwar', 'wrc_plus']) {
                if (act[metric] != null && storedSeason[metric] != null && Number(act[metric]) === Number(storedSeason[metric])) {
                    actualStat.stat_sources[metric] = storedSeason.stat_sources?.[metric];
                }
            }
        }
        const isBat = data.mode === "batting";

        const fmtDelta = (val, inverse = false, decimals = 0) => {
            if (val === undefined || val === null || Number(val) === 0) {
                return `<span style="color:#64748b; font-size:11.5px; font-weight:600;">• 직전 시즌(${data.baseline_season})과 동일</span>`;
            }
            const num = Number(val);
            const isGood = inverse ? num < 0 : num > 0;
            const color = isGood ? "#15803d" : "#b91c1c";
            const bg = isGood ? "#dcfce7" : "#fee2e2";
            const arrow = num > 0 ? "▲" : "▼";
            const absStr = decimals > 0 ? Math.abs(num).toFixed(decimals) : Math.abs(num);
            return `<span style="display:inline-block; background:${bg}; color:${color}; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:800;">${arrow} ${absStr} (vs ${data.baseline_season})</span>`;
        };

        let cards = [];
        if (isBat) {
            cards = [
                {
                    title: "예상 타율 / OPS",
                    val: `${Number(p.batting_avg).toFixed(3).replace(/^0\./, '.')} / ${Number(p.ops).toFixed(3)}`,
                    delta: fmtDelta(d.ops, false, 3),
                    actText: act ? `실제 ${data.target_season} 기록: ${Number(act.batting_avg || 0).toFixed(3).replace(/^0\./, '.')} / ${Number(act.ops || 0).toFixed(3)}` : null
                },
                {
                    title: "예상 출루율 / 장타율",
                    val: `${Number(p.obp).toFixed(3).replace(/^0\./, '.')} / ${Number(p.slg).toFixed(3).replace(/^0\./, '.')}`,
                    delta: fmtDelta(d.slg, false, 3),
                    actText: act ? `실제 ${data.target_season} 기록: ${Number(act.obp || 0).toFixed(3).replace(/^0\./, '.')} / ${Number(act.slg || 0).toFixed(3).replace(/^0\./, '.')}` : null
                },
                {
                    title: "예상 홈런 / 타점",
                    val: `${p.home_runs} HR / ${p.rbi} RBI`,
                    delta: fmtDelta(d.home_runs, false, 0),
                    actText: act ? `실제 ${data.target_season} 기록: ${act.home_runs} HR / ${act.rbi} RBI` : null
                },
                {
                    title: "예상 wRC+ (득점창출력)",
                    val: `${p.wrc_plus}`,
                    delta: fmtDelta(d.wrc_plus, false, 0),
                    actText: act ? `DB 기록 ${data.target_season} wRC+: ${formatSourcedStat(actualStat, 'wrc_plus')}` : null
                },
                {
                    title: "예상 bWAR / fWAR",
                    val: `${Number(p.bwar).toFixed(1)} / ${Number(p.fwar).toFixed(1)}`,
                    delta: fmtDelta(d.fwar, false, 1),
                    actText: act ? `DB 기록 ${data.target_season} bWAR / fWAR: ${formatSourcedStat(actualStat, 'bwar', 1)} / ${formatSourcedStat(actualStat, 'fwar', 1)}` : null
                },
                {
                    title: "예상 출전 / 도루",
                    val: `${p.games}G / ${p.stolen_bases}SB`,
                    delta: `<span style="display:inline-block; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700;">만 ${data.predicted_age}세 시즌 기준</span>`,
                    actText: act ? `실제 ${data.target_season} 기록: ${act.games}G / ${act.stolen_bases}SB` : null
                }
            ];
        } else {
            cards = [
                {
                    title: "예상 ERA / FIP",
                    val: `${Number(p.era).toFixed(2)} / ${Number(p.fip).toFixed(2)}`,
                    delta: fmtDelta(d.era, true, 2),
                    actText: act ? `실제 ${data.target_season} 기록: ${Number(act.era || 0).toFixed(2)} / ${Number(act.fip || 0).toFixed(2)}` : null
                },
                {
                    title: "예상 다승 / 패전",
                    val: `${p.wins}승 ${p.losses}패`,
                    delta: fmtDelta(d.wins, false, 0),
                    actText: act ? `실제 ${data.target_season} 기록: ${act.wins}승 ${act.losses}패` : null
                },
                {
                    title: "예상 이닝 / 탈삼진",
                    val: `${Number(p.innings_pitched).toFixed(1)} IP / ${p.strikeouts} K`,
                    delta: fmtDelta(d.strikeouts, false, 0),
                    actText: act ? `실제 ${data.target_season} 기록: ${act.innings_pitched} IP / ${act.strikeouts} K` : null
                },
                {
                    title: "예상 WHIP",
                    val: `${Number(p.whip).toFixed(2)}`,
                    delta: fmtDelta(d.whip, true, 2),
                    actText: act ? `실제 ${data.target_season} WHIP: ${Number(act.whip || 0).toFixed(2)}` : null
                },
                {
                    title: "예상 bWAR / fWAR",
                    val: `${Number(p.bwar).toFixed(1)} / ${Number(p.fwar).toFixed(1)}`,
                    delta: fmtDelta(d.fwar, false, 1),
                    actText: act ? `DB 기록 ${data.target_season} bWAR / fWAR: ${formatSourcedStat(actualStat, 'bwar', 1)} / ${formatSourcedStat(actualStat, 'fwar', 1)}` : null
                },
                {
                    title: "예상 등판 경기",
                    val: `${p.games}경기`,
                    delta: `<span style="display:inline-block; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700;">만 ${data.predicted_age}세 시즌 기준</span>`,
                    actText: act ? `실제 ${data.target_season} 등판: ${act.games}경기` : null
                }
            ];
        }

        gridEl.innerHTML = cards.map(c => {
            // ★ c.actText가 존재할 때만 하단에 파란색 실제 기록 박스 조각 생성 (템플릿 리터럴 깨짐 방지)
            const actHtml = c.actText 
                ? `<div style="margin-top: 8px; padding: 6px 10px; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 6px; font-size: 11.5px; color: #1d4ed8; font-weight: 800;">🎯 ${c.actText}</div>` 
                : '';

            return `
                <div style="background: #fcfdfe; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between; gap: 6px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.02);">
                    <div style="font-size: 12px; color: #64748b; font-weight: 700;">${c.title}</div>
                    <div style="font-size: 22px; font-weight: 900; color: #102d63; letter-spacing: -0.3px;">${c.val}</div>
                    <div style="margin-top: 2px;">${c.delta}</div>
                    ${actHtml}
                </div>
            `;
        }).join("");

        const modeBadge = act
            ? `<span style="background:#dbeafe; color:#1d4ed8; font-size:11px; font-weight:800; padding:3px 8px; border-radius:6px;">백테스트 검증 모드 (실제 기록 존재)</span>`
            : `<span style="background:#e0e7ff; color:#3730a3; font-size:11px; font-weight:800; padding:3px 8px; border-radius:6px;">미래 시즌 예측 모드</span>`;

        const insightsHtml = (data.insights || []).map(line => `<li style="margin-bottom: 4px;">${line}</li>`).join("");
        insightEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <strong style="color:#0f172a; font-size:14px;">📋 PyTorch DL 스카우팅 리포트 (${data.prior_seasons_used.join(', ')} 시즌 기반 ➔ ${data.target_season} 시즌 예측)</strong>
                    ${modeBadge}
                </div>
                <span style="font-size:11.5px; color:#64748b; font-weight:600;">${data.model_info?.architecture || ''}</span>
            </div>
            <ul style="margin: 0; padding-left: 18px; color: #334155;">${insightsHtml}</ul>
        `;
    } catch (e) {
        console.error(e);
        gridEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 16px; color: #b91c1c;">예측 데이터를 산출할 수 없습니다.</div>`;
    }
}