
/* ==================================================
   BASEBOT 관리자 대시보드
   파일: front/js/admin/admin-dashboard.js
================================================== */

document.addEventListener("DOMContentLoaded", () => {
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
