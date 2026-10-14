/* ========================================
   BASEBOT 내가 쓴 댓글
   댓글/답글 필터 / 검색 / 정렬 / 페이지 이동 / 삭제
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";

// 전체 댓글과 화면에 표시할 목록
let allMyComments = [];
let filteredMyComments = [];

// 현재 선택한 종류(ALL / COMMENT / REPLY)와 페이지
let selectedType = "ALL";
let currentPage = 1;

// 한 페이지에 표시할 댓글 수
const COMMENTS_PER_PAGE = 5;

// 서버에서 한 번에 가져올 댓글 수 (전체 목록을 모으기 위해 사용)
const FETCH_SIZE = 50;


// ========================================
// 페이지가 열리면 실행
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    setupMyCommentsEvents();
    loadMyComments();
});


// ========================================
// 검색, 종류 탭, 정렬 이벤트 연결
// ========================================

function setupMyCommentsEvents() {
    // 검색
    const searchInput = document.getElementById("myCommentsSearchInput");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentPage = 1;
            applyMyCommentsFilters();
        });
    }

    // 정렬
    const sortSelect = document.getElementById("myCommentsSort");

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            currentPage = 1;
            applyMyCommentsFilters();
        });
    }

    // 종류 탭
    const tabs = document.querySelectorAll(".my-comments-tab");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            selectedType = tab.dataset.type;

            currentPage = 1;

            tabs.forEach(item => {
                const isActive = item.dataset.type === selectedType;

                item.classList.toggle("active", isActive);
                item.setAttribute("aria-pressed", String(isActive));
            });

            applyMyCommentsFilters();
        });
    });
}


// ========================================
// 내가 쓴 댓글 불러오기
// 기존 API를 페이지별로 호출해 전체를 모읍니다.
// ========================================

async function fetchMyCommentsPage(token, page) {
    const response = await fetch(
        `${API_BASE_URL}/api/mypage/comments?page=${page}&size=${FETCH_SIZE}`,
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            },
            cache: "no-store"
        }
    );

    if (response.status === 401) {
        throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    }

    if (!response.ok) {
        throw new Error(`댓글 조회 실패: HTTP ${response.status}`);
    }

    return response.json();
}

async function loadMyComments() {
    const token = sessionStorage.getItem("access_token");

    if (!token) {
        allMyComments = [];
        filteredMyComments = [];

        showMyCommentsEmpty("로그인 후 내가 쓴 댓글을 확인할 수 있습니다.");
        return;
    }

    try {
        const firstPage = await fetchMyCommentsPage(token, 1);

        let comments = Array.isArray(firstPage.comments)
            ? [...firstPage.comments]
            : [];

        const totalPages = Number(firstPage.total_pages) || 1;

        // 2페이지 이후가 있으면 이어서 가져오기
        for (let page = 2; page <= totalPages; page++) {
            const data = await fetchMyCommentsPage(token, page);

            if (Array.isArray(data.comments)) {
                comments = comments.concat(data.comments);
            }
        }

        allMyComments = comments;
        currentPage = 1;

        applyMyCommentsFilters();

    } catch (error) {
        console.error("내가 쓴 댓글 조회 오류:", error);

        allMyComments = [];
        filteredMyComments = [];

        showMyCommentsEmpty(
            error.message ||
            "댓글을 불러오지 못했습니다. 서버 연결을 확인해 주세요."
        );
    }
}


// ========================================
// 종류 필터, 검색, 정렬 적용
// ========================================

function applyMyCommentsFilters() {
    const searchInput = document.getElementById("myCommentsSearchInput");
    const sortSelect = document.getElementById("myCommentsSort");

    const keyword = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    const sortOrder = sortSelect
        ? sortSelect.value
        : "newest";

    // 1. 종류 필터 + 2. 검색(댓글 내용, 게시글 제목)
    filteredMyComments = allMyComments.filter(comment => {
        const isReply = comment.parent_comment_id !== null &&
                        comment.parent_comment_id !== undefined;

        if (selectedType === "COMMENT" && isReply) {
            return false;
        }

        if (selectedType === "REPLY" && !isReply) {
            return false;
        }

        if (keyword) {
            const content = String(comment.content || "").toLowerCase();
            const postTitle = String(comment.post_title || "").toLowerCase();

            if (!content.includes(keyword) && !postTitle.includes(keyword)) {
                return false;
            }
        }

        return true;
    });

    // 3. 정렬
    filteredMyComments.sort((a, b) => {
        if (sortOrder === "likes") {
            const diff =
                (Number(b.comment_like_count) || 0) -
                (Number(a.comment_like_count) || 0);

            if (diff !== 0) {
                return diff;
            }
        }

        const dateA = getMyCommentsTime(a.created_at);
        const dateB = getMyCommentsTime(b.created_at);

        if (sortOrder === "oldest") {
            return dateA - dateB;
        }

        return dateB - dateA;
    });

    renderMyComments();
}

function getMyCommentsTime(value) {
    const time = new Date(value || 0).getTime();

    return Number.isNaN(time) ? 0 : time;
}


// ========================================
// 댓글 목록 표시
// ========================================

function renderMyComments() {
    const listElement = document.querySelector(".my-comments-items");
    const emptyElement = document.getElementById("my-comments-empty");

    if (!listElement || !emptyElement) {
        return;
    }

    listElement.innerHTML = "";

    updateMyCommentsCounts(filteredMyComments.length);

    // 검색 또는 필터 결과가 없는 경우
    if (filteredMyComments.length === 0) {
        let message = "조건에 맞는 댓글이 없습니다.";

        if (allMyComments.length === 0) {
            message = "작성한 댓글이 없습니다.";
        }

        showMyCommentsEmpty(message, allMyComments.length === 0);
        return;
    }

    emptyElement.style.display = "none";

    // 현재 페이지에 표시할 범위 계산
    const startIndex = (currentPage - 1) * COMMENTS_PER_PAGE;
    const endIndex = startIndex + COMMENTS_PER_PAGE;

    const pageComments = filteredMyComments.slice(startIndex, endIndex);

    pageComments.forEach(comment => {
        const isReply = comment.parent_comment_id !== null &&
                        comment.parent_comment_id !== undefined;

        const item = document.createElement("li");
        item.className = "activity-item my-comments-item";

        // 게시글 상세 페이지로 이동하는 링크
        const link = document.createElement("a");

        link.href =
            `community-view.html?postId=${encodeURIComponent(comment.post_id)}`;

        link.className = "activity-link my-comments-link";

        // 카테고리 + 답글 배지
        const tags = document.createElement("div");
        tags.className = "my-comments-tags";

        const category = document.createElement("span");
        category.className =
            `my-comments-category category-${comment.post_category}`;
        category.textContent = getMyCommentsCategoryName(comment.post_category);

        tags.appendChild(category);

        if (isReply) {
            const replyBadge = document.createElement("span");
            replyBadge.className = "my-comments-reply-badge";
            replyBadge.textContent = "답글";

            tags.appendChild(replyBadge);
        }

        // 댓글 내용
        const text = document.createElement("p");
        text.className = "my-comments-text";
        text.textContent = comment.content || "";

        // 원문 게시글 제목
        const post = document.createElement("span");
        post.className = "my-comments-post";

        const postLabel = document.createElement("span");
        postLabel.className = "my-comments-post-label";
        postLabel.textContent = "원문";

        const postTitle = document.createElement("span");
        postTitle.className = "my-comments-post-title";
        postTitle.textContent = comment.post_title || "제목 없는 게시글";

        post.appendChild(postLabel);
        post.appendChild(postTitle);

        // 작성일 · 좋아요
        const meta = document.createElement("span");
        meta.className = "activity-meta my-comments-meta";

        const date = formatMyCommentsDate(comment.created_at);
        const likes = Number(comment.comment_like_count) || 0;

        meta.textContent = date
            ? `작성 ${date} · 좋아요 ${likes}`
            : `좋아요 ${likes}`;

        link.appendChild(tags);
        link.appendChild(text);
        link.appendChild(post);
        link.appendChild(meta);

        // 삭제 버튼
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "my-comment-delete-button";
        deleteButton.textContent = "삭제";

        deleteButton.addEventListener("click", async (event) => {
            // 게시글 상세 페이지로 이동하지 않도록 막기
            event.preventDefault();
            event.stopPropagation();

            await deleteMyComment(comment, deleteButton);
        });

        item.appendChild(link);
        item.appendChild(deleteButton);

        listElement.appendChild(item);
    });

    // 페이지 이동 버튼 생성
    const totalPages = Math.ceil(
        filteredMyComments.length / COMMENTS_PER_PAGE
    );

    renderMyCommentsPagination(totalPages);
}


// ========================================
// 댓글 삭제
// DELETE /community/comments/{comment_id}
// ========================================

async function deleteMyComment(comment, button) {
    const isReply = comment.parent_comment_id !== null &&
                    comment.parent_comment_id !== undefined;

    const message = isReply
        ? "이 답글을 삭제하시겠습니까?\n삭제한 답글은 복구할 수 없습니다."
        : "이 댓글을 삭제하시겠습니까?\n댓글에 달린 답글도 함께 삭제되며 복구할 수 없습니다.";

    if (!window.confirm(message)) {
        return;
    }

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        alert("로그인 후 댓글을 삭제할 수 있습니다.");
        return;
    }

    button.disabled = true;
    button.textContent = "삭제 중...";

    try {
        const response = await fetch(
            `${API_BASE_URL}/community/comments/${comment.comment_id}`,
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
            let errorMessage = "댓글 삭제에 실패했습니다.";

            try {
                const errorData = await response.json();

                if (typeof errorData.detail === "string") {
                    errorMessage = errorData.detail;
                }
            } catch (parseError) {
                // JSON이 아니면 기본 메시지 사용
            }

            throw new Error(errorMessage);
        }

        // 삭제된 댓글과, 그 아래 달린 내 답글도 목록에서 함께 제거
        const removedIds = new Set([Number(comment.comment_id)]);

        let changed = true;

        while (changed) {
            changed = false;

            allMyComments.forEach(item => {
                const id = Number(item.comment_id);

                if (
                    !removedIds.has(id) &&
                    item.parent_comment_id !== null &&
                    item.parent_comment_id !== undefined &&
                    removedIds.has(Number(item.parent_comment_id))
                ) {
                    removedIds.add(id);
                    changed = true;
                }
            });
        }

        allMyComments = allMyComments.filter(
            item => !removedIds.has(Number(item.comment_id))
        );

        applyMyCommentsFilters();

        // 마지막 페이지의 댓글이 모두 사라졌다면 이전 페이지로 이동
        const lastPage = Math.max(
            1,
            Math.ceil(filteredMyComments.length / COMMENTS_PER_PAGE)
        );

        if (currentPage > lastPage) {
            currentPage = lastPage;
            renderMyComments();
        }

    } catch (error) {
        console.error("댓글 삭제 오류:", error);

        button.disabled = false;
        button.textContent = "삭제";

        alert(error.message || "댓글 삭제에 실패했습니다.");
    }
}


// ========================================
// 카테고리 이름 변환 (다른 마이페이지와 동일)
// ========================================

function getMyCommentsCategoryName(category) {
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

function formatMyCommentsDate(value) {
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
// 총 개수 / 받은 좋아요 / 검색 결과 개수 표시
// 총 개수와 좋아요 합계는 필터와 관계없이 전체 기준
// ========================================

function updateMyCommentsCounts(filteredCount) {
    const totalElement = document.querySelector(".my-comments-total");

    if (totalElement) {
        totalElement.textContent = `총 ${allMyComments.length}개`;
    }

    const likesElement = document.querySelector(".my-comments-likes");

    if (likesElement) {
        const totalLikes = allMyComments.reduce(
            (sum, comment) => sum + (Number(comment.comment_like_count) || 0),
            0
        );

        likesElement.textContent = `받은 좋아요 ${totalLikes}`;
    }

    const resultCountElement =
        document.getElementById("myCommentsResultCount");

    if (resultCountElement) {
        resultCountElement.textContent = `댓글 ${filteredCount}개`;
    }
}


// ========================================
// 목록이 비어 있을 때 메시지 표시
// showDescription가 true이면 안내 문구(p)도 함께 표시
// ========================================

function showMyCommentsEmpty(message, showDescription = false) {
    const listElement = document.querySelector(".my-comments-items");
    const emptyElement = document.getElementById("my-comments-empty");

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

    updateMyCommentsCounts(0);

    renderMyCommentsPagination(0);
}


// ========================================
// 페이지 이동 버튼 생성 (화살표)
// ========================================

function renderMyCommentsPagination(totalPages) {
    const paginationElement =
        document.getElementById("my-comments-pagination");

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
    prevButton.className = "my-comments-page-button page-arrow";
    prevButton.textContent = "‹";
    prevButton.setAttribute("aria-label", "이전 페이지");
    prevButton.disabled = currentPage === 1;

    prevButton.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderMyComments();
        }
    });

    paginationElement.appendChild(prevButton);

    // 페이지 번호 버튼
    for (let page = 1; page <= totalPages; page++) {
        const pageButton = document.createElement("button");

        pageButton.type = "button";
        pageButton.className = "my-comments-page-button";
        pageButton.textContent = String(page);

        if (page === currentPage) {
            pageButton.classList.add("active");
            pageButton.setAttribute("aria-current", "page");
        }

        pageButton.addEventListener("click", () => {
            currentPage = page;
            renderMyComments();
        });

        paginationElement.appendChild(pageButton);
    }

    // 다음 페이지 버튼
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "my-comments-page-button page-arrow";
    nextButton.textContent = "›";
    nextButton.setAttribute("aria-label", "다음 페이지");
    nextButton.disabled = currentPage === totalPages;

    nextButton.addEventListener("click", () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderMyComments();
        }
    });

    paginationElement.appendChild(nextButton);
}