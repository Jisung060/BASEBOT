"use strict";

let teamStatsData = [];
let teamSort = { key: "vote_count", dir: "desc" };

let gamePredData = [];
let gameSort = { key: "total_votes", dir: "desc" };

let userRankingData = [];
let rankSort = { key: "rank", dir: "asc" };

let userRecordData = [];
let recordSort = { key: "vote_id", dir: "desc" };

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    initSortableTable("teamStatsThead", teamSort, renderTeamStatsTable);
    initSortableTable("gamePredThead", gameSort, renderGamePredTable);
    initSortableTable("userRankingThead", rankSort, renderUserRankingTable);
    initSortableTable("userRecordThead", recordSort, renderUserRecordTable);

    initFilterForms();

    loadOverviewAndTeamStats();
    loadGamePredictions();
    loadUserRankings();
    loadUserRecords();
});

// =========================================================
// 공통 정렬 유틸리티 및 헤더 바인딩
// =========================================================
function sortDataArray(arr, key, dir) {
    if (!key) return arr;
    const mult = dir === "asc" ? 1 : -1;

    return [...arr].sort((a, b) => {
        const va = a[key];
        const vb = b[key];

        if (va === null || va === undefined || va === "-") return 1;
        if (vb === null || vb === undefined || vb === "-") return -1;

        const na = Number(va);
        const nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== "" && String(vb).trim() !== "") {
            return (na - nb) * mult;
        }
        return String(va).localeCompare(String(vb), "ko", { numeric: true }) * mult;
    });
}

function initSortableTable(theadId, sortStateObj, renderCallback) {
    const ths = document.querySelectorAll(`#${theadId} th.sortable`);
    ths.forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.col;
            if (sortStateObj.key === col) {
                sortStateObj.dir = sortStateObj.dir === "asc" ? "desc" : "asc";
            } else {
                sortStateObj.key = col;
                sortStateObj.dir = "desc";
            }

            ths.forEach(el => {
                el.classList.remove("asc", "desc");
                const icon = el.querySelector(".sort-icon");
                if (icon) icon.textContent = "↕";
            });
            th.classList.add(sortStateObj.dir);
            const activeIcon = th.querySelector(".sort-icon");
            if (activeIcon) activeIcon.textContent = sortStateObj.dir === "asc" ? "▲" : "▼";

            renderCallback();
        });
    });
}

function initFilterForms() {
    const gameForm = document.getElementById("gamePredFilterForm");
    if (gameForm) {
        gameForm.addEventListener("submit", e => {
            e.preventDefault();
            loadGamePredictions();
        });
    }

    const onlyVotedChk = document.getElementById("filterOnlyVoted");
    if (onlyVotedChk) {
        onlyVotedChk.addEventListener("change", loadGamePredictions);
    }

    const rankForm = document.getElementById("userRankingFilterForm");
    if (rankForm) {
        rankForm.addEventListener("submit", e => {
            e.preventDefault();
            loadUserRankings();
        });
    }

    const recordForm = document.getElementById("userRecordFilterForm");
    if (recordForm) {
        recordForm.addEventListener("submit", e => {
            e.preventDefault();
            loadUserRecords();
        });
    }
}

