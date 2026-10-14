/* ========================================
   BASEBOT 내가 쓴 글
   검색 / 카테고리 필터 / 정렬 / 페이지 이동 / 삭제
======================================== */

/*
    community.js, my-scraps.js와 동일하게 백엔드 서버 주소를 사용합니다.
*/
const MY_POSTS_API_BASE = "http://127.0.0.1:8000";

// 전체 게시글과 화면에 표시할 목록
let allMyPosts = [];
let filteredMyPosts = [];

// 현재 선택한 카테고리와 페이지
let selectedCategory = "ALL";
let currentPage = 1;

// 한 페이지에 표시할 게시글 수
const POSTS_PER_PAGE = 5;

// 서버에서 한 번에 가져올 게시글 수 (전체 목록을 모으기 위해 사용)
const FETCH_SIZE = 50;


// ========================================
// 페이지가 열리면 실행
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    setupMyPostsEvents();
    loadMyPosts();
});


// ========================================
// 검색, 카테고리, 정렬 이벤트 연결
// ========================================

function setupMyPostsEvents() {
    // 제목 검색
    const searchInput = document.getElementById("myPostsSearchInput");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentPage = 1;
            applyMyPostsFilters();
        });
    }

    // 정렬
    const sortSelect = document.getElementById("myPostsSort");

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            currentPage = 1;
            applyMyPostsFilters();
        });
    }

    // 카테고리 버튼
    const categoryButtons = document.querySelectorAll(".my-posts-tab");

    categoryButtons.forEach(button => {
        button.addEventListener("click", () => {
            selectedCategory = button.dataset.category;

            currentPage = 1;

            categoryButtons.forEach(tab => {
                const isActive =
                    tab.dataset.category === selectedCategory;

                tab.classList.toggle("active", isActive);
                tab.setAttribute("aria-pressed", String(isActive));
            });

            applyMyPostsFilters();
        });
    });
}


// ========================================
// 내가 쓴 글 불러오기
// 기존 API(/mypage/my-posts)를 페이지별로 호출해 전체를 모읍니다.
// ========================================

async function fetchMyPostsPage(token, page) {
    const response = await fetch(
        `${MY_POSTS_API_BASE}/mypage/my-posts?page=${page}&size=${FETCH_SIZE}`,
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
        throw new Error(`게시글 조회 실패: HTTP ${response.status}`);
    }

    return response.json();
}

async function loadMyPosts() {
    const token = sessionStorage.getItem("access_token");

    if (!token) {
        allMyPosts = [];
        filteredMyPosts = [];

        showMyPostsEmpty("로그인 후 내가 쓴 글을 확인할 수 있습니다.");
        return;
    }

    try {
        const firstPage = await fetchMyPostsPage(token, 1);

        let posts = Array.isArray(firstPage.items)
            ? [...firstPage.items]
            : [];

        const totalPages = Number(firstPage.total_pages) || 1;

        // 2페이지 이후가 있으면 이어서 가져오기
        for (let page = 2; page <= totalPages; page++) {
            const data = await fetchMyPostsPage(token, page);

            if (Array.isArray(data.items)) {
                posts = posts.concat(data.items);
            }
        }

        allMyPosts = posts;
        currentPage = 1;

        applyMyPostsFilters();

    } catch (error) {
        console.error("내가 쓴 글 조회 오류:", error);

        allMyPosts = [];
        filteredMyPosts = [];

        showMyPostsEmpty(
            error.message ||
            "게시글을 불러오지 못했습니다. 서버 연결을 확인해 주세요."
        );
    }
}


// ========================================
// 검색, 카테고리 필터, 정렬 적용
// ========================================

function applyMyPostsFilters() {
    const searchInput = document.getElementById("myPostsSearchInput");
    const sortSelect = document.getElementById("myPostsSort");

    const keyword = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    const sortOrder = sortSelect
        ? sortSelect.value
        : "newest";

    // 1. 카테고리 필터 + 2. 제목 검색
    filteredMyPosts = allMyPosts.filter(post => {
        if (
            selectedCategory !== "ALL" &&
            post.category !== selectedCategory
        ) {
            return false;
        }

        if (keyword) {
            const title = String(post.title || "").toLowerCase();

            if (!title.includes(keyword)) {
                return false;
            }
        }

        return true;
    });

    // 3. 정렬
    filteredMyPosts.sort((a, b) => {
        if (sortOrder === "views") {
            return (Number(b.view_count) || 0) - (Number(a.view_count) || 0);
        }

        if (sortOrder === "likes") {
            return (Number(b.like_count) || 0) - (Number(a.like_count) || 0);
        }

        const dateA = getMyPostsTime(a.created_at);
        const dateB = getMyPostsTime(b.created_at);

        if (sortOrder === "oldest") {
            return dateA - dateB;
        }

        return dateB - dateA;
    });

    renderMyPosts();
}

