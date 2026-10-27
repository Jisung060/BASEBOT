"use strict";

let currentCategory = "batters";
let currentDataItems = [];
let dataSortConfig = { key: null, dir: "desc" };

let currentLogs = [];
let logSortConfig = { key: "log_id", dir: "desc" };

const DATA_TYPE_LABELS = {
    "PREPARE_PLAYER_CHARTS": "선수 차트용 CSV 수집",
    "PIPELINE_PLAYERS": "선수 3단계 통합 파이프라인",
    "PIPELINE_GAMES": "경기 3단계 통합 파이프라인",
    "STEP_BATTERS": "타자 수집 (collector_batters)",
    "STEP_PITCHERS": "투수 수집 (collector_pitchers)",
    "STEP_PLAYERS_META": "선수 메타 (collector_players_meta)",
    "STEP_SAVANT_REPAIR": "Savant 빠른 갱신 (Extension 제외)",
    "STEP_SAVANT_EXTENSION": "투수 Extension 단독 갱신",
    "STEP_GAMES": "경기 수집 (collector_games)",
    "STEP_BOXSCORES": "박스스코어 수집 (collector_boxscores)",
    "STEP_REPAIR_GAMES": "경기 보정 (repair_games_data)",
    "STEP_SEED_TEAMS": "30개 구단 시드 (seed_teams)",
    "IMPORT_SOURCE_CSVS": "로컬 원본 CSV로 값·출처 보정",
    "PREPARE_SOURCE_CSVS": "원본 CSV 다운로드·검증",
    "TRAIN_ML_MODEL": "경기 승부예측 ML 모델 학습",
    "TRAIN_DL_MODEL": "선수 성적예측 DL 모델 학습"
};

// 카테고리별 테이블 컬럼 정의
const CATEGORY_COLUMNS = {
    batters: [
        { key: "player_id", label: "선수 ID" },
        { key: "player_name", label: "선수명" },
        { key: "team_code", label: "구단" },
        { key: "position", label: "포지션" },
        { key: "season", label: "시즌" },
        { key: "games", label: "경기" },
        { key: "batting_avg", label: "타율", fmt: v => v !== null ? Number(v).toFixed(3) : "-" },
        { key: "home_runs", label: "홈런" },
        { key: "rbi", label: "타점" },
        { key: "wrc_plus", label: "wRC+" },
        { key: "xwoba", label: "xwOBA", fmt: v => v !== null ? Number(v).toFixed(3) : "-" },
        { key: "avg_exit_velocity", label: "타구속도", fmt: v => v !== null ? `${Number(v).toFixed(1)} mph` : "-" },
        { key: "barrel_percentage", label: "배럴%", fmt: v => v !== null ? `${Number(v).toFixed(1)}%` : "-" },
        { key: "outs_above_average", label: "OAA" },
        { key: "bwar", label: "bWAR", fmt: v => v !== null ? Number(v).toFixed(1) : "-" },
        { key: "fwar", label: "fWAR", fmt: v => v !== null ? Number(v).toFixed(1) : "-" }
    ],
    pitchers: [
        { key: "player_id", label: "선수 ID" },
        { key: "player_name", label: "선수명" },
        { key: "team_code", label: "구단" },
        { key: "throws", label: "투구" },
        { key: "season", label: "시즌" },
        { key: "games", label: "경기" },
        { key: "wins", label: "승" },
        { key: "losses", label: "패" },
        { key: "era", label: "ERA", fmt: v => v !== null ? Number(v).toFixed(2) : "-" },
        { key: "fip", label: "FIP", fmt: v => v !== null ? Number(v).toFixed(2) : "-" },
        { key: "whip", label: "WHIP", fmt: v => v !== null ? Number(v).toFixed(2) : "-" },
        { key: "innings_pitched", label: "이닝", fmt: v => v !== null ? Number(v).toFixed(1) : "-" },
        { key: "strikeouts", label: "탈삼진" },
        { key: "fastball_velocity", label: "평균구속", fmt: v => v !== null ? `${Number(v).toFixed(1)} mph` : "-" },
        { key: "bwar", label: "bWAR", fmt: v => v !== null ? Number(v).toFixed(1) : "-" },
        { key: "fwar", label: "fWAR", fmt: v => v !== null ? Number(v).toFixed(1) : "-" }
    ],
    games: [
        { key: "game_id", label: "경기 ID" },
        { key: "game_date", label: "경기 일자" },
        { key: "game_time", label: "시작 시각(UTC)", fmt: v => v ? String(v).substring(0, 5) : "미정" },
        { key: "away_team_name", label: "원정팀" },
        { key: "away_score", label: "원정 점수" },
        { key: "home_score", label: "홈 점수" },
        { key: "home_team_name", label: "홈팀" },
        { key: "winning_team_code", label: "승리팀", fmt: v => v || "-" },
        { key: "stadium", label: "경기장", fmt: v => v || "미정" },
        { key: "status", label: "상태" }
    ],
    teams: [
        { key: "team_id", label: "구단 ID" },
        { key: "team_code", label: "약어" },
        { key: "team_name", label: "구단명" },
        { key: "league", label: "리그" },
        { key: "division", label: "지구" },
        { key: "city", label: "연고지" },
        { key: "stadium", label: "홈구장" },
        { key: "batter_count", label: "등록 타자 수", fmt: v => `${v ?? 0}명` },
        { key: "pitcher_count", label: "등록 투수 수", fmt: v => `${v ?? 0}명` }
    ]
};

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    initSeasonDropdowns(); // ★ 2015년 ~ 현재 연도 드롭다운 자동 생성
    initCategoryTabs();
    initManualSyncControls();
    initLogTableSorting();

    loadDashboardSummary();
    loadCategoryData();
    loadSchedules();
    loadSyncLogs();
});

