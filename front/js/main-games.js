
/* ==================================================
   메인 페이지 "오늘의 경기" 데이터 연동
   - 팀 로고 및 풀네임 표시
   - 경기 시작까지 남은 시간 표시
   - 남은 시간 1초마다 자동 갱신
================================================== */

// console.log("✅ main-games.js 파일 실행됨");

document.addEventListener("DOMContentLoaded", () => {
    // console.log("✅ DOMContentLoaded 실행됨");
    // console.log(
    //     "game-list 요소:",
    //     document.querySelector(".game-list")
    // );


    loadMainTodayGames();

    setInterval(updateMainGameCountdowns, 1000);
});


/* ==================================================
   오늘의 경기 조회
================================================== */

async function loadMainTodayGames() {
    const container = document.querySelector(".game-list");

    // 경기 일정 페이지와 구분
    if (!container || container.id === "game-list") return;

    try {
        const today = getLocalDateString();

        let response = await fetch(
            `/api/games/main?date=${today}&limit=3`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error(`경기 조회 실패: ${response.status}`);
        }

        let games = await response.json();

        // console.log("오늘의 경기 API 응답:", games);
        // console.table(games);

        // 오늘 경기가 없으면 다가오는 경기 조회
        if (!Array.isArray(games) || games.length === 0) {
            response = await fetch(
                "/api/games/main?limit=3",
                { cache: "no-store" }
            );

            if (!response.ok) {
                throw new Error(`경기 조회 실패: ${response.status}`);
            }

            games = await response.json();
        }

        if (!Array.isArray(games) || games.length === 0) {
            container.innerHTML = `
                <div class="game-empty-message">
                    예정된 경기가 없습니다.
                </div>
            `;
            return;
        }

        container.innerHTML = "";

        games.forEach(game => {
            const card = document.createElement("div");
            card.className = "game-card";

            // 날짜 및 시간 정규화
            const gameDate = normalizeGameDate(game.game_date);
            const gameTime = normalizeGameTime(game.game_time);

            // 실제 경기 상태 저장
            card.dataset.gameStatus = game.status || "SCHEDULED";

            const awayName =
                game.away_team_name || game.away_team_code || "원정팀";

            const homeName =
                game.home_team_name || game.home_team_code || "홈팀";

            // 팀 로고
            const awayLogo = createTeamLogo(
                game.away_logo_url,
                awayName
            );

            const homeLogo = createTeamLogo(
                game.home_logo_url,
                homeName
            );

            card.innerHTML = `
                <div class="game-info">
                    <span
                        class="game-countdown"
                        data-game-date="${gameDate}"
                        data-game-time="${gameTime}"
                    ></span>
                </div>

                <div class="game-team"
                     style="
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 10px;
                     ">

                    <span style="
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                    ">
                        ${awayLogo}
                        <span class="team-name"></span>
                    </span>

                    <strong>VS</strong>

                    <span style="
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                    ">
                        ${homeLogo}
                        <span class="team-name"></span>
                    </span>
                </div>

                <div class="game-status"></div>
            `;

            // 팀 이름은 textContent로 삽입
            const teamNames = card.querySelectorAll(".team-name");
            teamNames[0].textContent = awayName;
            teamNames[1].textContent = homeName;

            // 상태 표시
            updateGameStatus(card, game);

            container.appendChild(card);
        });

        // 첫 표시 즉시 실행
        updateMainGameCountdowns();

    } catch (error) {
        console.error("메인 경기 로드 오류:", error);

        container.innerHTML = `
            <div class="game-empty-message">
                경기 정보를 불러오지 못했습니다.
            </div>
        `;
    }
}


/* ==================================================
   팀 로고 생성
================================================== */

function createTeamLogo(url, teamName) {
    if (!url) return "";

    const img = document.createElement("img");
    img.src = url;
    img.alt = teamName;
    img.width = 22;
    img.height = 22;
    img.style.objectFit = "contain";
    img.style.verticalAlign = "middle";

    img.onerror = () => img.remove();

    // HTML 문자열에 URL을 직접 삽입하지 않음
    return img.outerHTML;
}


/* ==================================================
   날짜 정규화
================================================== */

function normalizeGameDate(value) {
    if (!value) return "";

    // YYYY-MM-DD 또는 YYYY-MM-DD HH:mm:ss
    // YYYY-MM-DDTHH:mm:ss 형식 지원
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

    return match ? match[1] : "";
}


/* ==================================================
   시간 정규화
================================================== */

function normalizeGameTime(value) {
    if (!value) return "";

    const time = String(value).trim();

    // ISO 날짜·시간 전체가 넘어오는 경우
    const isoMatch = time.match(
        /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2})?)/
    );

    const normalized = isoMatch
        ? isoMatch[1]
        : time.match(/^(\d{2}:\d{2}(?::\d{2})?)/)?.[1] || "";

    // HH:mm이면 초를 보충
    return normalized.length === 5
        ? `${normalized}:00`
        : normalized;
}


/* ==================================================
   현재 날짜 (브라우저 현지 시간 기준)
================================================== */

function getLocalDateString() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


/* ==================================================
   경기 상태 표시
================================================== */

function updateGameStatus(card, game) {
    const statusElement = card.querySelector(".game-status");

    if (!statusElement) return;

    const status = game.status || "SCHEDULED";

    if (status === "FINAL") {
        statusElement.textContent =
            `경기 종료 (${game.away_score ?? 0} : ${game.home_score ?? 0})`;
    } else if (status === "IN_PROGRESS") {
        statusElement.textContent =
            `경기 진행 중 (${game.away_score ?? 0} : ${game.home_score ?? 0})`;
    } else if (status === "CANCELLED") {
        statusElement.textContent = "경기 취소";
    } else {
        statusElement.textContent = "경기 예정";
    }
}


/* ==================================================
   경기 시작까지 남은 시간 자동 갱신
================================================== */

function updateMainGameCountdowns() {
    const countdowns = document.querySelectorAll(".game-countdown");

    countdowns.forEach((countdown) => {
        const gameDate = countdown.dataset.gameDate;
        const gameTime = countdown.dataset.gameTime;
        const status = countdown.dataset.gameStatus;

        // 경기 날짜 또는 시간이 없는 경우
        if (!gameDate || !gameTime) {
            countdown.textContent = "경기 시간 미정";
            return;
        }

        // 이미 시작했거나 종료된 경기
        if (["FINAL", "IN_PROGRESS", "CANCELLED"].includes(status)) {
            countdown.textContent = "";
            countdown.style.display = "none";
            return;
        }

        const targetTime = new Date(`${gameDate}T${gameTime}`);
        const now = new Date();

        if (Number.isNaN(targetTime.getTime())) {
            countdown.textContent = "경기 시간 확인 불가";
            return;
        }

        const remaining = targetTime.getTime() - now.getTime();

        if (remaining <= 0) {
            countdown.textContent = "경기 시작 시간";
            return;
        }

        const totalSeconds = Math.floor(remaining / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let text = "";

        if (days > 0) {
            text = `${days}일 ${hours}시간 ${minutes}분 후 시작`;
        } else if (hours > 0) {
            text = `${hours}시간 ${minutes}분 ${seconds}초 후 시작`;
        } else {
            text = `${minutes}분 ${seconds}초 후 시작`;
        }

        countdown.textContent = text;
        countdown.style.display = "";
    });
}
