/* =========================================
   BASEBOT Community JavaScript
   현재는 화면 동작 확인용
   이후 FastAPI API로 교체
========================================= */
const API_BASE_URL = "http://127.0.0.1:8000";

// 커뮤니티 사이드바 설정
// 1) 로그인한 사용자에게만 '내 활동' 표시
// 2) 현재 보고 있는 메뉴 강조
function setupCommunitySidebar() {
    const myActivity = document.getElementById("communityMyActivity");

    if (myActivity) {
        myActivity.hidden = !sessionStorage.getItem("access_token");
    }

    const category = (
        new URLSearchParams(window.location.search).get("category") || ""
    ).toUpperCase();

    if (category) {
        document
            .querySelectorAll(".community-sidebar-submenu a[data-category]")
            .forEach((link) => {
                link.classList.toggle(
                    "active",
                    link.dataset.category === category
                );
            });
    } else {
        document
            .getElementById("communityAllLink")
            ?.classList.add("active");
    }
}

document.addEventListener("DOMContentLoaded", setupCommunitySidebar);

function showBasebotModal(
    title,
    message,
    callback = null
) {
    const modal =
        document.getElementById("basebotModal");

    const titleElement =
        document.getElementById("basebotModalTitle");

    const messageElement =
        document.getElementById("basebotModalMessage");

    const button =
        document.getElementById("basebotModalButton");

    const cancelButton =
        document.getElementById("basebotModalCancelButton");

    if (
        !modal ||
        !titleElement ||
        !messageElement ||
        !button
    ) {
        return;
    }

    titleElement.textContent = title;
    messageElement.textContent = message;

    // 일반 알림 팝업에서는 취소 버튼 숨기기
    if (cancelButton) {
        cancelButton.style.display = "none";
    }

    button.textContent = "확인";

    modal.classList.add("show");

    button.onclick = function () {

        modal.classList.remove("show");

        if (callback) {
            callback();
        }
    };
}


// =========================================
// BASEBOT 확인 팝업
// 삭제 확인 등에 사용
// =========================================
function showBasebotConfirm(
    title,
    message,
    confirmCallback = null,
    confirmText = "확인"
) {
    const modal =
        document.getElementById("basebotModal");

    const titleElement =
        document.getElementById("basebotModalTitle");

    const messageElement =
        document.getElementById("basebotModalMessage");

    const button =
        document.getElementById("basebotModalButton");

    const cancelButton =
        document.getElementById("basebotModalCancelButton");

    if (
        !modal ||
        !titleElement ||
        !messageElement ||
        !button ||
        !cancelButton
    ) {
        return;
    }

    titleElement.textContent = title;
    messageElement.textContent = message;

    // 확인 팝업에서는 취소 버튼 표시
    cancelButton.style.display = "inline-flex";

    cancelButton.textContent = "취소";
    button.textContent = confirmText;

    modal.classList.add("show");


    // 취소 버튼
    cancelButton.onclick = function () {

        modal.classList.remove("show");

    };


    // 확인 버튼
    button.onclick = function () {

        modal.classList.remove("show");

        if (confirmCallback) {
            confirmCallback();
        }
    };
}

// =========================================
// 로그인 필요 팝업
// 로그인하지 않고 로그인이 필요한 기능을 눌렀을 때 호출
// message : 기능마다 다른 안내 문구를 쓸 때만 전달 (생략하면 기본 문구)
// "로그인하기" → 로그인 페이지로 이동 / "취소" → 팝업만 닫힘
// =========================================
function showLoginRequired(
    message = "해당 기능은 로그인 후 이용할 수 있습니다."
) {
    showBasebotConfirm(
        "로그인이 필요합니다",
        message,
        function () {
            window.location.href = "/login.html";
        },
        "로그인하기"
    );
}


// =========================================
// 로그인한 사용자의 ID 가져오기
// 토큰(JWT) 안의 user_id를 꺼내서 반환
// 로그인하지 않았거나 토큰이 올바르지 않으면 null
// =========================================
function getCurrentUserId() {

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        return null;
    }

    try {
        const payload = JSON.parse(
            atob(
                token.split(".")[1]
                    .replace(/-/g, "+")
                    .replace(/_/g, "/")
            )
        );

        return Number(payload.user_id);

    } catch (error) {
        console.error("로그인 사용자 정보 확인 오류:", error);
        return null;
    }
}


// =========================================
// HTML 특수문자 변환
// 사용자가 입력한 글을 innerHTML에 넣을 때 사용
// (<script> 같은 입력이 코드로 실행되는 것을 방지)
// =========================================
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* =========================================
   팀 정보
   DB의 teams 테이블에서 가져온다.
========================================= */

let teams = [];
let teamNamesByCode = {};

