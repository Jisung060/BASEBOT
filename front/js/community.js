
/* =========================================
   BASEBOT Community JavaScript
   현재는 화면 동작 확인용
   이후 FastAPI API로 교체
========================================= */
const API_BASE_URL = "http://127.0.0.1:8000";

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

const teams = {
    AL: {
        EAST: [
            ["BAL", "볼티모어 오리올스"],
            ["BOS", "보스턴 레드삭스"],
            ["NYY", "뉴욕 양키스"],
            ["TB", "탬파베이 레이스"],
            ["TOR", "토론토 블루제이스"]
        ],
        CENTRAL: [
            ["CWS", "시카고 화이트삭스"],
            ["CLE", "클리블랜드 가디언스"],
            ["DET", "디트로이트 타이거스"],
            ["KC", "캔자스시티 로열스"],
            ["MIN", "미네소타 트윈스"]
        ],
        WEST: [
            ["HOU", "휴스턴 애스트로스"],
            ["LAA", "LA 에인절스"],
            ["ATH", "애슬레틱스"],
            ["SEA", "시애틀 매리너스"],
            ["TEX", "텍사스 레인저스"]
        ]
    },

    NL: {
        EAST: [
            ["ATL", "애틀랜타 브레이브스"],
            ["MIA", "마이애미 말린스"],
            ["NYM", "뉴욕 메츠"],
            ["PHI", "필라델피아 필리스"],
            ["WSH", "워싱턴 내셔널스"]
        ],
        CENTRAL: [
            ["CHC", "시카고 컵스"],
            ["CIN", "신시내티 레즈"],
            ["MIL", "밀워키 브루어스"],
            ["PIT", "피츠버그 파이리츠"],
            ["STL", "세인트루이스 카디널스"]
        ],
        WEST: [
            ["ARI", "애리조나 다이아몬드백스"],
            ["COL", "콜로라도 로키스"],
            ["LAD", "LA 다저스"],
            ["SD", "샌디에이고 파드리스"],
            ["SF", "샌프란시스코 자이언츠"]
        ]
    }
};

const divisionNames = {
    EAST: "동부",
    CENTRAL: "중부",
    WEST: "서부"
};


/* =========================================
   팀 코드 → 한글 팀 이름
   예: NYY → 뉴욕 양키스
========================================= */

const teamNamesByCode = {};

Object.values(teams).forEach(league => {
    Object.values(league).forEach(division => {
        division.forEach(([code, name]) => {
            teamNamesByCode[code] = name;
        });
    });
});


function updateTeamSelect(leagueSelectId, divisionSelectId, teamSelectId) {
    const leagueSelect = document.getElementById(leagueSelectId);
    const divisionSelect = document.getElementById(divisionSelectId);
    const teamSelect = document.getElementById(teamSelectId);

    if (!leagueSelect || !divisionSelect || !teamSelect) {
        return;
    }

    function resetTeams() {
        teamSelect.innerHTML = '<option value="">전체 팀</option>';
        teamSelect.value = "";
        teamSelect.disabled = true;
    }

    function renderDivisions() {
        const league = leagueSelect.value;

        divisionSelect.innerHTML = `
            <option value="">전체 지구</option>
            <option value="EAST">동부</option>
            <option value="CENTRAL">중부</option>
            <option value="WEST">서부</option>
        `;

        divisionSelect.value = "";
        divisionSelect.disabled = !league;
        resetTeams();
    }

    function renderTeams() {
        const league = leagueSelect.value;
        const division = divisionSelect.value;

        resetTeams();

        if (!league || !division) {
            return;
        }

        const list = teams[league]?.[division] || [];

        list.forEach(([code, name]) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = name;
            teamSelect.appendChild(option);
        });

        teamSelect.disabled = false;
    }

    leagueSelect.addEventListener("change", renderDivisions);
    divisionSelect.addEventListener("change", renderTeams);

    if (leagueSelect.value) {
        renderDivisions();
    } else {
        divisionSelect.disabled = true;
        resetTeams();
    }
}

