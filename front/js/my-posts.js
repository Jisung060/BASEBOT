/* =========================================
   내가 쓴 글 - DB 연동 및 페이지 이동
========================================= */

document.addEventListener("DOMContentLoaded", function () {

    const postList = document.querySelector(".my-posts-list");
    const pagination = document.getElementById("my-posts-pagination");
    const totalElement = document.querySelector(".my-posts-total");
    const emptyElement = document.getElementById("my-posts-empty");

    if (!postList || !pagination) {
        return;
    }

    const postsPerPage = 5;
    const pageGroupSize = 5;

    let currentPage = 1;
    let totalPages = 0;

    // 카테고리 DB 값 -> 화면 표시 이름
    const categoryMap = {
        GENERAL: {
            label: "자유게시판",
            className: "category-general"
        },
        ANALYSIS: {
            label: "경기 분석",
            className: "category-analysis"
        },
        GAME_THREAD: {
            label: "경기 토론",
            className: "category-game"
        },
        NEWS: {
            label: "뉴스",
            className: "category-news"
        }
    };

    // HTML에 텍스트를 안전하게 추가하기 위한 함수
    function createTextElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text ?? "";

        return element;
    }

    // 작성일 표시
    function formatDate(dateValue) {
        if (!dateValue) {
            return "-";
        }

        const date = new Date(dateValue);

        if (Number.isNaN(date.getTime())) {
            return String(dateValue).slice(0, 10);
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        return `${year}.${month}.${day}`;
    }

    // 게시글 하나 생성
    function createPostElement(post) {

        const item = document.createElement("li");
        item.className = "my-post-item";

        const main = document.createElement("div");
        main.className = "my-post-main";

        // 카테고리 및 작성일
        const info = document.createElement("div");
        info.className = "my-post-info";

        const category = categoryMap[post.category] || {
            label: post.category || "기타",
            className: "category-general"
        };

        const categoryElement = createTextElement(
            "span",
            `my-post-category ${category.className}`,
            category.label
        );

        const dateElement = createTextElement(
            "span",
            "activity-date",
            formatDate(post.created_at)
        );

        info.append(categoryElement, dateElement);

        // 게시글 제목
        const title = createTextElement(
            "a",
            "activity-title my-post-title",
            post.title
        );

        title.href = `community-view.html?postId=${encodeURIComponent(post.post_id)}`;

        // 조회수, 좋아요, 댓글
        const stats = document.createElement("div");
        stats.className = "my-post-stats";

        stats.append(
            createTextElement(
                "span",
                "",
                `조회 ${post.view_count ?? 0}`
            ),
            createTextElement(
                "span",
                "",
                `좋아요 ${post.like_count ?? 0}`
            ),
            createTextElement(
                "span",
                "",
                `댓글 ${post.comment_count ?? 0}`
            )
        );

        main.append(info, title, stats);
        item.appendChild(main);

        return item;
    }

    // 페이지의 게시글 표시
    function renderPosts(posts) {

        postList.replaceChildren();

        posts.forEach(function (post) {
            postList.appendChild(createPostElement(post));
        });

        if (emptyElement) {
            emptyElement.style.display =
                posts.length === 0 ? "block" : "none";
        }
    }

    // 페이지 이동 버튼 생성
    function createButton(label, targetPage, disabled, active = false) {

        const button = document.createElement("button");

        button.type = "button";
        button.textContent = label;
        button.disabled = disabled;

        if (active) {
            button.classList.add("active");
            button.setAttribute("aria-current", "page");
        }

        button.addEventListener("click", function () {
            loadPosts(targetPage);
        });

        return button;
    }

    // 페이지 번호 렌더링
    function renderPagination() {

        pagination.replaceChildren();

        if (totalPages <= 1) {
            return;
        }

        const currentGroup = Math.floor(
            (currentPage - 1) / pageGroupSize
        );

        const startPage = currentGroup * pageGroupSize + 1;

        const endPage = Math.min(
            startPage + pageGroupSize - 1,
            totalPages
        );

        // 첫 페이지
        pagination.appendChild(
            createButton("<<", 1, currentPage === 1)
        );

        // 이전 페이지
        pagination.appendChild(
            createButton("<", currentPage - 1, currentPage === 1)
        );

        // 페이지 번호
        for (let page = startPage; page <= endPage; page++) {

            pagination.appendChild(
                createButton(
                    String(page),
                    page,
                    false,
                    page === currentPage
                )
            );
        }

        // 다음 페이지
        pagination.appendChild(
            createButton(">", currentPage + 1, currentPage === totalPages)
        );

        // 마지막 페이지
        pagination.appendChild(
            createButton(">>", totalPages, currentPage === totalPages)
        );
    }

    // 로그인한 사용자의 게시글 조회
    async function loadPosts(page = 1) {

        const token = sessionStorage.getItem("access_token");

        if (!token) {
            postList.replaceChildren();
            pagination.replaceChildren();

            if (totalElement) {
                totalElement.textContent = "총 0개";
            }

            if (emptyElement) {
                emptyElement.textContent = "로그인이 필요합니다.";
                emptyElement.style.display = "block";
            }

            return;
        }

        try {

            const response = await fetch(
                `/mypage/my-posts?page=${page}&size=${postsPerPage}`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                }
            );

            if (response.status === 401) {
                postList.replaceChildren();
                pagination.replaceChildren();

                if (emptyElement) {
                    emptyElement.textContent =
                        "로그인이 만료되었습니다. 다시 로그인해 주세요.";
                    emptyElement.style.display = "block";
                }

                return;
            }

            if (!response.ok) {
                throw new Error(
                    `게시글 조회 실패: HTTP ${response.status}`
                );
            }

            const data = await response.json();

            console.log("게시글 API 응답:", data);
            console.log("게시글 목록:", data.items);

            currentPage = data.page;
            totalPages = data.total_pages;

            if (totalElement) {
                totalElement.textContent = `총 ${data.total}개`;
            }

            if (emptyElement) {
                emptyElement.textContent = "작성한 게시글이 없습니다.";
            }

            renderPosts(data.items || []);
            renderPagination();

        } catch (error) {

            console.error("내가 쓴 글 조회 오류:", error);

            postList.replaceChildren();
            pagination.replaceChildren();

            if (emptyElement) {
                emptyElement.textContent =
                    "게시글을 불러오지 못했습니다. 서버 연결과 API 설정을 확인해 주세요.";
                emptyElement.style.display = "block";
            }
        }
    }

    // 최초 페이지 조회
    loadPosts(1);

});