/* =========================================
   DB에서 팀 목록 가져오기 (community.js)
========================================= */
async function loadTeams() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/teams`);
        if (!response.ok) {
            throw new Error(`팀 목록 조회 실패: ${response.status}`);
        }

        teams = await response.json();
        console.log("DB에서 가져온 팀 목록:", teams);

        // 팀 코드 → 한글 팀 이름 매핑
        teamNamesByCode = {};
        teams.forEach(team => {
            const koreanName = window.koreanTeamNames && window.koreanTeamNames[team.team_code];
            teamNamesByCode[team.team_code] = koreanName || team.team_name;
        });

    } catch (error) {
        console.error("팀 목록을 불러오는 중 오류:", error);
        teams = [];
        teamNamesByCode = {};
    }
}


/* =========================================
   리그 → 지구 → 팀 선택
========================================= */

function updateTeamSelect(
    leagueSelectId,
    divisionSelectId,
    teamSelectId
) {

    const leagueSelect =
        document.getElementById(leagueSelectId);

    const divisionSelect =
        document.getElementById(divisionSelectId);

    const teamSelect =
        document.getElementById(teamSelectId);


    if (
        !leagueSelect ||
        !divisionSelect ||
        !teamSelect
    ) {
        return;
    }


    /* -----------------------------------------
       팀 초기화
    ----------------------------------------- */

    function resetTeams() {

        teamSelect.innerHTML =
            '<option value="">전체 팀</option>';

        teamSelect.value = "";
        teamSelect.disabled = true;
    }


    /* -----------------------------------------
       지구 목록 표시
    ----------------------------------------- */

    function renderDivisions() {

        const league = leagueSelect.value;

        divisionSelect.innerHTML = `
            <option value="">전체 지구</option>
            <option value="East">동부</option>
            <option value="Central">중부</option>
            <option value="West">서부</option>
        `;

        divisionSelect.value = "";

        divisionSelect.disabled = !league;

        resetTeams();
    }


    /* -----------------------------------------
       팀 목록 표시
    ----------------------------------------- */

    function renderTeams() {

        const league = leagueSelect.value;
        const division = divisionSelect.value;

        resetTeams();


        if (!league || !division) {
            return;
        }


        const list = teams.filter(team =>

            team.league === league &&
            team.division === division

        );


        list.forEach(team => {

            const option =
                document.createElement("option");

            option.value = team.team_code;

            option.textContent =
            koreanTeamNames[team.team_code] ||
            team.team_name;

            teamSelect.appendChild(option);

        });


        teamSelect.disabled = list.length === 0;
    }


    leagueSelect.addEventListener(
        "change",
        renderDivisions
    );


    divisionSelect.addEventListener(
        "change",
        renderTeams
    );


    if (leagueSelect.value) {

        renderDivisions();

    } else {

        divisionSelect.disabled = true;

        resetTeams();
    }
}

// =========================================
// 글쓰기 팀 선택
// 리그/지구 선택 없이 전체 팀 표시
// =========================================

function setupWriteTeamSelect() {

    const teamSelect =
        document.getElementById("writeTeamSelect");

    if (!teamSelect) {
        return;
    }

    // 기본 선택 항목
    teamSelect.innerHTML =
        '<option value="">선택 안 함</option>';

    // 전체 팀 목록 표시
    teams.forEach(team => {

        const option =
            document.createElement("option");

        option.value = team.team_code;

        option.textContent =
            koreanTeamNames[team.team_code] ||
            team.team_name;

        teamSelect.appendChild(option);
    });
}

/* =========================================
   팀 데이터 로드 후 선택창 초기화
========================================= */

async function initializeTeamSelects() {

    await loadTeams();

    updateTeamSelect(
        "leagueSelect",
        "divisionSelect",
        "teamSelect"
    );

    setupWriteTeamSelect();

}


initializeTeamSelects();

// =========================================
// 커뮤니티 필터 상태
// =========================================

// 상단 분류 검색 조건
let appliedFilter = {
    league: "",
    division: "",
    team: "",
    category: ""
};

// 하단 게시글 검색 조건
let appliedPostSearch = {
    type: "",
    keyword: ""
};

// =========================================
// 인기 게시글 불러오기
// =========================================

async function loadPopularPosts() {

    const popularGrid =
        document.getElementById("popularGrid");

    if (!popularGrid) return;

    try {

        const response = await fetch(
            `${API_BASE_URL}/community/posts/popular`
        );

        if (!response.ok) {
            throw new Error(
                "인기 게시글을 불러오지 못했습니다."
            );
        }

        const posts = await response.json();

        popularGrid.innerHTML = "";

        posts.forEach(post => {

            const card =
                document.createElement("a");

            card.href =
                `community-view.html?postId=${post.post_id}`;

            card.className =
                "popular-card";

            // 상단 필터에서 사용할 데이터
            card.dataset.league =
                post.league || "";

            card.dataset.division =
                post.division || "";

            card.dataset.team =
                post.team_code || "";

            card.dataset.category =
                post.category || "";

            // 카테고리 이름
            let categoryName = "";

            switch (post.category) {
                case "GENERAL":
                    categoryName = "자유";
                    break;

                case "ANALYSIS":
                    categoryName = "분석";
                    break;

                case "GAME_THREAD":
                    categoryName = "경기";
                    break;

                case "NEWS":
                    categoryName = "뉴스";
                    break;

                default:
                    categoryName = post.category || "";
            }

            // 카테고리 CSS 클래스
            const categoryClass =
                post.category
                    ? post.category.toLowerCase()
                    : "";

            // 내용 미리보기 (HTML 태그를 뺀 글자만 80자)
            const previewText =
                post.content
                    ? new DOMParser()
                        .parseFromString(post.content, "text/html")  // 코드를 실행하지 않고 읽기
                        .body.textContent                            // 글자만 꺼내기 (&nbsp; 등도 정상 글자로 변환)
                        .trim()
                        .substring(0, 80)
                    : "";

            // 글자를 HTML에 안전하게 넣기 위해 변환
            const preview = escapeHtml(previewText);

            card.innerHTML = `
                <div class="popular-card-top">
                    <span class="category-label ${categoryClass}">
                        ${categoryName}
                    </span>
                    <span>
                        추천 ${post.like_count || 0}
                    </span>
                </div>

                <h3>
                    ${escapeHtml(post.title)}
                </h3>

                <p>
                    ${preview}
                </p>

                <div class="popular-card-meta">
                    ${escapeHtml(post.nickname || "익명")} ·
                    조회 ${post.view_count || 0}
                </div>
            `;

            popularGrid.appendChild(card);
        });

        console.log(
            "인기 게시글 불러오기 완료:",
            posts
        );

    } catch (error) {

        console.error(
            "인기 게시글 불러오기 오류:",
            error
        );

        popularGrid.innerHTML = `
            <p class="popular-empty">
                인기 게시글을 불러오지 못했습니다.
            </p>
        `;
    }
}

// =========================================
// 게시판 페이지네이션
// =========================================
const POSTS_PER_PAGE = 15;
let currentPage = 1;

// =========================================
// 게시글 필터링 + 정렬
// 상단 분류 + 하단 게시글 검색을
// 동시에 적용한다.
// =========================================
function updateCommunityBoard() {

    const board =
        document.querySelector(".board");

    const boardRows =
        [...document.querySelectorAll(".board-row")];

    const popularCards =
        [...document.querySelectorAll(".popular-card")];

    const selectedFilter =
        document.getElementById("selectedFilter");

    const boardTotal =
        document.querySelector(".board-total");

    const emptyMessage =
        document.getElementById("filterEmptyMessage");

    const sortSelect =
        document.getElementById("sortSelect");


    // -----------------------------------------
    // 게시글 하나가 상단 분류 조건에 맞는지 확인
    // -----------------------------------------
    function matchesTopFilter(element) {

    const elementLeague =
        (element.dataset.league || "").toUpperCase();

    const elementDivision =
        (element.dataset.division || "").toUpperCase();

    const elementTeam =
        (element.dataset.team || "").toUpperCase();

    const elementCategory =
        (element.dataset.category || "").toUpperCase();


    const filterLeague =
        (appliedFilter.league || "").toUpperCase();

    const filterDivision =
        (appliedFilter.division || "").toUpperCase();

    const filterTeam =
        (appliedFilter.team || "").toUpperCase();

    const filterCategory =
        (appliedFilter.category || "").toUpperCase();


    if (
        filterLeague &&
        elementLeague !== filterLeague
    ) {
        return false;
    }


    if (
        filterDivision &&
        elementDivision !== filterDivision
    ) {
        return false;
    }


    if (
        filterTeam &&
        elementTeam !== filterTeam
    ) {
        return false;
    }


    if (
        filterCategory &&
        elementCategory !== filterCategory
    ) {
        return false;
    }


    return true;
}


    // -----------------------------------------
    // 게시글 하나가 하단 검색 조건에 맞는지 확인
    // -----------------------------------------
    function matchesPostSearch(element) {

        const keyword =
            appliedPostSearch.keyword;

        // 검색어가 없으면 전부 통과
        if (!keyword) {
            return true;
        }

        const title =
            (element.dataset.title || "")
                .toLowerCase();

        const content =
            (element.dataset.content || "")
                .toLowerCase();

        const writer =
            (element.dataset.writer || "")
                .toLowerCase();


        // 제목 검색
        if (appliedPostSearch.type === "title") {

            return title.includes(keyword);
        }


        // 작성자 검색
        if (appliedPostSearch.type === "writer") {

            return writer.includes(keyword);
        }


        // 제목 + 내용 검색
        return (
            title.includes(keyword) ||
            content.includes(keyword)
        );
    }


    // -----------------------------------------
    // 최종 조건
    //
    // 상단 조건 AND 하단 검색 조건
    // -----------------------------------------
    function matchesAll(element) {

        return (
            matchesTopFilter(element) &&
            matchesPostSearch(element)
        );
    }


    // -----------------------------------------
    // 정렬
    // -----------------------------------------
    function sortRows(rows) {

        const sortValue =
            sortSelect?.value || "latest";


        return [...rows].sort((a, b) => {

            if (sortValue === "views") {

                return (
                    Number(b.dataset.views) -
                    Number(a.dataset.views)
                );
            }


            if (sortValue === "likes") {

                return (
                    Number(b.dataset.likes) -
                    Number(a.dataset.likes)
                );
            }


            // 최신순
            const dateCompare =
                String(b.dataset.date)
                    .localeCompare(
                        String(a.dataset.date)
                    );


            if (dateCompare !== 0) {
                return dateCompare;
            }


            // 날짜가 같으면 게시글 번호가 큰 것부터
            return (
                Number(b.children[0].textContent) -
                Number(a.children[0].textContent)
            );
        });
    }


    // -----------------------------------------
    // 실제 게시글 필터링
    // -----------------------------------------
    const matchedRows =
        boardRows.filter(row => matchesAll(row));


    // 모든 게시글 숨기기 / 조건에 맞는 글만 표시
    boardRows.forEach(row => {

        row.hidden =
            !matchedRows.includes(row);
    });

    // -----------------------------------------
    // 인기 게시글도 상단 필터 적용
    // -----------------------------------------

    popularCards.forEach(card => {

        card.hidden =
            !matchesTopFilter(card);
    });


   // -----------------------------------------
    // 정렬 + 페이지네이션
    // -----------------------------------------
    if (board) {

        const sortedRows =
            sortRows(matchedRows);

        // 전체 페이지 수 계산
        const totalPages =
            Math.ceil(
                sortedRows.length / POSTS_PER_PAGE
            );

        // 현재 페이지가 전체 페이지보다 커졌다면
        // 마지막 페이지로 이동
        if (
            totalPages > 0 &&
            currentPage > totalPages
        ) {
            currentPage = totalPages;
        }

        // 현재 페이지에서 보여줄 시작 위치
        const startIndex =
            (currentPage - 1) * POSTS_PER_PAGE;

        // 현재 페이지에서 보여줄 게시글
        const pageRows =
            sortedRows.slice(
                startIndex,
                startIndex + POSTS_PER_PAGE
            );

        // 모든 게시글 숨기기
        boardRows.forEach(row => {
            row.hidden = true;
        });

        // 현재 페이지 게시글만 표시
        pageRows.forEach(row => {
            row.hidden = false;
            board.appendChild(row);
        });

        // 페이지 버튼 생성
        renderPagination(totalPages);
    }


    // -----------------------------------------
    // 상단 조건 표시
    // -----------------------------------------
    const leagueSelect =
        document.getElementById("leagueSelect");

    const divisionSelect =
        document.getElementById("divisionSelect");

    const teamSelect =
        document.getElementById("teamSelect");


    const parts = [];


    if (appliedFilter.league) {

        parts.push(
            leagueSelect?.selectedOptions[0]?.textContent ||
            "전체 리그"
        );
    }


    if (appliedFilter.division) {

        parts.push(
            divisionSelect?.selectedOptions[0]?.textContent ||
            "전체 지구"
        );
    }


    if (appliedFilter.team) {

        parts.push(
            teamSelect?.selectedOptions[0]?.textContent ||
            "전체 팀"
        );
    }


    const categoryNames = {

        GENERAL: "자유",

        ANALYSIS: "분석",

        GAME_THREAD: "경기",

        NEWS: "뉴스"
    };


    if (appliedFilter.category) {

        parts.push(
            categoryNames[appliedFilter.category] ||
            ""
        );
    }


    const conditionText =
        parts.length
            ? parts.join(" · ")
            : "전체 게시글";


    if (selectedFilter) {

        selectedFilter.textContent =
            conditionText;
    }


    // -----------------------------------------
    // 게시글 개수 + 정렬 표시
    // -----------------------------------------
    if (boardTotal) {

        const sortName = {

            latest: "최신순",

            views: "조회순",

            likes: "추천순"

        }[sortSelect?.value || "latest"];


        boardTotal.innerHTML =
            `${conditionText} · ${sortName} <strong>${matchedRows.length}</strong>`;
    }


    // -----------------------------------------
    // 검색 결과 없음
    // -----------------------------------------
    if (emptyMessage) {

        emptyMessage.hidden =
            matchedRows.length !== 0;
    }
}

// =========================================
// 게시판 페이지네이션
// =========================================
function renderPagination(totalPages) {

    const pagination =
        document.querySelector(".pagination");

    if (!pagination) {
        return;
    }

    // 기존 페이지 버튼 삭제
    pagination.innerHTML = "";

    // 페이지가 없거나 1페이지뿐이면 버튼 표시 안 함
    if (totalPages <= 1) {
        return;
    }


    // 이전 버튼
    if (currentPage > 1) {

        const prevButton =
            document.createElement("a");

        prevButton.href = "#";
        prevButton.textContent = "‹";

        prevButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                currentPage--;

                updateCommunityBoard();
            }
        );

        pagination.appendChild(
            prevButton
        );
    }


    // 페이지 번호
    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        const pageButton =
            document.createElement("a");

        pageButton.href = "#";

        pageButton.textContent = page;


        // 현재 페이지
        if (page === currentPage) {

            pageButton.classList.add(
                "active"
            );
        }


        pageButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                currentPage = page;

                updateCommunityBoard();
            }
        );


        pagination.appendChild(
            pageButton
        );
    }


    // 다음 버튼
    if (currentPage < totalPages) {

        const nextButton =
            document.createElement("a");

        nextButton.href = "#";

        nextButton.textContent = "›";


        nextButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                currentPage++;

                updateCommunityBoard();
            }
        );


        pagination.appendChild(
            nextButton
        );
    }
}



// =========================================
// 상단 리그 / 지구 / 팀 / 카테고리 필터
// =========================================
function setupCommunityFilters() {

    const leagueSelect =
        document.getElementById("leagueSelect");

    const divisionSelect =
        document.getElementById("divisionSelect");

    const teamSelect =
        document.getElementById("teamSelect");

    const categorySelect =
        document.getElementById("categorySelect");


    const sortSelect =
        document.getElementById("sortSelect");

    console.log(
        "필터 요소 확인:",
        {
            leagueSelect,
            divisionSelect,
            teamSelect,
            categorySelect,
            sortSelect
        }
    );

    if (
        !leagueSelect ||
        !divisionSelect ||
        !teamSelect
    ) {
        return;
    }

    // -----------------------------------------
    // 정렬 변경
    // -----------------------------------------
    sortSelect?.addEventListener(
        "change",
        () => {
            currentPage = 1;
            updateCommunityBoard();
        }
    );

    // -----------------------------------------
    // 처음에는 전체 게시글 표시
    // -----------------------------------------
    updateCommunityBoard();
}

// =========================================
//  게시글 검색
// 제목 / 제목+내용 / 작성자
// =========================================
function setupPostSearch() {

    const searchButton =
        document.getElementById(
            "postSearchButton"
        );

    const searchType =
        document.getElementById(
            "searchType"
        );

    const searchInput =
        document.getElementById(
            "searchInput"
        );


    if (
        !searchButton ||
        !searchType ||
        !searchInput
    ) {
        return;
    }



    searchButton.addEventListener("click", function () {
        const type = searchType.value;
        const keyword = searchInput.value.trim().toLowerCase();

        // 1. 키워드 검색 조건 저장
        appliedPostSearch = {
            type: keyword ? type : "",
            keyword: keyword
        };

        // 2. 상세검색 조건 저장
        appliedFilter = {
            league: document.getElementById("leagueSelect")?.value || "",
            division: document.getElementById("divisionSelect")?.value || "",
            team: document.getElementById("teamSelect")?.value || "",
            category: document.getElementById("categorySelect")?.value || ""
        };

        // 3. 첫 페이지부터 통합 검색
        currentPage = 1;
        updateCommunityBoard();
    });


    searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        searchButton.click();
    }
});
}

async function loadPosts() {

    console.log("loadPosts 실행됨");

    // 검색 조건 가져오기
    const searchType =
        document.getElementById("searchType")?.value || "";

    const searchKeyword =
        document.getElementById("searchInput")?.value.trim() || "";

    console.log("검색 기준:", searchType);
    console.log("검색어:", searchKeyword);

    try {

        const response = await fetch(
            `${API_BASE_URL}/community/posts`
        );

        if (!response.ok) {
            throw new Error("게시글을 불러오지 못했습니다.");
        }

        const posts = await response.json();

        console.log("DB에서 가져온 게시글:", posts);

        const board = document.querySelector(".board");

        if (!board) {
            return;
        }

        // 기존 샘플 게시글만 삭제
        board.querySelectorAll(".board-row").forEach(row => {
            row.remove();
        });

        // 게시글 하나씩 화면에 생성
        posts.forEach(post => {

            // 카테고리 표시용 이름
            const categoryNames = {
                GENERAL: "자유",
                ANALYSIS: "분석",
                GAME_THREAD: "경기",
                NEWS: "뉴스"
            };

            // 카테고리 CSS 클래스
            const categoryClasses = {
                GENERAL: "general",
                ANALYSIS: "analysis",
                GAME_THREAD: "game",
                NEWS: "news"
            };

            // 지구 표시용 이름
            const divisionNames = {
                East: "동부",
                Central: "중부",
                West: "서부"
            };

            // 날짜
            const date = new Date(post.created_at);

            const month = String(
                date.getMonth() + 1
            ).padStart(2, "0");

            const day = String(
                date.getDate()
            ).padStart(2, "0");

            const displayDate = `${month}.${day}`;

            // 게시글 행 생성
            const row = document.createElement("a");

            row.className = "board-row";

            // 게시글 상세 페이지로 이동
            row.href = `community-view.html?postId=${post.post_id}`;

            // 필터에서 사용할 데이터
            row.dataset.league = post.league || "";

            row.dataset.division = post.division
                ? post.division.toUpperCase()
                : "";

            row.dataset.team = post.team_code || "";

            row.dataset.category = post.category || "";

            row.dataset.date = post.created_at || "";

            row.dataset.views = post.view_count || 0;

            row.dataset.likes = post.like_count || 0;

            // 검색용 데이터
            row.dataset.title = post.title || "";

            row.dataset.content = post.content || "";

            row.dataset.writer = post.nickname || "";


            /* =========================================
               팀 코드 → 한글 팀 이름
            ========================================= */

            const displayTeamName =
                teamNamesByCode[post.team_code] ||
                post.team_name ||
                "전체 팀";


            // 게시글 내용
            row.innerHTML = `
                <div>
                    ${post.post_id}
                </div>

                <div>
                    <span class="category-label ${categoryClasses[post.category] || ""}">
                        ${categoryNames[post.category] || post.category}
                    </span>
                </div>

                <div class="col-title">

                    <div class="post-filter-info">
                        ${post.league || ""} ·
                        ${divisionNames[post.division] || post.division || ""} ·
                        ${displayTeamName}
                    </div>

                    <span class="board-title">
                        ${escapeHtml(post.title)}
                    </span>

                    <span class="comment-count">
                        [${post.comment_count || 0}]
                    </span>

                </div>

                <div>
                    ${escapeHtml(post.nickname)}
                </div>

                <div>
                    ${displayDate}
                </div>

                <div>
                    ${Number(post.view_count || 0).toLocaleString()}
                </div>

                <div>
                    ${Number(post.like_count || 0).toLocaleString()}
                </div>
            `;

            board.appendChild(row);
        });

    } catch (error) {

        console.error(
            "게시글 조회 오류:",
            error
        );
    }
}

// 사이드바 링크(?category=GENERAL 등)로 들어왔을 때
// 상단 분류 필터에 반영
function applyCategoryFromUrl() {

    const category = (
        new URLSearchParams(window.location.search).get("category") || ""
    ).toUpperCase();

    const allowed = ["GENERAL", "ANALYSIS", "GAME_THREAD", "NEWS"];

    // 올바르지 않은 값은 무시
    if (!allowed.includes(category)) {
        return;
    }

    appliedFilter.category = category;

    const categorySelect = document.getElementById("categorySelect");

    if (categorySelect) {
        categorySelect.value = category;
    }
}



/* =========================================
   커뮤니티 시작
   게시글을 먼저 불러온 후 필터 설정
========================================= */

async function startCommunity() {

    await loadPosts();
    await loadPopularPosts();

    applyCategoryFromUrl();

    setupCommunityFilters();

    setupPostSearch();
}

startCommunity();


/* =========================================
   커뮤니티 목록으로 돌아왔을 때
   최신 게시글 데이터 다시 불러오기
========================================= */

window.addEventListener("pageshow", async function (event) {
    const board = document.querySelector(".board");

    if (!board) return;

    // 브라우저 뒤로가기/앞으로가기로 돌아온 경우에만 새로고침
    if (event.persisted) {
        await loadPosts();
        await loadPopularPosts();
        setupCommunityFilters();
    }
});



/* =========================================
   게시글 상세 조회
========================================= */

async function loadPostDetail() {

    const postId =
        new URLSearchParams(
            window.location.search
        ).get("postId");

    if (!postId) {
        return;
    }

    const postDetail =
        document.querySelector(".post-detail");

    if (!postDetail) {
        return;
    }

    try {

        // =================================
        // 조회수 증가
        // =================================

        const viewResponse =
            await fetch(
                `${API_BASE_URL}/community/posts/${postId}/view`,
                {
                    method: "POST"
                }
            );

        if (!viewResponse.ok) {

            throw new Error(
                "조회수 증가에 실패했습니다."
            );
        }


        // =================================
        // 게시글 상세 조회
        // =================================

        const response =
            await fetch(
                `${API_BASE_URL}/community/posts/${postId}`
            );

        if (!response.ok) {

            throw new Error(
                "게시글을 불러오지 못했습니다."
            );
        }

        const post =
            await response.json();

        console.log(
            "상세 게시글:",
            post
        );


        /* =================================
           카테고리
        ================================= */

        const categoryNames = {
            GENERAL: "자유",
            ANALYSIS: "분석",
            GAME_THREAD: "경기",
            NEWS: "뉴스"
        };

        const categoryClasses = {
            GENERAL: "general",
            ANALYSIS: "analysis",
            GAME_THREAD: "game",
            NEWS: "news"
        };


        const categoryLabel =
            postDetail.querySelector(
                ".post-head .category-label"
            );

        if (categoryLabel) {

            categoryLabel.textContent =
                categoryNames[post.category] ||
                post.category;

            categoryLabel.className =
                `category-label ${categoryClasses[post.category] || ""}`;
        }


        /* =================================
           제목
        ================================= */

        const title =
            postDetail.querySelector(
                ".post-head h2"
            );

        if (title) {

            title.textContent =
                post.title;
        }


        /* =================================
           날짜
        ================================= */

        const date =
            new Date(post.created_at);

        const year =
            date.getFullYear();

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, "0");

        const day =
            String(
                date.getDate()
            ).padStart(2, "0");

        const hours =
            String(
                date.getHours()
            ).padStart(2, "0");

        const minutes =
            String(
                date.getMinutes()
            ).padStart(2, "0");


        const displayDate =
            `${year}.${month}.${day} ${hours}:${minutes}`;


        /* =================================
           관련 팀 이름
        ================================= */

        const displayTeamName =
            teamNamesByCode[post.team_code] ||
            post.team_name ||
            "전체 팀";


        /* =================================
           게시글 메타 정보
        ================================= */

        const metaItems =
            postDetail.querySelectorAll(
                ".post-meta span"
            );


        if (metaItems[0]) {

            metaItems[0].innerHTML =
                `작성자 <strong>${escapeHtml(post.nickname)}</strong>`;
        }


        if (metaItems[1]) {

            metaItems[1].innerHTML =
                `작성일 <strong>${displayDate}</strong>`;
        }


        if (metaItems[2]) {

            metaItems[2].innerHTML =
                `관련 구단 <strong>${displayTeamName}</strong>`;
        }


        if (metaItems[3]) {

            metaItems[3].innerHTML =
                `조회 <strong>${Number(
                    post.view_count || 0
                ).toLocaleString()}</strong>`;
        }


        /* =================================
           게시글 본문
        ================================= */

        const body =
            postDetail.querySelector(
                ".post-body"
            );

        if (body) {

            body.innerHTML =
                DOMPurify.sanitize(post.content);
        }


        // =================================
        //          좋아요
        // =================================
        const likeButton =
            document.getElementById(
                "postLikeButton"
            );

        if (likeButton) {

            const count =
                likeButton.querySelector(
                    "strong"
                );

            // 현재 게시글의 좋아요 개수 표시
            if (count) {

                count.textContent =
                    Number(
                        post.like_count || 0
                    ).toLocaleString();
            }


                // =================================
                //          현재 좋아요 상태 확인
                // =================================

                const accessToken =
                    sessionStorage.getItem("access_token");

                // 로그인하지 않은 경우:
                // 실제 좋아요 개수는 유지하고,
                // 내가 좋아요를 눌렀다는 표시만 제거
                if (!accessToken) {
                    likeButton.classList.remove("liked");

                } else {
                    try {
                        const likeStatusResponse =
                            await fetch(
                                `${API_BASE_URL}/community/posts/${post.post_id}/like`,
                                {
                                    headers: {
                                        "Authorization": `Bearer ${accessToken}`
                                    }
                                }
                            );

                        console.log(
                            "좋아요 상태 API 응답:",
                            likeStatusResponse.status
                        );

                        if (!likeStatusResponse.ok) {
                            const errorText =
                                await likeStatusResponse.text();

                            console.error(
                                "좋아요 상태 조회 실패:",
                                likeStatusResponse.status,
                                errorText
                            );

                        } else {
                            const likeStatus =
                                await likeStatusResponse.json();

                            console.log(
                                "현재 좋아요 상태:",
                                likeStatus
                            );

                            // 실제 좋아요 개수 표시
                            if (count) {
                                count.textContent =
                                    Number(
                                        likeStatus.like_count || 0
                                    ).toLocaleString();
                            }

                            // 로그인한 사용자의 좋아요 상태 표시
                            likeButton.classList.toggle(
                                "liked",
                                Boolean(likeStatus.liked)
                            );
                        }

                    } catch (error) {
                        console.error(
                            "좋아요 상태 조회 오류:",
                            error
                        );
                    }
                }


            // =================================
            //          좋아요 버튼 클릭
            // =================================
            likeButton.onclick = async function () {

                // 로그인 토큰 확인
                const accessToken =
                    sessionStorage.getItem("access_token");

                // 로그인하지 않은 경우
                if (!accessToken) {
                    showLoginRequired();

                    return;
                }

                try {
                    const likeResponse =
                        await fetch(
                            `${API_BASE_URL}/community/posts/${post.post_id}/like`,
                            {
                                method: "POST",
                                headers: {
                                    "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                                }
                            }
                        );

                    if (!likeResponse.ok) {

                        const errorData =
                            await likeResponse.json();

                        throw new Error(
                            errorData.detail ||
                            "좋아요 처리에 실패했습니다."
                        );
                    }

                    const result =
                        await likeResponse.json();

                    console.log(
                        "좋아요 처리 결과:",
                        result
                    );


                    // 좋아요 개수 즉시 변경
                    if (count) {

                        count.textContent =
                            Number(
                                result.like_count || 0
                            ).toLocaleString();
                    }


                    // 좋아요 상태에 따라 버튼 변경
                    if (result.liked) {

                        likeButton.classList.add("liked");

                    } else {

                        likeButton.classList.remove("liked");
                    }

                } catch (error) {

                    console.error(
                        "좋아요 처리 오류:",
                        error
                    );

                    showBasebotModal(
                        "좋아요 오류",
                        error.message ||
                        "좋아요 처리 중 오류가 발생했습니다."
                    );
                }
            };
        }

        await loadComments(post.post_id);

                /* =================================
           수정 / 삭제 버튼
           게시글 작성자에게만 표시
        ================================= */

        const ownerArea =
            postDetail.querySelector(".post-owner-area");

        if (ownerArea) {

            // 로그인한 사용자 ID (비로그인이면 null)
            const ownerUserId = getCurrentUserId();

            // 작성자 본인일 때만 표시
            ownerArea.style.display =
                ownerUserId !== null &&
                Number(post.user_id) === ownerUserId
                    ? "flex"
                    : "none";
        }


        /* =================================
                  수정 버튼
           ================================= */

        const editButton =
            postDetail.querySelector(
                ".post-owner-area a"
            );

        if (editButton) {

            // 수정 페이지로 바로 이동하지 않도록 설정
            editButton.href = "#";

            editButton.addEventListener("click", function (event) {

                // 링크의 기본 이동 동작 막기
                event.preventDefault();

                // 로그인 토큰 가져오기
                const accessToken =
                    sessionStorage.getItem("access_token");

                // 로그인하지 않은 경우
                if (!accessToken) {
                    showLoginRequired();
                    return;
                }

                // 로그인한 사용자 ID 확인 (토큰이 이상하면 null)
                const currentUserId = getCurrentUserId();

                if (currentUserId === null) {
                    showBasebotModal(
                        "인증 오류",
                        "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요."
                    );
                    return;
                }

                // 게시글 작성자와 로그인 사용자 비교
                if (
                    Number(post.user_id) !== currentUserId
                ) {
                    showBasebotModal(
                        "수정 권한 없음",
                        "본인이 작성한 게시글만 수정할 수 있습니다."
                    );
                    return;
                }

                // 본인이 작성한 글인 경우에만 수정 페이지로 이동
                window.location.href =
                    `community-edit.html?postId=${post.post_id}`;
            });
        }



    } catch (error) {

        console.error(
            "게시글 상세 조회 오류:",
            error
        );

    }
}

loadPostDetail();


async function loadComments(postId) {

    const commentList =
        document.getElementById("commentList");

    const commentCount =
        document.getElementById("commentCount");

    if (!commentList) {
        return;
    }

    try {

        const response =
            await fetch(
                `${API_BASE_URL}/community/posts/${postId}/comments`
            );

        if (!response.ok) {

            throw new Error(
                "댓글을 불러오지 못했습니다."
            );
        }

        const comments =
            await response.json();

        console.log(
            "댓글 목록:",
            comments
        );

        // 댓글 개수
        if (commentCount) {

            commentCount.textContent =
                comments.length;
        }

        // 기존 댓글 비우기
        commentList.innerHTML = "";

        // 댓글이 없는 경우
        if (comments.length === 0) {

            commentList.innerHTML = `
                <p class="comment-empty">
                    아직 댓글이 없습니다.
                </p>
            `;

            return;
        }

       // -----------------------------------------
        // 댓글 계층 구조 만들기
        // -----------------------------------------

        const commentMap = new Map();

        comments.forEach(function (comment) {

            commentMap.set(
                comment.comment_id,
                {
                    ...comment,
                    children: []
                }
            );
        });


        // -----------------------------------------
        // 부모 댓글에 자식 댓글 연결
        // -----------------------------------------

        const rootComments = [];

        comments.forEach(function (comment) {

            const current =
                commentMap.get(
                    comment.comment_id
                );

            if (
                comment.parent_comment_id &&
                commentMap.has(
                    comment.parent_comment_id
                )
            ) {

                const parent =
                    commentMap.get(
                        comment.parent_comment_id
                    );

                parent.children.push(
                    current
                );

            } else {

                rootComments.push(
                    current
                );
            }
        });


        // -----------------------------------------
        // 댓글 재귀 출력
        // -----------------------------------------

        function renderComment(
            comment,
            depth = 0
        ) {

            const commentItem =
                createCommentElement(
                    comment,
                    depth
                );

            commentList.appendChild(
                commentItem
            );


            // 자식 댓글 출력
            comment.children.forEach(
                function (child) {

                    renderComment(
                        child,
                        depth + 1
                    );
                }
            );
        }


        // -----------------------------------------
        // 최상위 댓글부터 출력
        // -----------------------------------------

        rootComments.forEach(
            function (comment) {

                renderComment(
                    comment,
                    0
                );
            }
        );


    } catch (error) {

        console.error(
            "댓글 조회 오류:",
            error
        );
    }
}

/* =========================================
   댓글 좋아요
========================================= */

document
    .getElementById("commentList")
    ?.addEventListener("click", async function (event) {

        const likeButton =
            event.target.closest(".comment-like-button");

        if (!likeButton) {
            return;
        }

        // 로그인 여부 확인
        const accessToken = sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우
        if (!accessToken) {
            showLoginRequired("댓글 좋아요는 로그인 후 이용할 수 있습니다.");

            return;
        }

        const commentId =
            likeButton.dataset.commentId;

        if (!commentId) {
            showBasebotModal(
                "답글 작성",
                "댓글 번호를 찾을 수 없습니다."
            );

            return;
        }

        try {

            const response =
                await fetch(
                    `${API_BASE_URL}/community/comments/${commentId}/like`,
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                        }
                    }
                );

            if (!response.ok) {

                const errorData =
                    await response.json();

                throw new Error(
                    errorData.detail ||
                    "댓글 좋아요 처리에 실패했습니다."
                );
            }

            const result =
                await response.json();

            console.log(
                "댓글 좋아요 결과:",
                result
            );

            // 댓글 목록 다시 불러오기
            await loadComments(getPostId());

        } catch (error) {

            console.error(
                "댓글 좋아요 오류:",
                error
            );

            showBasebotModal(
                "댓글 좋아요 오류",
                error.message ||
                "댓글 좋아요 처리 중 오류가 발생했습니다."
            );
        }
    });
/* =========================================
   댓글 수정
========================================= */

document
    .getElementById("commentList")
    ?.addEventListener("click", function (event) {

        const editButton =
            event.target.closest(
                ".comment-edit-button"
            );

        if (!editButton) {
            return;
        }

        const commentItem =
            editButton.closest(
                ".comment-item"
            );

        if (!commentItem) {
            return;
        }

        const commentId =
            commentItem.dataset.commentId;

        const commentText =
            commentItem.querySelector(
                ".comment-text"
            );

        if (!commentId || !commentText) {
            return;
        }

        /* 이미 수정 중이면 다시 만들지 않음 */

        if (
            commentItem.querySelector(
                ".comment-edit-box"
            )
        ) {
            return;
        }

        /* 기존 댓글 내용 저장 */

        const originalContent =
            commentText.textContent;

        /* 기존 댓글 내용 숨기기 */

        commentText.style.display = "none";

        const commentActions =
            commentItem.querySelector(".comment-actions");

        if (commentActions) {
            commentActions.style.display = "none";
            }
        /* 수정 영역 생성 */

        const editBox =
            document.createElement("div");

        editBox.className =
            "comment-edit-box";

        editBox.innerHTML = `
            <textarea
                class="comment-edit-textarea"
            ></textarea>

            <div class="comment-edit-actions">

                <button
                    type="button"
                    class="comment-save-button"
                >
                    저장
                </button>

                <button
                    type="button"
                    class="comment-cancel-button"
                >
                    취소
                </button>

            </div>
        `;

        /* 기존 댓글 영역 바로 그 자리에 삽입 */

        commentText.parentNode.insertBefore(
            editBox,
            commentText
        );

        /* textarea에 기존 내용 넣기 */

        const textarea =
            editBox.querySelector(
                ".comment-edit-textarea"
            );

        textarea.value =
            originalContent;

        /* 버튼 */

        const saveButton =
            editBox.querySelector(
                ".comment-save-button"
            );

        const cancelButton =
            editBox.querySelector(
                ".comment-cancel-button"
            );

        /* textarea 자동 포커스 */

        textarea.focus();

        /* 커서를 글 마지막으로 이동 */

        textarea.setSelectionRange(
            textarea.value.length,
            textarea.value.length
        );

        /* =========================================
           수정 취소
        ========================================= */

        cancelButton.addEventListener(
            "click",
            function () {

                editBox.remove();

                commentText.style.display = "";

                if (commentActions) {
                    commentActions.style.display = "";
                }
            }
        );

        /* =========================================
           수정 저장
        ========================================= */

        saveButton.addEventListener(
            "click",
            async function () {

                const content =
                    textarea.value.trim();

                if (!content) {

                    showBasebotModal(
                        "댓글 수정",
                        "댓글 내용을 입력해주세요."
                    );

                    return;
                }

                try {
                    const response = await fetch(
                        `${API_BASE_URL}/community/comments/${commentId}?content=${encodeURIComponent(content)}`,
                        {
                            method: "PUT",
                            headers: {
                                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                            }
                        }
                    );


                    if (!response.ok) {

                        const errorData =
                            await response.json();

                        throw new Error(
                            errorData.detail ||
                            "댓글 수정에 실패했습니다."
                        );
                    }

                    const result =
                        await response.json();

                    console.log(
                        "댓글 수정 완료:",
                        result
                    );

                    /* 수정된 댓글 목록 다시 불러오기 */

                    await loadComments(
                        getPostId()
                    );

                } catch (error) {

                    console.error(
                        "댓글 수정 오류:",
                        error
                    );

                    showBasebotModal(
                        "댓글 수정 오류",
                        error.message ||
                        "댓글 수정 중 오류가 발생했습니다."
                    );
                }
            }
        );

        /* =========================================
           Ctrl + Enter → 저장
           Enter → 줄바꿈
        ========================================= */

        textarea.addEventListener(
            "keydown",
            function (event) {

                if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                ) {

                    event.preventDefault();

                    saveButton.click();
                }
            }
        );
    });

/* =========================================
   댓글 삭제
========================================= */

document
    .getElementById("commentList")
    ?.addEventListener("click", async function (event) {

        const deleteButton =
            event.target.closest(
                ".comment-delete-button"
            );

        if (!deleteButton) {
            return;
        }


        // 로그인 여부 확인
        const accessToken =
            sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우
        if (!accessToken) {
            showLoginRequired();

            return;
        }


        const commentItem =
            deleteButton.closest(
                ".comment-item"
            );

        if (!commentItem) {
            return;
        }

        const commentId =
            commentItem.dataset.commentId;

        if (!commentId) {
            showBasebotModal(
                "댓글 삭제",
                "댓글 번호를 찾을 수 없습니다."
            );
            return;
        }

        // 삭제 확인
            showBasebotConfirm(
        "댓글 삭제",
        "정말 이 댓글을 삭제하시겠습니까?",

        async function () {

            try {
                const response =
                    await fetch(
                        `${API_BASE_URL}/community/comments/${commentId}`,
                        {
                            method: "DELETE",
                            headers: {
                                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                            }
                        }
                    );

                if (!response.ok) {

                    const errorData =
                        await response.json();

                    throw new Error(
                        errorData.detail ||
                        "댓글 삭제에 실패했습니다."
                    );
                }

                const result =
                    await response.json();

                console.log(
                    "댓글 삭제 완료:",
                    result
                );

                showBasebotModal(
                    "삭제 완료",
                    "댓글이 삭제되었습니다.",
                    function () {

                        loadComments(
                            getPostId()
                        );

                    }
                );

            } catch (error) {

                console.error(
                    "댓글 삭제 오류:",
                    error
                );

                showBasebotModal(
                    "삭제 오류",
                    error.message ||
                    "댓글 삭제 중 오류가 발생했습니다."
                );
            }
        },

        "삭제"
    );
    });

function createCommentElement(
    comment,
    depth = 0
) {

    // 로그인한 사용자 ID (내 댓글에만 수정/삭제 버튼을 보여주기 위해 사용)
    const currentUserId = getCurrentUserId();

    const commentItem =
        document.createElement("div");


    commentItem.className =
        depth > 0
            ? "comment-item reply-comment"
            : "comment-item";


    commentItem.dataset.commentId =
        comment.comment_id;


    commentItem.dataset.depth =
        depth;


    commentItem.innerHTML = `
        <div class="comment-head">

            <strong>
                ${escapeHtml(comment.nickname)}
            </strong>

            <span>
                ${formatCommentDate(
                    comment.created_at
                )}
            </span>

        </div>


        <p class="comment-text">
            ${escapeHtml(comment.content)}
        </p>


        <div class="comment-actions">

        <button
            type="button"
            class="comment-like-button"
            data-comment-id="${comment.comment_id}"
        >
            ♥ 좋아요
            <strong>${Number(comment.like_count || 0)}</strong>
        </button>

    
        <button
            type="button"
            class="reply-button"
        >
            답글
        </button>
    
        ${
            Number(comment.user_id) === currentUserId
                ? `
                    <button
                        type="button"
                        class="comment-edit-button"
                    >
                        수정
                    </button>
    
                    <button
                        type="button"
                        class="comment-delete-button"
                    >
                        삭제
                    </button>
                `
                : ""
        }
    
    </div>
    `;


    // -----------------------------------------
    // 대댓글 깊이에 따른 들여쓰기
    // -----------------------------------------

    if (depth > 0) {

        commentItem.style.marginLeft =
            `${Math.min(depth * 28, 140)}px`;
    }

    // 댓글 좋아요 상태 조회
    loadCommentLikeStatus(commentItem, comment);

    return commentItem;

}


/* =========================================
   댓글 좋아요 상태 조회
========================================= */
async function loadCommentLikeStatus(commentItem, comment) {

    const likeButton =
        commentItem.querySelector(".comment-like-button");

    if (!likeButton) {
        return;
    }

    const accessToken =
        sessionStorage.getItem("access_token");

    // 로그인하지 않은 경우 상태 조회를 하지 않음
    if (!accessToken) {
        likeButton.classList.remove("active");
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/community/comments/${comment.comment_id}/like`,
            {
                headers: {
                    "Authorization": `Bearer ${accessToken}`
                }
            }
        );

        if (!response.ok) {
            console.error(
                "댓글 좋아요 상태 조회 실패:",
                response.status,
                await response.text()
            );
            return;
        }

        const result = await response.json();

        // 서버가 반환한 좋아요 상태 반영
        likeButton.classList.toggle(
            "active",
            Boolean(result.liked)
        );

        // 서버가 반환한 좋아요 개수 반영
        const count =
            likeButton.querySelector("strong");

        if (count && result.like_count !== undefined) {
            count.textContent =
                Number(result.like_count).toLocaleString();
        }

    } catch (error) {
        console.error(
            "댓글 좋아요 상태 조회 오류:",
            error
        );
    }
}


