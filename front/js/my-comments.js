/* ==================================================
   내가 쓴 댓글
   - 페이지당 5개
   - 전체 댓글 수
   - 댓글 좋아요 합계
   - 게시판 카테고리 및 관련 구단
   - 게시글 좋아요 및 댓글 수
================================================== */

document.addEventListener("DOMContentLoaded", () => {
    loadMyComments(1);
});


/* ==================================================
   댓글 목록 조회
================================================== */

async function loadMyComments(page = 1) {
    const list = document.getElementById("my-comments-list");
    const pagination = document.getElementById(
        "my-comments-pagination"
    );

    if (!list || !pagination) return;

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        alert("로그인이 필요합니다.");
        location.href = "/login.html";
        return;
    }

    list.innerHTML = `
        <li class="empty-comment">
            댓글을 불러오는 중입니다.
        </li>
    `;

    pagination.innerHTML = "";

    try {
        const response = await fetch(
            `/api/mypage/comments?page=${page}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                cache: "no-store"
            }
        );

        if (response.status === 401) {
            alert("로그인이 만료되었습니다.");

            sessionStorage.removeItem("access_token");
            sessionStorage.removeItem("loginUser");

            location.href = "/login.html";
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "댓글 API 응답 오류:",
                response.status,
                errorText
            );

            throw new Error(
                `댓글 목록 조회 실패: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        renderMyCommentsSummary(data.summary || {});
        renderMyComments(data.comments || []);
        renderMyCommentsPagination(
            Number(data.page || 1),
            Number(data.total_pages || 0)
        );

        // 목록 상단의 전체 댓글 개수
        const countLabel = document.getElementById(
            "comments-count-label"
        );

        if (countLabel) {
            countLabel.textContent = Number(
                data.total || 0
            ).toLocaleString("ko-KR");
        }

    } catch (error) {
        console.error("내가 쓴 댓글 조회 오류:", error);

        list.innerHTML = `
            <li class="empty-comment error">
                댓글 목록을 불러오지 못했습니다.
                <p>잠시 후 다시 시도해 주세요.</p>
            </li>
        `;

        pagination.innerHTML = "";
    }
}


/* ==================================================
   활동 요약
================================================== */

function renderMyCommentsSummary(summary) {
    const totalComments = document.getElementById(
        "total-comments"
    );

    const totalLikes = document.getElementById(
        "total-comment-likes"
    );

    if (totalComments) {
        totalComments.textContent = Number(
            summary.total_comments || 0
        ).toLocaleString("ko-KR");
    }

    if (totalLikes) {
        totalLikes.textContent = Number(
            summary.total_likes || 0
        ).toLocaleString("ko-KR");
    }
}


/* ==================================================
   댓글 목록 출력
================================================== */

