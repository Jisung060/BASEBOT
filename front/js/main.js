/* ==================================================
   Header 불러오기
================================================== */

fetch("/components/header.html")
    .then(response => {
        if (!response.ok) {
            throw new Error("Header 파일을 불러오지 못했습니다.");
        }

        return response.text();
    })
    .then(data => {
        const header = document.getElementById("header");

        if (header) {
            header.innerHTML = data;
            updateHeader();
            initHeaderSearch();
        }
    })
    .catch(error => {
        console.error("Header 불러오기 실패:", error);
    });


/* ==================================================
   Footer 불러오기
================================================== */

fetch("/components/footer.html")
    .then(response => {
        if (!response.ok) {
            throw new Error("Footer 파일을 불러오지 못했습니다.");
        }

        return response.text();
    })
    .then(data => {
        const footer = document.getElementById("footer");

        if (footer) {
            footer.innerHTML = data;
        }
    })
    .catch(error => {
        console.error("Footer 불러오기 실패:", error);
    });


/* ==================================================
   로그인 상태에 따른 Header 변경 (닉네임 환영 문구 포함)
================================================== */

async function updateHeader() {
    const accessToken = sessionStorage.getItem("access_token");

    const userGreetingArea = document.getElementById("userGreetingArea");
    const userNicknameText = document.getElementById("userNicknameText");
    const loginLink = document.getElementById("loginLink");
    const signupArea = document.getElementById("signupArea");
    const mypageArea = document.getElementById("mypageArea");
    const adminLink = document.getElementById("adminLink");

    // 로그인 사용자 정보 파싱
    let user = null;

    try {
        user = JSON.parse(
            sessionStorage.getItem("user") || localStorage.getItem("user") || "null"
        );
    } catch (error) {
        console.error("사용자 정보 파싱 실패:", error);
    }

    // 관리자 메뉴 표시
    if (adminLink) {
        if (accessToken && user && user.role === "ADMIN") {
            adminLink.style.display = "inline-block";
        } else {
            adminLink.style.display = "none";
        }
    }

    /* ==================================================
       로그인하지 않은 상태
    ================================================== */

    if (!accessToken) {
        if (userGreetingArea) {
            userGreetingArea.style.display = "none";
        }

        if (loginLink) {
            loginLink.textContent = "로그인";
            loginLink.href = "login.html";
            loginLink.onclick = null;
        }

        if (signupArea) {
            signupArea.style.display = "inline";
        }

        if (mypageArea) {
            mypageArea.style.display = "none";
        }

        return;
    }

    /* ==================================================
       로그인한 상태
    ================================================== */

    // 1. 닉네임 표시 (세션에 nickname이 없으면 백엔드에서 보완 조회)
    if (userGreetingArea && userNicknameText) {
        let displayName = user ? (user.nickname || user.username || user.name) : null;

        if (!displayName && user && (user.user_id || user.id)) {
            try {
                const uid = user.user_id || user.id;
                const res = await fetch(`/api/rankings/me?user_id=${uid}`);
                if (res.ok) {
                    const rankData = await res.json();
                    if (rankData.user_info && rankData.user_info.nickname) {
                        displayName = rankData.user_info.nickname;
                        user.nickname = displayName;
                        sessionStorage.setItem("user", JSON.stringify(user));
                    }
                }
            } catch (e) {
                console.warn("닉네임 추가 조회 실패:", e);
            }
        }

        userNicknameText.textContent = displayName || "회원";
        userGreetingArea.style.display = "inline";
    }

    // 2. 로그인 → 로그아웃
    if (loginLink) {
        loginLink.textContent = "로그아웃";
        loginLink.href = "#";

        loginLink.onclick = function (event) {
            event.preventDefault();
            logout();
        };
    }

    // 3. 회원가입 숨김 & 마이페이지 표시
    if (signupArea) {
        signupArea.style.display = "none";
    }

    if (mypageArea) {
        mypageArea.style.display = "inline";
    }
}


/* ==================================================
   Baseball Savant 스타일 실시간 자동완성 검색 초기화
================================================== */