function getPostId() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    return params.get("postId");
}

function formatCommentDate(dateString) {

    const date =
        new Date(dateString);

    const year =
        date.getFullYear();

    const month =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getDate()
        ).padStart(2, "0");

    const hours =
        String(
            date.getHours()
        ).padStart(2, "0");

    const minutes =
        String(
            date.getMinutes()
        ).padStart(2, "0");

    return `${year}.${month}.${day} ${hours}:${minutes}`;
}



/* =========================================
   게시글 작성
========================================= */

function setupWriteForm() {

    const writeForm =
        document.getElementById("writeForm");

    if (!writeForm) {
        return;
    }


    writeForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();


            /* ================================
               입력값 가져오기
            ================================= */

            const category =
                writeForm.querySelector(
                    '[name="category"]'
                ).value;

            const teamCode =
                writeForm.querySelector(
                    '[name="related_team_id"]'
                ).value;

            console.log(
                "선택한 teamCode:",
                teamCode
            );

            const title =
                writeForm.querySelector(
                    '[name="title"]'
                ).value.trim();

            const editor =
                document.getElementById(
                    "editor"
                );


            /* ================================
               본문 가져오기
            ================================= */

            const content =
                editor.innerHTML.trim();


            /* ================================
               유효성 검사
            ================================= */

            if (!category) {

                showBasebotModal(
                    "게시글 작성",
                    "분류를 선택해주세요."
                );

                return;
            }


            if (!title) {

                showBasebotModal(
                    "게시글 작성",
                    "제목을 입력해주세요."
                );

                return;
            }


            if (
                !content ||
                content === "<p><br></p>"
            ) {

                showBasebotModal(
                    "게시글 작성",
                    "내용을 입력해주세요."
                );

                return;
            }


            /* ================================
               서버로 보낼 데이터
            ================================= */

            const postData = {

                category: category,

                related_team_code:
                    teamCode || null,

                title: title,

                content: content
            };


            console.log(
                "게시글 작성 데이터:",
                postData
            );


            try {
                const response =
                    await fetch(
                        `${API_BASE_URL}/community/posts`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type": "application/json",

                                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                            },

                            body:
                                JSON.stringify(
                                    postData
                                )
                        }
                    );


                if (!response.ok) {

                    const errorData =
                        await response.json();

                    throw new Error(
                        errorData.detail ||
                        "게시글 등록에 실패했습니다."
                    );
                }


                const result =
                    await response.json();


                console.log(
                    "게시글 등록 완료:",
                    result
                );

                showBasebotModal(
                    "작성 완료",
                    "게시글이 작성되었습니다.",
                    function () {
                        window.location.href =
                            "community.html";
                    }
                );


            } catch (error) {

                console.error(
                    "게시글 작성 오류:",
                    error
                );

                showBasebotModal(
                    "게시글 작성 오류",
                    error.message ||
                    "게시글 등록 중 오류가 발생했습니다."
                );
            }
        }
    );
}


