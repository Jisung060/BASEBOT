
/* ========================================
   BASEBOT 스크랩한 게시글
   검색 / 카테고리 필터 / 정렬 / 페이지 이동
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";

// 전체 스크랩 목록과 화면에 표시할 목록
let allMyScraps = [];
let filteredMyScraps = [];

// 현재 선택한 카테고리와 페이지
let selectedCategory = "ALL";
let currentPage = 1;

// 한 페이지에 표시할 게시글 수
const SCRAPS_PER_PAGE = 5;


// ========================================
// 페이지가 열리면 실행
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    setupMyScrapsEvents();
    loadMyScraps();
});


// ========================================
// 검색, 카테고리, 정렬 이벤트 연결
// ========================================

function setupMyScrapsEvents() {
    // 제목 검색
    const searchInput = document.getElementById(
        "myScrapsSearchInput"
    );

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentPage = 1;
            applyMyScrapsFilters();
        });
    }

    // 정렬
    const sortSelect = document.getElementById(
        "myScrapsSort"
    );

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            currentPage = 1;
            applyMyScrapsFilters();
        });
    }

    // 카테고리 버튼
    const categoryButtons = document.querySelectorAll(
        ".my-scraps-tab"
    );

    categoryButtons.forEach(button => {
        button.addEventListener("click", () => {
            selectedCategory = button.dataset.category;

            currentPage = 1;

            // 선택한 버튼의 활성화 스타일 변경
            categoryButtons.forEach(tab => {
                const isActive =
                    tab.dataset.category === selectedCategory;

                tab.classList.toggle("active", isActive);
                tab.setAttribute(
                    "aria-pressed",
                    String(isActive)
                );
            });

            applyMyScrapsFilters();
        });
    });
}


// ========================================
// 스크랩 목록 불러오기
// ========================================

async function loadMyScraps() {
    const listElement = document.querySelector(
        ".my-scraps-list"
    );

    const totalElement = document.querySelector(
        ".my-posts-total"
    );

    const emptyElement = document.getElementById(
        "my-posts-empty"
    );

    if (!listElement || !totalElement || !emptyElement) {
        console.error("스크랩 목록 화면 요소를 찾을 수 없습니다.");
        return;
    }

    try {
        const token = sessionStorage.getItem("access_token");

        if (!token) {
            showMyScrapsEmpty(
                "로그인 후 스크랩한 게시글을 확인할 수 있습니다."
            );

            updateMyScrapsCounts(0);
            return;
        }

        // 기존 백엔드 API 사용
        const response = await fetch(
            `${API_BASE_URL}/community/my-scraps`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            throw new Error(
                "로그인이 만료되었습니다. 다시 로그인해 주세요."
            );
        }

        if (!response.ok) {
            throw new Error(
                `스크랩 목록 조회 실패: HTTP ${response.status}`
            );
        }

        const scraps = await response.json();

        if (!Array.isArray(scraps)) {
            throw new Error(
                "스크랩 목록 응답 형식이 올바르지 않습니다."
            );
        }

        allMyScraps = scraps;

        updateMyScrapsCounts(allMyScraps.length);

        if (allMyScraps.length === 0) {
            showMyScrapsEmpty(
                "스크랩한 게시글이 없습니다."
            );
            return;
        }

        // 처음 화면에 전체 목록 표시
        applyMyScrapsFilters();

    } catch (error) {
        console.error("스크랩 목록 불러오기 오류:", error);

        allMyScraps = [];
        filteredMyScraps = [];

        updateMyScrapsCounts(0);

        showMyScrapsEmpty(
            error.message || "스크랩 목록을 불러오지 못했습니다."
        );
    }
}


// ========================================
// 검색, 카테고리 필터, 정렬 적용
// ========================================

function applyMyScrapsFilters() {
    const searchInput = document.getElementById(
        "myScrapsSearchInput"
    );

    const sortSelect = document.getElementById(
        "myScrapsSort"
    );

    const keyword = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    const sortOrder = sortSelect
        ? sortSelect.value
        : "newest";

    // 1. 카테고리 필터
    filteredMyScraps = allMyScraps.filter(scrap => {
        if (
            selectedCategory !== "ALL" &&
            scrap.category !== selectedCategory
        ) {
            return false;
        }

        // 2. 제목 검색
        if (keyword) {
            const title = String(
                scrap.title || ""
            ).toLowerCase();

            if (!title.includes(keyword)) {
                return false;
            }
        }

        return true;
    });

    // 3. 스크랩 날짜 정렬
    filteredMyScraps.sort((a, b) => {
        const dateA = new Date(a.scrapped_at || 0).getTime();
        const dateB = new Date(b.scrapped_at || 0).getTime();

        const safeDateA = Number.isNaN(dateA) ? 0 : dateA;
        const safeDateB = Number.isNaN(dateB) ? 0 : dateB;

        if (sortOrder === "oldest") {
            return safeDateA - safeDateB;
        }

        return safeDateB - safeDateA;
    });

    // 검색 결과가 달라지면 첫 페이지부터 표시
    renderMyScraps();
}


// ========================================
// 게시글 목록 표시
// ========================================

function renderMyScraps() {
    const listElement = document.querySelector(
        ".my-scraps-list"
    );

    const emptyElement = document.getElementById(
        "my-posts-empty"
    );

    if (!listElement || !emptyElement) {
        return;
    }

    listElement.innerHTML = "";

    updateMyScrapsCounts(filteredMyScraps.length);

    // 검색 결과 건수 표시
    const resultCountElement = document.getElementById(
        "myScrapsResultCount"
    );

    if (resultCountElement) {
        resultCountElement.textContent =
            `게시글 ${filteredMyScraps.length}개`;
    }

    // 검색 또는 필터 결과가 없는 경우
    if (filteredMyScraps.length === 0) {
        let message = "조건에 맞는 게시글이 없습니다.";

        if (allMyScraps.length === 0) {
            message = "스크랩한 게시글이 없습니다.";
        }

        showMyScrapsEmpty(message);
        renderMyScrapsPagination(0);
        return;
    }

    emptyElement.style.display = "none";

    // 현재 페이지에 표시할 범위 계산
    const startIndex =
        (currentPage - 1) * SCRAPS_PER_PAGE;

    const endIndex =
        startIndex + SCRAPS_PER_PAGE;

    const pageScraps = filteredMyScraps.slice(
        startIndex,
        endIndex
    );

    // 현재 페이지 게시글 표시
      pageScraps.forEach(scrap => {
        const item = document.createElement("li");
        item.className = "activity-item my-scraps-item";

        // 게시글 상세 페이지로 이동하는 링크
        const link = document.createElement("a");

        link.href =
            `/community-view.html?postId=${encodeURIComponent(scrap.post_id)}`;

        link.className = "activity-link my-scraps-link";

        // 게시글 카테고리
          const category = document.createElement("span");
            category.className =
                `my-scraps-category category-${scrap.category}`;

            category.textContent =
                getMyScrapsCategoryName(scrap.category);

        // 게시글 제목
         const title = document.createElement("strong");
            title.className =
                "activity-title my-scraps-title";

            title.textContent =
                scrap.title || "(제목 없음)";

        // 작성자와 스크랩 날짜
        const meta = document.createElement("span");
            meta.className =
                "activity-meta my-scraps-meta";

            const nickname =
                scrap.nickname || "알 수 없는 작성자";

            const date =
                formatMyScrapsDate(scrap.scrapped_at);

            meta.textContent = date
                ? `${nickname} · 스크랩 ${date}`
                : nickname;


        // 조회수, 추천 수, 댓글 수
         const stats = document.createElement("span");
            stats.className = "my-scraps-stats";

            stats.textContent =
                `조회 ${Number(scrap.view_count) || 0}` +
                ` · 추천 ${Number(scrap.like_count) || 0}` +
                ` · 댓글 ${Number(scrap.comment_count) || 0}`;

            link.appendChild(category);
            link.appendChild(title);
            link.appendChild(meta);
            link.appendChild(stats);

            /*
             * 스크랩 취소 버튼
             */
            const cancelButton = document.createElement("button");

            cancelButton.type = "button";
            cancelButton.className =
                "my-scrap-cancel-button";

            cancelButton.textContent =
                "스크랩 취소";

            cancelButton.addEventListener("click", async (event) => {
                // 게시글 상세 페이지로 이동하지 않도록 막기
                event.preventDefault();
                event.stopPropagation();

                await cancelMyScrap(
                    scrap.post_id,
                    cancelButton
                );
            });

            item.appendChild(link);
            item.appendChild(cancelButton);

            listElement.appendChild(item);
        });


    // 페이지 이동 버튼 생성
    const totalPages = Math.ceil(
        filteredMyScraps.length / SCRAPS_PER_PAGE
    );

    renderMyScrapsPagination(totalPages);
}

