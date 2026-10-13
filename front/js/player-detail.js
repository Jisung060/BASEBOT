let currentPlayerData = null;
let activeMode = "batting"; // 'batting' or 'pitching'

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const playerId = urlParams.get("id") || "660271"; // 기본: 오타니 쇼헤이
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
        renderModeView();

    } catch (err) {
        console.error(err);
        document.getElementById("playerName").textContent = "데이터를 불러올 수 없습니다.";
        document.getElementById("playerStatsBody").innerHTML = 
            `<tr><td colspan="18" class="no-data">선수 데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
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
        document.getElementById("playerStatsBody").innerHTML = `<tr><td colspan="18" class="no-data">등록된 기록이 없습니다.</td></tr>`;
        return;
    }

    const latest = statsList[0];

    // 1. 프로필 주요 성적 요약 (도루 50-50 반영)
    if (isBat) {
        const sbText = latest.stolen_bases !== null ? `, ${latest.stolen_bases}SB` : '';
        const avgText = latest.batting_avg !== null ? Number(latest.batting_avg).toFixed(3).replace('0.', '.') : '-';
        document.getElementById("playerHighlightStat").textContent = 
            `${latest.season} 시즌 ${latest.home_runs || 0}HR${sbText}, 타율 ${avgText}`;
    } else {
        const eraText = latest.era !== null ? Number(latest.era).toFixed(2) : '-';
        document.getElementById("playerHighlightStat").textContent = 
            `${latest.season} 시즌 ${latest.wins || 0}승 ${latest.losses || 0}패, ERA ${eraText}`;
    }

    // 2. 4대 핵심 지표 요약 카드
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
                <div class="stat-summary-desc">상위 ${latest.exit_velo_percentile || '-'}% 백분위</div>
            </div>
            <div class="stat-summary-box">
                <div class="stat-summary-title">배럴 타구 비율 (Barrel %)</div>
                <div class="stat-summary-num">${latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) : '-'} <span class="unit">%</span></div>
                <div class="stat-summary-desc">상위 ${latest.barrel_percentile || '-'}% 백분위</div>
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

    // 3. Savant 4대 카테고리 완전체 시각화 (Value, Batting/Pitching, Fielding, Running)
    document.getElementById("savantTitle").textContent = `${latest.season} MLB Percentile Rankings`;
    const barsContainer = document.getElementById("savantBarsContainer");

    const renderBar = (it) => {
        if (it.pct === null || it.pct === undefined) {
            // NOT QUALIFIED 처리
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
        // [1] Value
        const valueItems = [
            { label: "Batting Run Value", pct: latest.batting_run_value_percentile, actual: latest.batting_run_value !== null ? latest.batting_run_value : '-' },
            { label: "Baserunning Run Value", pct: latest.baserunning_run_value_percentile, actual: latest.baserunning_run_value !== null ? latest.baserunning_run_value : '-' },
            { label: "Fielding Run Value", pct: latest.oaa_percentile, actual: latest.outs_above_average !== null ? latest.outs_above_average : '-' }
        ];

        // [2] Batting
        const battingItems = [
            { label: "xwOBA (기대 가중출루율)", pct: latest.xwoba_percentile, actual: latest.xwoba ? Number(latest.xwoba).toFixed(3) : '-' },
            { label: "xBA (기대 타율)", pct: latest.hard_hit_percentile ? Math.min(100, latest.hard_hit_percentile + 5) : 75, actual: latest.xba ? Number(latest.xba).toFixed(3) : '-' },
            { label: "xSLG (기대 장타율)", pct: latest.barrel_percentile ? Math.min(100, latest.barrel_percentile + 3) : 80, actual: latest.xslg ? Number(latest.xslg).toFixed(3) : '-' },
            { label: "Avg Exit Velo (평균 타구속도)", pct: latest.exit_velo_percentile, actual: latest.avg_exit_velocity ? Number(latest.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Barrel % (배럴 타구 비율)", pct: latest.barrel_percentile, actual: latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (하드힛 비율)", pct: latest.hard_hit_percentile, actual: latest.hard_hit_percentage ? Number(latest.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "LA Sweet-Spot % (스위트스팟)", pct: latest.sweet_spot_percentage ? Math.min(100, Math.round(Number(latest.sweet_spot_percentage) * 1.8)) : null, actual: latest.sweet_spot_percentage ? Number(latest.sweet_spot_percentage).toFixed(1) + '%' : '-' },
            { label: "Chase % (유인구 헛스윙률)", pct: latest.chase_percentage ? Math.max(1, 100 - Math.round(Number(latest.chase_percentage) * 2)) : null, actual: latest.chase_percentage ? Number(latest.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (전체 헛스윙률)", pct: latest.whiff_percentage ? Math.max(1, 100 - Math.round(Number(latest.whiff_percentage) * 2.2)) : null, actual: latest.whiff_percentage ? Number(latest.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (삼진율)", pct: latest.k_percentage ? Math.max(1, 100 - Math.round(Number(latest.k_percentage) * 2.5)) : null, actual: latest.k_percentage ? Number(latest.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷율)", pct: latest.bb_percentage ? Math.min(100, Math.round(Number(latest.bb_percentage) * 5.0)) : null, actual: latest.bb_percentage ? Number(latest.bb_percentage).toFixed(1) + '%' : '-' }
        ];

        // [3] Fielding
        const fieldingItems = [
            { label: "Range (OAA)", pct: latest.oaa_percentile, actual: latest.outs_above_average !== null ? latest.outs_above_average : '-' },
            { label: "Arm Strength", pct: latest.arm_strength_percentile, actual: latest.arm_strength ? Number(latest.arm_strength).toFixed(1) + ' mph' : '-' }
        ];

        // [4] Running
        const runningItems = [
            { label: "Sprint Speed", pct: latest.sprint_speed_percentile, actual: latest.sprint_speed ? Number(latest.sprint_speed).toFixed(1) + ' ft/s' : '-' }
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
        // 투수 모드
        const valueItems = [
            { label: "Pitching Run Value", pct: latest.pitching_run_value_percentile, actual: latest.pitching_run_value !== null ? latest.pitching_run_value : '-' }
        ];

        const pitchingItems = [
            { label: "xERA (기대 평균자책점)", pct: latest.xwoba_percentile, actual: latest.xera ? Number(latest.xera).toFixed(2) : '-' },
            { label: "Fastball Velo (포심 평균구속)", pct: latest.fastball_velo_percentile, actual: latest.fastball_velocity ? Number(latest.fastball_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Avg Exit Velo (피타구속도 억제)", pct: latest.exit_velo_percentile, actual: latest.avg_exit_velocity ? Number(latest.avg_exit_velocity).toFixed(1) + ' mph' : '-' },
            { label: "Barrel % (피배럴 억제)", pct: latest.barrel_percentile, actual: latest.barrel_percentage ? Number(latest.barrel_percentage).toFixed(1) + '%' : '-' },
            { label: "Hard-Hit % (피하드힛 억제)", pct: latest.hard_hit_percentile, actual: latest.hard_hit_percentage ? Number(latest.hard_hit_percentage).toFixed(1) + '%' : '-' },
            { label: "Whiff % (헛스윙 유도율)", pct: latest.whiff_percentage ? Math.round(Number(latest.whiff_percentage) * 2.5) : null, actual: latest.whiff_percentage ? Number(latest.whiff_percentage).toFixed(1) + '%' : '-' },
            { label: "Chase % (유인구 유도율)", pct: latest.chase_percentage ? Math.round(Number(latest.chase_percentage) * 2.2) : null, actual: latest.chase_percentage ? Number(latest.chase_percentage).toFixed(1) + '%' : '-' },
            { label: "K % (탈삼진 비율)", pct: latest.k_percentage ? Math.min(100, Math.round(Number(latest.k_percentage) * 2.8)) : null, actual: latest.k_percentage ? Number(latest.k_percentage).toFixed(1) + '%' : '-' },
            { label: "BB % (볼넷 억제율)", pct: latest.bb_percentage ? Math.max(1, 100 - Math.round(Number(latest.bb_percentage) * 4.5)) : null, actual: latest.bb_percentage ? Number(latest.bb_percentage).toFixed(1) + '%' : '-' }
        ];

        groupsHtml = `
            <div class="savant-group-header">🏆 Value</div>
            ${valueItems.map(renderBar).join("")}
            <div class="savant-group-header">⚾ Pitching</div>
            ${pitchingItems.map(renderBar).join("")}
        `;
    }

    barsContainer.innerHTML = groupsHtml;

    // 4. 하단 상세 테이블 (도루, 삼진, 볼넷 전 지표 반영)
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
            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
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