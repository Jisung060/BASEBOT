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

        // 이긴 점수 / 진 점수 색 (일정·결과 페이지와 같음, 동점이면 기본색)
        const homeWin = Number(game.home_score) > Number(game.away_score);
        const awayWin = Number(game.away_score) > Number(game.home_score);
        const homeScoreClass = homeWin ? "winner" : awayWin ? "loser" : "";
        const awayScoreClass = awayWin ? "winner" : homeWin ? "loser" : "";

        // 점수 밑 경기 상태 (일정·결과 페이지와 같은 문구, 값이 없으면 '경기 종료')
        const STATUS_LABELS = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" };
        const statusLabel = escapeGameHtml(STATUS_LABELS[game.status] || "경기 종료");

        // 오른쪽 날짜 칸: "2026-09-27" → "09.27" (뉴스·공지 목록처럼 맨 오른쪽)
        const gameDate = escapeGameHtml(
            String(game.game_date || "").slice(5, 10).replace("-", ".")
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

                <div class="result-score-box">
                    <strong class="result-score">
                        <span class="${homeScoreClass}">${homeScore}</span> : <span class="${awayScoreClass}">${awayScore}</span>
                    </strong>
                    <small class="result-status">${statusLabel}</small>
                </div>

                <div class="result-team">
                    ${renderTeamLogo(awayLogo, awayName)}

                    <span title="${awayName}">
                        ${awayName}
                    </span>
                </div>

                <span class="result-date">${gameDate}</span>

            </a>
        `;
    }).join("");
}


// ==================================================
// 구단 로고 URL 반환
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

    // 로고 URL이 없으면 MLB 구단 ID로 생성
    const id = Number(teamId);

    if (Number.isInteger(id) && id > 0) {
        return `https://www.mlbstatic.com/team-logos/${id}.svg`;
    }

    // 구단 ID도 없으면 로고 없이 구단 이름 표시
    return "";
}


// ==================================================
// 구단 로고 HTML 생성
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