async function cancelMyScrap(postId, button) {
    try {
        const token =
            sessionStorage.getItem("access_token");

        if (!token) {
            showMyScrapsEmpty(
                "로그인 후 스크랩을 취소할 수 있습니다."
            );
            return;
        }

        button.disabled = true;
        button.textContent = "취소 중...";

        const response = await fetch(
            `${API_BASE_URL}/community/posts/${postId}/scrap`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            throw new Error(
                "로그인이 만료되었습니다. 다시 로그인해 주세요."
            );
        }

        if (!response.ok) {
            throw new Error(
                `스크랩 취소 실패: HTTP ${response.status}`
            );
        }

        const result = await response.json();

        console.log(
            "스크랩 취소 결과:",
            result
        );

        if (result.scrapped !== false) {
            throw new Error(
                "스크랩 취소에 실패했습니다."
            );
        }

        /*
         * 현재 화면의 목록에서도 해당 게시글 제거
         */
        allMyScraps =
            allMyScraps.filter(
                scrap =>
                    Number(scrap.post_id) !== Number(postId)
            );

        /*
         * 필터 / 검색 결과 다시 계산
         */
        currentPage = 1;

        updateMyScrapsCounts(
            allMyScraps.length
        );

        applyMyScrapsFilters();

    } catch (error) {
        console.error(
            "스크랩 취소 오류:",
            error
        );

        button.disabled = false;
        button.textContent = "스크랩 취소";

        alert(
            error.message ||
            "스크랩 취소에 실패했습니다."
        );
    }
}