function initHeaderSearch() {
    const wrapper = document.getElementById("savantSearchWrapper");
    const input = document.getElementById("headerSearchInput");
    const clearBtn = document.getElementById("headerSearchClear");
    const searchBtn = document.getElementById("headerSearchBtn");
    const dropdown = document.getElementById("headerSearchDropdown");
    const resultList = document.getElementById("headerSearchResultList");

    if (!input || !dropdown || !resultList) return;

    let debounceTimer = null;
    let currentItems = [];
    let activeIndex = -1;

    // 상세 페이지 이동 헬퍼
    function navigateToItem(item) {
        if (!item) return;
        if (item.type === "team") {
            location.href = `/team-detail.html?id=${item.id}`;
        } else {
            location.href = `/player-detail.html?id=${item.id}`;
        }
    }

    // 검색 결과 렌더링
    function renderDropdown(results) {
        currentItems = results || [];
        activeIndex = -1;
        resultList.innerHTML = "";

        if (currentItems.length === 0) {
            resultList.innerHTML = `<li class="savant-no-result">검색 결과가 없습니다.</li>`;
            dropdown.style.display = "block";
            return;
        }

        currentItems.forEach((item, idx) => {
            const li = document.createElement("li");
            li.className = "savant-result-item";
            li.dataset.index = idx;

            const fallbackImg = item.type === "team"
                ? `https://www.mlbstatic.com/team-logos/${item.id}.svg`
                : "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/generic/headshot/67/current";

            li.innerHTML = `
                <img 
                    class="savant-item-thumb ${item.type === 'team' ? 'is-team' : ''}" 
                    src="${item.image_url}" 
                    onerror="this.src='${fallbackImg}'"
                    alt="${item.name}"
                >
                <div class="savant-item-info">
                    <span class="savant-item-name">${item.name}</span>
                    <span class="savant-item-sub">${item.subtext}</span>
                </div>
            `;

            li.addEventListener("click", () => navigateToItem(item));
            resultList.appendChild(li);
        });

        dropdown.style.display = "block";
    }

    // API 호출
    async function fetchSearchResults(query) {
        try {
            const res = await fetch(`/api/players/search/autocomplete?q=${encodeURIComponent(query)}&limit=12`);
            if (!res.ok) throw new Error("검색 API 오류");
            const data = await res.json();
            renderDropdown(data.results || []);
        } catch (err) {
            console.error("검색 실패:", err);
        }
    }

    // 입력 이벤트 (디바운스 200ms)
    input.addEventListener("input", () => {
        const val = input.value.trim();
        if (clearBtn) {
            clearBtn.style.display = val.length > 0 ? "flex" : "none";
        }

        clearTimeout(debounceTimer);
        if (val.length < 1) {
            dropdown.style.display = "none";
            currentItems = [];
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchSearchResults(val);
        }, 200);
    });

    // 포커스 시 이미 입력된 검색어가 있으면 드롭다운 다시 표시
    input.addEventListener("focus", () => {
        if (input.value.trim().length > 0 && currentItems.length > 0) {
            dropdown.style.display = "block";
        }
    });

    // 키보드 방향키(↑, ↓) 및 Enter 지원
    input.addEventListener("keydown", (e) => {
        const itemsEl = resultList.querySelectorAll(".savant-result-item");
        if (!itemsEl.length) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % itemsEl.length;
            updateActiveHighlight(itemsEl);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + itemsEl.length) % itemsEl.length;
            updateActiveHighlight(itemsEl);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0 && currentItems[activeIndex]) {
                navigateToItem(currentItems[activeIndex]);
            } else if (currentItems.length > 0) {
                navigateToItem(currentItems[0]);
            }
        } else if (e.key === "Escape") {
            dropdown.style.display = "none";
        }
    });

    function updateActiveHighlight(itemsEl) {
        itemsEl.forEach((el, idx) => {
            el.classList.toggle("active", idx === activeIndex);
            if (idx === activeIndex) {
                el.scrollIntoView({ block: "nearest" });
            }
        });
    }

    // ✕ 지우기 버튼 클릭
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            input.value = "";
            clearBtn.style.display = "none";
            dropdown.style.display = "none";
            currentItems = [];
            input.focus();
        });
    }

    // 🔍 돋보기 버튼 클릭 시 첫 번째 결과로 이동하거나 검색 실행
    if (searchBtn) {
        searchBtn.addEventListener("click", () => {
            if (currentItems.length > 0) {
                navigateToItem(currentItems[0]);
            } else if (input.value.trim().length > 0) {
                fetchSearchResults(input.value.trim());
            } else {
                input.focus();
            }
        });
    }

    // 검색창 외부 클릭 시 드롭다운 닫기
    document.addEventListener("click", (e) => {
        if (wrapper && !wrapper.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });
}

/* ==================================================
   로그아웃
================================================== */

function logout() {
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("user");

    // 현재 페이지의 챗봇 세션 초기화
    chatbotSessionId = null;

    alert("로그아웃되었습니다.");

    location.href = "main.html";
}


/* ==================================================
   AI CHATBOT DOM 요소
================================================== */

const chatbotButton = document.getElementById("chatbotButton");
const chatbotWindow = document.getElementById("chatbotWindow");
const chatbotClose = document.getElementById("chatbotClose");
const chatbotInput = document.getElementById("chatbotInput");
const chatbotSend = document.getElementById("chatbotSend");
const chatbotBody = document.querySelector(".chatbot-body");


/* ==================================================
   챗봇 세션 ID
================================================== */

