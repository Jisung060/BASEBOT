document.addEventListener("DOMContentLoaded", () => {
    loadMainGameResults();
});


// ==================================================
// 메인 경기 결과 조회
// ==================================================
async function loadMainGameResults() {
    const list = document.getElementById("main-game-results-list");

    if (!list) return;

    try {
        const response = await fetch("/api/main/game-results", {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("경기 결과 조회 실패");
        }

        const data = await response.json();

        renderMainGameResults(
            Array.isArray(data.games) ? data.games : []
        );

    } catch (error) {
        console.error("메인 경기 결과 조회 오류:", error);

        list.innerHTML = `
            <div class="game-results-message">
                경기 결과를 불러오지 못했습니다.
            </div>
        `;
    }
}


// ==================================================
// 메인 경기 결과 렌더링
// ==================================================
function renderMainGameResults(games) {
    const list = document.getElementById("main-game-results-list");

    if (!list) return;

    if (games.length === 0) {
        list.innerHTML = `
            <div class="game-results-message">
                종료된 경기가 없습니다.
            </div>
        `;
        return;
    }

    list.innerHTML = games.slice(0, 3).map(game => {
        const homeName = escapeGameHtml(
            game.home_team_name || "홈팀"
        );

        const awayName = escapeGameHtml(
            game.away_team_name || "원정팀"
        );

        // API 로고 URL이 없으면 팀 ID로 로고 URL 생성
        const homeLogo = getTeamLogo(
            game.home_team_logo,
            game.home_team_id
        );

        const awayLogo = getTeamLogo(
            game.away_team_logo,
            game.away_team_id
        );

        const homeScore = escapeGameHtml(
            game.home_score ?? 0
        );

        const awayScore = escapeGameHtml(
            game.away_score ?? 0
        );

        // 박스스코어(경기 상세) 페이지 주소 - 경기 일정 페이지와 같은 형식
        const detailUrl = `/game-detail.html?${new URLSearchParams({
            id: game.game_id,
            date: String(game.game_date || "").slice(0, 10)
        })}`;

        return `
            <a class="result-item" href="${escapeGameHtml(detailUrl)}">

                <div class="result-team">
                    ${renderTeamLogo(homeLogo, homeName)}

                    <span title="${homeName}">
                        ${homeName}
                    </span>
                </div>

                <strong class="result-score">
                    ${homeScore} : ${awayScore}
                </strong>

                <div class="result-team">
                    ${renderTeamLogo(awayLogo, awayName)}

                    <span title="${awayName}">
                        ${awayName}
                    </span>
                </div>

            </a>
        `;
    }).join("");
}


// ==================================================
// 팀 로고 URL 반환
// ==================================================
function getTeamLogo(logoUrl, teamId) {
    // API에서 정상적인 로고 URL을 제공하면 우선 사용
    if (
        typeof logoUrl === "string" &&
        logoUrl.trim() !== "" &&
        /^https?:\/\//i.test(logoUrl.trim())
    ) {
        return logoUrl.trim();
    }

    // 로고 URL이 없으면 MLB 팀 ID로 생성
    const id = Number(teamId);

    if (Number.isInteger(id) && id > 0) {
        return `https://www.mlbstatic.com/team-logos/${id}.svg`;
    }

    // 팀 ID도 없으면 로고 없이 팀 이름 표시
    return "";
}


// ==================================================
// 팀 로고 HTML 생성
// ==================================================
function renderTeamLogo(logoUrl, teamName) {
    if (!logoUrl) {
        return "";
    }

    return `
        <img
            class="result-team-logo"
            src="${escapeGameHtml(logoUrl)}"
            alt="${teamName} 로고"
            loading="lazy"
            onerror="this.style.display='none';"
        >
    `;
}


// ==================================================
// HTML 특수문자 이스케이프
// ==================================================
function escapeGameHtml(value) {
    return String(value).replace(/[&<>"']/g, char => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[char];
    });
}