function renderMyComments(comments) {
    const list = document.getElementById("my-comments-list");

    if (!list) return;

    if (comments.length === 0) {
        list.innerHTML = `
            <li class="empty-comment">
                <span class="empty-comment-icon">✎</span>
                <strong>아직 작성한 댓글이 없습니다.</strong>
                <p>커뮤니티에서 첫 번째 댓글을 작성해 보세요.</p>
            </li>
        `;
        return;
    }

    const categoryNames = {
        GENERAL: "자유게시판",
        ANALYSIS: "경기 분석",
        GAME_THREAD: "경기 스레드",
        NEWS: "뉴스"
    };

    list.innerHTML = comments.map(comment => {
        const postId = encodeURIComponent(comment.post_id);

        const postTitle = escapeCommentHtml(
            comment.post_title || "제목 없는 게시글"
        );

        const rawContent = comment.content || "";

        const content = escapeCommentHtml(
            rawContent.length > 20
                ? rawContent.slice(0, 20) + "..."
                : rawContent
        );

        const categoryValue = comment.post_category || "";

        const category = escapeCommentHtml(
            categoryNames[categoryValue] ||
            categoryValue ||
            "게시판"
        );

        const teamName = comment.team_name
            ? escapeCommentHtml(comment.team_name)
            : "";

        const date = formatCommentDate(comment.created_at);

        const commentLikes = Number(
            comment.comment_like_count || 0
        );

        const postLikes = Number(
            comment.post_like_count || 0
        );

        const postCommentCount = Number(
            comment.post_comment_count || 0
        );

        return `
            <li class="my-comment-item">

                <!-- 카테고리, 구단, 작성일 -->
                <div class="my-comment-top">

                    <div class="my-comment-tags">
                        <span class="my-comment-category">
                            ${category}
                        </span>

                        ${teamName ? `
                            <span class="my-comment-team">
                                ⚾ ${teamName}
                            </span>
                        ` : ""}
                    </div>

                    <time class="activity-date">
                        ${date}
                    </time>

                </div>

                <!-- 원본 게시글 제목 -->
                <a
                    href="/community-view.html?post_id=${postId}"
                    class="my-comment-post-title"
                    title="${postTitle}"
                >
                    <span class="my-comment-post-label">
                        원본 게시글
                    </span>
                    <span class="my-comment-post-heading">
                        ${postTitle}
                    </span>
                    <span class="my-comment-arrow">↗</span>
                </a>

                <!-- 내가 작성한 댓글 -->
                <div class="my-comment-text-box">
                    <span class="my-comment-label">
                        내가 작성한 댓글
                    </span>

                    <p class="my-comment-text">${content}</p>
                </div>

                <!-- 활동 정보 -->
                <div class="my-comment-bottom">

                    <div class="my-comment-stats">
                        <span title="내 댓글이 받은 좋아요">
                            <span class="comment-stat-icon">♥</span>
                            댓글 좋아요
                            <strong>
                                ${commentLikes.toLocaleString("ko-KR")}
                            </strong>
                        </span>

                        <span title="원본 게시글의 좋아요">
                            <span class="comment-stat-icon">♡</span>
                            게시글 좋아요
                            <strong>
                                ${postLikes.toLocaleString("ko-KR")}
                            </strong>
                        </span>

                        <span title="원본 게시글의 댓글 수">
                            <span class="comment-stat-icon">▤</span>
                            게시글 댓글
                            <strong>
                                ${postCommentCount.toLocaleString("ko-KR")}
                            </strong>
                        </span>
                    </div>

                    <a
                        href="/community-view.html?postId=${postId}"
                        class="my-comment-view-link"
                    >
                        게시글 보기
                        <span>→</span>
                    </a>

                </div>

            </li>
        `;
    }).join("");
}


/* ==================================================
   페이지네이션
================================================== */

function renderMyCommentsPagination(currentPage, totalPages) {
    const pagination = document.getElementById(
        "my-comments-pagination"
    );

    if (!pagination) return;

    if (!totalPages || totalPages <= 1) {
        pagination.innerHTML = "";
        return;
    }

    let html = `
        <button
            type="button"
            class="mypage-page-btn"
            data-page="${currentPage - 1}"
            ${currentPage === 1 ? "disabled" : ""}
        >
            이전
        </button>
    `;

    for (let page = 1; page <= totalPages; page++) {
        html += `
            <button
                type="button"
                class="mypage-page-btn ${
                    page === currentPage ? "active" : ""
                }"
                data-page="${page}"
                ${
                    page === currentPage
                        ? 'aria-current="page"'
                        : ""
                }
            >
                ${page}
            </button>
        `;
    }

    html += `
        <button
            type="button"
            class="mypage-page-btn"
            data-page="${currentPage + 1}"
            ${currentPage === totalPages ? "disabled" : ""}
        >
            다음
        </button>
    `;

    pagination.innerHTML = html;

    pagination.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => {
            if (button.disabled) return;

            const nextPage = Number(button.dataset.page);

            if (nextPage >= 1 && nextPage <= totalPages) {
                loadMyComments(nextPage);
            }
        });
    });
}


/* ==================================================
   날짜 포맷
================================================== */

function formatCommentDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
}


/* ==================================================
   HTML 특수문자 처리
================================================== */

function escapeCommentHtml(value) {
    return String(value).replace(/[&<>"']/g, char => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[char];
    });
}