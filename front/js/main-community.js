/* ==================================================
   메인 페이지 최신 커뮤니티 게시글
================================================== */

document.addEventListener("DOMContentLoaded", () => {
    loadRecentCommunityPosts();
});


/* 최신 게시글 조회 */
async function loadRecentCommunityPosts() {
    const list = document.getElementById("main-community-list");

    // 메인 페이지에 커뮤니티 영역이 없으면 실행하지 않음
    if (!list) {
        return;
    }

    try {
        const response = await fetch("/api/main/community-posts");

        if (!response.ok) {
            throw new Error("커뮤니티 게시글 조회 실패");
        }

        const data = await response.json();

        renderCommunityPosts(data.posts || []);

    } catch (error) {
        console.error("최신 커뮤니티 게시글 조회 오류:", error);

        list.innerHTML = `
            <li>
                <span>게시글을 불러오지 못했습니다.</span>
            </li>
        `;
    }
}


/* 게시글 목록 렌더링 */
function renderCommunityPosts(posts) {
    const list = document.getElementById("main-community-list");

    if (!list) {
        return;
    }

    // 게시글이 없는 경우
    if (posts.length === 0) {
        list.innerHTML = `
            <li>
                <span>등록된 게시글이 없습니다.</span>
            </li>
        `;
        return;
    }

    list.innerHTML = posts.map(post => {
        const title = escapeHtml(post.title || "제목 없음");
        const date = formatCommunityDate(post.created_at);

        return `
            <li>
                <a href="community-view.html?postId=${encodeURIComponent(post.post_id)}">
                    ${title}
                </a>
                <span>${date}</span>
            </li>
        `;
    }).join("");
}


/* 날짜 표시: MM.DD */
function formatCommunityDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${month}.${day}`;
}


/* HTML 특수문자 처리 */
function escapeHtml(value) {
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