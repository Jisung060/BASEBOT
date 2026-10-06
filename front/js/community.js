
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
        document.getElementById(
            "basebotModal"
        );

    const titleElement =
        document.getElementById(
            "basebotModalTitle"
        );

    const messageElement =
        document.getElementById(
            "basebotModalMessage"
        );

    const button =
        document.getElementById(
            "basebotModalButton"
        );

    if (!modal) {
        return;
    }

    titleElement.textContent =
        title;

    messageElement.textContent =
        message;

    modal.classList.add("show");

    button.onclick = function () {

        modal.classList.remove("show");

        if (callback) {
            callback();
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


function setupCommunityFilters() {
    const leagueSelect = document.getElementById("leagueSelect");
    const divisionSelect = document.getElementById("divisionSelect");
    const teamSelect = document.getElementById("teamSelect");
    const searchButton = document.getElementById("teamFilterSearchButton");
    const selectedFilter = document.getElementById("selectedFilter");
    const boardTotal = document.querySelector(".board-total");
    const emptyMessage = document.getElementById("filterEmptyMessage");
    const sortSelect = document.getElementById("sortSelect");

    if (!leagueSelect || !divisionSelect || !teamSelect || !searchButton) {
        return;
    }

    const board = document.querySelector(".board");
    const boardRows = [...document.querySelectorAll(".board-row[data-team]")];
    const popularCards = [...document.querySelectorAll(".popular-card[data-team]")];
    const categoryButtons = [...document.querySelectorAll(".category-toggle")];

    // 현재 검색 버튼을 눌러 적용된 조건.
    let appliedFilter = {
        league: "",
        division: "",
        team: "",
        category: ""
    };

    function selectedText(select, fallback) {
        return select.selectedOptions[0]?.textContent || fallback;
    }

    function matches(element, filter) {
        if (filter.league && element.dataset.league !== filter.league) return false;
        if (filter.division && element.dataset.division !== filter.division) return false;
        if (filter.team && element.dataset.team !== filter.team) return false;
        if (filter.category && element.dataset.category !== filter.category) return false;
        return true;
    }

    function categoryName(code) {
        const names = {
            GENERAL: "자유",
            ANALYSIS: "분석",
            GAME_THREAD: "경기",
            NEWS: "뉴스"
        };

        return names[code] || "";
    }

    function getConditionText(filter) {
        const parts = [];

        if (filter.league) {
            parts.push(selectedText(leagueSelect, "전체 리그"));
        }

        if (filter.division) {
            parts.push(selectedText(divisionSelect, "전체 지구"));
        }

        if (filter.team) {
            parts.push(selectedText(teamSelect, "전체 팀"));
        }

        if (filter.category) {
            parts.push(categoryName(filter.category));
        }

        return parts.length ? parts.join(" · ") : "전체 게시글";
    }

    function sortRows(rows) {
        const sortValue = sortSelect?.value || "latest";

        return [...rows].sort((a, b) => {
            if (sortValue === "views") {
                return Number(b.dataset.views) - Number(a.dataset.views);
            }

            if (sortValue === "likes") {
                return Number(b.dataset.likes) - Number(a.dataset.likes);
            }

            // 최신순: 날짜가 같으면 게시글 번호가 큰 글이 먼저.
            const dateCompare = String(b.dataset.date).localeCompare(String(a.dataset.date));

            if (dateCompare !== 0) {
                return dateCompare;
            }

            return Number(b.children[0].textContent) - Number(a.children[0].textContent);
        });
    }

    function updateBoard(filter) {
        const matchedRows = boardRows.filter(row => matches(row, filter));

        // 먼저 모든 게시글을 숨기고, 검색 조건에 맞는 게시글만 표시.
        boardRows.forEach(row => {
            row.hidden = !matchedRows.includes(row);
        });

        // 정렬 선택에 따라 현재 필터 결과의 순서를 변경.
        if (board) {
            const sortedRows = sortRows(matchedRows);

            sortedRows.forEach(row => {
                board.appendChild(row);
            });
        }

        // 인기 게시글도 같은 조건으로 필터링.
        popularCards.forEach(card => {
            card.hidden = !matches(card, filter);
        });

        const conditionText = getConditionText(filter);

        if (selectedFilter) {
            selectedFilter.textContent = conditionText;
        }

        if (boardTotal) {
            const sortName = {
                latest: "최신순",
                views: "조회순",
                likes: "추천순"
            }[sortSelect?.value || "latest"];

            boardTotal.innerHTML =
                `${conditionText} · ${sortName} <strong>${matchedRows.length}</strong>`;
        }

        if (emptyMessage) {
            emptyMessage.hidden = matchedRows.length !== 0;
        }
    }

    function applySearch() {
        appliedFilter = {
            league: leagueSelect.value,
            division: divisionSelect.value,
            team: teamSelect.value,
            category: document.querySelector(".category-toggle.active")?.dataset.categoryFilter || ""
        };

        updateBoard(appliedFilter);
    }

    // 분류 토글은 검색 조건을 고르는 단계.
    // 실제 필터링은 [검색] 버튼을 눌렀을 때 적용.
    categoryButtons.forEach(button => {
        button.addEventListener("click", () => {
            categoryButtons.forEach(item => item.classList.remove("active"));
            button.classList.add("active");
        });
    });

    searchButton.addEventListener("click", applySearch);

    // 조회순 / 최신순 / 추천순은 현재 검색 결과를 바로 재정렬.
    sortSelect?.addEventListener("change", () => {
        updateBoard(appliedFilter);
    });

    // 처음에는 전체 게시글을 최신순으로 보여줌.
    updateBoard(appliedFilter);
}


async function loadPosts() {
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
}

startCommunity();


/* =========================================
   커뮤니티 목록으로 돌아왔을 때
   최신 게시글 데이터 다시 불러오기
========================================= */

window.addEventListener("pageshow", async function () {

    const board =
        document.querySelector(".board");

    if (!board) {
        return;
    }

    await loadPosts();

    setupCommunityFilters();
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

        // 조회수 증가
        await fetch(
            `${API_BASE_URL}/community/posts/${postId}/view`,
            {
                method: "POST"
            }
        );

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


        /* =================================
           좋아요
        ================================= */

        const likeButton =
            document.getElementById(
                "postLikeButton"
            );

        if (likeButton) {

            const count =
                likeButton.querySelector(
                    "strong"
                );

            if (count) {

                count.textContent =
                    Number(
                        post.like_count || 0
                    ).toLocaleString();
            }
        }


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

    const imageInput =
        document.getElementById("editorImage");

    imageInput?.addEventListener("change", function () {

        const file = this.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {

            alert(
                "이미지 파일만 선택할 수 있습니다."
            );

            this.value = "";

            return;
        }

        const reader = new FileReader();

        reader.onload = event => {

            editor.focus();

            const img =
                document.createElement("img");

            img.src = event.target.result;

            img.alt = file.name;

            img.className = "editor-image";

            editor.appendChild(img);

            const p =
                document.createElement("p");

            editor.appendChild(p);

            this.value = "";
        };

        reader.readAsDataURL(file);
    });

    const form = editor.closest("form");

    form?.addEventListener("submit", () => {

        if (contentInput) {
            contentInput.value = editor.innerHTML;
        }

    });
}

setupEditor();


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
   대댓글
========================================= */

document.querySelectorAll(".reply-button").forEach(button => {

    button.addEventListener("click", () => {

        const comment =
            button.closest(".comment-item");

        if (!comment) return;

        let replyBox =
            comment.querySelector(
                ":scope > .reply-write"
            );

        if (replyBox) {

            replyBox.remove();

            return;
        }

        replyBox =
            document.createElement("div");

        replyBox.className =
            "reply-write";

        replyBox.innerHTML = `
            <textarea placeholder="답글을 입력하세요"></textarea>
            <button type="button">답글 등록</button>
        `;

        replyBox.style.marginTop = "10px";

        replyBox.style.display = "grid";

        replyBox.style.gridTemplateColumns =
            "1fr 80px";

        replyBox.style.gap = "6px";

        const textarea =
            replyBox.querySelector("textarea");

        textarea.style.minHeight = "60px";

        textarea.style.padding = "8px";

        textarea.style.border =
            "1px solid #d8dde6";

        const submit =
            replyBox.querySelector("button");

        submit.style.border = "0";

        submit.style.background = "#173f91";

        submit.style.color = "#fff";

        submit.style.cursor = "pointer";

        submit.addEventListener("click", () => {

            if (!textarea.value.trim()) {

                alert(
                    "답글 내용을 입력해주세요."
                );

                return;
            }

            alert(
                "대댓글 UI 테스트입니다. 실제 저장은 추후 API와 연결합니다."
            );

            textarea.value = "";
        });

        comment.appendChild(replyBox);

        textarea.focus();
    });
});


/* =========================================
   댓글
========================================= */

const commentForm =
    document.getElementById("commentForm");

commentForm?.addEventListener("submit", event => {

    event.preventDefault();

    const textarea =
        commentForm.querySelector("textarea");

    if (!textarea.value.trim()) {

        alert(
            "댓글 내용을 입력해주세요."
        );

        return;
    }

    alert(
        "댓글 UI 테스트입니다. 실제 저장은 추후 FastAPI와 연결합니다."
    );

    textarea.value = "";
});


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

// 삭제 함수
async function deletePost() {

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

    const confirmed =
        confirm("정말 이 게시글을 삭제하시겠습니까?");

    if (!confirmed) {
        return;
    }

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

        alert(
            error.message ||
            "게시글 삭제 중 오류가 발생했습니다."
        );
    }
}

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