// 페이지가 열려 있는 동안 같은 대화의 세션 ID를 유지한다.
// 페이지를 새로고침하면 새 대화가 시작된다.
let chatbotSessionId = null;


/* ==================================================
   챗봇 요청 상태
================================================== */

// 답변을 기다리는 동안 중복 요청 방지
let isChatSending = false;


/* ==================================================
   챗봇 열기 / 닫기
================================================== */

if (chatbotButton && chatbotWindow) {
    chatbotButton.addEventListener("click", function () {
        chatbotWindow.classList.toggle("active");

        if (
            chatbotWindow.classList.contains("active") &&
            chatbotInput
        ) {
            chatbotInput.focus();
        }
    });
}


/* ==================================================
   챗봇 닫기
================================================== */

if (chatbotClose && chatbotWindow) {
    chatbotClose.addEventListener("click", function () {
        chatbotWindow.classList.remove("active");
    });
}


/* ==================================================
   사용자 메시지
================================================== */

function addUserMessage(message) {
    if (!chatbotBody) {
        return;
    }

    const messageElement = document.createElement("div");
    messageElement.className = "chatbot-message user";

    const content = document.createElement("div");
    content.className = "message-content";

    // 사용자 입력을 HTML로 해석하지 않도록 textContent 사용
    content.textContent = message;

    messageElement.appendChild(content);
    chatbotBody.appendChild(messageElement);

    scrollChatToBottom();
}


/* ==================================================
   AI 메시지
================================================== */

function addBotMessage(message) {
    if (!chatbotBody) {
        return;
    }

    const messageElement = document.createElement("div");
    messageElement.className = "chatbot-message bot";

    const icon = document.createElement("div");
    icon.className = "message-icon";
    icon.textContent = "AI";

    const content = document.createElement("div");
    content.className = "message-content";

    // AI 답변의 줄바꿈은 CSS white-space 설정으로 표시할 수 있다.
    // 서버 응답을 HTML로 실행하지 않도록 textContent 사용
    content.textContent = message;

    messageElement.appendChild(icon);
    messageElement.appendChild(content);

    chatbotBody.appendChild(messageElement);

    scrollChatToBottom();
}


/* ==================================================
   로딩
================================================== */

function addLoadingMessage() {
    if (!chatbotBody) {
        return;
    }

    // 기존 로딩 메시지가 있다면 중복 생성하지 않는다.
    if (document.getElementById("chatbotLoading")) {
        return;
    }

    const messageElement = document.createElement("div");

    messageElement.id = "chatbotLoading";
    messageElement.className = "chatbot-message bot";

    const icon = document.createElement("div");
    icon.className = "message-icon";
    icon.textContent = "AI";

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = "답변을 생각하고 있어요...";

    messageElement.appendChild(icon);
    messageElement.appendChild(content);

    chatbotBody.appendChild(messageElement);

    scrollChatToBottom();
}


/* ==================================================
   로딩 제거
================================================== */

function removeLoadingMessage() {
    const loading = document.getElementById("chatbotLoading");

    if (loading) {
        loading.remove();
    }
}


/* ==================================================
   스크롤
================================================== */

function scrollChatToBottom() {
    if (!chatbotBody) {
        return;
    }

    chatbotBody.scrollTop = chatbotBody.scrollHeight;
}


/* ==================================================
   챗봇 입력 상태 변경
================================================== */

function setChatInputDisabled(disabled) {
    if (chatbotInput) {
        chatbotInput.disabled = disabled;
    }

    if (chatbotSend) {
        chatbotSend.disabled = disabled;
    }
}


/* ==================================================
   메시지 전송
================================================== */

async function sendChatMessage() {
    // 입력 요소가 없는 페이지에서는 실행하지 않는다.
    if (!chatbotInput || !chatbotBody) {
        return;
    }

    // 요청 처리 중에는 중복 전송하지 않는다.
    if (isChatSending) {
        return;
    }

    const message = chatbotInput.value.trim();

    if (!message) {
        return;
    }

    // 요청 상태 변경
    isChatSending = true;
    setChatInputDisabled(true);

    // 사용자 메시지 출력
    addUserMessage(message);

    // 입력창 초기화
    chatbotInput.value = "";

    // 로딩 표시
    addLoadingMessage();

    try {
        const accessToken = sessionStorage.getItem("access_token");

        const headers = {
            "Content-Type": "application/json"
        };

        // 토큰이 있는 경우 Authorization 헤더 전달
        // 백엔드에서 JWT 인증을 처리하도록 연결해야 실제 인증이 적용된다.
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const response = await fetch("/chat", {
            method: "POST",

            headers: headers,

            body: JSON.stringify({
                message: message,
                session_id: chatbotSessionId
            })
        });

        if (!response.ok) {
            let errorMessage = "챗봇 API 요청 실패";

            try {
                const errorData = await response.json();

                if (errorData.detail) {
                    errorMessage = errorData.detail;
                }
            } catch (parseError) {
                // 오류 응답이 JSON이 아닌 경우 기본 메시지 사용
            }

            throw new Error(
                `${errorMessage} (HTTP ${response.status})`
            );
        }

        const data = await response.json();

        // 응답 데이터 확인
        if (typeof data.answer !== "string") {
            throw new Error("챗봇 응답에 answer가 없습니다.");
        }

        // 서버에서 반환한 세션 ID 유지
        if (data.session_id) {
            chatbotSessionId = data.session_id;
        }

        // 로딩 제거
        removeLoadingMessage();

        // AI 답변 출력
        addBotMessage(data.answer);

    } catch (error) {
        console.error("AI 챗봇 오류:", error);

        removeLoadingMessage();

        addBotMessage(
            "죄송합니다. 현재 AI 챗봇과 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
        );

    } finally {
        // 요청 상태 초기화
        isChatSending = false;

        // 입력창과 버튼 활성화
        setChatInputDisabled(false);

        // 입력창에 포커스
        if (
            chatbotWindow &&
            chatbotWindow.classList.contains("active") &&
            chatbotInput
        ) {
            chatbotInput.focus();
        }
    }
}


