/* ==================================================
   관심 팀 페이지
================================================== */

document.addEventListener("DOMContentLoaded", () => {
    loadFavoriteTeam();
});


/* HTML에 표시할 문자열 이스케이프 */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}


/* 날짜 표시 */
function formatGameDate(dateValue) {
    if (!dateValue) {
        return "-";
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
}


/* 경기 상태 표시 */
function getGameStatus(status) {
    const statusMap = {
        SCHEDULED: "경기 예정",
        IN_PROGRESS: "경기 중",
        FINAL: "경기 종료",
        CANCELLED: "경기 취소"
    };

    return statusMap[status] || status || "상태 미정";
}


/* 관심 팀 정보 조회 */
async function loadFavoriteTeam() {
    const teamInfo = document.getElementById("favorite-team-info");
    const teamSetting = document.getElementById("favorite-team-setting");
    const gamesContainer = document.getElementById("favorite-team-games");

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        teamInfo.innerHTML = `
            <h2>로그인이 필요합니다.</h2>
            <p>로그인 후 관심 팀을 확인할 수 있습니다.</p>
        `;

        gamesContainer.innerHTML = `
            <div class="mypage-empty">
                로그인 후 관심 팀의 최근 경기를 확인할 수 있습니다.
            </div>
        `;

        return;
    }

    try {
        const response = await fetch("/mypage/favorite-team", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            teamInfo.innerHTML = `
                <h2>로그인이 만료되었습니다.</h2>
                <p>다시 로그인해주세요.</p>
            `;

            gamesContainer.innerHTML = `
                <div class="mypage-empty">
                    로그인 후 최근 경기 정보를 확인할 수 있습니다.
                </div>
            `;

            return;
        }

        if (!response.ok) {
            throw new Error(`관심 팀 조회 실패: ${response.status}`);
        }

        const data = await response.json();

        // 관심 팀이 없는 경우
        if (!data.favorite_team) {
            teamInfo.innerHTML = `
                <h2>관심 팀이 없습니다.</h2>
                <p>회원정보 수정에서 관심 팀을 선택해주세요.</p>
            `;

            teamSetting.style.display = "inline-flex";

            gamesContainer.innerHTML = `
                <div class="mypage-empty">
                    관심 팀을 설정하면 최근 경기 결과가 표시됩니다.
                </div>
            `;

            return;
        }

        // 관심 팀 출력
        renderFavoriteTeam(data.favorite_team);

        // 최근 경기 출력
        renderRecentGames(data.recent_games || []);

    } catch (error) {
        console.error("관심 팀 조회 오류:", error);

        teamInfo.innerHTML = `
            <h2>관심 팀 정보를 불러오지 못했습니다.</h2>
            <p>잠시 후 다시 시도해주세요.</p>
        `;

        gamesContainer.innerHTML = `
            <div class="mypage-empty">
                최근 경기 정보를 불러오지 못했습니다.
            </div>
        `;
    }
}


/* ==================================================
   관심 팀 표시
================================================== */
function renderFavoriteTeam(team) {
    const teamInfo = document.getElementById("favorite-team-info");
    const teamSetting = document.getElementById("favorite-team-setting");

    const logoHtml = team.logo_url
        ? `
            <img
                src="${escapeHtml(team.logo_url)}"
                alt="${escapeHtml(team.team_name)} 로고"
                class="favorite-team-logo"
                onerror="this.style.display='none'"
            >
        `
        : "";

    const location = [team.city, team.stadium]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" · ");

    teamInfo.innerHTML = `
        <div class="favorite-team-heading">
            ${logoHtml}

            <div>
                <h2>${escapeHtml(team.team_name)}</h2>
                <p>${escapeHtml(team.team_code || "")}</p>
            </div>
        </div>

        <div class="favorite-team-details">
            <p>
                <strong>리그</strong>
                ${escapeHtml(team.league || "-")}
            </p>

            <p>
                <strong>지구</strong>
                ${escapeHtml(team.division || "-")}
            </p>

            <p>
                <strong>연고지 / 홈구장</strong>
                ${location || "-"}
            </p>
        </div>
    `;

    teamSetting.style.display = "inline-flex";
}


/* ==================================================
   최근 경기 표시
================================================== */
function renderRecentGames(games) {
    const container = document.getElementById("favorite-team-games");

    if (!games.length) {
        container.innerHTML = `
            <div class="mypage-empty">
                해당 관심 팀의 경기 기록이 없습니다.
            </div>
        `;

        return;
    }

    container.innerHTML = games.map(game => {
        const resultClass = {
            WIN: "result-win",
            LOSS: "result-loss",
            DRAW: "result-draw"
        }[game.result] || "";

        const resultText = {
            WIN: "승리",
            LOSS: "패배",
            DRAW: "무승부"
        }[game.result] || "";

        const homeTeam = `
            <div class="favorite-game-team">
                ${
                    game.home_team_logo
                        ? `<img src="${escapeHtml(game.home_team_logo)}"
                                alt=""
                                class="favorite-game-logo"
                                onerror="this.style.display='none'">`
                        : ""
                }
                <span>${escapeHtml(game.home_team_code || game.home_team_name)}</span>
            </div>
        `;

        const awayTeam = `
            <div class="favorite-game-team">
                ${
                    game.away_team_logo
                        ? `<img src="${escapeHtml(game.away_team_logo)}"
                                alt=""
                                class="favorite-game-logo"
                                onerror="this.style.display='none'">`
                        : ""
                }
                <span>${escapeHtml(game.away_team_code || game.away_team_name)}</span>
            </div>
        `;

        const score = game.status === "SCHEDULED" ||
                      game.status === "CANCELLED"
            ? "-"
            : `${game.home_score} : ${game.away_score}`;

        return `
            <div class="favorite-game-item">

                <div class="favorite-game-date">
                    ${escapeHtml(formatGameDate(game.game_date))}
                    <span>${escapeHtml(getGameStatus(game.status))}</span>
                </div>

                <div class="favorite-game-match">
                    ${homeTeam}

                    <div class="favorite-game-score">
                        <strong>${escapeHtml(score)}</strong>
                    </div>

                    ${awayTeam}
                </div>

                <div class="favorite-game-result ${resultClass}">
                    ${escapeHtml(resultText)}
                </div>

            </div>
        `;
    }).join("");
}