setupWriteForm();

/* =========================================
   글쓰기 에디터
========================================= */

function setupEditor() {
    const editor = document.getElementById("editor");
    const contentInput = document.getElementById("contentInput");

    if (!editor) return;

    document.querySelectorAll(".editor-toolbar button[data-command]").forEach(button => {

        button.addEventListener("mousedown", event => {
            event.preventDefault();
        });

        button.addEventListener("click", () => {

            editor.focus();

            document.execCommand(
                button.dataset.command,
                false,
                null
            );

        });

    });

    const fontSizeSelect =
        document.getElementById("fontSizeSelect");

    fontSizeSelect?.addEventListener("change", function () {

        if (!this.value) return;

        editor.focus();

        document.execCommand(
            "fontSize",
            false,
            this.value
        );

        this.value = "";
    });


    const form = editor.closest("form");

    form?.addEventListener("submit", () => {

        if (contentInput) {
            contentInput.value = editor.innerHTML;
        }

    });
}

setupEditor();

async function setupEditForm() {

    const editForm =
        document.getElementById("editForm");

    if (!editForm) {
        return;
    }

    const params =
        new URLSearchParams(
            window.location.search
        );

    const postId =
        params.get("postId");

    if (!postId) {
        showBasebotModal(
            "게시글 수정",
            "게시글 번호를 찾을 수 없습니다."
        );
        return;
    }

    console.log(
        "수정할 게시글 번호:",
        postId
    );

    try {

        // 기존 게시글 가져오기
        const response =
            await fetch(
                `${API_BASE_URL}/community/posts/${postId}`
            );

        if (!response.ok) {
            throw new Error(
                "게시글 정보를 불러오지 못했습니다."
            );
        }

        const post =
            await response.json();

        console.log(
            "기존 게시글:",
            post
        );


        // =========================
        // 1. 분류
        // =========================

        const categorySelect =
            editForm.querySelector(
                '[name="category"]'
            );

        categorySelect.value =
            post.category;

        // =========================
        // 2. 구단
        // =========================

        const teamSelect =
            document.getElementById(
                "writeTeamSelect"
            );

        // 기존 게시글의 팀이 있다면 선택
        if (post.team_code) {

            teamSelect.value =
                post.team_code;
        }

        // =========================
        // 3. 제목
        // =========================

        const titleInput =
            editForm.querySelector(
                '[name="title"]'
            );

        titleInput.value =
            post.title;


        // =========================
        // 4. 내용
        // =========================

        const editor =
            document.getElementById(
                "editor"
            );

        editor.innerHTML =
            DOMPurify.sanitize(post.content);


    } catch (error) {

        console.error(
            "게시글 불러오기 오류:",
            error
        );

        showBasebotModal(
            "게시글 수정 오류",
            error.message ||
            "게시글을 불러오는 중 오류가 발생했습니다."
        );

        return;
    }


    // =================================
    // 수정완료 버튼
    // =================================

    editForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();


            const category =
                editForm.querySelector(
                    '[name="category"]'
                ).value;

            const teamSelect =
                 document.getElementById(
                     "writeTeamSelect"
                );

            const teamCode =
                teamSelect.value;

            const title =
                editForm.querySelector(
                    '[name="title"]'
                ).value.trim();

            const editor =
                document.getElementById(
                    "editor"
                );

            const content =
                editor.innerHTML.trim();


            // -------------------------
            // 입력 확인
            // -------------------------

           if (!category) {

                showBasebotModal(
                    "게시글 수정",
                    "분류를 선택해주세요."
                );

                return;
            }

            if (!title) {

                showBasebotModal(
                    "게시글 수정",
                    "제목을 입력해주세요."
                );

                return;
            }

            if (
                !content ||
                content === "<p><br></p>"
            ) {

                showBasebotModal(
                    "게시글 수정",
                    "내용을 입력해주세요."
                );

                return;
            }


            // -------------------------
            // 수정 데이터
            // -------------------------

            const postData = {

                category:
                    category,

                related_team_code:
                    teamCode || null,

                title:
                    title,

                content:
                    content
            };


            console.log(
                "게시글 수정 데이터:",
                postData
            );


            try {
                const response =
                    await fetch(
                        `${API_BASE_URL}/community/posts/${postId}`,
                        {
                            method: "PUT",

                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                            },

                            body:
                                JSON.stringify(
                                    postData
                                )
                        }
                    );

                if (!response.ok) {

                    const errorData =
                        await response.json();

                    throw new Error(
                        errorData.detail ||
                        "게시글 수정에 실패했습니다."
                    );
                }


                const result =
                    await response.json();


                console.log(
                    "게시글 수정 완료:",
                    result
                );


                showBasebotModal(
                    "수정 완료",
                    "게시글이 수정되었습니다.",
                    function () {
                        window.location.href =
                            `community-view.html?postId=${postId}`;
                    }
                );


            } catch (error) {

                console.error(
                    "게시글 수정 오류:",
                    error
                );

                showBasebotModal(
                    "게시글 수정 오류",
                    error.message ||
                    "게시글 수정 중 오류가 발생했습니다."
                );
            }
        }
    );
}


