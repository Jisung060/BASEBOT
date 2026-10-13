/* ========================================
   BASEBOT 스크랩한 게시글
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";

document.addEventListener("DOMContentLoaded", () => {
    loadMyScraps();
});


/* 스크랩한 게시글 목록 불러오기 */
async function loadMyScraps() {
    const listElement =
        document.querySelector(".my-posts-list");

    const totalElement =
        document.querySelector(".my-posts-total");

    const emptyElement =
        document.getElementById("my-posts-empty");

    if (!listElement || !totalElement || !emptyElement) {
        console.error("스크랩 목록 화면 요소를 찾을 수 없습니다.");
        return;
    }

    try {
        // 기존 프로젝트의 로그인 토큰 확인
        const token =
         sessionStorage.getItem("access_token");

        if (!token) {
            console.warn("로그인 토큰을 찾을 수 없습니다.");

            listElement.innerHTML = "";
            totalElement.textContent = "총 0개";
            emptyElement.textContent =
                "로그인 후 스크랩한 게시글을 확인할 수 있습니다.";
            emptyElement.style.display = "block";

            return;
        }

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

        listElement.innerHTML = "";
        totalElement.textContent = `총 ${scraps.length}개`;

        if (scraps.length === 0) {
            emptyElement.textContent =
                "스크랩한 게시글이 없습니다.";
            emptyElement.style.display = "block";
            return;
        }

        emptyElement.style.display = "none";

        scraps.forEach(scrap => {
            const item = document.createElement("li");
            item.className = "activity-item";

            const link = document.createElement("a");
            link.href =
                `/community-view.html?postId=${scrap.post_id}`;
            link.className = "activity-link";

            const title = document.createElement("strong");
            title.className = "activity-title";
            title.textContent = scrap.title || "(제목 없음)";

            const meta = document.createElement("span");
            meta.className = "activity-meta";

            const date = scrap.scrapped_at
                ? new Date(scrap.scrapped_at).toLocaleString("ko-KR")
                : "";

            meta.textContent =
                `${scrap.nickname || "알 수 없는 작성자"} · 스크랩 ${date}`;

            link.appendChild(title);
            link.appendChild(meta);
            item.appendChild(link);
            listElement.appendChild(item);
        });

    } catch (error) {
        console.error("스크랩 목록 불러오기 오류:", error);

        listElement.innerHTML = "";
        totalElement.textContent = "조회 실패";
        emptyElement.textContent =
            error.message || "스크랩 목록을 불러오지 못했습니다.";
        emptyElement.style.display = "block";
    }
}
