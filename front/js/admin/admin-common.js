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
    news: "뉴스 관리",
    "activity-logs": "관리자 활동 이력",
    "system-status": "시스템 및 수집 상태",
    settings: "서비스 운영 설정",
};


let adminAccessDenied = false;

/* 관리자 API 인증 및 중복 권한 경고 방지 */
async function adminFetch(url, options = {}) {
    if (adminAccessDenied) {
        throw new Error("관리자 접근이 제한되었습니다.");
    }

    const token = sessionStorage.getItem("access_token");
    let response;
    if (token) {
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${token}`);
        response = await fetch(url, { ...options, headers });
    }

    if (!token || response.status === 401 || response.status === 403) {
        if (!adminAccessDenied) {
            adminAccessDenied = true;
            const needsLogin = !token || response.status === 401;
            if (needsLogin) sessionStorage.removeItem("access_token");
            alert(needsLogin ? "로그인이 필요하거나 만료되었습니다." : "관리자 권한이 필요합니다.");
            window.location.href = needsLogin ? "/login.html" : "/";
        }
        throw new Error("관리자 접근이 제한되었습니다.");
    }

    return response;
}

async function verifyAdminAccess() {
    try {
        const response = await adminFetch("/admin/users/access-check");
        if (!response.ok) throw new Error("관리자 권한 확인 실패");
        return true;
    } catch (error) {
        if (!adminAccessDenied) {
            adminAccessDenied = true;
            alert("관리자 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
            window.location.href = "/";
        }
        return false;
    }
}

const adminAccessReady = verifyAdminAccess();

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


/* 로그인 시 저장한 계정 정보로 사이드바 프로필 표시 */
function initializeAdminProfile() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user") || localStorage.getItem("user") || "null");
        if (!user || typeof user !== "object") return;

        const nickname = typeof user.nickname === "string" ? user.nickname.trim() : "";
        const username = typeof user.username === "string" ? user.username.trim() : "";
        const displayName = nickname || username || "관리자";
        document.getElementById("adminProfileNickname").textContent = displayName;
        document.getElementById("adminProfileUsername").textContent = username || "계정 정보 없음";
        document.getElementById("adminProfileAvatar").textContent = Array.from(displayName)[0].toUpperCase();
    } catch (error) {
        console.warn("관리자 프로필 정보를 표시하지 못했습니다:", error);
    }
}


/* 컴포넌트 로드가 완료된 뒤 메뉴 초기화 */
async function initializeAdminLayout() {
    if (!await adminAccessReady) return;

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
        initializeAdminProfile();

    } catch (error) {
        console.error("관리자 공통 레이아웃 초기화 오류:", error);
    }
}

initializeAdminLayout();


/* ==================================================
   관리자 로그아웃
================================================== */

// 사이드바가 나중에 로드되어도 로그아웃 이벤트 처리
document.addEventListener("click", function (event) {
    const logoutLink = event.target.closest("#adminLogoutLink");

    if (!logoutLink) return;

    event.preventDefault();

    // 로그인 토큰 및 사용자 정보 삭제
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("user");

    localStorage.removeItem("access_token");
    localStorage.removeItem("user");

    // 메인 페이지로 이동
    window.location.replace("/main.html");
});