setupEditForm();


/* =========================================
   게시글 스크랩
   (게시글 좋아요는 loadPostDetail 안에서 처리)
========================================= */

function setupPostActions() {

    const scrapButton =
        document.getElementById("postScrapButton");


    // =========================================
    // 게시글 스크랩 상태 조회 및 버튼 처리
    // =========================================

    const postId = new URLSearchParams(
        window.location.search
    ).get("postId");

    const accessToken = sessionStorage.getItem("access_token");

    // 버튼 모양과 문구를 변경하는 함수
    function updateScrapButton(scrapped) {
        if (!scrapButton) return;

        scrapButton.classList.toggle("scrapped", scrapped);

        scrapButton.textContent = scrapped
            ? "🔖 스크랩 완료"
            : "🔖 스크랩";
    }

    // 페이지를 열었을 때 기존 스크랩 상태 조회
    async function loadScrapStatus() {
        if (!scrapButton || !postId || !accessToken) {
            updateScrapButton(false);
            return;
        }

        try {
            const response = await fetch(
                `${API_BASE_URL}/community/posts/${postId}/scrap`,
                {
                    headers: {
                        "Authorization": `Bearer ${accessToken}`
                    }
                }
            );

            if (!response.ok) {
                console.error(
                    "스크랩 상태 조회 실패:",
                    response.status
                );
                return;
            }

            const data = await response.json();

            updateScrapButton(data.scrapped);

        } catch (error) {
            console.error("스크랩 상태 조회 오류:", error);
        }
    }

    // 스크랩 버튼 클릭
    scrapButton?.addEventListener("click", async function () {
        const token = sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우 로그인 팝업 표시
        if (!token) {
            showLoginRequired();
            return;
        }

        if (!postId) {
            showBasebotModal(
                "오류",
                "게시글 정보를 찾을 수 없습니다."
            );
            return;
        }

        // 요청 중 중복 클릭 방지
        if (this.disabled) return;

        this.disabled = true;

        try {
            const response = await fetch(
                `${API_BASE_URL}/community/posts/${postId}/scrap`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                }
            );

            const data = await response.json();

            if (!response.ok) {
                showBasebotModal(
                    "스크랩 실패",
                    data.detail || "스크랩 처리 중 오류가 발생했습니다."
                );
                return;
            }

            updateScrapButton(data.scrapped);

            showBasebotModal(
                "스크랩",
                data.message
            );

        } catch (error) {
            console.error("게시글 스크랩 오류:", error);

            showBasebotModal(
                "오류",
                "서버와 통신할 수 없습니다. 잠시 후 다시 시도해 주세요."
            );

        } finally {
            this.disabled = false;
        }
    });

    // 페이지 진입 시 상태 표시
    loadScrapStatus();




}