function getMyPostsTime(value) {
    const time = new Date(value || 0).getTime();

    return Number.isNaN(time) ? 0 : time;
}


// ========================================
// 게시글 목록 표시
// ========================================

function renderMyPosts() {
    const listElement = document.querySelector(".my-posts-items");
    const emptyElement = document.getElementById("my-posts-empty");

    if (!listElement || !emptyElement) {
        return;
    }

    listElement.innerHTML = "";

    updateMyPostsCounts(filteredMyPosts.length);

    // 검색 또는 필터 결과가 없는 경우
    if (filteredMyPosts.length === 0) {
        let message = "조건에 맞는 게시글이 없습니다.";

        if (allMyPosts.length === 0) {
            message = "작성한 게시글이 없습니다.";
        }

        showMyPostsEmpty(message, allMyPosts.length === 0);
        return;
    }

    emptyElement.style.display = "none";

    // 현재 페이지에 표시할 범위 계산
    const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
    const endIndex = startIndex + POSTS_PER_PAGE;

    const pagePosts = filteredMyPosts.slice(startIndex, endIndex);

    pagePosts.forEach(post => {
        const item = document.createElement("li");
        item.className = "activity-item my-posts-item";

        // 게시글 상세 페이지로 이동하는 링크
        const link = document.createElement("a");

        link.href =
            `community-view.html?postId=${encodeURIComponent(post.post_id)}`;

        link.className = "activity-link my-posts-link";

        // 카테고리
        const category = document.createElement("span");
        category.className =
            `my-posts-category category-${post.category}`;
        category.textContent = getMyPostsCategoryName(post.category);

        // 제목
        const title = document.createElement("strong");
        title.className = "activity-title my-posts-title";
        title.textContent = post.title || "(제목 없음)";

        // 작성일
        const meta = document.createElement("span");
        meta.className = "activity-meta my-posts-meta";

        const date = formatMyPostsDate(post.created_at);

        meta.textContent = date ? `작성 ${date}` : "";

        // 조회수, 추천 수, 댓글 수
        const stats = document.createElement("span");
        stats.className = "my-posts-stats";

        stats.textContent =
            `조회 ${Number(post.view_count) || 0}` +
            ` · 추천 ${Number(post.like_count) || 0}` +
            ` · 댓글 ${Number(post.comment_count) || 0}`;

        link.appendChild(category);
        link.appendChild(title);
        link.appendChild(meta);
        link.appendChild(stats);

        // 수정 / 삭제 버튼 영역
        const actions = document.createElement("div");
        actions.className = "my-posts-actions";

        // 수정 버튼 (글 수정 페이지로 이동)
        const editButton = document.createElement("a");

        editButton.className = "my-post-edit-button";
        editButton.textContent = "수정";

       editButton.href =
       `community-edit.html?postId=${encodeURIComponent(post.post_id)}&from=my-posts`;

        // 삭제 버튼
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "my-post-delete-button";
        deleteButton.textContent = "삭제";

        deleteButton.addEventListener("click", async (event) => {
            // 게시글 상세 페이지로 이동하지 않도록 막기
            event.preventDefault();
            event.stopPropagation();

            await deleteMyPost(post, deleteButton);
        });

        actions.appendChild(editButton);
        actions.appendChild(deleteButton);

        item.appendChild(link);
        item.appendChild(actions);

        listElement.appendChild(item);
    });

    // 페이지 이동 버튼 생성
    const totalPages = Math.ceil(
        filteredMyPosts.length / POSTS_PER_PAGE
    );

    renderMyPostsPagination(totalPages);
}


// ========================================
// 게시글 삭제
// DELETE /community/posts/{post_id}
// ========================================