// =========================================================
// 1. 상단 KPI + 하이라이트 경기 3종 + 구단별 적중률 통계
// =========================================================
async function loadOverviewAndTeamStats() {
    try {
        const res = await adminFetch("/api/admin/predictions/overview");
        if (!res.ok) throw new Error("통계 로드 실패");
        const data = await res.json();

        const kpi = data.kpi || {};
        document.getElementById("kpiTotalVotes").textContent = `${Number(kpi.total_votes || 0).toLocaleString()}건`;
        document.getElementById("kpiUniqueUsers").textContent = `참여 회원 총 ${Number(kpi.unique_users || 0).toLocaleString()}명`;

        document.getElementById("kpiOverallAccuracy").textContent = `${kpi.overall_accuracy ?? 0}%`;
        document.getElementById("kpiHitDetail").textContent =
            `정산 ${Number(kpi.settled_votes || 0).toLocaleString()}건 중 ${Number(kpi.correct_votes || 0).toLocaleString()}건 적중`;

        const betP = Number(kpi.total_bet_points || 0).toLocaleString();
        const rewP = Number(kpi.total_reward_points || 0).toLocaleString();
        document.getElementById("kpiTotalPoints").textContent = `${betP} P / ${rewP} P`;

        const pendingCnt = Number(kpi.pending_votes || 0);
        const pendingEl = document.getElementById("kpiPendingVotes");
        pendingEl.textContent = `${pendingCnt.toLocaleString()}건`;
        pendingEl.style.color = pendingCnt > 0 ? "#b45309" : "#0f172a";

        // 하이라이트 경기 3종 바인딩
        const hl = data.highlights || {};
        bindHighlightCard("hlMostHit", hl.most_hit_game, g => `적중 ${g.correct_votes}표 (총 ${g.total_votes}표 참여)`);
        bindHighlightCard("hlHighAcc", hl.highest_acc_game, g => `적중률 ${g.accuracy}% (${g.correct_votes}/${g.settled_votes}표 적중)`);
        bindHighlightCard("hlLowAcc", hl.lowest_acc_game, g => `적중률 ${g.accuracy}% (${g.correct_votes}/${g.settled_votes}표 적중)`);

        // 구단별 통계 테이블
        teamStatsData = data.team_stats || [];
        document.getElementById("teamStatsCountLabel").textContent = `투표 발생 구단: 총 ${teamStatsData.length}개`;
        renderTeamStatsTable();

    } catch (e) {
        console.error("예측 개요 로드 오류:", e);
    }
}

function bindHighlightCard(prefix, gameObj, metricFormatter) {
    const titleEl = document.getElementById(`${prefix}Title`);
    const valEl = document.getElementById(`${prefix}Value`);
    const descEl = document.getElementById(`${prefix}Desc`);

    if (!gameObj) {
        titleEl.textContent = "정산 완료된 경기 없음";
        valEl.textContent = "—";
        return;
    }

    titleEl.textContent = `${gameObj.game_date} | ${gameObj.matchup}`;
    valEl.textContent = metricFormatter(gameObj);
    descEl.textContent = `경기 ID #${gameObj.game_id} · 최종 스코어 (${gameObj.matchup_short})`;
}

