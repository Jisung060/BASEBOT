const params = new URLSearchParams(location.search);
let gameId = params.get("id");                          // 주소에 경기 번호가 없으면 아래에서 최근 경기로 채움 (date는 쓰지 않음)
let selectedGame = null;

let dbHeadshots = {};                                   // DB(players.headshot_url)의 선수 사진
let hiddenColumns = {};                                 // DB에 없는 기록 칸 (표 id → 숨길 칸 번호)

const escapeHtml = value => String(value ?? "-").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const formatStatus = status => ({ FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" })[status] || status || "상태 정보 없음";

// 홈구장 현지 시간대 (승부 예측 페이지 prediction.js와 같은 표, 나머지 구단은 동부 시간)
const TEAM_TIMEZONES = {
    158: "America/Chicago", 112: "America/Chicago", 145: "America/Chicago", 138: "America/Chicago",
    142: "America/Chicago", 118: "America/Chicago", 117: "America/Chicago", 140: "America/Chicago",
    115: "America/Denver", 109: "America/Phoenix",
    119: "America/Los_Angeles", 108: "America/Los_Angeles", 135: "America/Los_Angeles",
    137: "America/Los_Angeles", 136: "America/Los_Angeles", 133: "America/Los_Angeles"
};

// DB의 game_date + game_time(UTC) → 한국 시간 / 구장 현지 시간 (시간 정보가 없으면 null)
function getGameTimes(game) {
    if (!game?.game_date || !game?.game_time) return null;
    const utc = new Date(`${String(game.game_date).slice(0, 10)}T${String(game.game_time).slice(0, 8)}Z`);
    if (Number.isNaN(utc.getTime())) return null;
    const format = timeZone => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
            timeZone, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short"
        }).formatToParts(utc).map(part => [part.type, part.value]));
        return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, zone: parts.timeZoneName };
    };
    const kst = format("Asia/Seoul");
    const local = format(TEAM_TIMEZONES[Number(game.home_team_id)] || "America/New_York");
    return { kst: `${kst.date} ${kst.time} (KST)`, local: `${local.date} ${local.time} (${local.zone})` };
}