setupPostActions();


/* =========================================
   신고 모달
========================================= */

function setupReportModal() {
    const openButton =
        document.getElementById("postReportButton");

    const modal =
        document.getElementById("reportModal");

    const closeButton =
        document.getElementById("closeReportModal");

    const cancelButton =
        document.getElementById("cancelReport");

    const submitButton =
        document.getElementById("submitReport");

    const reportContent =
        document.getElementById("reportContent");

    if (!openButton || !modal) return;

    const close = () => {
        modal.hidden = true;
    };

    // 신고 모달 열기
    openButton.addEventListener("click", () => {

        // 로그인 여부 확인
        const accessToken =
            sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우 로그인 팝업 표시
        if (!accessToken) {
            showLoginRequired();

            return;
        }

        modal.hidden = false;
    });

    // 신고 모달 닫기
    closeButton?.addEventListener("click", close);
    cancelButton?.addEventListener("click", close);

    // 모달 바깥을 누르면 닫기
    modal.addEventListener("click", event => {
        if (event.target === modal) {
            close();
        }
    });

    // 신고 제출
    submitButton?.addEventListener("click", async () => {
        const selected =
            document.querySelector(
                'input[name="reportReason"]:checked'
            );

        if (!selected) {
            showBasebotModal(
                "신고 사유 선택",
                "신고 사유를 선택해주세요."
            );
            return;
        }

        const postId = new URLSearchParams(
            window.location.search
        ).get("postId");

        if (!postId) {
            showBasebotModal(
                "신고 실패",
                "게시글 정보를 찾을 수 없습니다."
            );
            return;
        }

        const token =
            sessionStorage.getItem("access_token");

        // 신고 창을 연 뒤 로그인이 만료된 경우를 대비
        if (!token) {
            close();

            showLoginRequired("신고 기능은 로그인 후 이용할 수 있습니다.");

            return;
        }

        // 중복 클릭 방지
        if (submitButton.disabled) return;

        submitButton.disabled = true;

        const reportData = {
            reason: selected.value,
            content: reportContent.value.trim() || null
        };

        try {
            const response = await fetch(
                `${API_BASE_URL}/community/posts/${postId}/report`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify(reportData)
                }
            );

            const data = await response.json();

            if (!response.ok) {
                showBasebotModal(
                    "신고 실패",
                    data.detail || "신고 처리 중 오류가 발생했습니다."
                );
                return;
            }

            // 신고 성공 후 입력값 초기화
            document.querySelectorAll(
                'input[name="reportReason"]'
            ).forEach(input => {
                input.checked = false;
            });

            reportContent.value = "";

            close();

            showBasebotModal(
                "신고 접수 완료",
                data.message || "신고가 접수되었습니다."
            );

        } catch (error) {
            console.error("게시글 신고 오류:", error);

            showBasebotModal(
                "오류",
                "서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요."
            );

        } finally {
            submitButton.disabled = false;
        }
    });
}

