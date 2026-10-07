const MLB_STATS_API = "https://statsapi.mlb.com/api/v1.1/game";
const params = new URLSearchParams(location.search);
const gameId = params.get("id");
const gameDate = params.get("date") || "2024-04-01";
let selectedGame = null;

const escapeHtml = value => String(value ?? "-").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const formatStatus = status => ({ FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" })[status] || status || "상태 정보 없음";

async function loadGame() {
    if (!gameId) {
        showPageError("경기 정보가 없습니다. 경기 일정·결과 페이지에서 경기를 선택해 주세요.");
        return;
    }

    try {
        const response = await fetch(`/api/games?date=${encodeURIComponent(gameDate)}&limit=100`);
        if (!response.ok) throw new Error(`경기 조회 API 오류 (${response.status})`);
        const games = await response.json();
        selectedGame = games.find(game => String(game.game_id) === String(gameId));
        if (!selectedGame) throw new Error("선택한 경기 정보를 DB에서 찾지 못했습니다.");
        renderGameSummary(selectedGame);
        if (selectedGame.status !== "FINAL") {
            document.querySelectorAll(".boxscore-section, .detail-tabs").forEach(section => section.hidden = true);
            const notice = document.getElementById("boxscore-notice");
            notice.textContent = "경기 종료 후 박스스코어를 확인할 수 있습니다.";
            notice.hidden = false;
            return;
        }
        await loadMlbBoxscore(selectedGame.game_id);
    } catch (error) {
        console.error(error);
        showPageError(error.message || "경기 정보를 불러오지 못했습니다.");
    }
}

function renderGameSummary(game) {
    document.title = `${game.away_team_code} @ ${game.home_team_code} - BASEBOT`;
    document.getElementById("game-date").textContent = game.game_date || gameDate;
    document.getElementById("game-venue").textContent = "MLB 정규시즌";
    document.getElementById("game-status").textContent = formatStatus(game.status);
    document.getElementById("away-team-name").textContent = game.away_team_name;
    document.getElementById("home-team-name").textContent = game.home_team_name;
    document.getElementById("away-score").textContent = game.away_score ?? "-";
    document.getElementById("home-score").textContent = game.home_score ?? "-";
    document.getElementById("away-pitcher").textContent = "상세 기록 불러오는 중";
    document.getElementById("home-pitcher").textContent = "상세 기록 불러오는 중";
    setTeamLogo("away", game.away_logo_url, game.away_team_code);
    setTeamLogo("home", game.home_logo_url, game.home_team_code);
}

function setTeamLogo(side, url, code) {
    const mark = document.getElementById(`${side}-mark`);
    const logo = document.getElementById(`${side}-logo`);
    logo.src = url || "";
    logo.alt = `${side === "away" ? selectedGame.away_team_name : selectedGame.home_team_name} logo`;
    logo.onerror = () => {
        mark.textContent = code || "MLB";
        mark.classList.add("team-mark-fallback");
    };
}

async function loadMlbBoxscore(id) {
    try {
        const response = await fetch(`${MLB_STATS_API}/${encodeURIComponent(id)}/feed/live`);
        if (!response.ok) throw new Error(`MLB 상세 기록 API 오류 (${response.status})`);
        const feed = await response.json();
        const live = feed.liveData || {};
        const boxscore = live.boxscore?.teams;
        if (!boxscore?.away || !boxscore?.home) throw new Error("MLB 상세 기록이 아직 제공되지 않습니다.");
        const gameInfo = feed.gameData || {};
        const venue = gameInfo.venue?.name;
        if (venue) document.getElementById("game-venue").textContent = venue;
        const originalDate = gameInfo.datetime?.originalDate;
        if (originalDate) document.getElementById("game-date").textContent = originalDate;
        renderInnings(live.linescore, boxscore);
        renderTeamStats(boxscore);
        renderTeamAdvancedStats(boxscore);
    } catch (error) {
        console.error(error);
        showStatsUnavailable(error.message || "MLB 박스스코어를 불러오지 못했습니다.");
    }
}

function renderTeamAdvancedStats(boxscore) {
    const rows = ["away", "home"].map(side => {
        const batting = boxscore[side].teamStats?.batting || {};
        return `<tr><td class="team-cell">${escapeHtml(selectedGame[`${side}_team_name`])}</td><td>${escapeHtml(batting.avg)}</td><td>${escapeHtml(batting.obp)}</td><td>${escapeHtml(batting.slg)}</td><td>${escapeHtml(batting.ops)}</td><td>${escapeHtml(batting.homeRuns)}</td><td>${escapeHtml(batting.baseOnBalls)}</td><td>${escapeHtml(batting.strikeOuts)}</td></tr>`;
    });
    document.getElementById("team-stat-body").innerHTML = rows.join("");
}

function playerDetailUrl(playerId) {
    if (!playerId) return "";
    return `player-detail.html?id=${encodeURIComponent(playerId)}`;
}

function playerHeadshotUrl(playerId) {
    if (!playerId) return "";
    return `https://img.mlbstatic.com/mlb-photos/image/upload/w_64,q_auto:best/v1/people/${encodeURIComponent(playerId)}/headshot/67/current`;
}

function bindPlayerHeadshotFallback(container) {
    container.querySelectorAll(".boxscore-player-headshot").forEach(image => {
        image.addEventListener("error", () => image.remove(), { once: true });
    });
}

function setPlayerLink(element, player) {
    const name = player?.person?.fullName || "-";
    const url = playerDetailUrl(player?.person?.id);
    element.textContent = name;
    if (url) {
        element.href = url;
    } else {
        element.removeAttribute("href");
    }
}

function renderInnings(linescore, boxscore) {
    const innings = linescore?.innings || [];
    if (!innings.length) {
        document.getElementById("inning-head").innerHTML = "";
        document.getElementById("inning-body").innerHTML = `<tr><td colspan="2">이닝별 기록이 제공되지 않습니다.</td></tr>`;
        return;
    }
    const labels = innings.map(inning => `<th>${inning.num}</th>`).join("");
    document.getElementById("inning-head").innerHTML = `<tr><th>팀</th>${labels}<th>득점</th><th>안타</th><th>실책</th><th>잔루</th></tr>`;
    document.getElementById("inning-body").innerHTML = ["away", "home"].map(side => {
        const team = selectedGame[`${side}_team_code`];
        const totals = linescore.teams?.[side] || {};
        const runs = innings.map(inning => inning[side]?.runs ?? (side === "home" && inning.isTopInning ? "" : "-")).map(value => `<td>${value}</td>`).join("");
        const fallbackTotals = boxscore[side].teamStats?.batting || {};
        return `<tr><td class="team-cell">${escapeHtml(team)}</td>${runs}<td>${totals.runs ?? selectedGame[`${side}_score`] ?? "-"}</td><td>${totals.hits ?? fallbackTotals.hits ?? "-"}</td><td>${totals.errors ?? "-"}</td><td>${totals.leftOnBase ?? "-"}</td></tr>`;
    }).join("");
}

function renderTeamStats(boxscore) {
    window.currentBoxscore = boxscore;
    const sides = ["away", "home"];
    sides.forEach(side => {
        const box = boxscore[side];
        const players = box.players || {};
        const battingOrder = (box.battingOrder || []).map((id, index) => ({ player: players[`ID${id}`], index }))
            .filter(item => item.player)
            .sort((a, b) => Number(a.player.battingOrder || a.index) - Number(b.player.battingOrder || b.index));
        const pitchers = (box.pitchers || []).map(id => players[`ID${id}`]).filter(Boolean);
        setPlayerLink(document.getElementById(`${side}-pitcher`), pitchers[0]);
        document.getElementById(`${side}-lineup-title`).textContent = `${selectedGame[`${side}_team_name`]} 선발 라인업`;
        const lineup = document.getElementById(`${side}-lineup`);
        lineup.innerHTML = battingOrder.map(({ player }) => {
            const name = player.person?.fullName || "선수 정보 없음";
            const href = playerDetailUrl(player.person?.id);
            const headshot = playerHeadshotUrl(player.person?.id);
            const photo = headshot ? `<img class="boxscore-player-headshot" src="${escapeHtml(headshot)}" alt="" aria-hidden="true" loading="lazy">` : "";
            const playerName = href
                ? `<a class="player-profile-link" href="${escapeHtml(href)}">${photo}<span>${escapeHtml(name)}</span></a>`
                : escapeHtml(name);
            const number = player.jerseyNumber ? ` #${escapeHtml(player.jerseyNumber)}` : "";
            return `<li><span>${playerName}${number}</span><span>${escapeHtml(player.position?.abbreviation)}</span></li>`;
        }).join("") || `<li><span>라인업 정보 없음</span></li>`;
        bindPlayerHeadshotFallback(lineup);
        box._battingRows = battingOrder.map(({ player }, index) => ({
            playerId: player.person?.id,
            cells: makeBatterRow(player, index)
        }));
        box._pitchingRows = pitchers.map(player => ({ playerId: player.person?.id, cells: makePitcherRow(player) }));
    });

    setupTeamSwitch("batting-team-switch", "batters", "batter-body", 17);
    setupTeamSwitch("pitching-team-switch", "pitchers", "pitcher-body", 12);
}

function makeBatterRow(player, index) {
    const stat = player.stats?.batting || {};
    const average = stat.avg || (Number(stat.atBats) > 0 ? (Number(stat.hits || 0) / Number(stat.atBats)).toFixed(3).replace(/^0/, "") : "-");
    return [index + 1, player.person?.fullName, player.position?.abbreviation, stat.atBats, stat.hits, stat.doubles, stat.triples, stat.homeRuns, stat.rbi, stat.runs, stat.baseOnBalls, stat.strikeOuts, stat.leftOnBase, average, stat.obp, stat.slg, stat.ops];
}

function makePitcherRow(player) {
    const stat = player.stats?.pitching || {};
    return [player.person?.fullName, stat.inningsPitched, stat.numberOfPitches, stat.battersFaced, stat.hits, stat.runs, stat.earnedRuns, stat.baseOnBalls, stat.strikeOuts, stat.homeRuns, stat.era, stat.whip];
}

function setupTeamSwitch(containerId, group, bodyId, columns) {
    const container = document.getElementById(containerId);
    const sides = ["away", "home"];
    sides.forEach((side, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = selectedGame[`${side}_team_code`];
        button.classList.toggle("active", index === 0);
        button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
        button.addEventListener("click", () => {
            container.querySelectorAll("button").forEach(item => {
                item.classList.toggle("active", item === button);
                item.setAttribute("aria-pressed", item === button ? "true" : "false");
            });
            renderRows(group, side, bodyId, columns);
        });
        container.appendChild(button);
    });
    renderRows(group, "away", bodyId, columns);
}

function renderRows(group, side, bodyId, columns) {
    const tableRows = group === "batters" ? getBoxRows(side, "batting") : getBoxRows(side, "pitching");
    document.getElementById(bodyId).innerHTML = tableRows.length
        ? tableRows.map(row => {
            const cells = Array.isArray(row) ? row : row.cells;
            const playerColumn = group === "batters" ? 1 : 0;
            return `<tr>${cells.map((value, index) => {
                const isPlayerName = index === playerColumn;
                const className = isPlayerName ? "player-name-cell" : "";
                const href = isPlayerName ? playerDetailUrl(row.playerId) : "";
                const headshot = isPlayerName ? playerHeadshotUrl(row.playerId) : "";
                const content = href
                    ? `<a class="player-profile-link" href="${escapeHtml(href)}">${headshot ? `<img class="boxscore-player-headshot" src="${escapeHtml(headshot)}" alt="" aria-hidden="true" loading="lazy">` : ""}<span>${escapeHtml(value)}</span></a>`
                    : escapeHtml(value);
                return `<td class="${className}">${content}</td>`;
            }).join("")}</tr>`;
        }).join("")
        : `<tr><td colspan="${columns}">이 경기의 ${group === "batters" ? "타자" : "투수"} 기록이 없습니다.</td></tr>`;
    bindPlayerHeadshotFallback(document.getElementById(bodyId));
}

function getBoxRows(side, type) {
    const box = window.currentBoxscore?.[side];
    if (box) return type === "batting" ? box._battingRows || [] : box._pitchingRows || [];
    return [];
}

function showStatsUnavailable(message) {
    document.getElementById("inning-head").innerHTML = "";
    document.getElementById("inning-body").innerHTML = `<tr><td>${escapeHtml(message)} 이닝별 상세 기록은 MLB Stats API에서 가져옵니다.</td></tr>`;
    document.getElementById("batter-body").innerHTML = `<tr><td colspan="17">상세 타자 기록을 가져오지 못했습니다.</td></tr>`;
    document.getElementById("pitcher-body").innerHTML = `<tr><td colspan="12">상세 투수 기록을 가져오지 못했습니다.</td></tr>`;
    ["away-pitcher", "home-pitcher"].forEach(id => {
        const pitcher = document.getElementById(id);
        pitcher.textContent = "-";
        pitcher.removeAttribute("href");
    });
    document.getElementById("team-stat-body").innerHTML = `<tr><td colspan="8">팀 타격 지표를 가져오지 못했습니다.</td></tr>`;
}

function showPageError(message) {
    document.getElementById("game-status").textContent = "조회 오류";
    document.getElementById("game-date").textContent = message;
    showStatsUnavailable(message);
}

document.querySelectorAll(".tab-button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === button.dataset.tab));
}));

loadGame();
