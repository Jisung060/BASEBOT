document.addEventListener("DOMContentLoaded", () => {
    loadMainGameResults();
});

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
        renderMainGameResults(data.games || []);

    } catch (error) {
        console.error("메인 경기 결과 조회 오류:", error);

        list.innerHTML = `
            <div class="game-results-message">
                경기 결과를 불러오지 못했습니다.
            </div>
        `;
    }
}

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
        const homeName = escapeGameHtml(game.home_team_name || "홈팀");
        const awayName = escapeGameHtml(game.away_team_name || "원정팀");

        const homeLogo = game.home_team_logo;
        const awayLogo = game.away_team_logo;

        return `
            <div class="result-item">
                <div class="result-team">
                    <img
                        class="result-team-logo"
                        src="${escapeGameHtml(homeLogo)}"
                        alt="${homeName} 로고"
                    >
                    <span title="${homeName}">${homeName}</span>
                </div>
        
                <strong class="result-score">
                    ${game.home_score ?? 0} : ${game.away_score ?? 0}
                </strong>
        
                <div class="result-team">
                    <img
                        class="result-team-logo"
                        src="${escapeGameHtml(awayLogo)}"
                        alt="${awayName} 로고"
                    >
                    <span title="${awayName}">${awayName}</span>
                </div>
            </div>
        `;
    }).join("");
}

function getMlbLogo(teamId) {
    return `https://www.mlbstatic.com/team-logos/${Number(teamId)}.svg`;
}

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