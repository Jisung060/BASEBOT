/* =========================================
   BASEBOT Community JavaScript
   현재는 화면 동작 확인용
   이후 FastAPI API로 교체
========================================= */

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
            if (dateCompare !== 0) return dateCompare;

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
            sortedRows.forEach(row => board.appendChild(row));
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

setupCommunityFilters();

function setupEditor() {
    const editor = document.getElementById("editor");
    const contentInput = document.getElementById("contentInput");

    if (!editor) return;

    document.querySelectorAll(".editor-toolbar button[data-command]").forEach(button => {
        button.addEventListener("mousedown", event => event.preventDefault());

        button.addEventListener("click", () => {
            editor.focus();
            document.execCommand(button.dataset.command, false, null);
        });
    });

    const fontSizeSelect = document.getElementById("fontSizeSelect");

    fontSizeSelect?.addEventListener("change", function () {
        if (!this.value) return;

        editor.focus();
        document.execCommand("fontSize", false, this.value);
        this.value = "";
    });

    const imageInput = document.getElementById("editorImage");

    imageInput?.addEventListener("change", function () {
        const file = this.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("이미지 파일만 선택할 수 있습니다.");
            this.value = "";
            return;
        }

        const reader = new FileReader();

        reader.onload = event => {
            editor.focus();

            const img = document.createElement("img");
            img.src = event.target.result;
            img.alt = file.name;
            img.className = "editor-image";

            editor.appendChild(img);

            const p = document.createElement("p");
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

function setupPostActions() {
    const likeButton = document.getElementById("postLikeButton");
    const scrapButton = document.getElementById("postScrapButton");

    likeButton?.addEventListener("click", function () {
        this.classList.toggle("active");

        const count = this.querySelector("strong");

        if (count) {
            const current = Number(count.textContent.replace(",", ""));
            count.textContent = this.classList.contains("active")
                ? current + 1
                : current - 1;
        }
    });

    scrapButton?.addEventListener("click", function () {
        this.classList.toggle("scrapped");
        this.textContent = this.classList.contains("scrapped")
            ? "🔖 스크랩됨"
            : "🔖 스크랩";
    });

    document.querySelectorAll(".comment-like-button").forEach(button => {
        button.addEventListener("click", function () {
            this.classList.toggle("active");

            const count = this.querySelector("strong");

            if (count) {
                const current = Number(count.textContent);
                count.textContent = this.classList.contains("active")
                    ? current + 1
                    : current - 1;
            }
        });
    });
}

setupPostActions();

function setupReportModal() {
    const openButton = document.getElementById("postReportButton");
    const modal = document.getElementById("reportModal");
    const closeButton = document.getElementById("closeReportModal");
    const cancelButton = document.getElementById("cancelReport");
    const submitButton = document.getElementById("submitReport");

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
        const selected = document.querySelector('input[name="reportReason"]:checked');

        if (!selected) {
            alert("신고 사유를 선택해주세요.");
            return;
        }

        alert("신고가 접수되었습니다. 실제 저장은 추후 FastAPI와 연결합니다.");
        close();
    });
}

setupReportModal();

function setupShare() {
    const openButton = document.getElementById("postShareButton");
    const modal = document.getElementById("shareModal");
    const closeButton = document.getElementById("closeShareModal");
    const copyButton = document.getElementById("copyLinkButton");
    const nativeButton = document.getElementById("nativeShareButton");

    if (!openButton || !modal) return;

    const getShareData = () => ({
        title: document.querySelector(".post-title")?.textContent.trim() || "BASEBOT 커뮤니티 게시글",
        text: "BASEBOT 커뮤니티 게시글을 확인해보세요.",
        url: window.location.href
    });

    const close = () => {
        modal.hidden = true;
    };

    openButton.addEventListener("click", () => {
        modal.hidden = false;
    });

    closeButton?.addEventListener("click", close);

    modal.addEventListener("click", event => {
        if (event.target === modal) close();
    });

    copyButton?.addEventListener("click", async () => {
        const { url } = getShareData();

        try {
            await navigator.clipboard.writeText(url);
            alert("게시글 링크가 복사되었습니다.");
            close();
        } catch (error) {
            const temp = document.createElement("input");
            temp.value = url;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand("copy");
            temp.remove();
            alert("게시글 링크가 복사되었습니다.");
            close();
        }
    });

    nativeButton?.addEventListener("click", async () => {
        const data = getShareData();

        if (!navigator.share) {
            alert("현재 브라우저에서는 기기 공유를 지원하지 않습니다. '링크 복사'를 이용해주세요.");
            return;
        }

        try {
            await navigator.share(data);
            close();
        } catch (error) {
            if (error.name !== "AbortError") {
                alert("공유하는 중 문제가 발생했습니다.");
            }
        }
    });
}

setupShare();

document.querySelectorAll(".reply-button").forEach(button => {
    button.addEventListener("click", () => {
        const comment = button.closest(".comment-item");
        if (!comment) return;

        let replyBox = comment.querySelector(":scope > .reply-write");

        if (replyBox) {
            replyBox.remove();
            return;
        }

        replyBox = document.createElement("div");
        replyBox.className = "reply-write";
        replyBox.innerHTML = `
            <textarea placeholder="답글을 입력하세요"></textarea>
            <button type="button">답글 등록</button>
        `;

        replyBox.style.marginTop = "10px";
        replyBox.style.display = "grid";
        replyBox.style.gridTemplateColumns = "1fr 80px";
        replyBox.style.gap = "6px";

        const textarea = replyBox.querySelector("textarea");
        textarea.style.minHeight = "60px";
        textarea.style.padding = "8px";
        textarea.style.border = "1px solid #d8dde6";

        const submit = replyBox.querySelector("button");
        submit.style.border = "0";
        submit.style.background = "#173f91";
        submit.style.color = "#fff";
        submit.style.cursor = "pointer";

        submit.addEventListener("click", () => {
            if (!textarea.value.trim()) {
                alert("답글 내용을 입력해주세요.");
                return;
            }

            alert("대댓글 UI 테스트입니다. 실제 저장은 추후 API와 연결합니다.");
            textarea.value = "";
        });

        comment.appendChild(replyBox);
        textarea.focus();
    });
});

const commentForm = document.getElementById("commentForm");

commentForm?.addEventListener("submit", event => {
    event.preventDefault();

    const textarea = commentForm.querySelector("textarea");

    if (!textarea.value.trim()) {
        alert("댓글 내용을 입력해주세요.");
        return;
    }

    alert("댓글 UI 테스트입니다. 실제 저장은 추후 FastAPI와 연결합니다.");
    textarea.value = "";
});
