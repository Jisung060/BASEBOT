// ========================================
// BASEBOT 내가 신고한 게시글 내역
// ========================================

const API_BASE_URL = "http://127.0.0.1:8000";

document.addEventListener("DOMContentLoaded", () => {
    loadMyReports();
});


// ========================================
// 신고 내역 불러오기
// ========================================

async function loadMyReports() {
    const listElement =
        document.querySelector(".my-reports-list");

    const totalElement =
        document.querySelector(".my-reports-total");

    const emptyElement =
        document.getElementById("my-reports-empty");

    // HTML 요소가 제대로 있는지 확인
    if (!listElement || !totalElement || !emptyElement) {
        console.error("신고 내역 화면 요소를 찾을 수 없습니다.");
        return;
    }

    try {
        // 로그인 토큰 가져오기
        const token = sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우
        if (!token) {
            listElement.innerHTML = "";
            totalElement.textContent = "총 0개";
            emptyElement.textContent =
                "로그인 후 신고 내역을 확인할 수 있습니다.";
            emptyElement.style.display = "block";
            return;
        }

        // 백엔드 신고 내역 API 호출
        const response = await fetch(
            `${API_BASE_URL}/community/my-reports`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
        }

        if (!response.ok) {
            throw new Error(
                `신고 내역 조회 실패: HTTP ${response.status}`
            );
        }

        const reports = await response.json();

        // 기존 목록 초기화
        listElement.innerHTML = "";

        // 신고 건수 표시
        totalElement.textContent = `총 ${reports.length}개`;

        // 신고 내역이 없는 경우
        if (reports.length === 0) {
            emptyElement.textContent = "신고 내역이 없습니다.";
            emptyElement.style.display = "block";
            return;
        }

        emptyElement.style.display = "none";

        // 신고 내역 하나씩 화면에 표시
        reports.forEach(report => {
            const item = document.createElement("li");
            item.className = "activity-item";

            // 게시글 제목 링크
            const link = document.createElement("a");
            link.href =
                `/community-view.html?postId=${encodeURIComponent(report.post_id)}`;
            link.className = "activity-link";

            const title = document.createElement("strong");
            title.className = "activity-title";
            title.textContent = report.title || "(제목 없음)";

            const meta = document.createElement("span");
            meta.className = "activity-meta";

            // 신고 사유를 한글로 표시
            const reasonLabels = {
                ABUSE: "욕설·비방",
                AD: "광고",
                SPAM: "스팸",
                INAPPROPRIATE: "부적절한 콘텐츠",
                ETC: "기타"
            };

            const reason =
                reasonLabels[report.reason] || report.reason || "미확인";

            // 신고 상태를 한글로 표시
            const statusLabels = {
                PENDING: "접수 대기",
                RESOLVED: "처리 완료",
                REJECTED: "반려"
            };

            const status =
                statusLabels[report.status] || report.status || "상태 미확인";

            // 신고한 날짜 표시
            const date = report.reported_at
                ? new Date(report.reported_at).toLocaleString("ko-KR")
                : "날짜 정보 없음";

            meta.textContent =
                `작성자: ${report.nickname || "알 수 없는 작성자"} · ` +
                `신고 사유: ${reason} · 상태: ${status} · 신고일: ${date}`;

            link.appendChild(title);
            link.appendChild(meta);

            // 신고할 때 입력한 상세 내용
            const content = document.createElement("p");
            content.className = "my-report-content";
            content.textContent =
                `신고 내용: ${report.report_content || "입력한 상세 내용 없음"}`;

            item.appendChild(link);
            item.appendChild(content);

            listElement.appendChild(item);
        });

    } catch (error) {
        console.error("신고 내역 불러오기 오류:", error);

        listElement.innerHTML = "";
        totalElement.textContent = "조회 실패";
        emptyElement.textContent =
            error.message || "신고 내역을 불러오지 못했습니다.";
        emptyElement.style.display = "block";
    }
}