// =========================================================
// 공통 정렬 유틸리티 함수
// =========================================================
function sortArrayByColumn(arr, key, dir) {
    if (!key) return arr;
    const multiplier = dir === "asc" ? 1 : -1;

    return [...arr].sort((a, b) => {
        const valA = a[key];
        const valB = b[key];

        if (valA === null || valA === undefined || valA === "-") return 1;
        if (valB === null || valB === undefined || valB === "-") return -1;

        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && String(valA).trim() !== "" && String(valB).trim() !== "") {
            return (numA - numB) * multiplier;
        }

        return String(valA).localeCompare(String(valB), "ko", { numeric: true }) * multiplier;
    });
}

// =========================================================
// Baseball Savant 도입 연도(2015년) ~ 현재 연도 동적 생성
// =========================================================
function initSeasonDropdowns(collectedSeasons = []) {
    const SAVANT_START_YEAR = 2015;
    const currentYear = new Date().getFullYear(); // 2026

    const manualSelect = document.getElementById("manualSeasonSelect");
    const filterSelect = document.getElementById("filterSeason");

    const prevManualVal = manualSelect ? manualSelect.value : "2024";
    const prevFilterVal = filterSelect ? filterSelect.value : "2024";

    // 1) 수동 데이터 가져오기용 시즌 선택창 (2026 ~ 2015)
    if (manualSelect) {
        manualSelect.innerHTML = "";
        for (let yr = currentYear; yr >= SAVANT_START_YEAR; yr--) {
            const isCollected = collectedSeasons.includes(yr);
            const label = isCollected ? `${yr} 시즌 (DB 보유)` : `${yr} 시즌`;
            const opt = new Option(label, yr);
            if (String(yr) === String(prevManualVal)) opt.selected = true;
            manualSelect.add(opt);
        }
    }

    // 2) 상단 데이터 조회용 시즌 필터창 (전체 + 2026 ~ 2015)
    if (filterSelect) {
        filterSelect.innerHTML = `<option value="">전체 시즌</option>`;
        for (let yr = currentYear; yr >= SAVANT_START_YEAR; yr--) {
            const isCollected = collectedSeasons.includes(yr);
            const label = isCollected ? `${yr} 시즌 ✓` : `${yr} 시즌`;
            const opt = new Option(label, yr);
            if (String(yr) === String(prevFilterVal)) opt.selected = true;
            filterSelect.add(opt);
        }
    }
}

// =========================================================
// 1. 상단 대시보드 요약 카드 로드
// =========================================================
async function loadDashboardSummary() {
    try {
        const res = await adminFetch("/api/admin/baseball-data/summary");
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById("statTeamsCount").textContent = data.teams_count.toLocaleString();
        document.getElementById("statPlayersCount").textContent = data.players_count.toLocaleString();
        document.getElementById("statGamesCount").textContent = data.games_count.toLocaleString();
        document.getElementById("statReviewCount").textContent = data.review_needed_count.toLocaleString();

        const detailEl = document.getElementById("statReviewDetail");
        if (data.review_needed_count > 0) {
            detailEl.textContent = `경기 결측 ${data.missing_games}건 / 선수 메타 미매핑 ${data.missing_players_meta}건`;
            detailEl.style.color = "#b91c1c";
        } else {
            detailEl.textContent = "모든 데이터 무결성 정상";
            detailEl.style.color = "#15803d";
        }

        // ★ DB에 이미 수집된 시즌 목록을 반영하여 2015~현재 연도 드롭다운 갱신
        if (data.available_seasons) {
            initSeasonDropdowns(data.available_seasons);
        }
    } catch (e) {
        console.error("대시보드 요약 로드 실패:", e);
    }
}