updateTeamSelect("leagueSelect", "divisionSelect", "teamSelect");
updateTeamSelect("writeLeagueSelect", "writeDivisionSelect", "writeTeamSelect");


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
// 게시글 필터링 + 정렬
// 상단 분류 + 하단 게시글 검색을
// 동시에 적용한다.
// =========================================
function updateCommunityBoard() {

    const board =
        document.querySelector(".board");

    const boardRows =
        [...document.querySelectorAll(".board-row[data-team]")];

    const popularCards =
        [...document.querySelectorAll(".popular-card[data-team]")];

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

        if (
            appliedFilter.league &&
            element.dataset.league !== appliedFilter.league
        ) {
            return false;
        }

        if (
            appliedFilter.division &&
            element.dataset.division !==
            appliedFilter.division
        ) {
            return false;
        }

        if (
            appliedFilter.team &&
            element.dataset.team !==
            appliedFilter.team
        ) {
            return false;
        }

        if (
            appliedFilter.category &&
            element.dataset.category !==
            appliedFilter.category
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
    // 정렬
    // -----------------------------------------
    if (board) {

        const sortedRows =
            sortRows(matchedRows);

        sortedRows.forEach(row => {

            board.appendChild(row);
        });
    }


    // -----------------------------------------
    // 인기 게시글도 상단 조건 적용
    // -----------------------------------------
    popularCards.forEach(card => {

        card.hidden =
            !matchesTopFilter(card);
    });


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
// 상단 리그 / 지구 / 팀 / 카테고리 필터
// =========================================
function setupCommunityFilters() {

    const leagueSelect =
        document.getElementById("leagueSelect");

    const divisionSelect =
        document.getElementById("divisionSelect");

    const teamSelect =
        document.getElementById("teamSelect");

    const searchButton =
        document.getElementById(
            "teamFilterSearchButton"
        );

    const categoryButtons =
        [
            ...document.querySelectorAll(
                ".category-toggle"
            )
        ];

    const sortSelect =
        document.getElementById("sortSelect");


    console.log(
        "필터 요소 확인:",
        {
            leagueSelect,
            divisionSelect,
            teamSelect,
            searchButton
        }
    );


    if (
        !leagueSelect ||
        !divisionSelect ||
        !teamSelect ||
        !searchButton
    ) {
        return;
    }


    // -----------------------------------------
    // 상단 검색 버튼
    // -----------------------------------------
    searchButton.onclick = function () {

        console.log(
            "검색 버튼 클릭됨!"
        );


        appliedFilter = {

            league:
                leagueSelect.value,

            division:
                divisionSelect.value,

            team:
                teamSelect.value,

            category:
                document.querySelector(
                    ".category-toggle.active"
                )?.dataset.categoryFilter || ""
        };


        // ⭐ 상단 조건 + 하단 검색 조건
        // 둘 다 적용
        updateCommunityBoard();
    };


    console.log(
        "검색 이벤트 연결 완료:",
        searchButton
    );


    // -----------------------------------------
    // 카테고리 선택
    // -----------------------------------------
    categoryButtons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                categoryButtons.forEach(
                    item => {

                        item.classList.remove(
                            "active"
                        );
                    }
                );


                button.classList.add(
                    "active"
                );
            }
        );
    });


    // -----------------------------------------
    // 정렬 변경
    // -----------------------------------------
    sortSelect?.addEventListener(
        "change",
        () => {

            updateCommunityBoard();
        }
    );


    // -----------------------------------------
    // 처음에는 전체 게시글 표시
    // -----------------------------------------
    updateCommunityBoard();
}



