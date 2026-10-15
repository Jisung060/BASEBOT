/* ==================================================
   BASEBOT 관리자 공통 JavaScript
================================================== */

const ADMIN_PAGE_TITLES = {
    dashboard: "관리자 대시보드",
    users: "회원 관리",
    community: "커뮤니티 관리",
    "baseball-data": "야구 데이터 관리",
    predictions: "경기 예측 관리",
    chatbot: "AI 챗봇 관리",
    notices: "공지사항 관리",
    news: "뉴스 관리",
    "activity-logs": "관리자 활동 이력",
    "system-status": "시스템 및 수집 상태",
    settings: "서비스 운영 설정",
};


/* 공통 HTML 컴포넌트 로드 */
async function loadAdminComponent(containerId, url) {
    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(
            `공통 컴포넌트 영역을 찾을 수 없습니다: ${containerId}`
        );
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `컴포넌트 로드 실패: ${url} (${response.status})`
        );
    }

    container.innerHTML = await response.text();
}


/* 현재 페이지에 맞는 제목과 메뉴 설정 */
function initializeAdminPage() {
    const currentPage = document.body.dataset.page;
    const pageTitle = ADMIN_PAGE_TITLES[currentPage];

    if (!pageTitle) {
        console.warn(
            `관리자 페이지 제목을 찾을 수 없습니다: ${currentPage}`
        );
        return;
    }

    /* 상단 제목 */
    const titleElement = document.getElementById("admin-page-title");
    const breadcrumbElement = document.getElementById("admin-breadcrumb");

    if (titleElement) {
        titleElement.textContent = pageTitle;
    }

    if (breadcrumbElement) {
        breadcrumbElement.textContent =
            `BASEBOT / ADMIN / ${pageTitle}`;
    }

    /* 현재 메뉴 활성화 */
    document.querySelectorAll(".admin-nav a").forEach((link) => {
        const isCurrentPage = link.dataset.page === currentPage;

        link.classList.toggle("active", isCurrentPage);

        if (isCurrentPage) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    /* 브라우저 탭 제목 */
    document.title = `${pageTitle} | BASEBOT ADMIN`;
}


/* 컴포넌트 로드가 완료된 뒤 메뉴 초기화 */
async function initializeAdminLayout() {
    try {
        await Promise.all([
            loadAdminComponent(
                "admin-sidebar-container",
                "/components/admin-sidebar.html"
            ),
            loadAdminComponent(
                "admin-topbar-container",
                "/components/admin-topbar.html"
            ),
            loadAdminComponent(
                "admin-footer-container",
                "/components/admin-footer.html"
            )
        ]);

        initializeAdminPage();

    } catch (error) {
        console.error("관리자 공통 레이아웃 초기화 오류:", error);
    }
}

initializeAdminLayout();