setupReportModal();



/* =========================================
   공유
========================================= */

function setupShare() {

    const openButton =
        document.getElementById("postShareButton");

    const modal =
        document.getElementById("shareModal");

    const closeButton =
        document.getElementById("closeShareModal");

    const copyButton =
        document.getElementById("copyLinkButton");

    const nativeButton =
        document.getElementById("nativeShareButton");

    if (!openButton || !modal) return;

    const getShareData = () => ({
        title:
            document.querySelector(".post-head h2")
                ?.textContent.trim()
            || "BASEBOT 커뮤니티 게시글",

        text:
            "BASEBOT 커뮤니티 게시글을 확인해보세요.",

        url:
            window.location.href
    });

    const close = () => {
        modal.hidden = true;
    };

    openButton.addEventListener("click", () => {
        modal.hidden = false;
    });

    closeButton?.addEventListener("click", close);

    modal.addEventListener("click", event => {

        if (event.target === modal) {
            close();
        }

    });

    copyButton?.addEventListener("click", async () => {

        const { url } = getShareData();

        try {

            await navigator.clipboard.writeText(url);

            close();

            showBasebotModal(
                "링크 복사",
                "게시글 링크가 복사되었습니다."
            );

        } catch (error) {

            const temp =
                document.createElement("input");

            temp.value = url;

            document.body.appendChild(temp);

            temp.select();

            document.execCommand("copy");

            temp.remove();

            close();

            showBasebotModal(
                "링크 복사",
                "게시글 링크가 복사되었습니다."
            );
        }
    });
    nativeButton?.addEventListener("click", async () => {

        const data = getShareData();

        if (!navigator.share) {

            showBasebotModal(
                "공유",
                "현재 브라우저에서는 기기 공유를 지원하지 않습니다. '링크 복사'를 이용해주세요."
            );

            return;
        }

        try {

            await navigator.share(data);

            close();

        } catch (error) {

            if (error.name !== "AbortError") {

                showBasebotModal(
                    "공유",
                    "공유하는 중 문제가 발생했습니다."
                );
            }
        }
    });
}

setupShare();

/* =========================================
   댓글
========================================= */

const commentForm =
    document.getElementById("commentForm");

