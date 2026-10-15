/* =========================================
   공지사항 상세 페이지
   주소 예시: /notice-view.html?id=3
   구조와 팝업은 커뮤니티 게시글 상세(community.js)와 동일하게 맞춤
========================================= */

const NOTICE_CATEGORY = {
    NOTICE: { name: "일반공지", className: "notice" },
    IMPORTANT: { name: "중요공지", className: "important" },
    MAINTENANCE: { name: "점검", className: "maintenance" }
};


/* =========================================
   BASEBOT 공통 팝업 (community.js와 같은 방식)
========================================= */

// 알림 팝업 (확인 버튼 하나)
function showBasebotModal(title, message, callback = null) {
    const modal = document.getElementById("basebotModal");
    const button = document.getElementById("basebotModalButton");
    const cancelButton = document.getElementById("basebotModalCancelButton");

    document.getElementById("basebotModalTitle").textContent = title;
    document.getElementById("basebotModalMessage").textContent = message;

    cancelButton.style.display = "none";
    button.textContent = "확인";
    modal.classList.add("show");

    button.onclick = function () {
        modal.classList.remove("show");
        if (callback) callback();
    };
}

// 확인 팝업 (취소 + 확인 버튼)
function showBasebotConfirm(title, message, confirmCallback, confirmText = "확인") {
    const modal = document.getElementById("basebotModal");
    const button = document.getElementById("basebotModalButton");
    const cancelButton = document.getElementById("basebotModalCancelButton");

    document.getElementById("basebotModalTitle").textContent = title;
    document.getElementById("basebotModalMessage").textContent = message;

    cancelButton.style.display = "inline-flex";
    button.textContent = confirmText;
    modal.classList.add("show");

    cancelButton.onclick = function () {
        modal.classList.remove("show");
    };

    button.onclick = function () {
        modal.classList.remove("show");
        confirmCallback();
    };
}


/* =========================================
   로그인한 사용자가 관리자인지 확인
   (로그인할 때 저장한 user 정보의 role 사용)
========================================= */
function isAdminUser() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user"));
        return Boolean(sessionStorage.getItem("access_token")) && user?.role === "ADMIN";
    } catch (error) {
        return false;
    }
}


// "2026-10-15T14:30:00" → "2026.10.15 14:30" (커뮤니티 상세와 같은 모양)
function formatNoticeDate(value) {
    if (!value) return "-";
    return value.slice(0, 16).replace("T", " ").replace(/-/g, ".");
}


/* =========================================
   공지사항 1개 불러오기
========================================= */
async function loadNoticeDetail() {
    const noticeId = new URLSearchParams(window.location.search).get("id");
    const title = document.getElementById("noticeTitle");

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


/* =========================================
   화면에 채우기
   textContent를 써서 글 내용이 코드로 실행되지 않게 함
========================================= */
function renderNotice(notice) {
    const category = NOTICE_CATEGORY[notice.category] || { name: notice.category, className: "" };
    const categoryLabel = document.getElementById("noticeCategory");

    document.title = `${notice.title} | BASEBOT`;

    categoryLabel.textContent = category.name;
    categoryLabel.className = `category-label ${category.className}`;

    // 상단 고정 공지는 분류 앞에 '고정' 표시
    if (notice.is_pinned) {
        const pin = document.createElement("span");
        pin.className = "notice-pin-mark";
        pin.textContent = "고정";
        categoryLabel.before(pin);
    }

    document.getElementById("noticeTitle").textContent = notice.title;
    document.getElementById("noticeWriter").textContent = notice.writer || "관리자";
    document.getElementById("noticeDate").textContent = formatNoticeDate(notice.created_at);
    document.getElementById("noticeViewCount").textContent =
        Number(notice.view_count || 0).toLocaleString();

    const body = document.getElementById("noticeBody");
    body.classList.add("notice-text");
    body.textContent = notice.content;

    setupAdminButtons(notice.notice_id);
}


/* =========================================
   수정 / 삭제 버튼 (관리자에게만 보임)
========================================= */
function setupAdminButtons(noticeId) {
    const adminArea = document.getElementById("noticeAdminArea");

    // 관리자가 아니면 버튼 영역을 숨긴 채로 끝
    if (!isAdminUser()) {
        adminArea.style.display = "none";
        return;
    }
    adminArea.style.display = "flex";

    // 수정: 작성 페이지를 만들 때 연결 예정
    document.getElementById("editNoticeButton").onclick = function (event) {
        event.preventDefault();
        showBasebotModal("준비 중", "공지사항 수정 기능은 작성 페이지와 함께 추가될 예정입니다.");
    };

    // 삭제: 확인 팝업 → 서버에 삭제 요청 (서버에서도 관리자인지 다시 확인함)
    document.getElementById("deleteNoticeButton").onclick = function () {
        showBasebotConfirm(
            "공지사항 삭제",
            "이 공지사항을 삭제하시겠습니까?",
            () => deleteNotice(noticeId),
            "삭제"
        );
    };
}


async function deleteNotice(noticeId) {
    try {
        const response = await fetch(`/api/notices/${encodeURIComponent(noticeId)}`, {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || "삭제에 실패했습니다.");
        }

        showBasebotModal("삭제 완료", "공지사항이 삭제되었습니다.", () => {
            window.location.href = "/notice.html";
        });

    } catch (error) {
        console.error("공지사항 삭제 오류:", error);
        showBasebotModal("삭제 오류", error.message);
    }
}


document.addEventListener("DOMContentLoaded", loadNoticeDetail);