// ========================================
// 카테고리 이름 변환
// ========================================

function getMyScrapsCategoryName(category) {
    const categoryNames = {
        NEWS: "야구 뉴스",
        GAME_THREAD: "경기",
        ANALYSIS: "분석",
        GENERAL: "자유글"
    };

    return categoryNames[category] || "기타";
}


// ========================================
// 날짜 표시
// ========================================

function formatMyScrapsDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}


// ========================================
// 총 개수 / 검색 결과 개수 표시
// ========================================

function updateMyScrapsCounts(count) {
    const totalElement = document.querySelector(
        ".my-posts-total"
    );

    if (totalElement) {
        totalElement.textContent = `총 ${count}개`;
    }

    const resultCountElement = document.getElementById(
        "myScrapsResultCount"
    );

    if (resultCountElement) {
        resultCountElement.textContent = `게시글 ${count}개`;
    }
}


// ========================================
// 목록이 비어 있을 때 메시지 표시
// ========================================

function showMyScrapsEmpty(message) {
    const listElement = document.querySelector(
        ".my-scraps-list"
    );

    const emptyElement = document.getElementById(
        "my-posts-empty"
    );

    if (listElement) {
        listElement.innerHTML = "";
    }

    if (emptyElement) {
        const title = emptyElement.querySelector("strong");
        const description = emptyElement.querySelector("p");

        if (title) {
            title.textContent = message;
        } else {
            emptyElement.textContent = message;
        }

        if (description) {
            description.style.display = "none";
        }

        emptyElement.style.display = "block";
    }

    const resultCountElement = document.getElementById(
        "myScrapsResultCount"
    );

    if (resultCountElement) {
        resultCountElement.textContent = "게시글 0개";
    }

    renderMyScrapsPagination(0);
}


// ========================================
// 페이지 이동 버튼 생성
// ========================================

function renderMyScrapsPagination(totalPages) {
    const paginationElement = document.getElementById(
        "my-posts-pagination"
    );

    if (!paginationElement) {
        return;
    }

    paginationElement.innerHTML = "";

    if (totalPages <= 1) {
        return;
    }

    // 이전 페이지 버튼
    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "my-scraps-page-button page-arrow";
    prevButton.textContent = "‹";
    prevButton.setAttribute("aria-label", "이전 페이지");
    prevButton.disabled = currentPage === 1;

    prevButton.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderMyScraps();
        }
    });

    paginationElement.appendChild(prevButton);

    // 페이지 번호 버튼
    for (let page = 1; page <= totalPages; page++) {
        const pageButton = document.createElement("button");

        pageButton.type = "button";
        pageButton.className = "my-scraps-page-button";
        pageButton.textContent = String(page);

        if (page === currentPage) {
            pageButton.classList.add("active");
            pageButton.setAttribute("aria-current", "page");
        }

        pageButton.addEventListener("click", () => {
            currentPage = page;
            renderMyScraps();
        });

        paginationElement.appendChild(pageButton);
    }

    // 다음 페이지 버튼
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "my-scraps-page-button page-arrow";
    nextButton.textContent = "›";
    nextButton.setAttribute("aria-label", "다음 페이지");
    nextButton.disabled = currentPage === totalPages;

    nextButton.addEventListener("click", () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderMyScraps();
        }
    });

    paginationElement.appendChild(nextButton);
}
