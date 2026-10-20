/* =========================================
   공지사항 목록 페이지
   - 상단 고정 공지 먼저, 그다음 최신순 (서버에서 정렬)
   - 분류 선택, 검색(제목+내용), 페이지 나누기
========================================= */

const NOTICES_PER_PAGE = 15;

const NOTICE_CATEGORY = {
    NOTICE: { name: "일반공지", className: "notice" },
    IMPORTANT: { name: "중요공지", className: "important" },
    MAINTENANCE: { name: "점검", className: "maintenance" }
};

let notices = [];          // 서버에서 받은 공지 목록
let currentNoticePage = 1;

const NOTICE_STATE_KEY = "noticeListState";   // 글 보러 갈 때 목록 상태를 저장할 이름


/* =========================================
   목록 상태 저장 / 복원
   (글을 보고 '목록'이나 뒤로 가기로 돌아오면 보던 페이지 그대로)
========================================= */
function saveNoticeState() {
    sessionStorage.setItem(NOTICE_STATE_KEY, JSON.stringify({
        page: currentNoticePage,
        category: document.getElementById("noticeCategorySelect").value,
        keyword: document.getElementById("searchInput").value,
        searchType: document.getElementById("searchType").value
    }));
}

function takeNoticeState() {                   // 저장한 상태를 꺼내고 지움 (한 번만 사용)
    const text = sessionStorage.getItem(NOTICE_STATE_KEY);
    sessionStorage.removeItem(NOTICE_STATE_KEY);
    try { return text ? JSON.parse(text) : null; } catch { return null; }
}


// HTML 특수문자 변환 (제목이 코드로 실행되지 않게)
function escapeNoticeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


// "2026-10-15T14:30:00" → "2026.10.15"
function formatNoticeListDate(value) {
    return value ? value.slice(0, 10).replace(/-/g, ".") : "-";
}


/* =========================================
   서버에서 공지 목록 가져오기
========================================= */
async function loadNotices() {
    const keyword = document.getElementById("searchInput").value.trim();
    const searchType = document.getElementById("searchType").value;   // 제목+내용 / 제목 / 작성자
    const category = document.getElementById("noticeCategorySelect").value;

    const params = new URLSearchParams({ limit: 100 });
    if (keyword) {
        params.set("keyword", keyword);
        params.set("search_type", searchType);
    }
    if (category) params.set("category", category);

    try {
        const response = await fetch(`/api/notices?${params}`);
        if (!response.ok) {
            throw new Error("공지사항 목록 조회 실패");
        }
        notices = (await response.json()).notices || [];
    } catch (error) {
        console.error("공지사항 목록 조회 오류:", error);
        notices = [];
    }

    currentNoticePage = 1;
    renderNotices();
}


/* =========================================
   현재 페이지 공지 그리기
========================================= */
function renderNotices() {
    const board = document.getElementById("noticeBoard");
    const emptyMessage = document.getElementById("noticeEmptyMessage");

    // 기존 행 지우기
    board.querySelectorAll(".board-row").forEach(row => row.remove());

    document.getElementById("noticeTotalCount").textContent = notices.length;
    emptyMessage.hidden = notices.length !== 0;

    // 검색어나 분류를 고른 상태에서 결과가 없을 때만 '목록으로' 버튼 보이기
    const isFiltered = document.getElementById("searchInput").value.trim() !== ""
        || document.getElementById("noticeCategorySelect").value !== "";
    document.getElementById("noticeBackButton").hidden = !isFiltered;

    const start = (currentNoticePage - 1) * NOTICES_PER_PAGE;
    const pageNotices = notices.slice(start, start + NOTICES_PER_PAGE);

    pageNotices.forEach(notice => {
        const category = NOTICE_CATEGORY[notice.category] || { name: notice.category, className: "" };

        const row = document.createElement("a");
        row.className = notice.is_pinned ? "board-row pinned" : "board-row";
        row.href = `notice-view.html?id=${encodeURIComponent(notice.notice_id)}`;
        row.addEventListener("click", saveNoticeState);   // 글 보러 가기 전에 지금 페이지 저장

        row.innerHTML = `
            <div>
                <span class="category-label ${category.className}">${category.name}</span>
            </div>

            <div class="col-title">
                ${notice.is_pinned ? '<span class="notice-pin-mark">고정</span>' : ""}
                <span class="board-title">${escapeNoticeHtml(notice.title)}</span>
            </div>

            <div>${escapeNoticeHtml(notice.writer || "관리자")}</div>

            <div>${formatNoticeListDate(notice.created_at)}</div>

            <div>${Number(notice.view_count || 0).toLocaleString()}</div>
        `;

        board.appendChild(row);
    });

    renderNoticePagination(Math.ceil(notices.length / NOTICES_PER_PAGE));
}


