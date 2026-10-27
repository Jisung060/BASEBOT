
/* ==================================================
   BASEBOT 관리자 대시보드
   파일: front/js/admin/admin-dashboard.js
================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    loadDashboardStats();
});


/* ==================================================
   인증 토큰 가져오기
================================================== */
function getAdminToken() {
    return sessionStorage.getItem("access_token");
}


/* ==================================================
   관리자 대시보드 통계 조회
================================================== */
async function loadDashboardStats() {
    const token = getAdminToken();

    if (!token) {
        alert("로그인이 필요합니다.");
        window.location.href = "../login.html";
        return;
    }

    try {
        const response = await fetch("/admin/dashboard/stats", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        if (response.status === 401 || response.status === 403) {
            alert("관리자 권한을 확인해 주세요.");
            return;
        }

        if (!response.ok) {
            throw new Error(
                `대시보드 통계 조회 실패: ${response.status}`
            );
        }

        const data = await response.json();

        renderDashboardStats(data);

    } catch (error) {
        console.error("대시보드 통계 조회 오류:", error);
        showDashboardError();
    }
}


/* ==================================================
   통계 화면에 표시
================================================== */
function renderDashboardStats(data) {
    const statCards = document.querySelectorAll(".stat-card");

    const stats = [
        {
            value: data.total_users,
            description: "전체 가입 회원"
        },
        {
            value: data.today_users,
            description: "오늘 가입한 회원"
        },
        {
            value: data.total_posts,
            description: "전체 게시글"
        },
        {
            value: data.pending_reports,
            description: "미처리 신고"
        },
        {
            value: data.today_games,
            description: "오늘 경기"
        },
        {
            value: data.prediction_participation,
            description: "전체 예측 참여"
        }
    ];

    statCards.forEach((card, index) => {
        const valueElement = card.querySelector("strong");
        const descriptionElement = card.querySelector("small");

        if (!valueElement || !stats[index]) {
            return;
        }

        const value = stats[index].value;

        valueElement.textContent =
            typeof value === "number"
                ? value.toLocaleString("ko-KR")
                : "—";

        if (descriptionElement) {
            descriptionElement.textContent =
                stats[index].description;
        }
    });
}


/* ==================================================
   통계 조회 오류 표시
================================================== */
function showDashboardError() {
    document.querySelectorAll(".stat-card strong").forEach(element => {
        element.textContent = "—";
    });

    document.querySelectorAll(".stat-card small").forEach(element => {
        element.textContent = "데이터 조회 실패";
    });
}



/* ==================================================
   BASEBOT 관리자 대시보드
   최근 활동 이력
================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    loadRecentActivityLogs();
});


/* ==================================================
   최근 활동 이력 조회
================================================== */

async function loadRecentActivityLogs() {
    const panel = document.querySelector(
        ".content-grid .panel"
    );

    if (!panel) {
        console.error("최근 활동 패널을 찾을 수 없습니다.");
        return;
    }

    const emptyState = panel.querySelector(".empty-state");

    if (!emptyState) {
        console.error("최근 활동 표시 영역을 찾을 수 없습니다.");
        return;
    }

    // 로그인 토큰 확인
    const accessToken = sessionStorage.getItem("access_token");

    if (!accessToken) {
        showActivityMessage(
            emptyState,
            "로그인이 필요합니다."
        );
        return;
    }

    try {
        // 최근 7일간의 모든 활동 조회
        const response = await fetch(
            "/admin/activity-logs/recent?days=7",
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${accessToken}`
                }
            }
        );

        if (response.status === 401) {
            showActivityMessage(
                emptyState,
                "로그인 인증이 만료되었습니다."
            );
            return;
        }

        if (response.status === 403) {
            showActivityMessage(
                emptyState,
                "관리자 권한이 필요합니다."
            );
            return;
        }

        if (!response.ok) {
            throw new Error(
                `최근 활동 조회 실패: ${response.status}`
            );
        }

        const data = await response.json();
        const logs = Array.isArray(data.items)
            ? data.items
            : [];

        if (logs.length === 0) {
            showActivityMessage(
                emptyState,
                "최근 7일간 활동 내역이 없습니다."
            );
            return;
        }

        renderRecentActivityLogs(panel, logs);

    } catch (error) {
        console.error(
            "최근 활동 이력 조회 오류:",
            error
        );

        showActivityMessage(
            emptyState,
            "최근 활동을 불러오지 못했습니다."
        );
    }
}


/* ==================================================
   최근 활동 목록 렌더링
================================================== */

function renderRecentActivityLogs(panel, logs) {
    const emptyState = panel.querySelector(".empty-state");

    if (!emptyState) {
        return;
    }

    const list = document.createElement("div");
    list.className = "activity-log-list";

    logs.forEach((log) => {
        const item = document.createElement("div");
        item.className = "activity-log-item";

        // 활동 내용
        const content = document.createElement("div");
        content.className = "activity-log-content";

        const description = document.createElement("strong");
        description.className = "activity-log-description";
        description.textContent =
            log.description || "작업 내용 없음";

        // 관리자 아이디 및 일시
        const meta = document.createElement("p");
        meta.className = "activity-log-meta";

        const username = log.admin_username || "알 수 없음";
        const date = formatActivityDate(log.created_at);

        meta.textContent = `${username} · ${date}`;

        // 처리 결과
        const result = document.createElement("span");
        const isSuccess = log.result === "SUCCESS";

        result.className = isSuccess
            ? "activity-log-result success"
            : "activity-log-result failure";

        result.textContent = isSuccess ? "성공" : "실패";

        content.appendChild(description);
        content.appendChild(meta);

        item.appendChild(content);
        item.appendChild(result);

        list.appendChild(item);
    });

    // 기존 빈 상태 영역을 활동 목록으로 교체
    emptyState.replaceWith(list);
}


/* ==================================================
   빈 상태 및 오류 메시지
================================================== */

function showActivityMessage(emptyState, message) {
    const title = emptyState.querySelector("strong");
    const description = emptyState.querySelector("p");

    if (title) {
        title.textContent = message;
    }

    if (description) {
        description.textContent = "";
    }
}


/* ==================================================
   날짜 표시 형식
================================================== */

function formatActivityDate(value) {
    if (!value) {
        return "일시 정보 없음";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "일시 정보 없음";
    }

    return date.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}
