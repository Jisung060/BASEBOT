
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

    // 1. 최신 닉네임 조회 및 표시
    if (userGreetingArea && userNicknameText) {
        let displayName = user
            ? (user.nickname || user.username || user.name)
            : null;

        // 로그인 사용자 ID가 있으면 백엔드에서 최신 닉네임 조회
        if (user && (user.user_id || user.id)) {
            try {
                const uid = user.user_id || user.id;

                const res = await fetch(
                    `/api/rankings/me?user_id=${uid}`
                );

                if (res.ok) {
                    const rankData = await res.json();

                    if (rankData.user_info?.nickname) {
                        displayName = rankData.user_info.nickname;

                        // 세션에 저장된 닉네임도 최신 값으로 갱신
                        user.nickname = displayName;
                        sessionStorage.setItem(
                            "user",
                            JSON.stringify(user)
                        );

                        // localStorage에 사용자 정보가 있다면 함께 갱신
                        if (localStorage.getItem("user")) {
                            localStorage.setItem(
                                "user",
                                JSON.stringify(user)
                            );
                        }
                    }
                }
            } catch (error) {
                console.warn("최신 닉네임 조회 실패:", error);
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
            resultList.innerHTML =
                `<li class="savant-no-result">검색 결과가 없습니다.</li>`;

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
            const res = await fetch(
                `/api/players/search/autocomplete?q=${encodeURIComponent(query)}&limit=12`
            );

            if (!res.ok) {
                throw new Error("검색 API 오류");
            }

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
    // 세션에 저장된 로그인 정보 삭제
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("user");

    // localStorage에 남아 있을 수 있는 로그인 정보도 삭제
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");

    // 현재 페이지의 챗봇 세션 초기화
    window.chatbotSessionId = null;

    alert("로그아웃되었습니다.");

    // 메인 페이지로 이동
    window.location.href = "/main.html";
}


/* ==================================================
   공통 AI 챗봇 컴포넌트 불러오기
================================================== */

async function loadChatbotComponent() {
    // 이미 삽입되어 있으면 중복 삽입 방지
    if (document.getElementById("basebot-chatbot")) {
        return;
    }

    try {
        const response = await fetch("/components/chatbot.html");

        if (!response.ok) {
            throw new Error(
                `챗봇 컴포넌트를 불러오지 못했습니다. HTTP ${response.status}`
            );
        }

        const html = await response.text();

        // 챗봇 CSS 연결
        if (!document.querySelector('link[data-chatbot-css]')) {
            const link = document.createElement("link");

            link.rel = "stylesheet";
            link.href = "/css/chatbot.css";
            link.dataset.chatbotCss = "true";

            document.head.appendChild(link);
        }

        // 챗봇 HTML 삽입
        document.body.insertAdjacentHTML("beforeend", html);

        // 챗봇 JS 연결
        // chatbot.js는 HTML 삽입 후 한 번만 불러온다.
        if (!document.querySelector('script[data-chatbot-js]')) {
            const script = document.createElement("script");

            script.src = "/js/chatbot.js";
            script.dataset.chatbotJs = "true";

            script.onerror = () => {
                console.error("챗봇 JavaScript 파일을 불러오지 못했습니다.");
            };

            document.body.appendChild(script);
        }

    } catch (error) {
        console.error("챗봇 컴포넌트 로딩 실패:", error);
    }
}


// 공통 챗봇 로딩 실행
loadChatbotComponent();


/* =========================================
   MLB 구단 전역 한글 매핑 객체 (공통)
========================================= */
window.koreanTeamNames = {
    BAL: "볼티모어 오리올스",
    BOS: "보스턴 레드삭스",
    NYY: "뉴욕 양키스",
    TB: "탬파베이 레이스",
    TOR: "토론토 블루제이스",

    CWS: "시카고 화이트삭스",
    CLE: "클리블랜드 가디언스",
    DET: "디트로이트 타이거스",
    KC: "캔자스시티 로열스",
    MIN: "미네소타 트윈스",

    HOU: "휴스턴 애스트로스",
    LAA: "LA 에인절스",
    OAK: "오클랜드 애슬레틱스",
    ATH: "오클랜드 애슬레틱스",
    SEA: "시애틀 매리너스",
    TEX: "텍사스 레인저스",

    ATL: "애틀랜타 브레이브스",
    MIA: "마이애미 말린스",
    NYM: "뉴욕 메츠",
    PHI: "필라델피아 필리스",
    WSH: "워싱턴 내셔널스",

    CHC: "시카고 컵스",
    CIN: "신시내티 레즈",
    MIL: "밀워키 브루어스",
    PIT: "피츠버그 파이리츠",
    STL: "세인트루이스 카디널스",

    ARI: "애리조나 다이아몬드백스",
    AZ: "애리조나 다이아몬드백스",
    ARIZ: "애리조나 다이아몬드백스",
    COL: "콜로라도 로키스",
    LAD: "LA 다저스",
    SD: "샌디에이고 파드리스",
    SF: "샌프란시스코 자이언츠"
};




document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".clickable-section").forEach(box => {
            const navigate = () => {
                const url = box.dataset.navigationUrl;

                if (url) {
                    window.location.href = url;
                }
            };

            box.addEventListener("click", event => {
                // 기존 링크와 버튼의 동작은 그대로 유지
                if (event.target.closest("a, button")) {
                    return;
                }

                navigate();
            });

            // 키보드 Enter 또는 Space로도 이동 가능
            box.addEventListener("keydown", event => {
                if (event.target !== box) {
                    return;
                }

                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate();
                }
            });
        });
    });