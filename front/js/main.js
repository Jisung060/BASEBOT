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

    // localStorage에 저장된 JWT 확인
    const accessToken =
        localStorage.getItem("access_token");


    // 로그인 링크
    const loginLink =
        document.getElementById("loginLink");

    // 회원가입 링크
    const signupLink =
        document.getElementById("signupArea");


    // 로그인하지 않은 상태
    if (!accessToken) {

        return;
    }


    // 로그인한 상태
    if (loginLink) {

        loginLink.textContent = "로그아웃";

        loginLink.href = "#";

        loginLink.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                logout();

            }
        );

    }


    // 회원가입 숨기기
    if (signupArea) {

        signupArea.style.display = "none";

    }

}


/* ==================================================
   로그아웃
================================================== */

function logout() {

    // JWT 삭제
    localStorage.removeItem("access_token");

    // 로그인 사용자 정보 삭제
    localStorage.removeItem("user");

    alert("로그아웃되었습니다.");

    // 메인 페이지로 이동
    location.href = "main.html";

}


/* ==================================================
   AI CHATBOT
================================================== */

const chatbotButton = document.getElementById("chatbotButton");
const chatbotWindow = document.getElementById("chatbotWindow");
const chatbotClose = document.getElementById("chatbotClose");


// 챗봇 열기 / 닫기
chatbotButton.addEventListener("click", function () {

    chatbotWindow.classList.toggle("active");

});


// 챗봇 닫기
chatbotClose.addEventListener("click", function () {

    chatbotWindow.classList.remove("active");

});

// 경기 결과 불러오기
document.addEventListener("DOMContentLoaded", () => {
    // 공통 컴포넌트 로드
    loadComponent("header", "components/header.html");
    loadComponent("footer", "components/footer.html");

    // 경기 데이터 로드 (2024년 정규시즌 샘플 일자 기준)
    fetchMainGames();
});

async function loadComponent(id, path) {
    try {
        const res = await fetch(path);
        if (res.ok) document.getElementById(id).innerHTML = await res.text();
    } catch(e) {}
}

async function fetchMainGames() {
    try {
        // 2024-04-15 경기 결과 및 일정 조회 (시연용 특정 일자)
        const res = await fetch("http://127.0.0.1:8000/api/games?date=2024-04-15&limit=6");
        if (!res.ok) return;
        const games = await res.json();

        renderTodayGames(games);
        renderGameResults(games);
    } catch (err) {
        console.error("메인 경기 데이터 로드 실패:", err);
    }
}

// 1. 오늘의 경기 카드 영역 렌더링
function renderTodayGames(games) {
    const container = document.querySelector(".game-list");
    if (!container || games.length === 0) return;

    container.innerHTML = "";
    games.slice(0, 3).forEach(g => {
        const timeStr = new Date(g.game_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const card = document.createElement("div");
        card.className = "game-card";
        card.innerHTML = `
            <div class="game-info">${timeStr}</div>
            <div class="game-team">
                <span>${g.away_team_code}</span>
                <strong>VS</strong>
                <span>${g.home_team_code}</span>
            </div>
            <div class="game-status">${g.status}</div>
        `;
        container.appendChild(card);
    });
}

// 경기 결과 영역 렌더링 (대문자 FINAL 매칭)
function renderGameResults(games) {
    const container = document.querySelector(".result-list");
    if (!container || games.length === 0) return;

    container.innerHTML = "";
    // DB의 ENUM 값인 "FINAL"로 비교
    const finishedGames = games.filter(g => g.status === "FINAL").slice(0, 3);

    finishedGames.forEach(g => {
        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `
            <span>${g.away_team_name}</span>
            <strong>${g.away_score} : ${g.home_score}</strong>
            <span>${g.home_team_name}</span>
        `;
        container.appendChild(item);
    });
}