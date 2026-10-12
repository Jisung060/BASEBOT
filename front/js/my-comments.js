
/* ==================================================
   내가 쓴 댓글
   페이지당 5개
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
        <li>
            <span class="activity-title">
                댓글을 불러오는 중입니다.
            </span>
            <span class="activity-date">-</span>
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
            throw new Error("댓글 목록 조회 실패");
        }

        const data = await response.json();

        renderMyComments(data.comments || []);
        renderMyCommentsPagination(
            data.page,
            data.total_pages
        );

    } catch (error) {
        console.error("내가 쓴 댓글 조회 오류:", error);

        list.innerHTML = `
            <li>
                <span class="activity-title">
                    댓글 목록을 불러오지 못했습니다.
                </span>
                <span class="activity-date">-</span>
            </li>
        `;

        pagination.innerHTML = "";
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
            <li>
                <span class="activity-title">
                    작성한 댓글이 없습니다.
                </span>
                <span class="activity-date">-</span>
            </li>
        `;
        return;
    }

    list.innerHTML = comments.map(comment => {
        const postTitle = escapeCommentHtml(
            comment.post_title || "게시글"
        );

        const content = escapeCommentHtml(
            comment.content || ""
        );

        const date = formatCommentDate(comment.created_at);

        return `
            <li class="my-comment-item">
                <div class="my-comment-content">
                    <a
                        href="/community-view.html?postId=${encodeURIComponent(comment.post_id)}"
                        class="activity-title my-comment-post-title"
                        title="${postTitle}"
                    >
                        ${postTitle}
                    </a>

                    <p class="my-comment-text">${content}</p>
                </div>

                <span class="activity-date">${date}</span>
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
                class="mypage-page-btn ${page === currentPage ? "active" : ""}"
                data-page="${page}"
                ${page === currentPage ? 'aria-current="page"' : ""}
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