commentForm?.addEventListener("submit", async event => {

    event.preventDefault();

        // 로그인하지 않은 경우 로그인 팝업 표시
    if (!sessionStorage.getItem("access_token")) {
        showLoginRequired();

        return;
    }

    const textarea =
        commentForm.querySelector("textarea");

    const content =
        textarea.value.trim();

    if (!content) {

        showBasebotModal(
            "댓글 작성",
            "댓글 내용을 입력해주세요."
        );

        return;
    }

    // 현재 게시글 번호 가져오기
    const params =
        new URLSearchParams(
            window.location.search
        );

    const postId =
        params.get("postId");

    if (!postId) {

        showBasebotModal(
            "댓글 작성",
            "게시글 번호를 찾을 수 없습니다."
        );

        return;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/community/posts/${postId}/comments?content=${encodeURIComponent(content)}`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                }
            }
        );


        if (!response.ok) {

            const errorData =
                await response.json();

            throw new Error(
                errorData.detail ||
                "댓글 등록에 실패했습니다."
            );
        }

        const result =
            await response.json();

        console.log(
            "댓글 등록 완료:",
            result
        );

        // 입력창 비우기
        textarea.value = "";

        // 댓글 목록 다시 불러오기
        await loadComments(postId);

    } catch (error) {

        console.error(
            "댓글 등록 오류:",
            error
        );

        showBasebotModal(
            "댓글 작성 오류",
            error.message ||
            "댓글 등록 중 오류가 발생했습니다."
        );
    }
});

const commentTextarea =
    commentForm?.querySelector("textarea");

// 로그인하지 않은 경우: 입력창을 누르면 로그인 팝업 표시
commentTextarea?.addEventListener("focus", function () {

    if (sessionStorage.getItem("access_token")) {
        return;
    }

    // 입력창에 글을 쓰지 못하도록 포커스 해제
    commentTextarea.blur();

    showLoginRequired();
});

commentTextarea?.addEventListener("keydown", event => {

    if (event.key === "Enter" && !event.shiftKey) {

        event.preventDefault();

        commentForm.requestSubmit();
    }

});

/* =========================================
   대댓글
========================================= */

document
    .getElementById("commentList")
    ?.addEventListener("click", function (event) {

        const replyButton =
            event.target.closest(".reply-button");

        if (!replyButton) {
            return;
        }

                // 로그인하지 않은 경우 로그인 팝업 표시
        if (!sessionStorage.getItem("access_token")) {
            showLoginRequired();

            return;
        }

        const comment =
            replyButton.closest(".comment-item");

        if (!comment) {
            return;
        }

        const commentId =
            comment.dataset.commentId;

        if (!commentId) {
            showBasebotModal(
                "댓글 좋아요",
                "댓글 번호를 찾을 수 없습니다."
            );
            return;
        }

        // 이미 답글 입력창이 있으면 닫기
        let replyBox =
            comment.querySelector(
                ":scope > .reply-write"
            );

        if (replyBox) {

            replyBox.remove();

            return;
        }

        // 답글 입력창 생성
        replyBox =
            document.createElement("div");

        replyBox.className =
            "reply-write";

        replyBox.innerHTML = `
            <textarea
                placeholder="답글을 입력하세요"
            ></textarea>

            <button
                type="button"
            >
                답글 등록
            </button>
        `;

        const textarea =
            replyBox.querySelector("textarea");

        const submit =
            replyBox.querySelector("button");
        // 답글 입력창 Enter 등록
        textarea.addEventListener(
            "keydown",
            function (event) {

                // Enter만 누르면 등록
                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    submit.click();
                }
            }
        );

        textarea.style.minHeight = "60px";

        textarea.style.padding = "8px";

        textarea.style.border =
            "1px solid #d8dde6";

        submit.style.border = "0";

        submit.style.background = "#173f91";

        submit.style.color = "#fff";

        submit.style.cursor = "pointer";

        // 답글 등록
        submit.addEventListener(
            "click",
            async function () {

                const content =
                    textarea.value.trim();

                if (!content) {

                    showBasebotModal(
                        "답글 작성",
                        "답글 내용을 입력해주세요."
                    );

                    return;
                }

                try {
                    const response =
                        await fetch(
                            `${API_BASE_URL}/community/posts/${getPostId()}/comments?content=${encodeURIComponent(content)}&parent_comment_id=${commentId}`,
                            {
                                method: "POST",
                                headers: {
                                    "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                                }
                            }
                        );

                    if (!response.ok) {

                        const errorData =
                            await response.json();

                        throw new Error(
                            errorData.detail ||
                            "답글 등록에 실패했습니다."
                        );
                    }

                    const result =
                        await response.json();

                    console.log(
                        "대댓글 등록 완료:",
                        result
                    );

                    // 댓글 목록 다시 불러오기
                    await loadComments(
                        getPostId()
                    );

                } catch (error) {

                    console.error(
                        "대댓글 등록 오류:",
                        error
                    );

                    showBasebotModal(
                        "답글 작성 오류",
                        error.message ||
                        "답글 등록 중 오류가 발생했습니다."
                    );
                }
            }
        );

        comment.appendChild(replyBox);

        textarea.focus();
    });



// =========================================
// 게시글 삭제
// =========================================
async function deletePost() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    const postId =
        params.get("postId");

    if (!postId) {

        showBasebotModal(
            "오류",
            "게시글 번호를 찾을 수 없습니다."
        );

        return;
    }

    // 삭제 확인 팝업
    showBasebotConfirm(
        "게시글 삭제",
        "정말 이 게시글을 삭제하시겠습니까?",

        async function () {

            try {
                const response =
                    await fetch(
                        `${API_BASE_URL}/community/posts/${postId}`,
                        {
                            method: "DELETE",

                            headers: {
                                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
                            }
                        }
                    );

                if (!response.ok) {

                    const errorData =
                        await response.json();

                    throw new Error(
                        errorData.detail ||
                        "게시글 삭제에 실패했습니다."
                    );
                }

                const result =
                    await response.json();

                console.log(
                    "게시글 삭제 완료:",
                    result
                );

                showBasebotModal(
                    "삭제 완료",
                    "게시글이 삭제되었습니다.",
                    function () {

                        window.location.href =
                            "community.html";

                    }
                );

            } catch (error) {

                console.error(
                    "게시글 삭제 오류:",
                    error
                );

                showBasebotModal(
                    "삭제 오류",
                    error.message ||
                    "게시글 삭제 중 오류가 발생했습니다."
                );
            }
        },

        "삭제"
    );
}


// =========================================
// 삭제 버튼 이벤트
// =========================================
const deletePostButton =
    document.getElementById(
        "deletePostButton"
    );

if (deletePostButton) {

    deletePostButton.addEventListener(
        "click",
        deletePost
    );
}


function setupEditorImage() {
    const imageInput =
        document.getElementById("editorImage");

    const editor =
        document.getElementById("editor");

    if (!imageInput || !editor) {
        return;
    }

    imageInput.addEventListener("change", async function () {
        const file = imageInput.files[0];

        if (!file) {
            return;
        }

        if (!file.type.startsWith("image/")) {

            showBasebotModal(
                "이미지 첨부",
                "이미지 파일만 첨부할 수 있습니다."
            );

            imageInput.value = "";

            return;
        }

        try {
            // 1. 서버에 업로드할 데이터 준비
            const formData = new FormData();
            formData.append("file", file);

            // 2. 이미지 업로드 API 호출
            const response = await fetch(
                `${API_BASE_URL}/community/images/upload`,
                {
                    method: "POST",
                    body: formData
                }
            );

            if (!response.ok) {
                throw new Error("이미지 업로드에 실패했습니다.");
            }

            const result = await response.json();

            // 3. 서버에 저장된 이미지 주소 생성
            const imageUrl =
                `${API_BASE_URL}/uploads/community/${result.stored_name}`;

            // 4. 본문에 이미지 삽입
            const image = document.createElement("img");

            image.src = imageUrl;
            image.alt = "첨부 이미지";
            image.style.maxWidth = "100%";
            image.style.height = "auto";
            image.style.display = "block";
            image.style.margin = "10px 0";

            const selection = window.getSelection();

            if (
                selection.rangeCount > 0 &&
                editor.contains(selection.anchorNode)
            ) {
                const range = selection.getRangeAt(0);

                range.deleteContents();
                range.insertNode(image);

                range.setStartAfter(image);
                range.collapse(true);

                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                editor.appendChild(image);
            }

            // 이미지 다음 줄에서 글을 이어 쓸 수 있도록 처리
            const paragraph = document.createElement("p");
            paragraph.innerHTML = "<br>";

            image.parentNode.insertBefore(
                paragraph,
                image.nextSibling
            );

            console.log("이미지 업로드 성공:", result);

        } catch (error) {
            console.error("이미지 업로드 오류:", error);
            showBasebotModal(
                "이미지 업로드 오류",
                "이미지 업로드에 실패했습니다. 다시 시도해 주세요."
            );
        } finally {
            imageInput.value = "";
        }
    });
}

setupEditorImage();


/* =========================================
   글쓰기 버튼 - 로그인 확인
========================================= */

const communityWriteButton =
    document.getElementById("communityWriteButton");

if (communityWriteButton) {
    communityWriteButton.addEventListener("click", function (event) {
        const accessToken =
            sessionStorage.getItem("access_token");

        // 로그인하지 않은 경우
        if (!accessToken) {
            event.preventDefault();

            showLoginRequired("글쓰기는 로그인 후 이용할 수 있습니다.");
        }
    });
}