// =========================================================
// 2. 통합 데이터 조회 & 컬럼 클릭 정렬
// =========================================================
function initCategoryTabs() {
    const tabs = document.querySelectorAll("#dataCategoryTabs .tab");
    const statusWrap = document.getElementById("filterGameStatusWrap");

    tabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            currentCategory = tab.dataset.category;
            dataSortConfig = { key: null, dir: "desc" };

            if (statusWrap) {
                statusWrap.style.display = (currentCategory === "games") ? "flex" : "none";
            }

            loadCategoryData();
        });
    });

    const form = document.getElementById("dataFilterForm");
    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            loadCategoryData();
        });
    }

    // 상단 '결측 데이터 일괄 보정' 버튼 클릭 시 repair_games_data.py 실행
    const btnRepair = document.getElementById("btnVerifyAndRepair");
    if (btnRepair) {
        btnRepair.addEventListener("click", () => {
            executeManualSync({ data_type: "STEP_REPAIR_GAMES", trigger_type: "MANUAL" });
        });
    }
}

async function loadCategoryData() {
    const keyword = document.getElementById("filterKeyword").value.trim();
    const season = document.getElementById("filterSeason").value;
    const gameStatus = document.getElementById("filterGameStatus").value;

    const params = new URLSearchParams({ category: currentCategory, limit: "200" });
    if (keyword) params.append("keyword", keyword);
    if (season) params.append("season", season);
    if (currentCategory === "games" && gameStatus) params.append("game_status", gameStatus);

    const tbody = document.getElementById("baseballDataTbody");
    tbody.innerHTML = `<tr><td colspan="16" class="table-empty">데이터를 불러오는 중입니다...</td></tr>`;

    try {
        const res = await adminFetch(`/api/admin/baseball-data/items?${params.toString()}`);
        if (!res.ok) throw new Error("데이터 조회 실패");
        const data = await res.json();
        currentDataItems = data.items || [];

        document.getElementById("dataCountLabel").textContent = `조회 결과: 총 ${currentDataItems.length}건`;
        renderCategoryTable();
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="16" class="table-empty">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
    }
}