/* ==================================================
   전송 버튼
================================================== */

if (chatbotSend) {
    chatbotSend.addEventListener("click", sendChatMessage);
}


/* ==================================================
   Enter 키로 메시지 전송
================================================== */

if (chatbotInput) {
    chatbotInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });
}


/* ==================================================
   경기 결과 불러오기
================================================== */

document.addEventListener("DOMContentLoaded", function () {
    fetchMainGames();
});


/* ==================================================
   경기 데이터 조회
================================================== */

async function fetchMainGames() {
    try {
        // 기존에 사용하던 날짜와 limit 값은 유지한다.
        // localhost를 직접 지정하지 않고 현재 서버의 상대 경로를 사용한다.
        const res = await fetch(
            "/api/games?date=2024-04-15&limit=6"
        );

        if (!res.ok) {
            throw new Error(
                `경기 API 요청 실패: HTTP ${res.status}`
            );
        }

        const games = await res.json();

        if (!Array.isArray(games)) {
            throw new Error("경기 API 응답 형식이 배열이 아닙니다.");
        }

        renderTodayGames(games);

    } catch (err) {
        console.error("메인 경기 데이터 로드 실패:", err);
    }
}


/* ==================================================
   경기 날짜 및 시간 표시
================================================== */

function formatGameTime(gameTime) {
    if (!gameTime) {
        return "";
    }

    // DB의 TIME 컬럼이 "14:10:00" 형식으로 반환되는 경우
    const timeString = String(gameTime);

    const match = timeString.match(/^(\d{1,2}):(\d{2})/);

    if (match) {
        const hour = match[1].padStart(2, "0");
        const minute = match[2];

        return `${hour}:${minute}`;
    }

    // 예상하지 못한 형식은 원본 문자열을 그대로 반환
    return timeString;
}


/* ==================================================
   오늘의 경기 카드 영역 렌더링
================================================== */

function renderTodayGames(games) {
    const container = document.querySelector(".game-list");

    // 경기 일정 페이지(game.html)의 #game-list도 같은 클래스라서 건너뜀
    if (!container || container.id === "game-list") {
        return;
    }

    container.innerHTML = "";

    if (games.length === 0) {
        return;
    }

    games.slice(0, 3).forEach(game => {
        const card = document.createElement("div");
        card.className = "game-card";

        const gameInfo = document.createElement("div");
        gameInfo.className = "game-info";

        // 경기 날짜와 시간을 분리하여 표시
        const gameDate = game.game_date
            ? String(game.game_date).slice(0, 10)
            : "";

        const gameTime = formatGameTime(game.game_time);

        gameInfo.textContent = [gameDate, gameTime]
            .filter(Boolean)
            .join(" ");

        const gameTeam = document.createElement("div");
        gameTeam.className = "game-team";

        const awayTeam = document.createElement("span");
        awayTeam.textContent =
            game.away_team_code ||
            game.away_team_name ||
            game.away_team ||
            "원정팀";

        const versus = document.createElement("strong");
        versus.textContent = "VS";

        const homeTeam = document.createElement("span");
        homeTeam.textContent =
            game.home_team_code ||
            game.home_team_name ||
            game.home_team ||
            "홈팀";

        gameTeam.appendChild(awayTeam);
        gameTeam.appendChild(versus);
        gameTeam.appendChild(homeTeam);

        const gameStatus = document.createElement("div");
        gameStatus.className = "game-status";
        gameStatus.textContent = game.status || "상태 미정";

        card.appendChild(gameInfo);
        card.appendChild(gameTeam);
        card.appendChild(gameStatus);

        container.appendChild(card);
    });
}