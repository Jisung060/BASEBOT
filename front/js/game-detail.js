const MLB_STATS_API = "https://statsapi.mlb.com/api/v1.1/game";
const params = new URLSearchParams(location.search);
let gameId = params.get("id");                          // 주소에 경기 번호가 없으면 아래에서 최근 경기로 채움
let gameDate = params.get("date") || "2024-04-01";
let selectedGame = null;

const escapeHtml = value => String(value ?? "-").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const formatStatus = status => ({ FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" })[status] || status || "상태 정보 없음";

async function loadGame() {
    if (!gameId) {                                      // 경기 번호 없이 들어오면 가장 최근에 끝난 경기 보여주기
        try {
            const latestResponse = await fetch("/api/games?status=FINAL&limit=1");
            if (!latestResponse.ok) throw new Error(`최근 경기 조회 API 오류 (${latestResponse.status})`);
            const [latest] = await latestResponse.json();
            if (latest) {
                gameId = latest.game_id;
                gameDate = String(latest.game_date).slice(0, 10);
                history.replaceState(null, "", `?${new URLSearchParams({ id: gameId, date: gameDate })}`); // 주소에도 표시
            }
        } catch (error) {
            console.error(error);
        }
    }

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
            document.querySelectorAll(".boxscore-section, .detail-tabs, .scoreboard-innings").forEach(section => section.hidden = true); // 이닝 표(점수 카드 안)도 숨김
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
    if (game.status === "FINAL" && game.away_score !== game.home_score) {      // 끝난 경기: 진 팀 점수 연하게
        const loser = Number(game.away_score) < Number(game.home_score) ? "away" : "home";
        document.getElementById(`${loser}-score`).classList.add("score-loser");
    }
    document.getElementById("away-pitcher").textContent = "상세 기록 불러오는 중";
    document.getElementById("home-pitcher").textContent = "상세 기록 불러오는 중";
    setTeamLogo("away", game.away_logo_url, game.away_team_code);
    setTeamLogo("home", game.home_logo_url, game.home_team_code);
    document.getElementById("away-team-link").href = `team-detail.html?id=${encodeURIComponent(game.away_team_id)}`; // 로고 → 팀 상세
    document.getElementById("home-team-link").href = `team-detail.html?id=${encodeURIComponent(game.home_team_id)}`;
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

// 두 구단 기록 비교 (막대). 안타·실책은 위 이닝 표에 있어서 넣지 않음
const TEAM_COMPARE_ITEMS = [
    ["홈런", "homeRuns", true],                         // [이름, MLB 기록 이름, 막대 표시 여부]
    ["도루", "stolenBases", true],
    ["삼진", "strikeOuts", true],
    ["볼넷", "baseOnBalls", true],
    ["병살", "groundIntoDoublePlay", true],
    ["타율", "avg", false],                             // 비율 기록은 숫자만
    ["출루율", "obp", false],
    ["장타율", "slg", false],
    ["OPS", "ops", false]
];

function renderTeamAdvancedStats(boxscore) {
    const away = boxscore.away.teamStats?.batting || {};
    const home = boxscore.home.teamStats?.batting || {};
    const bar = (value, max, side) =>                    // 큰 값 기준 길이(%)의 막대
        `<span class="compare-bar ${side}"><i style="width:${max ? Math.round(Number(value || 0) / max * 100) : 0}%"></i></span>`;

    const rows = TEAM_COMPARE_ITEMS.map(([label, key, showBar]) => {
        const a = away[key] ?? "-";
        const h = home[key] ?? "-";
        const max = Math.max(Number(a) || 0, Number(h) || 0);
        return `<div class="compare-row">
            ${showBar ? bar(a, max, "away") : "<span></span>"}
            <strong class="compare-value">${escapeHtml(a)}</strong>
            <span class="compare-label">${escapeHtml(label)}</span>
            <strong class="compare-value">${escapeHtml(h)}</strong>
            ${showBar ? bar(h, max, "home") : "<span></span>"}
        </div>`;
    }).join("");

    document.getElementById("team-compare").innerHTML = `
        <div class="compare-head">
            <span>${escapeHtml(selectedGame.away_team_name)}</span>
            <em>VS</em>
            <span>${escapeHtml(selectedGame.home_team_name)}</span>
        </div>
        ${rows}`;
}

function playerDetailUrl(playerId) {
    if (!playerId) return "";
    const season = String(gameDate).slice(0, 4);       // 이 경기의 시즌 연도 → 선수 페이지가 그 시즌 기록으로 열림
    return `player-detail.html?${new URLSearchParams({ id: playerId, season })}`;
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
    document.getElementById("inning-head").innerHTML = `<tr><th>구단</th>${labels}<th>득점</th><th>안타</th><th>실책</th><th>잔루</th></tr>`;
    document.getElementById("inning-body").innerHTML = ["away", "home"].map(side => {
        const team = selectedGame[`${side}_team_name`];       // 약자 대신 정식 이름 (예: Los Angeles Angels)
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
        document.getElementById(`${side}-lineup-title`).textContent = selectedGame[`${side}_team_name`];   // 예: Los Angeles Angels
        const lineup = document.getElementById(`${side}-lineup`);
        lineup.innerHTML = battingOrder.map(({ player }) => {
            const name = player.person?.fullName || "선수 정보 없음";
            const href = playerDetailUrl(player.person?.id);
            const headshot = playerHeadshotUrl(player.person?.id);
            const photo = headshot ? `<img class="boxscore-player-headshot" src="${escapeHtml(headshot)}" alt="" aria-hidden="true" loading="lazy">` : "";
            const number = player.jerseyNumber ? `<em class="lineup-jersey">#${escapeHtml(player.jerseyNumber)}</em>` : ""; // 등번호: 이름 바로 옆
            const playerName = href
                ? `<a class="player-profile-link" href="${escapeHtml(href)}">${photo}<span>${escapeHtml(name)}${number}</span></a>`
                : `${escapeHtml(name)}${number}`;
            return `<li><span>${playerName}</span><span>${escapeHtml(player.position?.abbreviation)}</span></li>`;
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
        const logo = document.createElement("img");                  // 구단 로고 아이콘
        logo.src = selectedGame[`${side}_logo_url`] || "";
        logo.alt = "";
        logo.onerror = () => logo.replaceWith(selectedGame[`${side}_team_code`] || "MLB");  // 로고가 없으면 약자
        button.append(logo);
        button.title = selectedGame[`${side}_team_name`];           // 마우스를 올리면 구단 이름
        button.setAttribute("aria-label", selectedGame[`${side}_team_name`]);
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
    document.getElementById("team-compare").innerHTML = `<p class="team-compare-message">팀 기록을 가져오지 못했습니다.</p>`;
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