function renderCategoryTable() {
    const cols = CATEGORY_COLUMNS[currentCategory] || [];
    const thead = document.getElementById("baseballDataThead");
    const tbody = document.getElementById("baseballDataTbody");

    // 1. 헤더 렌더링 (정렬 아이콘 포함)
    const trHead = document.createElement("tr");
    cols.forEach(col => {
        const th = document.createElement("th");
        th.className = "sortable";
        const isCurrentSort = dataSortConfig.key === col.key;
        if (isCurrentSort) th.classList.add(dataSortConfig.dir);

        const iconChar = isCurrentSort ? (dataSortConfig.dir === "asc" ? "▲" : "▼") : "↕";
        th.innerHTML = `${col.label} <span class="sort-icon">${iconChar}</span>`;

        th.addEventListener("click", () => {
            if (dataSortConfig.key === col.key) {
                dataSortConfig.dir = dataSortConfig.dir === "asc" ? "desc" : "asc";
            } else {
                dataSortConfig.key = col.key;
                dataSortConfig.dir = "desc";
            }
            renderCategoryTable();
        });
        trHead.appendChild(th);
    });
    thead.innerHTML = "";
    thead.appendChild(trHead);

    // 2. 바디 렌더링
    if (!currentDataItems.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length}" class="table-empty">조건에 해당하는 데이터가 없습니다.</td></tr>`;
        return;
    }

    const sortedItems = sortArrayByColumn(currentDataItems, dataSortConfig.key, dataSortConfig.dir);
    tbody.innerHTML = "";

    sortedItems.forEach(row => {
        const tr = document.createElement("tr");
        cols.forEach(col => {
            const td = document.createElement("td");
            const rawVal = row[col.key];

            if (col.key === "status") {
                const badgeClass = rawVal === "FINAL" ? "tag-success" : (rawVal === "IN_PROGRESS" ? "tag-danger" : "tag-info");
                td.innerHTML = `<span class="tag ${badgeClass}">${rawVal || "-"}</span>`;
            } else if (col.key === "player_name" || col.key === "team_name") {
                td.innerHTML = `<strong style="color:#0f172a;">${rawVal ?? "-"}</strong>`;
            } else if (col.fmt) {
                td.textContent = col.fmt(rawVal);
            } else {
                td.textContent = (rawVal !== null && rawVal !== undefined) ? rawVal : "-";
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// =========================================================
// 3. 수동 데이터 가져오기 및 자동화 스케줄 관리
// =========================================================
function initManualSyncControls() {
    const syncTypeSelect = document.getElementById("manualSyncType");
    const seasonBox = document.getElementById("manualSeasonBox");
    const startBox = document.getElementById("manualStartDateBox");
    const endBox = document.getElementById("manualEndDateBox");

    let chartRequest = 0;
    const loadChartPlayers = async () => {
        const select = document.getElementById('manualChartPlayer');
        if (syncTypeSelect.value !== 'PREPARE_PLAYER_CHARTS') return;
        const request = ++chartRequest;
        select.disabled = true;
        select.innerHTML = '<option value="">선수 목록 조회 중...</option>';
        try {
            const res = await adminFetch(`/api/admin/baseball-data/chart-players?season=${Number(document.getElementById('manualSeasonSelect').value)}`);
            if (!res.ok) throw new Error('선수 목록 조회 실패');
            const data = await res.json();
            if (request !== chartRequest) return;
            select.innerHTML = '<option value="">대상을 선택해 주세요.</option>';
            if (data.players.length) select.add(new Option(`선택 시즌 전체 선수·유형 (${data.players.length}개)`, 'ALL'));
            for (const player of data.players) {
                select.add(new Option(`${player.name} (${player.player_id}) · ${player.mode === 'pitching' ? '투구' : '타격'}`, `${player.player_id}:${player.mode}`));
            }
            if (!data.players.length) select.innerHTML = '<option value="">해당 시즌 선수 기록 없음</option>';
            select.disabled = !data.players.length;
        } catch (error) {
            if (request === chartRequest) select.innerHTML = '<option value="">선수 목록 조회 실패 · 다시 선택해 주세요.</option>';
        }
    };
    document.getElementById('manualSeasonSelect').addEventListener('change', loadChartPlayers);
    const updateOptionVisibility = () => {
        const val = syncTypeSelect.value;
        document.getElementById("manualChartPlayerBox").style.display = val === "PREPARE_PLAYER_CHARTS" ? "flex" : "none";
        document.getElementById("manualChartRefreshBox").style.display = val === "PREPARE_PLAYER_CHARTS" ? "flex" : "none";
        loadChartPlayers();
        document.getElementById("manualCsvOptions").style.display = val === "PREPARE_SOURCE_CSVS" ? "flex" : "none";
        const isDateRangeType = ["PIPELINE_GAMES", "STEP_GAMES", "STEP_BOXSCORES"].includes(val);
        const isTraining = ["TRAIN_ML_MODEL", "TRAIN_DL_MODEL"].includes(val);
        document.getElementById("manualTrainingNotice").style.display = isTraining ? "block" : "none";
        const isNoParamType = isTraining || ["STEP_PLAYERS_META", "STEP_REPAIR_GAMES", "STEP_SEED_TEAMS"].includes(val);

        if (isDateRangeType) {
            seasonBox.style.display = "none";
            startBox.style.display = "flex";
            endBox.style.display = "flex";
        } else if (isNoParamType) {
            seasonBox.style.display = "none";
            startBox.style.display = "none";
            endBox.style.display = "none";
        } else {
            // PIPELINE_PLAYERS, STEP_BATTERS, STEP_PITCHERS, STEP_SAVANT_REPAIR
            seasonBox.style.display = "flex";
            startBox.style.display = "none";
            endBox.style.display = "none";
        }
    };

    if (syncTypeSelect) {
        syncTypeSelect.addEventListener("change", updateOptionVisibility);
        updateOptionVisibility();
    }

    const btnRun = document.getElementById("btnRunManualSync");
    if (btnRun) {
        btnRun.addEventListener("click", () => {
            const dtype = syncTypeSelect.value;
            const season = Number(document.getElementById("manualSeasonSelect").value || 2024);
            const sDate = document.getElementById("manualStartDate").value;
            const eDate = document.getElementById("manualEndDate").value;

            const chartSelection = document.getElementById('manualChartPlayer');
            const isAllCharts = chartSelection.value === 'ALL';
            const [chartId, chartMode] = chartSelection.value.split(':');
            if (dtype === 'PREPARE_PLAYER_CHARTS' && (chartSelection.disabled || (!isAllCharts && !Number(chartId)))) {
                alert('차트 대상 선수를 선택해 주세요.');
                return;
            }
            executeManualSync({
                player_id: dtype === 'PREPARE_PLAYER_CHARTS' && !isAllCharts ? Number(chartId) : null,
                chart_all_players: dtype === 'PREPARE_PLAYER_CHARTS' && isAllCharts,
                chart_refresh: dtype === 'PREPARE_PLAYER_CHARTS' && document.getElementById('manualChartRefresh').checked,
                chart_mode: dtype === 'PREPARE_PLAYER_CHARTS' && !isAllCharts ? chartMode : 'batting',
                data_type: dtype,
                season: season,
                start_date: sDate,
                end_date: eDate,
                force_csv_download: dtype === "PREPARE_SOURCE_CSVS" && document.getElementById("manualCsvForce").checked,
                trigger_type: "MANUAL"
            });
        });
    }

    const btnSaveSched = document.getElementById("btnSaveSchedules");
    if (btnSaveSched) {
        btnSaveSched.addEventListener("click", saveSchedulesConfig);
    }

    const btnRefreshLogs = document.getElementById("btnRefreshLogs");
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener("click", () => {
            loadSyncLogs();
            loadDashboardSummary();
        });
    }
}

let logPollTimer = null;

async function executeManualSync(payload) {
    try {
        const res = await adminFetch("/api/admin/baseball-data/fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || "수집 요청 실패");
        }

        if (typeof showAdminMessage === "function") {
            showAdminMessage(data.message || "파이프라인 실행이 시작되었습니다.");
        } else {
            alert(data.message || "파이프라인 실행이 시작되었습니다.");
        }

        loadSyncLogs();

        // RUNNING 상태인 작업이 있는 동안 3초마다 진행 단계([1/3] -> [2/3] -> [3/3]) 자동 갱신
        if (logPollTimer) clearInterval(logPollTimer);
        logPollTimer = setInterval(async () => {
            await loadSyncLogs();
            const hasRunning = currentLogs.some(l => l.status === "RUNNING");
            if (!hasRunning) {
                clearInterval(logPollTimer);
                logPollTimer = null;
                loadDashboardSummary();
                loadCategoryData();
                loadSchedules();
            }
        }, 3000);

    } catch (e) {
        console.error(e);
        alert(e.message || "데이터 가져오기 실행 중 오류가 발생했습니다.");
    }
}

async function loadSchedules() {
    const container = document.getElementById("scheduleListContainer");
    if (!container) return;

    try {
        const res = await adminFetch("/api/admin/baseball-data/schedules");
        if (!res.ok) return;
        const data = await res.json();
        const list = data.schedules || [];

        container.innerHTML = "";
        list.forEach(item => {
            const row = document.createElement("div");
            row.className = "schedule-item-row";
            row.dataset.dtype = item.data_type;

            row.innerHTML = `
                <div class="schedule-title">
                    <strong>${item.label}</strong>
                    <small>최근 실행: ${item.last_run_at || "기록 없음"}</small>
                    ${item.data_type === "STEP_SAVANT_REPAIR" ? '<small>Extension은 유지하고 나머지 지표를 일괄 갱신합니다.</small>' : ''}
                    ${item.data_type === "STEP_SAVANT_EXTENSION" ? '<small>로컬 CSV의 Extension·공식 백분위를 우선 사용합니다. Extension이 없으면 선수별 온라인 조회로 보충합니다.</small>' : ''}
                </div>
                <select class="sched-interval">
                    <option value="EVERY_6H" ${item.interval_type === "EVERY_6H" ? "selected" : ""}>6시간마다</option>
                    <option value="EVERY_12H" ${item.interval_type === "EVERY_12H" ? "selected" : ""}>12시간마다</option>
                    <option value="DAILY" ${item.interval_type === "DAILY" ? "selected" : ""}>매일 1회</option>
                    <option value="WEEKLY" ${item.interval_type === "WEEKLY" ? "selected" : ""}>매주 1회</option>
                </select>
                <input type="time" class="sched-time" value="${item.run_time || '04:00'}">
                <input type="text" class="sched-target" value="${item.target_option || '2024'}" title="대상 시즌 또는 옵션">
                <label class="switch-label" style="justify-content: flex-end;">
                    <input type="checkbox" class="sched-enabled" ${item.is_enabled ? "checked" : ""}>
                    <span>자동</span>
                </label>
            `;
            container.appendChild(row);
        });
    } catch (e) {
        console.error("스케줄 로드 실패:", e);
    }
}

async function saveSchedulesConfig() {
    const rows = document.querySelectorAll("#scheduleListContainer .schedule-item-row");
    const schedules = [];

    rows.forEach(r => {
        schedules.push({
            data_type: r.dataset.dtype,
            interval_type: r.querySelector(".sched-interval").value,
            run_time: r.querySelector(".sched-time").value,
            target_option: r.querySelector(".sched-target").value.trim(),
            is_enabled: r.querySelector(".sched-enabled").checked
        });
    });

    try {
        const res = await adminFetch("/api/admin/baseball-data/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedules })
        });
        if (!res.ok) throw new Error("저장 실패");
        const data = await res.json();

        if (typeof showAdminMessage === "function") {
            showAdminMessage(data.message);
        } else {
            alert(data.message);
        }
        loadSchedules();
    } catch (e) {
        console.error(e);
        alert("스케줄 저장 중 오류가 발생했습니다.");
    }
}


// =========================================================
// 4. 데이터 수집 기록 조회 및 컬럼 클릭 정렬
// =========================================================
function initLogTableSorting() {
    const ths = document.querySelectorAll("#syncLogsThead th.sortable");
    ths.forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.col;
            if (logSortConfig.key === col) {
                logSortConfig.dir = logSortConfig.dir === "asc" ? "desc" : "asc";
            } else {
                logSortConfig.key = col;
                logSortConfig.dir = "desc";
            }

            ths.forEach(el => {
                el.classList.remove("asc", "desc");
                const icon = el.querySelector(".sort-icon");
                if (icon) icon.textContent = "↕";
            });
            th.classList.add(logSortConfig.dir);
            const activeIcon = th.querySelector(".sort-icon");
            if (activeIcon) activeIcon.textContent = logSortConfig.dir === "asc" ? "▲" : "▼";

            renderSyncLogsTable();
        });
    });
}

