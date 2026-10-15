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
});

// Baseball Savant 공식 색상 산출 (50 기준 파랑/빨강)
function getSavantColor(pct) {
    if (pct === null || pct === undefined) return "#94a3b8";
    const val = Math.max(0, Math.min(100, Number(pct)));
    if (val >= 50) {
        const ratio = (val - 50) / 50;
        const r = Math.round(180 + 45 * ratio);
        const g = Math.round(70 * (1 - ratio));
        const b = Math.round(70 * (1 - ratio));
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        const ratio = val / 50;
        const r = Math.round(50 + 60 * ratio);
        const g = Math.round(80 + 60 * ratio);
        const b = Math.round(215);
        return `rgb(${r}, ${g}, ${b})`;
    }
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
                <div class="stat-summary-num">${targetStat.wrc_plus ?? '-'}</div>
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
                <div class="stat-summary-num">
                    ${targetStat.bwar !== null ? Number(targetStat.bwar).toFixed(1) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${targetStat.fwar !== null ? Number(targetStat.fwar).toFixed(1) : '-'}</span>
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
                <div class="stat-summary-num">
                    ${targetStat.bwar !== null ? Number(targetStat.bwar).toFixed(1) : '-'}
                    <span class="war-divider">/</span>
                    <span class="war-sub">${targetStat.fwar !== null ? Number(targetStat.fwar).toFixed(1) : '-'}</span>
                </div>
                <div class="stat-summary-desc">투수 승리 기여도 지표</div>
            </div>
        `;
    }

    // 3. Savant 4대 카테고리 시각화 (선택된 시즌 기준)
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
            { label: "Batting Run Value", pct: targetStat.batting_run_value_percentile, actual: targetStat.batting_run_value !== null ? targetStat.batting_run_value : '-' },
            { label: "Baserunning Run Value", pct: targetStat.baserunning_run_value_percentile, actual: targetStat.baserunning_run_value !== null ? targetStat.baserunning_run_value : '-' },
            { label: "Fielding Run Value", pct: targetStat.oaa_percentile, actual: targetStat.outs_above_average !== null ? targetStat.outs_above_average : '-' }
        ];

        const battingItems = [
            { label: "xwOBA (기대 가중출루율)", pct: targetStat.xwoba_percentile, actual: targetStat.xwoba ? Number(targetStat.xwoba).toFixed(3) : '-' },
            { label: "xBA (기대 타율)", pct: targetStat.hard_hit_percentile ? Math.min(100, targetStat.hard_hit_percentile + 5) : null, actual: targetStat.xba ? Number(targetStat.xba).toFixed(3) : '-' },
            { label: "xSLG (기대 장타율)", pct: targetStat.barrel_percentile ? Math.min(100, targetStat.barrel_percentile + 3) : null, actual: targetStat.xslg ? Number(targetStat.xslg).toFixed(3) : '-' },
            { label: "Avg Exit Velo (평균 타구속도)", pct: targetStat.exit_velo_percentile, actual: targetStat.avg_exit_velocity ? Number(targetStat.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Barrel % (배럴 타구 비율)", pct: targetStat.barrel_percentile, actual: targetStat.barrel_percentage ? Number(targetStat.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (하드힛 비율)", pct: targetStat.hard_hit_percentile, actual: targetStat.hard_hit_percentage ? Number(targetStat.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "LA Sweet-Spot % (스위트스팟)", pct: targetStat.sweet_spot_percentage ? Math.min(100, Math.round(Number(targetStat.sweet_spot_percentage) * 1.8)) : null, actual: targetStat.sweet_spot_percentage ? Number(targetStat.sweet_spot_percentage).toFixed(1) + '%' : '-' },
            { label: "Chase % (유인구 헛스윙률)", pct: targetStat.chase_percentage ? Math.max(1, 100 - Math.round(Number(targetStat.chase_percentage) * 2)) : null, actual: targetStat.chase_percentage ? Number(targetStat.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (전체 헛스윙률)", pct: targetStat.whiff_percentage ? Math.max(1, 100 - Math.round(Number(targetStat.whiff_percentage) * 2.2)) : null, actual: targetStat.whiff_percentage ? Number(targetStat.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (삼진율)", pct: targetStat.k_percentage ? Math.max(1, 100 - Math.round(Number(targetStat.k_percentage) * 2.5)) : null, actual: targetStat.k_percentage ? Number(targetStat.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷율)", pct: targetStat.bb_percentage ? Math.min(100, Math.round(Number(targetStat.bb_percentage) * 5.0)) : null, actual: targetStat.bb_percentage ? Number(targetStat.bb_percentage).toFixed(1) + '%' : '-' }
        ];

        const fieldingItems = [
            { label: "Range (OAA)", pct: targetStat.oaa_percentile, actual: targetStat.outs_above_average !== null ? targetStat.outs_above_average : '-' },
            { label: "Arm Strength", pct: targetStat.arm_strength_percentile, actual: targetStat.arm_strength ? Number(targetStat.arm_strength).toFixed(1) + ' mph' : '-' }
        ];

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
            <div class="savant-group-header">🏃 Running</div>
            ${runningItems.map(renderBar).join("")}
        `;

    } else {
        const valueItems = [
            { label: "Pitching Run Value", pct: targetStat.pitching_run_value_percentile, actual: targetStat.pitching_run_value !== null ? targetStat.pitching_run_value : '-' }
        ];

        const pitchingItems = [
            { label: "xERA (기대 평균자책점)", pct: targetStat.xwoba_percentile, actual: targetStat.xera ? Number(targetStat.xera).toFixed(2) : '-' },
            { label: "Fastball Velo (포심 평균구속)", pct: targetStat.fastball_velo_percentile, actual: targetStat.fastball_velocity ? Number(targetStat.fastball_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Avg Exit Velo (피타구속도 억제)", pct: targetStat.exit_velo_percentile, actual: targetStat.avg_exit_velocity ? Number(targetStat.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Barrel % (피배럴 억제)", pct: targetStat.barrel_percentile, actual: targetStat.barrel_percentage ? Number(targetStat.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (피하드힛 억제)", pct: targetStat.hard_hit_percentile, actual: targetStat.hard_hit_percentage ? Number(targetStat.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (헛스윙 유도율)", pct: targetStat.whiff_percentage ? Math.round(Number(targetStat.whiff_percentage) * 2.5) : null, actual: targetStat.whiff_percentage ? Number(targetStat.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "Chase % (유인구 유도율)", pct: targetStat.chase_percentage ? Math.round(Number(targetStat.chase_percentage) * 2.2) : null, actual: targetStat.chase_percentage ? Number(targetStat.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (탈삼진 비율)", pct: targetStat.k_percentage ? Math.min(100, Math.round(Number(targetStat.k_percentage) * 2.8)) : null, actual: targetStat.k_percentage ? Number(targetStat.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷 억제율)", pct: targetStat.bb_percentage ? Math.max(1, 100 - Math.round(Number(targetStat.bb_percentage) * 4.5)) : null, actual: targetStat.bb_percentage ? Number(targetStat.bb_percentage).toFixed(1) + '%' : '-' }
        ];

        groupsHtml = `
            <div class="savant-group-header">🏆 Value</div>
            ${valueItems.map(renderBar).join("")}
            <div class="savant-group-header">⚾ Pitching</div>
            ${pitchingItems.map(renderBar).join("")}
        `;
    }

    barsContainer.innerHTML = groupsHtml;

    // 4. 하단 시즌별 누적 기록 테이블 ('소속팀' 컬럼 추가 & 현재 선택 시즌 하이라이트)
    const thead = document.getElementById("statsThead");
    const tbody = document.getElementById("playerStatsBody");
    tbody.innerHTML = "";

    if (isBat) {
        thead.innerHTML = `
            <tr>
                <th>시즌</th>
                <th>소속팀</th>
                <th>경기</th>
                <th>타율</th>
                <th>안타</th>
                <th>홈런</th>
                <th>타점</th>
                <th>도루</th>
                <th>볼넷</th>
                <th>삼진</th>
                <th>wRC+</th>
                <th>xBA</th>
                <th>xSLG</th>
                <th>xwOBA</th>
                <th>타구속도</th>
                <th>배럴%</th>
                <th>스프린트</th>
                <th>OAA</th>
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
                <td>${st.batting_avg !== null ? Number(st.batting_avg).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.hits || 0}</td>
                <td><strong>${st.home_runs || 0}</strong></td>
                <td>${st.rbi || 0}</td>
                <td><strong>${st.stolen_bases !== null ? st.stolen_bases : '-'}</strong></td>
                <td>${st.walks || 0}</td>
                <td>${st.strikeouts || 0}</td>
                <td><strong>${st.wrc_plus !== null ? st.wrc_plus : '-'}</strong></td>
                <td>${st.xba !== null ? Number(st.xba).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.xslg !== null ? Number(st.xslg).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.xwoba !== null ? Number(st.xwoba).toFixed(3).replace('0.', '.') : '-'}</td>
                <td>${st.avg_exit_velocity ? Number(st.avg_exit_velocity).toFixed(1) + ' mph' : '-'}</td>
                <td>${st.barrel_percentage ? Number(st.barrel_percentage).toFixed(1) + '%' : '-'}</td>
                <td>${st.sprint_speed ? Number(st.sprint_speed).toFixed(1) : '-'}</td>
                <td>${st.outs_above_average !== null ? st.outs_above_average : '-'}</td>
                <td>${st.bwar !== null ? Number(st.bwar).toFixed(1) : '-'}</td>
                <td>${st.fwar !== null ? Number(st.fwar).toFixed(1) : '-'}</td>
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
                <th>구속</th>
                <th>피타구속도</th>
                <th>피배럴%</th>
                <th>Whiff%</th>
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
                <td>${st.fastball_velocity ? Number(st.fastball_velocity).toFixed(1) + ' mph' : '-'}</td>
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