function renderTeamStatsTable() {
    const tbody = document.getElementById("teamStatsTbody");
    if (!tbody) return;

    if (!teamStatsData.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty">집계된 구단별 투표 데이터가 없습니다.</td></tr>`;
        return;
    }

    const sorted = sortDataArray(teamStatsData, teamSort.key, teamSort.dir);
    tbody.innerHTML = "";

    sorted.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong style="color:#0f172a;">${t.team_name} (${t.team_code})</strong></td>
            <td>${t.division}</td>
            <td><strong>${t.vote_count.toLocaleString()}표</strong></td>
            <td style="color:#15803d; font-weight:700;">${t.hit_count.toLocaleString()}표</td>
            <td style="color:#b91c1c;">${t.miss_count.toLocaleString()}표</td>
            <td>
                <div class="acc-bar-wrap">
                    <div class="acc-bar-bg"><div class="acc-bar-fill" style="width:${Math.min(100, t.accuracy)}%;"></div></div>
                    <strong>${t.accuracy}%</strong>
                </div>
            </td>
            <td>${t.total_bet.toLocaleString()} P</td>
            <td><strong>${t.total_reward.toLocaleString()} P</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

// =========================================================
// 2. 경기별 예측 현황 테이블 및 수동 정산
// =========================================================
async function loadGamePredictions() {
    const gDate = document.getElementById("filterGameDate").value;
    const status = document.getElementById("filterGameStatus").value;
    const team = document.getElementById("filterGameTeam").value.trim();
    const onlyVoted = document.getElementById("filterOnlyVoted").checked;

    const params = new URLSearchParams({ limit: "200", only_voted: String(onlyVoted) });
    if (gDate) params.append("game_date", gDate);
    if (status) params.append("status", status);
    if (team) params.append("team", team);

    const tbody = document.getElementById("gamePredTbody");
    tbody.innerHTML = `<tr><td colspan="13" class="table-empty">경기별 예측 데이터를 불러오는 중입니다...</td></tr>`;

    try {
        const res = await adminFetch(`/api/admin/predictions/games?${params.toString()}`);
        if (!res.ok) throw new Error("경기별 예측 조회 실패");
        const data = await res.json();
        gamePredData = data.games || [];

        document.getElementById("gamePredCountLabel").textContent = `조회 결과: 총 ${gamePredData.length}경기`;
        renderGamePredTable();
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="13" class="table-empty">데이터 로드 중 오류가 발생했습니다.</td></tr>`;
    }
}

function renderGamePredTable() {
    const tbody = document.getElementById("gamePredTbody");
    if (!tbody) return;

    if (!gamePredData.length) {
        tbody.innerHTML = `<tr><td colspan="13" class="table-empty">조건에 해당하는 경기가 없습니다. ('투표 있는 경기만' 체크를 해제해 보세요)</td></tr>`;
        return;
    }

    const sorted = sortDataArray(gamePredData, gameSort.key, gameSort.dir);
    tbody.innerHTML = "";

    sorted.forEach(g => {
        const tr = document.createElement("tr");

        let statusTag = `<span class="tag tag-info">${g.status}</span>`;
        if (g.status === "FINAL") statusTag = `<span class="tag tag-success">FINAL (종료)</span>`;
        else if (g.status === "IN_PROGRESS" || g.status === "LIVE") statusTag = `<span class="tag tag-danger">LIVE (진행중)</span>`;

        const accText = g.accuracy !== null && g.accuracy !== undefined ? `<strong>${g.accuracy}%</strong>` : "-";

        let actionHtml = `<span style="color:#94a3b8; font-size:11px;">완료</span>`;
        if (g.status === "FINAL" && g.unsettled_votes > 0) {
            actionHtml = `<button type="button" class="button button-primary" style="min-height:28px; padding:4px 10px; font-size:11px;" onclick="settleGameFromAdmin(${g.game_id})">정산 실행 (${g.unsettled_votes}건)</button>`;
        } else if (g.status !== "FINAL") {
            actionHtml = `<span style="color:#64748b; font-size:11px;">대기</span>`;
        }

        tr.innerHTML = `
            <td><strong>#${g.game_id}</strong></td>
            <td>${g.game_date}</td>
            <td><strong style="color:#0f172a;">${g.matchup}</strong></td>
            <td>${statusTag}</td>
            <td>${g.game_result}</td>
            <td><strong>${g.total_votes.toLocaleString()}표</strong></td>
            <td>${g.home_votes.toLocaleString()}표</td>
            <td>${g.away_votes.toLocaleString()}표</td>
            <td>${g.home_bet_points.toLocaleString()} P</td>
            <td>${g.away_bet_points.toLocaleString()} P</td>
            <td style="color:#15803d; font-weight:700;">${g.correct_votes.toLocaleString()}표</td>
            <td>${accText}</td>
            <td>${actionHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function settleGameFromAdmin(gameId) {
    if (!confirm(`경기 #${gameId}의 미정산 투표를 즉시 정산하시겠습니까?`)) return;
    try {
        const res = await adminFetch(`/api/predictions/settle/${gameId}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "정산 실패");

        if (typeof showAdminMessage === "function") {
            showAdminMessage(data.message || "정산이 완료되었습니다.");
        } else {
            alert(data.message || "정산이 완료되었습니다.");
        }

        loadOverviewAndTeamStats();
        loadGamePredictions();
        loadUserRankings();
        loadUserRecords();
    } catch (e) {
        alert(`정산 오류: ${e.message}`);
    }
}

// =========================================================
// 3. 관리자 전용 사용자 상세 예측 랭킹
// =========================================================
async function loadUserRankings() {
    const kw = document.getElementById("filterRankUser").value.trim();
    const params = new URLSearchParams({ limit: "150" });
    if (kw) params.append("keyword", kw);

    const tbody = document.getElementById("userRankingTbody");
    tbody.innerHTML = `<tr><td colspan="14" class="table-empty">사용자 랭킹 데이터를 불러오는 중입니다...</td></tr>`;

    try {
        const res = await adminFetch(`/api/admin/predictions/user-rankings?${params.toString()}`);
        if (!res.ok) throw new Error("랭킹 조회 실패");
        const data = await res.json();
        userRankingData = data.rankings || [];

        document.getElementById("userRankingCountLabel").textContent = `총 ${userRankingData.length}명`;
        renderUserRankingTable();
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="14" class="table-empty">사용자 랭킹 로드 실패</td></tr>`;
    }
}

function renderUserRankingTable() {
    const tbody = document.getElementById("userRankingTbody");
    if (!tbody) return;

    if (!userRankingData.length) {
        tbody.innerHTML = `<tr><td colspan="14" class="table-empty">조건에 해당하는 사용자가 없습니다.</td></tr>`;
        return;
    }

    const sorted = sortDataArray(userRankingData, rankSort.key, rankSort.dir);
    tbody.innerHTML = "";

    sorted.forEach(u => {
        const tr = document.createElement("tr");
        const profitColor = u.net_profit > 0 ? "#15803d" : (u.net_profit < 0 ? "#b91c1c" : "#475569");
        const profitSign = u.net_profit > 0 ? `+${u.net_profit.toLocaleString()}` : u.net_profit.toLocaleString();

        tr.innerHTML = `
            <td><strong>${u.rank}위</strong></td>
            <td><strong style="color:#0f172a;">${u.nickname}</strong> <span style="color:#94a3b8; font-size:11px;">(${u.username})</span></td>
            <td><span class="tag tag-info">${u.grade}</span></td>
            <td>${u.fav_team_code}</td>
            <td><strong>${u.total_votes}회</strong></td>
            <td style="color:#15803d; font-weight:700;">${u.correct_votes}회</td>
            <td style="color:#b91c1c;">${u.failed_votes}회</td>
            <td><strong>${u.accuracy}%</strong></td>
            <td>🔥 ${u.prediction_streak}연승</td>
            <td>🏆 ${u.max_prediction_streak}연승</td>
            <td><strong>${u.current_point.toLocaleString()} P</strong></td>
            <td>${u.total_bet_points.toLocaleString()} P</td>
            <td>${u.total_reward_points.toLocaleString()} P</td>
            <td style="color:${profitColor}; font-weight:800;">${profitSign} P</td>
        `;
        tbody.appendChild(tr);
    });
}

// =========================================================
// 4. 사용자 예측 기록 (개별 투표 이력)
// =========================================================
async function loadUserRecords() {
    const user = document.getElementById("filterRecordUser").value.trim();
    const gDate = document.getElementById("filterRecordDate").value;
    const rStatus = document.getElementById("filterRewardStatus").value;

    const params = new URLSearchParams({ limit: "200" });
    if (user) params.append("user", user);
    if (gDate) params.append("game_date", gDate);
    if (rStatus) params.append("reward_status", rStatus);

    const tbody = document.getElementById("userRecordTbody");
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty">예측 기록을 불러오는 중입니다...</td></tr>`;

    try {
        const res = await adminFetch(`/api/admin/predictions/records?${params.toString()}`);
        if (!res.ok) throw new Error("기록 조회 실패");
        const data = await res.json();
        userRecordData = data.records || [];

        document.getElementById("userRecordCountLabel").textContent = `조회 결과: 총 ${userRecordData.length}건`;
        renderUserRecordTable();
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="11" class="table-empty">예측 기록 로드 중 오류가 발생했습니다.</td></tr>`;
    }
}

function renderUserRecordTable() {
    const tbody = document.getElementById("userRecordTbody");
    if (!tbody) return;

    if (!userRecordData.length) {
        tbody.innerHTML = `<tr><td colspan="11" class="table-empty">조건에 해당하는 예측 투표 기록이 없습니다.</td></tr>`;
        return;
    }

    const sorted = sortDataArray(userRecordData, recordSort.key, recordSort.dir);
    tbody.innerHTML = "";

    sorted.forEach(r => {
        const tr = document.createElement("tr");

        let badgeClass = "tag-warning";
        if (r.status_code === "PAID") badgeClass = "tag-success";
        else if (r.status_code === "FAILED") badgeClass = "tag-danger";

        tr.innerHTML = `
            <td><strong>#${r.vote_id}</strong></td>
            <td><strong style="color:#0f172a;">${r.user_display}</strong></td>
            <td>${r.game_date}</td>
            <td>${r.matchup}</td>
            <td><strong style="color:#1d4ed8;">${r.selected_team_name}</strong></td>
            <td>${r.game_result}</td>
            <td>${r.bet_point.toLocaleString()} P</td>
            <td><strong>${r.user_total_bet.toLocaleString()} P</strong></td>
            <td><strong style="color:${r.reward_point > 0 ? '#15803d' : '#64748b'};">+${r.reward_point.toLocaleString()} P</strong></td>
            <td><span class="tag ${badgeClass}">${r.status_label}</span></td>
            <td style="font-size:11px; color:#64748b;">${r.voted_at}</td>
        `;
        tbody.appendChild(tr);
    });
}