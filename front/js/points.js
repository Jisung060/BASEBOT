
/* ==================================================
   BASEBOT 포인트 / 등급 페이지
================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    // 로그인 확인
    const accessToken = sessionStorage.getItem("access_token");

    if (!accessToken) {
        alert("로그인이 필요한 서비스입니다.");
        location.href = "login.html";
        return;
    }

    try {
        // ================================================
        // 1. 로그인 사용자 정보 조회
        // ================================================
        const response = await fetch("/users/mypage", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        });

        // 로그인 만료
        if (response.status === 401) {
            sessionStorage.removeItem("access_token");
            sessionStorage.removeItem("user");

            alert("로그인이 만료되었습니다.");
            location.href = "login.html";
            return;
        }

        if (!response.ok) {
            throw new Error("포인트 정보를 불러오지 못했습니다.");
        }

        const data = await response.json();

        // ================================================
        // 2. 현재 포인트
        // ================================================
        setText(
            "userPoint",
            `${Number(data.point ?? 0).toLocaleString()} P`
        );

        // ================================================
        // 3. 현재 등급
        // ================================================
        const grade = String(data.grade || "BRONZE").toUpperCase();

        setText("userGrade", grade);
        setText("userGradeBadge", grade);
        setText("currentGradeLabel", grade);

        // ================================================
        // 4. 연속 적중 정보
        // ================================================
        setText(
            "userPredictionStreak",
            `${Number(data.prediction_streak ?? 0)}회`
        );

        setText(
            "userMaxPredictionStreak",
            `${Number(data.max_prediction_streak ?? 0)}회`
        );

        // ================================================
        // 5. 등급 진행률
        // ================================================
        renderGradeProgress(data);

        // ================================================
        // 6. 포인트 지급 내역 조회
        // ================================================
        await loadPointHistory(accessToken);

    } catch (error) {
        console.error("포인트 / 등급 조회 오류:", error);

        setText("userPoint", "-");
        setText("userGrade", "-");
        setText("userPredictionStreak", "-");
        setText("userMaxPredictionStreak", "-");
        setText("userGradeBadge", "-");
        setText("currentGradeLabel", "-");

        const nextGradePoint = document.getElementById("nextGradePoint");

        if (nextGradePoint) {
            nextGradePoint.textContent = "등급 정보를 불러올 수 없습니다.";
        }

        showPointHistoryMessage(
            "포인트 정보를 불러오는 중 오류가 발생했습니다."
        );
    }
});


// ==================================================
// 등급별 승급 기준 포인트
// 실제 BASEBOT 등급 기준에 맞게 수정
// ==================================================
const GRADE_THRESHOLDS = {
    BRONZE: 0,
    SILVER: 2000,
    GOLD: 5000,
    PLATINUM: 10000,
    DIAMOND: 20000
};

const GRADE_ORDER = [
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    "DIAMOND"
];


// ==================================================
// 공통 텍스트 출력
// ==================================================
function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


// ==================================================
// 등급 진행률 표시
// ==================================================
function renderGradeProgress(data) {
    const grade = String(data.grade || "BRONZE").toUpperCase();
    const point = Number(data.point ?? 0);

    const progressBar = document.getElementById("gradeProgressValue");
    const nextGradePoint = document.getElementById("nextGradePoint");

    if (!progressBar || !nextGradePoint) {
        return;
    }

    const gradeIndex = GRADE_ORDER.indexOf(grade);

    // 등록되지 않은 등급
    if (gradeIndex === -1) {
        progressBar.style.width = "0%";
        nextGradePoint.textContent = "등급 기준을 확인할 수 없습니다.";
        return;
    }

    // 최고 등급
    if (gradeIndex === GRADE_ORDER.length - 1) {
        progressBar.style.width = "100%";
        nextGradePoint.textContent = "최고 등급 달성";
        return;
    }

    const nextGrade = GRADE_ORDER[gradeIndex + 1];

    const currentThreshold = GRADE_THRESHOLDS[grade];
    const nextThreshold = GRADE_THRESHOLDS[nextGrade];

    // 잘못된 기준값 방지
    if (
        currentThreshold === undefined ||
        nextThreshold === undefined ||
        nextThreshold <= currentThreshold
    ) {
        progressBar.style.width = "0%";
        nextGradePoint.textContent = "등급 기준을 확인해 주세요.";
        return;
    }

    const progress = Math.max(
        0,
        Math.min(
            100,
            ((point - currentThreshold) /
                (nextThreshold - currentThreshold)) * 100
        )
    );

    progressBar.style.width = `${progress}%`;

    const remainingPoint = Math.max(0, nextThreshold - point);

    nextGradePoint.textContent =
        `다음 등급 ${nextGrade}까지 ` +
        `${remainingPoint.toLocaleString()} P`;
}


// ==================================================
// 포인트 지급 내역 조회
// API: GET /users/points/history
// ==================================================
async function loadPointHistory(accessToken) {
    try {
        const response = await fetch("/users/points/history", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        });

        if (response.status === 401) {
            sessionStorage.removeItem("access_token");
            sessionStorage.removeItem("user");

            alert("로그인이 만료되었습니다.");
            location.href = "login.html";
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();

            console.error("포인트 내역 API 응답:", {
                status: response.status,
                body: errorText
            });

            throw new Error(
                `포인트 지급 내역 조회 실패: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        renderPointHistory(data.history || []);

    } catch (error) {
        console.error("포인트 지급 내역 조회 오류:", error);

        // 내역 조회 실패가 현재 포인트 표시까지 영향을 주지 않도록 분리
        showPointHistoryMessage(
            "포인트 지급 내역을 불러오지 못했습니다."
        );
    }
}


// ==================================================
// 포인트 지급 내역 테이블 출력
// ==================================================
function renderPointHistory(history) {
    const boxes = document.querySelectorAll(".mypage-box");

    // 현재 HTML의 두 번째 mypage-box가 포인트 내역 영역
    const historyBox = boxes[1];
    const body = historyBox?.querySelector(".mypage-box-body");

    if (!body) {
        console.error("포인트 내역 영역을 찾을 수 없습니다.");
        return;
    }

    // 내역이 없는 경우
    if (!history.length) {
        body.innerHTML = `
            <div class="mypage-empty">
                포인트 지급 내역이 없습니다.
            </div>
        `;
        return;
    }

    // 최신 지급 내역부터 표시
    const sortedHistory = [...history].sort((a, b) => {
        return String(b.date || "").localeCompare(
            String(a.date || "")
        );
    });

    const rows = sortedHistory.map(item => {
        const date = escapeHtml(
            String(item.date || "-").slice(0, 10)
        );

        const game = escapeHtml(item.game || "-");
        const selectedTeam = escapeHtml(item.selected_team || "-");
        const result = escapeHtml(item.result || "포인트 지급");
        const rewardPoint = Number(item.reward_point || 0);

        return `
            <tr>
                <td>${date}</td>
                <td>${game}</td>
                <td>${selectedTeam}</td>
                <td>${result}</td>
                <td>
                    +${rewardPoint.toLocaleString()} P
                </td>
            </tr>
        `;
    }).join("");

    body.innerHTML = `
        <div class="mypage-table-wrap">
            <table class="mypage-table">
                <thead>
                    <tr>
                        <th>지급일</th>
                        <th>경기</th>
                        <th>예측 팀</th>
                        <th>지급 사유</th>
                        <th>지급 포인트</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}


// ==================================================
// 포인트 내역 오류 / 안내 메시지
// ==================================================
function showPointHistoryMessage(message) {
    const boxes = document.querySelectorAll(".mypage-box");
    const historyBox = boxes[1];
    const body = historyBox?.querySelector(".mypage-box-body");

    if (!body) {
        return;
    }

    body.innerHTML = `
        <div class="mypage-empty">
            ${escapeHtml(message)}
        </div>
    `;
}


// ==================================================
// HTML 특수문자 처리
// ==================================================
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}
