

document.addEventListener("DOMContentLoaded", () => {
    loadPredictionHistory();
});


// ==================================================
// 경기 예측 기록 조회
// ==================================================

async function loadPredictionHistory() {
    const token = sessionStorage.getItem("access_token");

    // 로그인 확인
    if (!token) {
        alert("로그인이 필요합니다.");
        window.location.href = "/pages/auth/login.html";
        return;
    }

    try {
        const response = await fetch(
            "/api/mypage/prediction-history",
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        // 인증 만료 또는 인증 오류
        if (response.status === 401) {
            alert("로그인이 만료되었습니다. 다시 로그인해 주세요.");
            sessionStorage.removeItem("access_token");
            window.location.href = "/pages/auth/login.html";
            return;
        }

        if (!response.ok) {
            throw new Error(
                `예측 기록 조회 실패: ${response.status}`
            );
        }

        const data = await response.json();

        // 통계 및 기록 표시
        renderPredictionStats(data.stats);
        renderPredictionHistory(data.history);

    } catch (error) {
        console.error("예측 기록 조회 오류:", error);
        showHistoryError();
    }
}


// ==================================================
// 통계 카드 표시
// ==================================================

function renderPredictionStats(stats) {
    const statCards = document.querySelectorAll(
        ".mypage-stat-card .mypage-stat-value"
    );

    if (statCards.length < 4) {
        console.error("예측 통계 카드 요소를 찾을 수 없습니다.");
        return;
    }

    statCards[0].textContent =
        `${stats.total_predictions ?? 0}회`;

    statCards[1].textContent =
        `${stats.correct_predictions ?? 0}회`;

    statCards[2].textContent =
        `${stats.incorrect_predictions ?? 0}회`;

    statCards[3].textContent =
        `${stats.accuracy ?? 0}%`;
}


// ==================================================
// 최근 예측 기록 표시
// ==================================================

function renderPredictionHistory(history) {
    const tbody = document.querySelector(
        ".mypage-table tbody"
    );

    if (!tbody) {
        console.error("예측 기록 테이블을 찾을 수 없습니다.");
        return;
    }

    // 기존 내용 초기화
    tbody.replaceChildren();

    // 예측 기록이 없는 경우
    if (!history || history.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        const empty = document.createElement("div");

        td.colSpan = 5;
        empty.className = "mypage-empty";
        empty.textContent = "아직 참여한 예측 기록이 없습니다.";

        td.appendChild(empty);
        tr.appendChild(td);
        tbody.appendChild(tr);

        return;
    }

    // 날짜 기준 최신순 정렬 (최신 날짜 → 과거 날짜)
    const sortedHistory = [...history].sort((a, b) => {
        const dateA = String(a.date ?? "");
        const dateB = String(b.date ?? "");

        return dateB.localeCompare(dateA);
    });

    // 정렬된 기록 표시
    sortedHistory.forEach((item) => {
        const tr = document.createElement("tr");

        // 날짜
        tr.appendChild(
            createCell(formatDate(item.date))
        );

        // 경기 대진
        tr.appendChild(
            createCell(item.game ?? "-")
        );

        // 내가 예측한 팀
        tr.appendChild(
            createCell(item.selected_team ?? "-")
        );

        // 실제 경기 결과
        tr.appendChild(
            createCell(item.game_result ?? "-")
        );

        // 예측 적중 여부
        const resultCell = createCell(
            item.prediction_result ?? "결과 대기"
        );

        resultCell.classList.add(
            getResultClass(item.prediction_result)
        );

        tr.appendChild(resultCell);
        tbody.appendChild(tr);
    });
}


// ==================================================
// 테이블 셀 생성
// ==================================================

function createCell(value) {
    const td = document.createElement("td");

    // innerHTML 대신 textContent 사용
    td.textContent = value;

    return td;
}


// ==================================================
// 날짜 형식
// ==================================================

function formatDate(dateValue) {
    if (!dateValue) {
        return "-";
    }

    // YYYY-MM-DD 형식이면 시간대 변환 없이 표시
    const dateString = String(dateValue);

    const match = dateString.match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    return dateString;
}


// ==================================================
// 예측 결과 CSS 클래스
// ==================================================

function getResultClass(result) {
    switch (result) {
        case "적중":
            return "prediction-correct";

        case "실패":
            return "prediction-incorrect";

        case "결과 대기":
            return "prediction-pending";

        case "경기 취소":
            return "prediction-cancelled";

        default:
            return "";
    }
}


// ==================================================
// 오류 표시
// ==================================================

function showHistoryError() {
    const tbody = document.querySelector(
        ".mypage-table tbody"
    );

    if (!tbody) {
        return;
    }

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const empty = document.createElement("div");

    td.colSpan = 5;
    empty.className = "mypage-empty";
    empty.textContent =
        "예측 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

    td.appendChild(empty);
    tr.appendChild(td);
    tbody.replaceChildren(tr);
}
