
/* ==================================================
   BASEBOT 공통 AI 챗봇
   파일 위치: front/js/chatbot.js

   기능:
   - 공통 챗봇 컴포넌트 초기화
   - 챗봇 열기 / 닫기
   - 사용자 메시지 및 AI 답변 표시
   - 답변 로딩 표시
   - /chat API 연결
   - 로그인 토큰 전달
   - Enter 키로 메시지 전송
================================================== */


/* ==================================================
   챗봇 세션 ID
================================================== */

// 기존 동작 유지:
// 페이지가 열려 있는 동안 같은 대화의 세션 ID를 유지한다.
// 페이지를 새로고침하면 새 대화가 시작된다.
window.chatbotSessionId = null;


/* ==================================================
   챗봇 요청 상태
================================================== */

// 답변을 기다리는 동안 중복 요청 방지
let isChatSending = false;


/* ==================================================
   챗봇 초기화
================================================== */

function initChatbot() {

    // 공통 컴포넌트가 이미 초기화되었다면 중복 실행 방지
    const chatbotRoot = document.getElementById("basebot-chatbot");

    if (!chatbotRoot || chatbotRoot.dataset.initialized === "true") {
        return;
    }

    // 컴포넌트 초기화 완료 표시
    chatbotRoot.dataset.initialized = "true";


    /* ==================================================
       AI CHATBOT DOM 요소
    ================================================== */

    const chatbotButton = chatbotRoot.querySelector("#chatbotButton");
    const chatbotWindow = chatbotRoot.querySelector("#chatbotWindow");
    const chatbotClose = chatbotRoot.querySelector("#chatbotClose");
    const chatbotInput = chatbotRoot.querySelector("#chatbotInput");
    const chatbotSend = chatbotRoot.querySelector("#chatbotSend");
    const chatbotBody = chatbotRoot.querySelector(".chatbot-body");


    // 필수 요소가 없으면 초기화 취소
    if (
        !chatbotButton ||
        !chatbotWindow ||
        !chatbotClose ||
        !chatbotInput ||
        !chatbotSend ||
        !chatbotBody
    ) {
        delete chatbotRoot.dataset.initialized;
        console.error("AI 챗봇 HTML 요소를 찾을 수 없습니다.");
        return;
    }


    /* ==================================================
       스크롤
    ================================================== */

    function scrollChatToBottom() {
        chatbotBody.scrollTop = chatbotBody.scrollHeight;
    }


    /* ==================================================
       사용자 메시지
    ================================================== */

    function addUserMessage(message) {

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

        const messageElement = document.createElement("div");
        messageElement.className = "chatbot-message bot";

        const icon = document.createElement("div");
        icon.className = "message-icon";
        icon.textContent = "AI";

        const content = document.createElement("div");
        content.className = "message-content";

        // 서버 응답을 HTML로 실행하지 않도록 textContent 사용
        content.textContent = message;

        messageElement.appendChild(icon);
        messageElement.appendChild(content);

        chatbotBody.appendChild(messageElement);

        scrollChatToBottom();
    }


    /* ==================================================
       로딩 메시지
    ================================================== */

    function addLoadingMessage() {

        // 기존 로딩 메시지가 있다면 중복 생성하지 않는다.
        if (chatbotRoot.querySelector("#chatbotLoading")) {
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

        const loading = chatbotRoot.querySelector("#chatbotLoading");

        if (loading) {
            loading.remove();
        }
    }


    /* ==================================================
       챗봇 입력 상태 변경
    ================================================== */

    function setChatInputDisabled(disabled) {
        chatbotInput.disabled = disabled;
        chatbotSend.disabled = disabled;
    }


    /* ==================================================
       챗봇 열기 / 닫기
    ================================================== */

    chatbotButton.addEventListener("click", function () {

        const isOpen = chatbotWindow.classList.toggle("active");

        chatbotButton.setAttribute("aria-expanded", String(isOpen));

        if (isOpen) {
            chatbotInput.focus();
        }
    });


    /* ==================================================
       챗봇 닫기
    ================================================== */

    chatbotClose.addEventListener("click", function () {

        chatbotWindow.classList.remove("active");
        chatbotButton.setAttribute("aria-expanded", "false");
    });


    /* ==================================================
       메시지 전송
    ================================================== */

    async function sendChatMessage() {

        // 입력창에 내용이 없으면 실행하지 않는다.
        const message = chatbotInput.value.trim();

        if (!message) {
            return;
        }

        // 요청 처리 중에는 중복 전송하지 않는다.
        if (isChatSending) {
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

            // 로그인 토큰이 있는 경우 Authorization 헤더 전달
            if (accessToken) {
                headers["Authorization"] = `Bearer ${accessToken}`;
            }

            const response = await fetch("/chat", {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    message: message,
                    session_id: window.chatbotSessionId
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
                    // JSON이 아닌 오류 응답이면 기본 메시지 사용
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
                window.chatbotSessionId = data.session_id;
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

            // 챗봇이 열려 있으면 입력창에 포커스
            if (chatbotWindow.classList.contains("active")) {
                chatbotInput.focus();
            }
        }
    }


    /* ==================================================
       전송 버튼
    ================================================== */

    chatbotSend.addEventListener("click", sendChatMessage);


    /* ==================================================
       Enter 키로 메시지 전송
    ================================================== */

    chatbotInput.addEventListener("keydown", function (event) {

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });

}


/* ==================================================
   공통 컴포넌트 로딩 감지
================================================== */

// chatbot.html은 fetch로 나중에 삽입될 수 있으므로,
// HTML이 삽입되는 시점을 감지하여 초기화한다.
function observeChatbotComponent() {

    // 컴포넌트가 이미 존재하면 바로 초기화
    if (document.getElementById("basebot-chatbot")) {
        initChatbot();
        return;
    }

    // 아직 없으면 DOM 변경을 감지
    const observer = new MutationObserver(function () {

        if (document.getElementById("basebot-chatbot")) {
            initChatbot();
            observer.disconnect();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}


// DOM이 준비된 뒤 컴포넌트 초기화 감시 시작
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeChatbotComponent);
} else {
    observeChatbotComponent();
}