async function loadGame() {
    if (!gameId) {                                      // 경기 번호 없이 들어오면 가장 최근에 끝난 경기 보여주기
        try {
            const latestResponse = await fetch("/api/games?status=FINAL&limit=1");
            if (!latestResponse.ok) throw new Error(`최근 경기 조회 API 오류 (${latestResponse.status})`);
            const [latest] = await latestResponse.json();
            if (latest) {
                gameId = latest.game_id;
                history.replaceState(null, "", `?${new URLSearchParams({ id: gameId })}`); // 주소에도 표시
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
        const response = await fetch(`/api/games?game_id=${encodeURIComponent(gameId)}`);   // 경기 번호로 한 경기만
        if (!response.ok) throw new Error(`경기 조회 API 오류 (${response.status})`);
        const games = await response.json();
        selectedGame = games.find(game => String(game.game_id) === String(gameId));
        if (!selectedGame) {                            // DB에 없는 경기(포스트시즌) → MLB 공식 기록에서 바로 불러옴
            await loadMlbGame(gameId);
            return;
        }
        renderGameSummary(selectedGame);
        if (selectedGame.status !== "FINAL") {
            document.querySelectorAll(".boxscore-section, .detail-tabs, .scoreboard-innings").forEach(section => section.hidden = true); // 이닝 표(점수 카드 안)도 숨김
            const notice = document.getElementById("boxscore-notice");
            notice.textContent = "경기 종료 후 박스스코어를 확인할 수 있습니다.";
            notice.hidden = false;
            return;
        }
        await loadBoxscore(selectedGame.game_id);
    } catch (error) {
        console.error(error);
        showPageError(error.message || "경기 정보를 불러오지 못했습니다.");
    }
}

function renderGameSummary(game) {
    document.title = `${game.away_team_code} @ ${game.home_team_code} - BASEBOT`;
    document.getElementById("game-date").textContent = game.game_date || "";
    document.getElementById("game-venue").textContent = game.venue_name || "MLB 정규시즌";   // 구장 (DB)

    // 구장 줄 / 시간 줄을 나눠서 표시 (상자·아이콘 없이, 같은 글꼴·크기)
    // 날짜는 시간 줄에 들어 있어서, 위의 '날짜 · 구장' 줄은 숨김 (같은 내용 두 번 안 보이게)
    const times = getGameTimes(game);
    if (times && !document.querySelector(".game-time-row")) {
        const box = document.createElement("div");
        box.className = "game-time-row";
        box.style.cssText = "margin:0 auto 4px;color:#727d8e;font-size:13px;font-weight:400;line-height:1.5;text-align:center;white-space:pre";
        const venue = document.createElement("div");      // 1줄: 구장
        venue.textContent = game.venue_name || "경기장 미정";
        const time = document.createElement("div");       // 2줄: 한국 시간  현지 시간
        time.textContent = `${times.kst}  ${times.local}`;
        box.append(time, venue); 
        const meta = document.querySelector(".game-meta");
        meta.style.display = "none";                  // CSS의 display:flex 때문에 hidden 대신 직접 숨김
        meta.after(box);
    }

    // '경기 종료' 표시: 점수 바로 위로 옮김 (점수와 가깝게)
    const statusRow = document.querySelector(".game-status-row");
    const scoreBox = document.querySelector(".final-score-box");
    if (statusRow && scoreBox && statusRow.parentElement !== scoreBox) {
        statusRow.style.margin = "0 0 2px";
        scoreBox.prepend(statusRow);
    }
    document.getElementById("game-status").textContent = formatStatus(game.status);
    document.getElementById("away-team-name").textContent = game.away_team_name;
    document.getElementById("home-team-name").textContent = game.home_team_name;
    document.getElementById("away-score").textContent = game.away_score ?? "-";
    document.getElementById("home-score").textContent = game.home_score ?? "-";
    if (game.status === "FINAL" && game.away_score !== game.home_score) {      // 끝난 경기: 진 팀 점수 연하게
        const loser = Number(game.away_score) < Number(game.home_score) ? "away" : "home";
        document.getElementById(`${loser}-score`).classList.add("score-loser");
    }
    if (game.status === "FINAL") {                                            // 끝난 경기: 점수 밑 하이라이트 버튼 + 카드 오른쪽 위 'MLB에서 보기'
        const highlight = document.getElementById("highlight-link");
        highlight.hidden = false;
        highlight.onclick = () => toggleHighlights(game.game_id);
        const gameday = document.getElementById("gameday-link");
        gameday.href = `https://www.mlb.com/gameday/${encodeURIComponent(game.game_id)}/final/box`;   // MLB가 팀·날짜 주소로 바꿔 줌
        gameday.hidden = false;
    }
    document.getElementById("away-pitcher").textContent = "상세 기록 불러오는 중";
    document.getElementById("home-pitcher").textContent = "상세 기록 불러오는 중";
    setTeamLogo("away", game.away_logo_url, game.away_team_code);
    setTeamLogo("home", game.home_logo_url, game.home_team_code);
    document.getElementById("away-team-link").href = `team-detail.html?id=${encodeURIComponent(game.away_team_id)}`; // 로고 → 팀 상세
    document.getElementById("home-team-link").href = `team-detail.html?id=${encodeURIComponent(game.home_team_id)}`;
}

/* ---------- 하이라이트 영상: 버튼으로 펼치기/숨기기 (서버가 MLB 공식 영상 목록을 받아 옴) ---------- */

let highlightsLoaded = false;

async function toggleHighlights(gameId) {
    const button = document.getElementById("highlight-link");
    const panel = document.getElementById("highlight-panel");
    const video = document.getElementById("highlight-video");
    const open = panel.hidden;                         // 지금 닫혀 있으면 열기
    panel.hidden = !open;
    button.textContent = open ? "하이라이트 ▲" : "하이라이트 ▼";
    button.setAttribute("aria-expanded", String(open));
    if (!open) {
        video.pause();                                 // 숨기면 영상 멈춤
        return;
    }
    if (highlightsLoaded) return;                      // 영상 목록은 처음 열 때 한 번만 불러옴

    const title = document.getElementById("highlight-title");
    title.textContent = "하이라이트 영상을 불러오는 중입니다...";
    try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/highlights`);
        if (!response.ok) throw new Error(`하이라이트 API 오류 (${response.status})`);
        const { videos } = await response.json();
        if (!videos.length) {
            title.textContent = "이 경기의 하이라이트 영상이 없습니다.";
            video.hidden = true;
            return;
        }
        highlightsLoaded = true;
        const clip = videos[0];                        // 경기 하이라이트 영상 1개 (자동 재생은 안 함)
        video.hidden = false;
        video.poster = clip.image_url || "";
        video.src = clip.video_url;
        title.hidden = true;                           // 영상 제목은 표시하지 않음 (안내 문구용 자리만 남김)
    } catch (error) {
        console.error(error);
        title.textContent = "하이라이트 영상을 불러오지 못했습니다.";
        video.hidden = true;
    }
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

/* ---------- 포스트시즌 경기: DB에 없어서 MLB 공식 기록(feed/live)을 화면에서 바로 불러옴 ---------- */

async function loadMlbGame(id) {
    const response = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(id)}/feed/live`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("선택한 경기 정보를 찾지 못했습니다.");
    const { gameData, liveData } = await response.json();
    const state = gameData.status?.abstractGameState;
    const start = gameData.datetime?.dateTime || "";    // UTC (예: 2025-10-25T00:08:00Z) — DB의 game_date·game_time과 같은 기준
    const side = name => {
        const team = gameData.teams[name];
        return {
            [`${name}_team_id`]: team.id,
            [`${name}_team_name`]: team.name,
            [`${name}_team_code`]: team.abbreviation,
            [`${name}_logo_url`]: `https://www.mlbstatic.com/team-logos/${team.id}.svg`,
            [`${name}_score`]: liveData.linescore?.teams?.[name]?.runs
        };
    };
    selectedGame = {                                   // DB 경기와 같은 모양으로 만들어서 기존 그리기 함수 사용
        game_id: gameData.game?.pk || id,
        status: state === "Final" ? "FINAL" : state === "Live" ? "IN_PROGRESS" : "SCHEDULED",
        game_date: start.slice(0, 10),
        game_time: start.slice(11, 19) || null,
        venue_name: gameData.venue?.name,
        ...side("away"),
        ...side("home")
    };
    renderGameSummary(selectedGame);
    document.querySelector(".sample-notice").textContent = "포스트시즌 경기는 MLB 공식 기록을 불러와 보여 줍니다.";
    if (selectedGame.status !== "FINAL") {
        document.querySelectorAll(".boxscore-section, .detail-tabs, .scoreboard-innings").forEach(section => section.hidden = true);
        const notice = document.getElementById("boxscore-notice");
        notice.textContent = "경기 종료 후 박스스코어를 확인할 수 있습니다.";
        notice.hidden = false;
        return;
    }
    renderFromMlb(liveData);
}

function renderFromMlb(liveData) {                     // MLB 박스스코어 → 기존 표 (2루타·득점·잔루 등 모든 칸 표시)
    hiddenColumns = {};
    dbHeadshots = {};
    const boxscore = {};
    ["away", "home"].forEach(side => {
        const team = liveData.boxscore.teams[side];
        const players = {};
        Object.values(team.players || {}).forEach(player => {
            const season = player.seasonStats || {};   // 타율·ERA 등은 시즌 기록 (DB 화면과 같은 기준)
            players[`ID${player.person.id}`] = {
                ...player,
                stats: {
                    batting: { ...player.stats?.batting, avg: season.batting?.avg, obp: season.batting?.obp, slg: season.batting?.slg, ops: season.batting?.ops },
                    pitching: { ...player.stats?.pitching, era: season.pitching?.era, whip: season.pitching?.whip }
                }
            };
        });
        boxscore[side] = { players, battingOrder: team.battingOrder || [], pitchers: team.pitchers || [], teamStats: team.teamStats };
    });
    renderInnings(liveData.linescore, boxscore, true);  // 실책·잔루 칸까지
    renderTeamStats(boxscore);
    renderTeamAdvancedStats(boxscore);                 // 팀 비교 전 항목
}

/* ---------- 상세 기록: 우리 DB(game_boxscores·games.linescore)만 사용 ---------- */

async function loadBoxscore(id) {
    try {
        const response = await fetch(`/api/games/${encodeURIComponent(id)}/detail`);
        if (!response.ok) throw new Error(`상세 기록 API 오류 (${response.status})`);
        const detail = await response.json();
        if (!detail.has_data) throw new Error("이 경기의 상세 기록이 아직 DB에 없습니다.");
        renderFromDb(detail);
    } catch (error) {
        console.error("DB 상세 기록 조회 오류:", error);
        showStatsUnavailable(error.message || "상세 기록을 불러오지 못했습니다.");
    }
}

// DB에 저장되지 않는 기록 (표에서 칸을 숨김)
const DB_MISSING_COLUMNS = {
    "batter-body": [5, 6, 9, 12],                      // 2루타, 3루타, 득점, 잔루
    "pitcher-body": [3, 7, 9]                          // 타자수, 볼넷, 피홈런 (투구수는 DB pitch_count로 표시)
};
// 시즌 기록(player_season_stats)으로 채우는 칸: [표, 칸 번호, DB 값 이름] → 아무도 값이 없으면 숨김
const DB_SEASON_COLUMNS = [
    ["batter-body", 14, "season_obp"], ["batter-body", 15, "season_slg"], ["batter-body", 16, "season_ops"],
    ["pitcher-body", 10, "season_era"], ["pitcher-body", 11, "season_whip"]
];
const rate3 = value => value === null || value === undefined ? undefined : Number(value).toFixed(3).replace(/^0/, "");   // 0.239 → ".239"
const rate2 = value => value === null || value === undefined ? undefined : Number(value).toFixed(2);                     // 4.92
const DB_COMPARE_KEYS = ["homeRuns", "strikeOuts", "baseOnBalls", "avg"];   // DB로 계산할 수 있는 팀 비교 항목

// DB 기록(game_boxscores)을 MLB 응답과 같은 모양으로 바꿔서 기존 그리기 함수를 그대로 사용
function renderFromDb(detail) {
    hiddenColumns = {};
    Object.entries(DB_MISSING_COLUMNS).forEach(([body, columns]) => { hiddenColumns[body] = [...columns]; });
    DB_SEASON_COLUMNS.forEach(([body, column, key]) => {
        if (!detail.players.some(row => row[key] !== null && row[key] !== undefined)) hiddenColumns[body].push(column);
    });
    dbHeadshots = {};
    const boxscore = {};
    ["away", "home"].forEach(side => {
        const teamId = String(selectedGame[`${side}_team_id`]);
        const rows = detail.players.filter(row => String(row.team_id) === teamId);
        const players = {};
        rows.forEach(row => {
            if (row.headshot_url) dbHeadshots[row.player_id] = row.headshot_url;
            players[`ID${row.player_id}`] = {
                person: { id: row.player_id, fullName: row.player_name },
                position: { abbreviation: row.position },
                battingOrder: row.batting_order,
                stats: {
                    batting: {
                        atBats: row.at_bats, hits: row.hits, homeRuns: row.home_runs, rbi: row.rbi, baseOnBalls: row.walks, strikeOuts: row.strikeouts,
                        avg: rate3(row.season_avg), obp: rate3(row.season_obp), slg: rate3(row.season_slg), ops: rate3(row.season_ops)   // 시즌 기록 (MLB 표와 같은 기준)
                    },
                    pitching: {
                        inningsPitched: row.innings_pitched, numberOfPitches: row.pitch_count, hits: row.hits_allowed, runs: row.runs_allowed, earnedRuns: row.earned_runs, strikeOuts: row.strikeouts_pitched,
                        era: rate2(row.season_era), whip: rate2(row.season_whip)                                                       // 시즌 기록
                    }
                }
            };
        });

        // 선발 타순 1~9번: 같은 번호가 여러 명이면 먼저 저장된 선수 (MLB 화면처럼 선발 9명만 표시)
        const batters = [];
        rows.filter(row => row.batting_order !== null)
            .sort((a, b) => a.batting_order - b.batting_order)
            .forEach(row => { if (!batters.some(item => item.batting_order === row.batting_order)) batters.push(row); });
        // 투수: DB에 선발 표시가 없어서 가장 많은 이닝을 던진 투수를 선발로 봄
        const pitchers = rows.filter(row => Number(row.innings_pitched) > 0 || row.position === "P")
            .sort((a, b) => Number(b.innings_pitched) - Number(a.innings_pitched));
        const starter = pitchers.shift();
        const pitcherIds = (starter ? [starter, ...pitchers.sort((a, b) => detail.players.indexOf(a) - detail.players.indexOf(b))] : [])
            .map(row => row.player_id);

        const sum = key => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
        const atBats = sum("at_bats");
        const hits = sum("hits");
        boxscore[side] = {
            players,
            battingOrder: batters.map(row => row.player_id),
            pitchers: pitcherIds,
            teamStats: { batting: {
                hits, homeRuns: sum("home_runs"), strikeOuts: sum("strikeouts"), baseOnBalls: sum("walks"),
                avg: atBats ? (hits / atBats).toFixed(3).replace(/^0/, "") : "-"
            } }
        };
    });

    // 이닝 점수: 예전 형식 [{inning, away, home}] 과 MLB 원본 형식 {innings: [{num, away: {runs}, home: {runs}}]} 둘 다 읽음
    const rawLinescore = detail.linescore || [];
    const linescore = {
        innings: Array.isArray(rawLinescore)
            ? rawLinescore.map(item => ({
                num: item.inning,
                away: { runs: item.away ?? undefined },
                home: { runs: item.home ?? undefined }
            }))
            : (rawLinescore.innings || []),
        teams: {
            away: { runs: selectedGame.away_score, hits: boxscore.away.teamStats.batting.hits },
            home: { runs: selectedGame.home_score, hits: boxscore.home.teamStats.batting.hits }
        }
    };

    renderInnings(linescore, boxscore, false);
    renderTeamStats(boxscore);
    renderTeamAdvancedStats(boxscore, TEAM_COMPARE_ITEMS.filter(([, key]) => DB_COMPARE_KEYS.includes(key)));
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

function renderTeamAdvancedStats(boxscore, items = TEAM_COMPARE_ITEMS) {   // items: 보여 줄 항목 (DB면 계산 가능한 것만)
    const away = boxscore.away.teamStats?.batting || {};
    const home = boxscore.home.teamStats?.batting || {};
    const bar = (value, max, side) =>                    // 공통 기준 대비 길이(%)의 막대
        `<span class="compare-bar ${side}"><i style="width:${max ? Math.round(Number(value || 0) / max * 100) : 0}%"></i></span>`;

    // 모든 막대 공통 기준 (최소 15, 더 큰 기록이 있으면 그 값) → 숫자가 클수록 긴 막대
    const scale = Math.max(15, ...items
        .filter(([, , showBar]) => showBar)
        .flatMap(([, key]) => [Number(away[key]) || 0, Number(home[key]) || 0]));

    const rows = items.map(([label, key, showBar]) => {
        const a = away[key] ?? "-";
        const h = home[key] ?? "-";
        return `<div class="compare-row">
            ${showBar ? bar(a, scale, "away") : "<span></span>"}
            <strong class="compare-value">${escapeHtml(a)}</strong>
            <span class="compare-label">${escapeHtml(label)}</span>
            <strong class="compare-value">${escapeHtml(h)}</strong>
            ${showBar ? bar(h, scale, "home") : "<span></span>"}
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
    const season = String(selectedGame?.game_date || "").slice(0, 4);   // 이 경기의 시즌 연도 → 선수 페이지가 그 시즌 기록으로 열림
    return `player-detail.html?${new URLSearchParams({ id: playerId, season })}`;
}

function playerHeadshotUrl(playerId) {
    if (!playerId) return "";
    if (dbHeadshots[playerId]) return dbHeadshots[playerId];   // DB에 저장된 사진 먼저
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

function renderInnings(linescore, boxscore, showExtra = true) {   // showExtra: 실책·잔루 칸 (DB에는 없어서 false)
    const innings = linescore?.innings || [];
    if (!innings.length) {
        document.getElementById("inning-head").innerHTML = "";
        document.getElementById("inning-body").innerHTML = `<tr><td colspan="2">이닝별 기록이 제공되지 않습니다.</td></tr>`;
        return;
    }
    const labels = innings.map(inning => `<th>${inning.num}</th>`).join("");
    document.getElementById("inning-head").innerHTML = `<tr><th>구단</th>${labels}<th>득점</th><th>안타</th>${showExtra ? "<th>실책</th><th>잔루</th>" : ""}</tr>`;
    document.getElementById("inning-body").innerHTML = ["away", "home"].map(side => {
        const team = selectedGame[`${side}_team_name`];       // 약자 대신 정식 이름 (예: Los Angeles Angels)
        const totals = linescore.teams?.[side] || {};
        const runs = innings.map(inning => inning[side]?.runs ?? (side === "home" && inning.isTopInning ? "" : "-")).map(value => `<td>${value}</td>`).join("");
        const fallbackTotals = boxscore[side].teamStats?.batting || {};
        const extra = showExtra ? `<td>${totals.errors ?? "-"}</td><td>${totals.leftOnBase ?? "-"}</td>` : "";
        return `<tr><td class="team-cell">${escapeHtml(team)}</td>${runs}<td>${totals.runs ?? selectedGame[`${side}_score`] ?? "-"}</td><td>${totals.hits ?? fallbackTotals.hits ?? "-"}</td>${extra}</tr>`;
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
            const playerName = href
                ? `<a class="player-profile-link" href="${escapeHtml(href)}">${photo}<span>${escapeHtml(name)}</span></a>`
                : escapeHtml(name);
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
    applyHiddenColumns(bodyId);
}

// DB에 없는 기록 칸은 머리글과 함께 숨김 (MLB에서 불러온 경기는 모두 표시)
function applyHiddenColumns(bodyId) {
    const hidden = hiddenColumns[bodyId] || [];
    const table = document.getElementById(bodyId).closest("table");
    table.querySelectorAll("tr").forEach(row => {
        if (row.children.length === 1) return;          // '기록 없음' 한 칸짜리 줄은 그대로
        [...row.children].forEach((cell, index) => { cell.hidden = hidden.includes(index); });
    });
}

function getBoxRows(side, type) {
    const box = window.currentBoxscore?.[side];
    if (box) return type === "batting" ? box._battingRows || [] : box._pitchingRows || [];
    return [];
}

function showStatsUnavailable(message) {
    document.getElementById("inning-head").innerHTML = "";
    document.getElementById("inning-body").innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
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

loadGame();