async function deleteMyPost(post, button) {
    const confirmed = window.confirm(
        "이 게시글을 삭제하시겠습니까?\n삭제한 게시글은 복구할 수 없습니다."
    );

    if (!confirmed) {
        return;
    }

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        alert("로그인 후 게시글을 삭제할 수 있습니다.");
        return;
    }

    button.disabled = true;
    button.textContent = "삭제 중...";

    try {
        const response = await fetch(
            `${MY_POSTS_API_BASE}/community/posts/${post.post_id}`,
            {
                method: "DELETE",
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
            let message = "게시글 삭제에 실패했습니다.";

            try {
                const errorData = await response.json();

                if (typeof errorData.detail === "string") {
                    message = errorData.detail;
                }
            } catch (parseError) {
                // JSON이 아니면 기본 메시지 사용
            }

            throw new Error(message);
        }

        // 화면 목록에서도 해당 게시글 제거
        allMyPosts = allMyPosts.filter(
            item => Number(item.post_id) !== Number(post.post_id)
        );

        applyMyPostsFilters();

        // 마지막 페이지의 글이 모두 사라졌다면 이전 페이지로 이동
        const lastPage = Math.max(
            1,
            Math.ceil(filteredMyPosts.length / POSTS_PER_PAGE)
        );

        if (currentPage > lastPage) {
            currentPage = lastPage;
            renderMyPosts();
        }

    } catch (error) {
        console.error("게시글 삭제 오류:", error);

        button.disabled = false;
        button.textContent = "삭제";

        alert(error.message || "게시글 삭제에 실패했습니다.");
    }
}


// ========================================
// 카테고리 이름 변환
// ========================================

function getMyPostsCategoryName(category) {
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

function formatMyPostsDate(value) {
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
// 총 개수는 필터와 관계없이 내가 쓴 전체 글 수
// ========================================

function updateMyPostsCounts(filteredCount) {
    const totalElement = document.querySelector(".my-posts-total");

    if (totalElement) {
        totalElement.textContent = `총 ${allMyPosts.length}개`;
    }

    const resultCountElement =
        document.getElementById("myPostsResultCount");

    if (resultCountElement) {
        resultCountElement.textContent = `게시글 ${filteredCount}개`;
    }
}


// ========================================
// 목록이 비어 있을 때 메시지 표시
// showDescription가 true이면 안내 문구(p)도 함께 표시
// ========================================

function showMyPostsEmpty(message, showDescription = false) {
    const listElement = document.querySelector(".my-posts-items");
    const emptyElement = document.getElementById("my-posts-empty");

    if (listElement) {
        listElement.innerHTML = "";
    }

    if (emptyElement) {
        const title = emptyElement.querySelector("strong");
        const description = emptyElement.querySelector("p");

        if (title) {
            title.textContent = message;
        }

        if (description) {
            description.style.display =
                showDescription ? "block" : "none";
        }

        emptyElement.style.display = "block";
    }

    updateMyPostsCounts(0);

    renderMyPostsPagination(0);
}


// ========================================
// 페이지 이동 버튼 생성 (화살표)
// ========================================

function renderMyPostsPagination(totalPages) {
    const paginationElement =
        document.getElementById("my-posts-pagination");

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
    prevButton.className = "my-posts-page-button page-arrow";
    prevButton.textContent = "‹";
    prevButton.setAttribute("aria-label", "이전 페이지");
    prevButton.disabled = currentPage === 1;

    prevButton.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderMyPosts();
        }
    });

    paginationElement.appendChild(prevButton);

    // 페이지 번호 버튼
    for (let page = 1; page <= totalPages; page++) {
        const pageButton = document.createElement("button");

        pageButton.type = "button";
        pageButton.className = "my-posts-page-button";
        pageButton.textContent = String(page);

        if (page === currentPage) {
            pageButton.classList.add("active");
            pageButton.setAttribute("aria-current", "page");
        }

        pageButton.addEventListener("click", () => {
            currentPage = page;
            renderMyPosts();
        });

        paginationElement.appendChild(pageButton);
    }

    // 다음 페이지 버튼
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "my-posts-page-button page-arrow";
    nextButton.textContent = "›";
    nextButton.setAttribute("aria-label", "다음 페이지");
    nextButton.disabled = currentPage === totalPages;

    nextButton.addEventListener("click", () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderMyPosts();
        }
    });

    paginationElement.appendChild(nextButton);
}