/* =========================================
   페이지 번호 버튼
========================================= */
function renderNoticePagination(totalPages) {
    const pagination = document.getElementById("noticePagination");
    pagination.innerHTML = "";

    if (totalPages <= 1) {
        return;
    }

    function addPageButton(text, page, isActive = false, isDisabled = false) {
        const button = document.createElement("a");
        button.href = "#";
        button.textContent = text;
        if (isActive) button.classList.add("active");
        if (isDisabled) {                         // 첫/마지막 페이지의 ‹ › : 자리는 지키고 누를 수 없게
            button.classList.add("disabled");
            button.setAttribute("aria-disabled", "true");
        }

        button.addEventListener("click", event => {
            event.preventDefault();
            if (isDisabled) return;
            currentNoticePage = page;
            renderNotices();                      // 스크롤 위치는 그대로 둠
        });

        pagination.appendChild(button);
    }

    // ‹ › 는 항상 표시 (버튼 위치가 흔들리지 않게)
    addPageButton("‹", currentNoticePage - 1, false, currentNoticePage <= 1);
    for (let page = 1; page <= totalPages; page++) {
        addPageButton(page, page, page === currentNoticePage);
    }
    addPageButton("›", currentNoticePage + 1, false, currentNoticePage >= totalPages);
}


/* =========================================
   시작: 분류 변경 / 검색 연결
========================================= */
document.addEventListener("DOMContentLoaded", () => {
    // 관리자에게만 글쓰기 버튼 보이기
    try {
        const user = JSON.parse(sessionStorage.getItem("user"));
        if (sessionStorage.getItem("access_token") && user?.role === "ADMIN") {
            document.getElementById("noticeWriteButton").style.display = "inline-flex";
        }
    } catch (error) {
        // 저장된 사용자 정보가 없으면 버튼을 숨긴 채로 둠
    }

    document.getElementById("noticeCategorySelect").addEventListener("change", loadNotices);

    // 검색 버튼 클릭 또는 Enter 키로 검색 (커뮤니티와 동일)
    document.getElementById("postSearchButton").addEventListener("click", loadNotices);
    document.getElementById("searchInput").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadNotices();
        }
    });

    // 목록으로: 검색어와 분류를 지우고 전체 목록 다시 불러오기
    document.getElementById("noticeBackButton").addEventListener("click", () => {
        document.getElementById("searchInput").value = "";
        document.getElementById("noticeCategorySelect").value = "";
        loadNotices();
    });

    // 글에서 돌아온 경우: 분류·검색어를 먼저 되돌린 뒤 불러오고, 보던 페이지로 이동
    const saved = takeNoticeState();
    if (saved) {
        document.getElementById("noticeCategorySelect").value = saved.category || "";
        document.getElementById("searchInput").value = saved.keyword || "";
        document.getElementById("searchType").value = saved.searchType || "title_content";
        loadNotices().then(() => {
            const totalPages = Math.max(1, Math.ceil(notices.length / NOTICES_PER_PAGE));
            currentNoticePage = Math.min(Number(saved.page) || 1, totalPages); // 글이 지워져 페이지가 줄면 마지막 페이지
            renderNotices();
        });
    } else {
        loadNotices();
    }
});
