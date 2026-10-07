/* ==================================================
   Header 불러오기
================================================== */

fetch("/components/header.html")
    .then(response => response.text())
    .then(data => {
        document.getElementById("header").innerHTML = data;
        updateHeader();
    })
    .catch(error => {
        console.error("Header 불러오기 실패:", error);
    });


/* ==================================================
   Footer 불러오기
================================================== */

fetch("/components/footer.html")
    .then(response => response.text())
    .then(data => {
        document.getElementById("footer").innerHTML = data;
    })
    .catch(error => {
        console.error("Footer 불러오기 실패:", error);
    });


/* ==================================================
   로그인 상태에 따른 Header 변경
================================================== */

function updateHeader() {

    const accessToken = sessionStorage.getItem("access_token");

    const loginLink = document.getElementById("loginLink");
    const signupArea = document.getElementById("signupArea");

    if (!accessToken) {
        return;
    }

    /* 로그인 → 로그아웃 */
    if (loginLink) {
        loginLink.textContent = "로그아웃";
        loginLink.href = "#";

        loginLink.addEventListener("click", function (event) {
            event.preventDefault();
            logout();
        });
    }

    /* 회원가입 숨기기 */
    if (signupArea) {
        signupArea.style.display = "none";
    }
}


/* ==================================================
   로그아웃
================================================== */

function logout() {

    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("user");

    alert("로그아웃되었습니다.");

    location.href = "main.html";
}


/* ==================================================
   AI CHATBOT
================================================== */

const chatbotButton =
    document.getElementById("chatbotButton");

const chatbotWindow =
    document.getElementById("chatbotWindow");

const chatbotClose =
    document.getElementById("chatbotClose");

const chatbotInput =
    document.getElementById("chatbotInput");

const chatbotSend =
    document.getElementById("chatbotSend");

const chatbotBody =
    document.querySelector(".chatbot-body");


/* ==================================================
   챗봇 열기 / 닫기
================================================== */
if(chatbotButton && chatbotWindow) { // 챗봇 창이 존재할 때(창이 없는 곳에서의 오류 방지)
    chatbotButton.addEventListener(
        "click",
        function () {

            chatbotWindow.classList.toggle(
                "active"
            );

            if (
                chatbotWindow.classList.contains(
                    "active"
                )
            ) {

                chatbotInput.focus();

            }

        }
    );
}

/* ==================================================
   챗봇 닫기
================================================== */
if(chatbotButton && chatbotWindow) {
    chatbotClose.addEventListener(
        "click",
        function () {

            chatbotWindow.classList.remove(
                "active"
            );

        }
    );
}

/* ==================================================
   세션 ID
================================================== */

// let chatbotSessionId =
//     localStorage.getItem(
//         "basebot_chat_session_id"
//     );

let chatbotSessionId = null;

/* ==================================================
   사용자 메시지
================================================== */

function addUserMessage(
    message
) {

    const messageElement =
        document.createElement("div");


    messageElement.className =
        "chatbot-message user";


    const content =
        document.createElement("div");


    content.className =
        "message-content";


    content.textContent =
        message;


    messageElement.appendChild(
        content
    );


    chatbotBody.appendChild(
        messageElement
    );


    scrollChatToBottom();
}


/* ==================================================
   AI 메시지
================================================== */

function addBotMessage(
    message
) {

    const messageElement =
        document.createElement("div");

    messageElement.className =
        "chatbot-message bot";

    const icon =
        document.createElement("div");

    icon.className =
        "message-icon";

    icon.textContent =
        "AI";

    const content =
        document.createElement("div");

    content.className =
        "message-content";

    content.textContent =
        message;

    messageElement.appendChild(
        icon
    );

    messageElement.appendChild(
        content
    );

    chatbotBody.appendChild(
        messageElement
    );

    scrollChatToBottom();
}


/* ==================================================
   로딩
================================================== */

function addLoadingMessage() {

    const messageElement =
        document.createElement("div");

    messageElement.id =
        "chatbotLoading";

    messageElement.className =
        "chatbot-message bot";

    messageElement.innerHTML = `
        <div class="message-icon">
            AI
        </div>

        <div class="message-content">
            답변을 생각하고 있어요...
        </div>
    `;

    chatbotBody.appendChild(
        messageElement
    );

    scrollChatToBottom();
}


