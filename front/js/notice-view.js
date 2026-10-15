/* ==================================================
   공지사항 상세 페이지
   주소 예시: /notice-view.html?id=3
================================================== */

const NOTICE_CATEGORY_LABEL = {
    NOTICE: "일반공지",
    IMPORTANT: "중요공지",
    MAINTENANCE: "점검"
};

document.addEventListener("DOMContentLoaded", () => {
    loadNoticeDetail();
});


/* 주소창의 ?id= 값 읽기 */
function getNoticeId() {
    return new URLSearchParams(location.search).get("id");
}


/* 로그인한 사용자가 관리자인지 확인 (로그인 시 저장한 user 정보 사용) */
function isAdminUser() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user"));
        return user?.role === "ADMIN";
    } catch (error) {
        return false;
    }
}


/* "2026-10-15T09:30:00" → "2026.10.15 09:30" */
function formatNoticeDate(value) {
    if (!value) {
        return "-";
    }
    return value.slice(0, 16).replace("T", " ").replace(/-/g, ".");
}


/* 공지사항 1개 조회 */
async function loadNoticeDetail() {
    const noticeId = getNoticeId();
    const title = document.getElementById("notice-title");

    if (!noticeId) {
        title.textContent = "잘못된 접근입니다.";
        return;
    }

    try {
        const response = await fetch(`/api/notices/${encodeURIComponent(noticeId)}`);

        if (response.status === 404) {
            title.textContent = "공지사항을 찾을 수 없습니다.";
            return;
        }

        if (!response.ok) {
            throw new Error("공지사항 조회 실패");
        }

        renderNotice(await response.json());

    } catch (error) {
        console.error("공지사항 상세 조회 오류:", error);
        title.textContent = "공지사항을 불러오지 못했습니다.";
    }
}


/* 화면에 채우기 (textContent를 써서 글 내용이 코드로 실행되지 않게 함) */
function renderNotice(notice) {
    const category = document.getElementById("notice-category");

    document.title = `${notice.title} | BASEBOT`;
    document.getElementById("notice-pin").hidden = !notice.is_pinned;

    category.textContent = NOTICE_CATEGORY_LABEL[notice.category] || "";
    category.classList.add(notice.category.toLowerCase());

    document.getElementById("notice-title").textContent = notice.title;
    document.getElementById("notice-writer").textContent = `작성자 ${notice.writer || "관리자"}`;
    document.getElementById("notice-date").textContent = formatNoticeDate(notice.created_at);
    document.getElementById("notice-views").textContent = `조회 ${notice.view_count}`;
    document.getElementById("notice-content").textContent = notice.content;

    // 수정/삭제 버튼은 관리자에게만 보여줌 (기능은 다음 단계에서 연결)
    if (isAdminUser()) {
        document.getElementById("notice-admin-actions").hidden = false;

        document.getElementById("notice-edit-btn").addEventListener("click", () => {
            alert("수정 기능은 준비 중입니다.");
        });

        document.getElementById("notice-delete-btn").addEventListener("click", () => {
            alert("삭제 기능은 준비 중입니다.");
        });
    }
}