// =========================================
// 하단 게시글 검색
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


    searchButton.addEventListener(
        "click",
        function () {

            const type =
                searchType.value;


            const keyword =
                searchInput.value
                    .trim()
                    .toLowerCase();


            console.log(
                "게시글 검색 실행:",
                {
                    type: type,
                    keyword: keyword
                }
            );


            // 하단 검색 조건 저장
            appliedPostSearch = {

                type:
                    keyword
                        ? type
                        : "",

                keyword:
                    keyword
            };


            // ⭐ 상단 필터와 하단 검색을
            // 동시에 적용
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
                        ${post.title}
                    </span>

                    <span class="comment-count">
                        [${post.comment_count || 0}]
                    </span>

                </div>

                <div>
                    ${post.nickname}
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





/* =========================================
   커뮤니티 시작
   게시글을 먼저 불러온 후 필터 설정
========================================= */

async function startCommunity() {

    await loadPosts();

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
                `작성자 <strong>${post.nickname}</strong>`;
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
                post.content;
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
            try {

                const likeStatusResponse =
                    await fetch(
                        `${API_BASE_URL}/community/posts/${post.post_id}/like`
                    );

                console.log("좋아요 상태 API 응답:",
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

                    // 좋아요 개수 표시
                    if (count) {

                        count.textContent =
                            Number(
                                likeStatus.like_count || 0
                            ).toLocaleString();
                    }

                    // 이미 좋아요를 눌렀다면
                    if (likeStatus.liked) {

                        likeButton.classList.add("liked");

                    } else {

                        likeButton.classList.remove("liked");
                    }
                }

            } catch (error) {

                console.error(
                    "좋아요 상태 조회 오류:",
                    error
                );
            }


            // =================================
            //          좋아요 버튼 클릭
            // =================================
            likeButton.onclick = async function () {

                try {

                    const likeResponse =
                        await fetch(
                            `${API_BASE_URL}/community/posts/${post.post_id}/like`,
                            {
                                method: "POST"
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
           수정 버튼
        ================================= */

        const editButton =
            postDetail.querySelector(
                ".post-owner-area a"
            );

        if (editButton) {

            editButton.href =
                `community-edit.html?postId=${post.post_id}`;
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


function createCommentElement(
    comment,
    depth = 0
) {

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
                ${comment.nickname}
            </strong>

            <span>
                ${formatCommentDate(
                    comment.created_at
                )}
            </span>

        </div>


        <p class="comment-text">
            ${comment.content}
        </p>


        <div class="comment-actions">

            <button
                type="button"
                class="comment-like-button"
            >
                ♥ 좋아요
                <strong>
                    ${comment.like_count}
                </strong>
            </button>


            <button
                type="button"
                class="reply-button"
            >
                답글
            </button>

        </div>
    `;


    // -----------------------------------------
    // 대댓글 깊이에 따른 들여쓰기
    // -----------------------------------------

    if (depth > 0) {

        commentItem.style.marginLeft =
            `${Math.min(depth * 28, 140)}px`;
    }


    return commentItem;
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

                alert("분류를 선택해주세요.");

                return;
            }


            if (!title) {

                alert("제목을 입력해주세요.");

                return;
            }


            if (
                !content ||
                content === "<p><br></p>"
            ) {

                alert("내용을 입력해주세요.");

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
                                "Content-Type":
                                    "application/json"
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

                alert(
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
        alert("게시글 번호를 찾을 수 없습니다.");
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
        // 2. 리그
        // =========================

        const leagueSelect =
            document.getElementById(
                "writeLeagueSelect"
            );

        const divisionSelect =
            document.getElementById(
                "writeDivisionSelect"
            );

        const teamSelect =
            document.getElementById(
                "writeTeamSelect"
            );


        // 팀 정보가 있다면
        if (post.league) {

            leagueSelect.value =
                post.league;

            // 리그 변경 이벤트 실행
            leagueSelect.dispatchEvent(
                new Event("change")
            );
        }


        // =========================
        // 3. 지구
        // =========================

        if (post.division) {

            divisionSelect.value =
                post.division.toUpperCase();

            divisionSelect.dispatchEvent(
                new Event("change")
            );
        }


        // =========================
        // 4. 구단
        // =========================

        if (post.team_code) {

            teamSelect.value =
                post.team_code;
        }


        // =========================
        // 5. 제목
        // =========================

        const titleInput =
            editForm.querySelector(
                '[name="title"]'
            );

        titleInput.value =
            post.title;


        // =========================
        // 6. 내용
        // =========================

        const editor =
            document.getElementById(
                "editor"
            );

        editor.innerHTML =
            post.content;


    } catch (error) {

        console.error(
            "게시글 불러오기 오류:",
            error
        );

        alert(
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

                alert(
                    "분류를 선택해주세요."
                );

                return;
            }

            if (!title) {

                alert(
                    "제목을 입력해주세요."
                );

                return;
            }

            if (
                !content ||
                content === "<p><br></p>"
            ) {

                alert(
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
                                "Content-Type":
                                    "application/json"
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

                alert(
                    error.message ||
                    "게시글 수정 중 오류가 발생했습니다."
                );
            }
        }
    );
}


setupEditForm();


/* =========================================
   게시글 좋아요 / 스크랩
========================================= */

function setupPostActions() {

    const likeButton =
        document.getElementById("postLikeButton");

    const scrapButton =
        document.getElementById("postScrapButton");

    likeButton?.addEventListener("click", function () {

        this.classList.toggle("active");

        const count =
            this.querySelector("strong");

        if (count) {

            const current =
                Number(
                    count.textContent.replace(",", "")
                );

            count.textContent =
                this.classList.contains("active")
                    ? current + 1
                    : current - 1;
        }
    });

    scrapButton?.addEventListener("click", function () {

        this.classList.toggle("scrapped");

        this.textContent =
            this.classList.contains("scrapped")
                ? "🔖 스크랩됨"
                : "🔖 스크랩";
    });

    document.querySelectorAll(".comment-like-button").forEach(button => {

        button.addEventListener("click", function () {

            this.classList.toggle("active");

            const count =
                this.querySelector("strong");

            if (count) {

                const current =
                    Number(count.textContent);

                count.textContent =
                    this.classList.contains("active")
                        ? current + 1
                        : current - 1;
            }
        });
    });
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

    if (!openButton || !modal) return;

    const close = () => {
        modal.hidden = true;
    };

    openButton.addEventListener("click", () => {
        modal.hidden = false;
    });

    closeButton?.addEventListener("click", close);

    cancelButton?.addEventListener("click", close);

    modal.addEventListener("click", event => {

        if (event.target === modal) {
            close();
        }

    });

    submitButton?.addEventListener("click", () => {

        const selected =
            document.querySelector(
                'input[name="reportReason"]:checked'
            );

        if (!selected) {

            alert(
                "신고 사유를 선택해주세요."
            );

            return;
        }

        alert(
            "신고가 접수되었습니다. 실제 저장은 추후 FastAPI와 연결합니다."
        );

        close();
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
            document.querySelector(".post-title")
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

            alert(
                "게시글 링크가 복사되었습니다."
            );

            close();

        } catch (error) {

            const temp =
                document.createElement("input");

            temp.value = url;

            document.body.appendChild(temp);

            temp.select();

            document.execCommand("copy");

            temp.remove();

            alert(
                "게시글 링크가 복사되었습니다."
            );

            close();
        }
    });

    nativeButton?.addEventListener("click", async () => {

        const data = getShareData();

        if (!navigator.share) {

            alert(
                "현재 브라우저에서는 기기 공유를 지원하지 않습니다. '링크 복사'를 이용해주세요."
            );

            return;
        }

        try {

            await navigator.share(data);

            close();

        } catch (error) {

            if (error.name !== "AbortError") {

                alert(
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

    const textarea =
        commentForm.querySelector("textarea");

    const content =
        textarea.value.trim();

    if (!content) {

        alert(
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

        alert(
            "게시글 번호를 찾을 수 없습니다."
        );

        return;
    }

    try {

        const response =
            await fetch(
                `${API_BASE_URL}/community/posts/${postId}/comments?content=${encodeURIComponent(content)}`,
                {
                    method: "POST"
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

        alert(
            error.message ||
            "댓글 등록 중 오류가 발생했습니다."
        );
    }
});

const commentTextarea =
    commentForm?.querySelector("textarea");

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

        const comment =
            replyButton.closest(".comment-item");

        if (!comment) {
            return;
        }

        const commentId =
            comment.dataset.commentId;

        if (!commentId) {
            alert(
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

                    alert(
                        "답글 내용을 입력해주세요."
                    );

                    return;
                }

                try {

                    const response =
                        await fetch(
                            `${API_BASE_URL}/community/posts/${getPostId()}/comments?content=${encodeURIComponent(content)}&parent_comment_id=${commentId}`,
                            {
                                method: "POST"
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

                    alert(
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
                            method: "DELETE"
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

    imageInput.addEventListener(
        "change",
        function () {

            const file =
                imageInput.files[0];

            if (!file) {
                return;
            }

            if (!file.type.startsWith("image/")) {
                alert("이미지 파일만 첨부할 수 있습니다.");
                return;
            }

            const reader =
                new FileReader();

            reader.onload = function (event) {

                const image =
                    document.createElement("img");

                image.src =
                    event.target.result;

                image.alt =
                    "첨부 이미지";

                image.style.maxWidth =
                    "100%";

                image.style.height =
                    "auto";

                image.style.display =
                    "block";

                image.style.margin =
                    "10px 0";

                // 현재 커서 위치에 이미지 삽입
                const selection =
                    window.getSelection();

                if (
                    selection.rangeCount > 0 &&
                    editor.contains(
                        selection.anchorNode
                    )
                ) {

                    const range =
                        selection.getRangeAt(0);

                    range.deleteContents();

                    range.insertNode(image);

                    range.setStartAfter(image);
                    range.collapse(true);

                    selection.removeAllRanges();
                    selection.addRange(range);

                } else {

                    // 커서가 에디터 밖에 있다면
                    // 에디터 마지막에 이미지 추가
                    editor.appendChild(image);

                }

                // 이미지 뒤에서 계속 글을 쓸 수 있도록 줄 추가
                const paragraph =
                    document.createElement("p");

                paragraph.innerHTML =
                    "<br>";

                image.parentNode.insertBefore(
                    paragraph,
                    image.nextSibling
                );

                // 파일 선택 초기화
                imageInput.value = "";

            };

            reader.readAsDataURL(file);
        }
    );
}

setupEditorImage();