/* ==================================================
   로딩 제거
================================================== */

function removeLoadingMessage() {

    const loading =
        document.getElementById(
            "chatbotLoading"
        );

    if (loading) {

        loading.remove();

    }
}


/* ==================================================
   스크롤
================================================== */

function scrollChatToBottom() {

    chatbotBody.scrollTop =
        chatbotBody.scrollHeight;
}


/* ==================================================
   메시지 전송
================================================== */

async function sendChatMessage() {
    const message = chatbotInput.value.trim();

    if (!message) {
        return;
    }


    /* 사용자 메시지 출력 */
    addUserMessage(
        message
    );

    /* 입력창 초기화 */
    chatbotInput.value = "";

    /* 로딩 */
    addLoadingMessage();

    try {
        const response =
            await fetch(
                "/chat",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        message: message,
                        session_id:
                            chatbotSessionId,
                        user_id: null
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                "챗봇 API 요청 실패"
            );
        }

        const data = await response.json();

        /* 세션 ID 저장 */
        chatbotSessionId =
            data.session_id;

        // localStorage.setItem(
        //     "basebot_chat_session_id",
        //     chatbotSessionId
        // );

        removeLoadingMessage();

        /* AI 답변 */
        addBotMessage(
            data.answer
        );

    } catch (error) {

        console.error(
            "AI 챗봇 오류:",
            error
        );

        removeLoadingMessage();

        addBotMessage(
            "죄송합니다. 현재 AI 챗봇과 연결할 수 없습니다."
        );
    }
}


/* ==================================================
   전송 버튼
================================================== */
if(chatbotSend) {
    chatbotSend.addEventListener(
        "click",
        sendChatMessage
    );
}

/* ==================================================
   Enter
================================================== */
if(chatbotInput) {
    chatbotInput.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key === "Enter"
            ) {

                event.preventDefault();

                sendChatMessage();

            }

        }
    );
}

/* ==================================================
   경기 결과 불러오기
================================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        /* 경기 데이터 로드 */
        fetchMainGames();

    }
);


/* ==================================================
   경기 데이터 조회
================================================== */

async function fetchMainGames() {

    try {

        /* 2024-04-15 경기 결과 및 일정 조회 */
        const res =
            await fetch(
                "http://127.0.0.1:8000/api/games?date=2024-04-15&limit=6"
            );


        if (!res.ok) {
            return;
        }


        const games =
            await res.json();


        renderTodayGames(
            games
        );


        renderGameResults(
            games
        );


    } catch (err) {

        console.error(
            "메인 경기 데이터 로드 실패:",
            err
        );

    }
}


/* ==================================================
   오늘의 경기 카드 영역 렌더링
================================================== */

function renderTodayGames(
    games
) {

    const container =
        document.querySelector(
            ".game-list"
        );


    if (
        !container ||
        games.length === 0
    ) {
        return;
    }


    container.innerHTML = "";


    games
        .slice(0, 3)
        .forEach(g => {

            const timeStr =
                new Date(
                    g.game_date
                ).toLocaleTimeString(
                    [],
                    {
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                );


            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "game-card";


            card.innerHTML = `
                <div class="game-info">
                    ${timeStr}
                </div>

                <div class="game-team">
                    <span>
                        ${g.away_team_code}
                    </span>

                    <strong>
                        VS
                    </strong>

                    <span>
                        ${g.home_team_code}
                    </span>
                </div>

                <div class="game-status">
                    ${g.status}
                </div>
            `;


            container.appendChild(
                card
            );

        });
}


/* ==================================================
   경기 결과 영역 렌더링
================================================== */

function renderGameResults(
    games
) {

    const container =
        document.querySelector(
            ".result-list"
        );


    if (
        !container ||
        games.length === 0
    ) {
        return;
    }


    container.innerHTML = "";


    /* DB의 ENUM 값인 "FINAL"로 비교 */
    const finishedGames =
        games
            .filter(
                g => g.status === "FINAL"
            )
            .slice(0, 3);


    finishedGames.forEach(
        g => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "result-item";


            item.innerHTML = `
                <span>
                    ${g.away_team_name}
                </span>

                <strong>
                    ${g.away_score} : ${g.home_score}
                </strong>

                <span>
                    ${g.home_team_name}
                </span>
            `;


            container.appendChild(
                item
            );

        }
    );
}