document.addEventListener("DOMContentLoaded", () => {
    loadMainGameResults();
});


const MAIN_RESULTS_MAX = 15;      // 스크롤로 볼 수 있는 최대 경기 수
const MAIN_RESULTS_VISIBLE = 4;   // 한 번에 보이는 경기 수 (나머지는 스크롤)

// ==================================================
// 메인 경기 결과 조회
// DB(정규시즌) 최근 경기 + MLB 포스트시즌 끝난 경기를 합쳐 최신순
// ==================================================
async function loadMainGameResults() {
    const list = document.getElementById("main-game-results-list");

    if (!list) return;

    try {
        const response = await fetch(`/api/games?status=FINAL&limit=${MAIN_RESULTS_MAX}`, {   // 일정·결과와 같은 DB 경기 API
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("경기 결과 조회 실패");
        }

        const dbGames = (await response.json()).map(game => ({
            ...game,
            home_team_logo: game.home_logo_url,
            away_team_logo: game.away_logo_url,
            sort_key: `${String(game.game_date).slice(0, 10)}T${game.game_time || "00:00:00"}`   // UTC 시작 시각 (정렬용)
        }));
        const postseasonGames = await fetchFinishedPostseasonGames(dbGames[0]);

        renderMainGameResults(
            [...dbGames, ...postseasonGames]
                .sort((a, b) => b.sort_key.localeCompare(a.sort_key))   // 최신 경기가 위로
                .slice(0, MAIN_RESULTS_MAX)
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
// MLB 포스트시즌 끝난 경기 (DB에 없어서 MLB 공식 API에서 바로)
// DB 최근 경기의 시즌만 확인 → 우리 DB에 없는 시즌은 가져오지 않음
// ==================================================
async function fetchFinishedPostseasonGames(latestDbGame) {
    if (!latestDbGame) return [];
    const season = String(latestDbGame.game_date).slice(0, 4);
    const ROUND_SHORT = { F: "WC", D: "DS", L: "CS", W: "WS" };
    try {
        const response = await fetch(
            `https://statsapi.mlb.com/api/v1/schedule/postseason/series?season=${season}&sportId=1`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!response.ok) return [];
        const data = await response.json();
        const logo = teamId => `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
        return (data.series || [])
            .flatMap(series => series.games || [])
            .filter(game => game.status?.abstractGameState === "Final"
                && !["Cancelled", "Postponed", "Suspended"].includes(game.status?.detailedState))   // 연기·취소된 경기(0:0) 제외
            .map(game => ({
                game_id: game.gamePk,
                game_date: game.gameDate.slice(0, 10),                         // UTC 날짜 (DB 경기와 같은 기준)
                status: "FINAL",
                series_label: `${ROUND_SHORT[game.gameType] || "PS"} ${game.seriesGameNumber}차전`,   // 예: "WS 7차전"
                home_team_id: game.teams.home.team.id,
                home_team_name: game.teams.home.team.name,
                home_team_logo: logo(game.teams.home.team.id),
                home_score: game.teams.home.score,
                away_team_id: game.teams.away.team.id,
                away_team_name: game.teams.away.team.name,
                away_team_logo: logo(game.teams.away.team.id),
                away_score: game.teams.away.score,
                sort_key: game.gameDate.slice(0, 19)
            }));
    } catch (error) {
        console.warn("MLB 포스트시즌 경기를 불러오지 못해 DB 경기만 표시합니다.", error);
        return [];
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

    list.innerHTML = games.slice(0, MAIN_RESULTS_MAX).map(game => {
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
        // 진 구단은 로고·이름을 살짝 흐리게 (일정·결과 카드와 같음, 너무 흐리지 않게)
        const loserStyle = ' style="opacity:.55;filter:grayscale(.6)"';
        const homeTeamStyle = awayWin ? loserStyle : "";
        const awayTeamStyle = homeWin ? loserStyle : "";

        // 점수 밑 경기 상태 (일정·결과 페이지와 같은 문구, 값이 없으면 '경기 종료')
        const STATUS_LABELS = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" };
        const statusLabel = escapeGameHtml(game.series_label || STATUS_LABELS[game.status] || "경기 종료");   // 포스트시즌은 "WS 7차전"

        // 오른쪽 날짜 칸: "2026-09-27" → "09.27" (뉴스·공지 목록처럼 맨 오른쪽)
        const gameDate = escapeGameHtml(
            String(game.game_date || "").slice(5, 10).replace("-", ".")
        );

        // 박스스코어(경기 상세) 페이지 주소 - 경기 일정 페이지와 같은 형식
        const detailUrl = `/game-detail.html?${new URLSearchParams({ id: game.game_id })}`;   // 경기 번호만

        return `
            <a class="result-item" href="${escapeGameHtml(detailUrl)}">

                <div class="result-team"${homeTeamStyle}>
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

                <div class="result-team"${awayTeamStyle}>
                    ${renderTeamLogo(awayLogo, awayName)}

                    <span title="${awayName}">
                        ${awayName}
                    </span>
                </div>

                <span class="result-date">${gameDate}</span>

            </a>
        `;
    }).join("");

    // 4경기만 보이고 나머지는 스크롤 (상자 높이 = 위 4줄 높이)
    const rows = [...list.querySelectorAll(".result-item")];
    if (rows.length > MAIN_RESULTS_VISIBLE) {
        list.style.maxHeight = `${rows.slice(0, MAIN_RESULTS_VISIBLE).reduce((sum, row) => sum + row.offsetHeight, 0)}px`;
        list.style.overflowY = "auto";
    } else {
        list.style.maxHeight = "";
        list.style.overflowY = "";
    }
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