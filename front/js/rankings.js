let currentSort = "win_rate";

// prediction.js의 로그인 유저 판정 로직과 통일
function getLoggedInUserId() {
    try {
        const userStr = sessionStorage.getItem("user") || localStorage.getItem("user");
        if (userStr) {
            const u = JSON.parse(userStr);
            if (u && (u.user_id || u.id)) return u.user_id || u.id;
        }
    } catch (e) {
        console.warn("유저 정보 파싱 실패:", e);
    }
    return localStorage.getItem("test_user_id") || "1"; // 기본 1번 유저 fallback
}

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    fetchMyStatus();
    fetchLeaderboard(currentSort);
});

function initTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const banner = document.getElementById("tabInfoBanner");
    const thPrimary = document.getElementById("thPrimaryMetric");
    const thLast = document.getElementById("thLastMetric");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            currentSort = tab.dataset.sort;

            // 탭별 안내 문구 및 헤더 텍스트 전환
            if (currentSort === "win_rate") {
                banner.style.display = "block";
                thPrimary.textContent = "예측 승률";
                if (thLast) thLast.textContent = "보유 포인트";
            } else if (currentSort === "streak") {
                banner.style.display = "none";
                thPrimary.textContent = "현재 연승";
                if (thLast) thLast.textContent = "보유 포인트";
            } else if (currentSort === "max_streak") {
                banner.style.display = "none";
                thPrimary.textContent = "최대 연승";
                if (thLast) thLast.textContent = "보유 포인트";
            } else if (currentSort === "most_wins") {
                banner.style.display = "none";
                thPrimary.textContent = "총 적중 수";
                if (thLast) thLast.textContent = "보유 포인트";
            } else if (currentSort === "point") {
                banner.style.display = "none";
                thPrimary.textContent = "보유 포인트";
                // 포인트 탭에서는 마지막 열의 중복을 피하고 '예측 승률'로 대체!
                if (thLast) thLast.textContent = "예측 승률";
            }

            fetchLeaderboard(currentSort);
        });
    });
}

// 1. 내 통계 카드 바인딩
async function fetchMyStatus() {
    const userId = getLoggedInUserId();
    if (!userId) {
        document.getElementById("myNickname").textContent = "로그인 필요";
        return;
    }

    try {
        const res = await fetch(`http://127.0.0.1:8000/api/rankings/me?user_id=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        const user = data.user_info;

        document.getElementById("myNickname").textContent = user.nickname || "분석관";
        
        const badge = document.getElementById("myGradeBadge");
        badge.textContent = user.grade || "BRONZE";
        badge.className = `grade-badge ${user.grade || 'BRONZE'}`;

        document.getElementById("myWinRank").textContent = data.win_rate_rank ? `${data.win_rate_rank}위` : "순위 외 (미달)";
        document.getElementById("myWinRate").textContent = `${user.win_rate}%`;
        document.getElementById("myRecord").textContent = `${user.correct_predictions}승 / ${user.total_predictions}전`;
        document.getElementById("myStreak").textContent = `${user.prediction_streak}연승 (최고 ${user.max_prediction_streak})`;
        document.getElementById("myPoint").textContent = `${Number(user.point).toLocaleString()} P`;

    } catch (err) {
        console.error("내 랭킹 정보 조회 실패:", err);
    }
}

// 리더보드 테이블 렌더링
async function fetchLeaderboard(sort) {
    const tbody = document.getElementById("leaderboardBody");
    tbody.innerHTML = `<tr><td colspan="8" class="text-center loading-text">집계 중입니다...</td></tr>`;

    try {
        const res = await fetch(`http://127.0.0.1:8000/api/rankings?sort_by=${sort}&limit=50`);
        if (!res.ok) throw new Error("리더보드를 가져오지 못했습니다.");
        const result = await res.json();
        const list = result.data;

        if (!list || list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center loading-text">해당 기준의 랭킹 기록이 아직 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        list.forEach(row => {
            const tr = document.createElement("tr");

            // 순위 뱃지 (1~3위 메달)
            let rankHtml = `<span class="rank-num">${row.rank}</span>`;
            if (row.rank === 1) rankHtml = `<span class="rank-badge rank-1">🥇</span>`;
            else if (row.rank === 2) rankHtml = `<span class="rank-badge rank-2">🥈</span>`;
            else if (row.rank === 3) rankHtml = `<span class="rank-badge rank-3">🥉</span>`;

            // 정렬 기준 대표 수치 포맷
            let primaryMetricHtml = "";
            if (sort === "win_rate") {
                primaryMetricHtml = `<span class="primary-metric-val">${row.win_rate}%</span>`;
            } else if (sort === "streak") {
                primaryMetricHtml = `<span class="primary-metric-val streak-highlight">🔥 ${row.prediction_streak}연승</span>`;
            } else if (sort === "max_streak") {
                primaryMetricHtml = `<span class="primary-metric-val">⚡ ${row.max_prediction_streak}연승</span>`;
            } else if (sort === "most_wins") {
                primaryMetricHtml = `<span class="primary-metric-val">${row.correct_predictions}회</span>`;
            } else if (sort === "point") {
                primaryMetricHtml = `<span class="primary-metric-val" style="color:#d97706;">${row.point.toLocaleString()} P</span>`;
            }

            // 마지막 열 내용: 포인트 탭일 때는 승률 표시, 그 외 탭에서는 보유 포인트 표시
            let lastMetricHtml = "";
            if (sort === "point") {
                lastMetricHtml = `<strong>${row.win_rate}%</strong>`;
            } else {
                lastMetricHtml = `<strong>${row.point.toLocaleString()} P</strong>`;
            }

            const teamCode = row.favorite_team ? row.favorite_team.code : "-";

            tr.innerHTML = `
                <td class="text-center">${rankHtml}</td>
                <td>
                    <div class="user-cell">
                        <span>${row.nickname}</span>
                    </div>
                </td>
                <td class="text-center"><span class="grade-badge ${row.grade}">${row.grade}</span></td>
                <td class="text-center"><span class="team-tag">${teamCode}</span></td>
                <td class="text-right">${primaryMetricHtml}</td>
                <td class="text-right">${row.correct_predictions} / ${row.total_predictions}</td>
                <td class="text-right">${row.prediction_streak}연승 <span style="font-size:12px; color:#94a3b8;">(최대 ${row.max_prediction_streak})</span></td>
                <td class="text-right">${lastMetricHtml}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("리더보드 로딩 실패:", err);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center loading-text" style="color:#ef4444;">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
    }
}