async function loadSyncLogs() {
    try {
        const res = await adminFetch("/api/admin/baseball-data/logs?limit=50");
        if (!res.ok) return;
        const data = await res.json();
        currentLogs = data.logs || [];
        renderSyncLogsTable();
    } catch (e) {
        console.error("로그 조회 실패:", e);
    }
}

function renderSyncLogsTable() {
    const tbody = document.getElementById("syncLogsTbody");
    if (!tbody) return;

    if (!currentLogs.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty">아직 실행된 데이터 수집 기록이 없습니다. 상단에서 데이터를 가져오면 이곳에 기록됩니다.</td></tr>`;
        return;
    }

    const sorted = sortArrayByColumn(currentLogs, logSortConfig.key, logSortConfig.dir);
    tbody.innerHTML = "";

    sorted.forEach(log => {
        const tr = document.createElement("tr");

        let statusTag = `<span class="tag tag-warning">진행중</span>`;
        if (log.status === "SUCCESS") statusTag = `<span class="tag tag-success">성공 (SUCCESS)</span>`;
        else if (log.status === "PARTIAL") statusTag = `<span class="tag tag-warning">일부 성공 (PARTIAL)</span>`;
        else if (log.status === "FAILED") statusTag = `<span class="tag tag-danger">실패 (FAILED)</span>`;

        const triggerBadge = log.trigger_type === "AUTO"
            ? `<span class="tag tag-info">자동 스케줄</span>`
            : `<span class="tag" style="background:#f1f5f9; color:#334155;">수동 실행</span>`;

        const typeLabel = DATA_TYPE_LABELS[log.data_type] || log.data_type;
        const durText = log.duration_sec !== null && log.duration_sec !== undefined ? `${log.duration_sec}초` : "-";

        tr.innerHTML = `
            <td><strong>#${log.log_id}</strong></td>
            <td><strong>${typeLabel}</strong></td>
            <td>${triggerBadge}</td>
            <td>${log.target_param || "-"}</td>
            <td><strong>${Number(log.records_affected || 0).toLocaleString()}건</strong></td>
            <td>${durText}</td>
            <td>${log.started_at || "-"}</td>
            <td>${statusTag}</td>
            <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis;" title="${log.message || ''}">
                ${log.message || "-"}
            </td>
        `;
        tbody.appendChild(tr);
    });
}
