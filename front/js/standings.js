const DIVISION_LABELS = { East: "동부지구", Central: "중부지구", West: "서부지구" };   // 지구 영어 → 한글

const $ = id => document.getElementById(id);           // id로 요소를 찾는 짧은 함수
const seasonSelect = $("standings-season-select");     // 시즌 선택 목록
const list = $("standings-list");                      // 지구별 표가 들어갈 상자
const message = $("standings-message");                // 불러오는 중 / 오류 문구
let standings = null;                                  // API에서 받은 순위 데이터
let selectedLeague = "AL";                             // 선택한 리그

function el(tag, className, text) {                    // 요소를 만드는 짧은 함수
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/* ---------- 데이터 불러오기 ---------- */

async function loadStandings(season) {
    message.textContent = "구단 순위를 불러오는 중입니다...";
    message.hidden = false;
    list.replaceChildren();
    try {
        const query = season ? `?season=${encodeURIComponent(season)}` : "";
        const response = await fetch(`/api/standings${query}`);
        if (!response.ok) throw new Error(`구단 순위 API 오류 (${response.status})`);
        standings = await response.json();
        renderSeasonOptions();
        showSelected();
    } catch (error) {
        console.error(error);
        message.textContent = "구단 순위를 불러오지 못했습니다. FastAPI 서버를 확인해 주세요.";
    }
}

/* ---------- 화면 그리기 ---------- */

function renderSeasonOptions() {                       // DB에 있는 시즌만 선택지로
    seasonSelect.replaceChildren(...standings.seasons.map(year => {
        const option = el("option", "", `${year} 시즌`);
        option.value = year;
        option.selected = year === standings.season;
        return option;
    }));
}

function renderStandings() {                           // 선택한 리그의 지구 3개 표 그리기
    const divisions = standings.divisions.filter(d => d.league === selectedLeague);
    if (!standings.season || divisions.every(d => d.teams.every(t => t.games === 0))) {
        message.textContent = "순위를 계산할 경기 결과가 없습니다.";
        message.hidden = false;
        list.replaceChildren();
        return;
    }
    message.hidden = true;

    const tables = divisions.map(d =>
        createStandingsTable(`${DIVISION_LABELS[d.division]} (${d.division} Division)`, d.teams)   // 예: 동부지구 (East Division)
    );
    const wildcard = (standings.wildcards || []).find(w => w.league === selectedLeague);
    if (wildcard) {                                    // 지구별 표 아래에 와일드카드 표
        tables.push(createStandingsTable("와일드카드 (Wild Card)", wildcard.teams));
    }
    const legend = el("p", "standings-legend");        // 파란 선 설명
    legend.append(el("span", "standings-legend-mark"), "플레이오프 진출권 (지구 1위 · 와일드카드 상위 3팀)");
    list.replaceChildren(...tables, legend);
}

function createStandingsTable(titleText, teams) {
    const section = el("section", "standings-division");
    section.append(el("h2", "standings-division-title", titleText));

    const wrap = el("div", "standings-table-wrap");
    const table = el("table", "standings-table");
    const head = el("thead");
    const headRow = el("tr");
    const body = el("tbody");
    let sortedIndex = null;                            // 정렬 중인 칸 (없으면 null = 원래 순위 순서)

    TABLE_COLUMNS.forEach(([name, getValue], index) => {
        if (!getValue) {                               // 순위·구단은 정렬 안 함
            headRow.append(el("th", "", name));
            return;
        }
        const th = el("th", "sortable");
        th.append(name, el("span", "sort-mark", "▼"));  // ▼ 자리는 항상 차지 → 표 모양이 바뀌지 않음
        th.addEventListener("click", () => {
            sortedIndex = sortedIndex === index ? null : index;   // 1번: 내림차순, 같은 칸 2번: 원래 순서
            headRow.querySelectorAll("th").forEach((cell, i) => cell.classList.toggle("sorted", i === sortedIndex));
            renderRows(sortedIndex === null ? teams : sortDescending(teams, getValue));
        });
        headRow.append(th);
    });
    head.append(headRow);

    function renderRows(list) {
        body.replaceChildren(...list.map(createTeamRow));
    }
    renderRows(teams);                                 // 처음엔 순위 순서

    table.append(head, body);
    wrap.append(table);
    section.append(wrap);
    return section;
}

/* ---------- 정렬 ('경기'~'평균자책') ---------- */
// [제목, 비교할 값] - 값이 없는 칸(순위·구단)은 정렬하지 않음
const TABLE_COLUMNS = [
    ["순위"],
    ["구단"],
    ["경기", t => t.games],
    ["승", t => t.wins],
    ["패", t => t.losses],
    ["승률", t => t.pct],
    ["게임차", t => gamesBehindValue(t.games_behind)],
    ["최근 10경기", t => leadingNumber(t.last10)],
    ["연속", t => streakValue(t.streak)],
    ["트렌드", t => (t.trend || []).filter(r => r === "W").length],
    ["타율", t => numberOrNull(t.avg)],
    ["평균자책", t => numberOrNull(t.era)]
];

function sortDescending(teams, getValue) {            // 큰 값부터, 기록 없음(-)은 맨 아래, 같으면 원래 순위
    return [...teams].sort((a, b) => {
        const va = getValue(a);
        const vb = getValue(b);
        if (va === null && vb === null) return a.rank - b.rank;
        if (va === null) return 1;
        if (vb === null) return -1;
        return (vb - va) || (a.rank - b.rank);
    });
}

function numberOrNull(text) {                          // ".254" → 0.254, "-" → null
    const value = parseFloat(text);
    return Number.isNaN(value) ? null : value;
}

function gamesBehindValue(text) {                      // "-" → 0, "+4" → -4, "2.5" → 2.5
    if (text === "-") return 0;
    return text.startsWith("+") ? -parseFloat(text.slice(1)) : parseFloat(text);
}

function leadingNumber(text) {                         // "7승 3패" → 7, "-" → null
    const match = String(text).match(/^(\d+)/);
    return match ? Number(match[1]) : null;
}

function streakValue(text) {                           // "3연승" → 3, "2연패" → -2, "-" → null
    const count = leadingNumber(text);
    if (count === null) return null;
    return text.includes("패") ? -count : count;
}

function createTeamRow(team) {
    const row = el("tr", team.playoff ? "playoff-row" : "");   // 플레이오프 진출권이면 왼쪽 파란 선
    row.append(el("td", "standings-rank", team.rank));

    const teamCell = el("td", "standings-team-cell");
    const link = el("a", "standings-team-link");       // 구단 클릭 → 팀 정보(로스터)
    link.href = `team-detail.html?id=${encodeURIComponent(team.team_id)}`;
    const logo = el("img", "standings-team-logo");
    logo.src = team.logo_url || "";
    logo.alt = "";
    logo.loading = "lazy";
    logo.onerror = () => logo.replaceWith(el("span", "standings-team-logo standings-logo-fallback", team.team_code || "MLB"));
    link.append(logo, el("span", "standings-team-name", team.team_name));
    teamCell.append(link);
    row.append(teamCell);

    const streakClass = team.streak.includes("승") ? "streak-win" : team.streak.includes("패") ? "streak-lose" : "";
    [
        [team.games],
        [team.wins],
        [team.losses],
        [formatPct(team.pct), "standings-pct"],
        [team.games_behind],
        [team.last10],
        [team.streak, streakClass]
    ].forEach(([value, className]) => row.append(el("td", className || "", value)));

    const trendCell = el("td", "standings-trend-cell");
    trendCell.append(createTrendChart(team.trend || []));
    row.append(trendCell, el("td", "", team.avg), el("td", "", team.era));
    return row;
}

/* ---------- 트렌드 그래프 (최근 15경기) ---------- */
// 기준선(점선)에서 시작해 이기면 한 칸 위로, 지면 한 칸 아래로 이어지는 꺾은선

function createTrendChart(results) {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "standings-trend");
    svg.setAttribute("viewBox", "0 0 60 28");
    svg.setAttribute("preserveAspectRatio", "none");

    const wins = results.filter(r => r === "W").length;
    const title = document.createElementNS(SVG_NS, "title");  // 마우스를 올리면 보이는 설명
    title.textContent = results.length
        ? `최근 ${results.length}경기 ${wins}승 ${results.length - wins}패`
        : "경기 기록 없음";
    svg.append(title);

    const baseline = document.createElementNS(SVG_NS, "line"); // 기준선 (승패 같음)
    Object.entries({ x1: 0, y1: 14, x2: 60, y2: 14, class: "trend-baseline" })
        .forEach(([key, value]) => baseline.setAttribute(key, value));
    svg.append(baseline);
    if (!results.length) return svg;

    let level = 0;                                     // 승 - 패 누적값
    const levels = [0, ...results.map(r => (level += r === "W" ? 1 : -1))];
    const maxLevel = Math.max(1, ...levels.map(Math.abs));
    const step = 12 / maxLevel;                        // 위아래 12px 안에 들어가게
    const points = levels.map((value, i) => [
        (i / (levels.length - 1)) * 58 + 1,            // x: 왼쪽 → 오른쪽
        14 - value * step                              // y: 위로 갈수록 승이 많음
    ]);

    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points.map(p => p.join(",")).join(" "));
    line.setAttribute("class", "trend-line");
    svg.append(line);

    const [lastX, lastY] = points[points.length - 1];  // 가장 최근 경기 위치
    const dot = document.createElementNS(SVG_NS, "circle");
    Object.entries({ cx: lastX, cy: lastY, r: 1.8, class: "trend-dot" })
        .forEach(([key, value]) => dot.setAttribute(key, value));
    svg.append(dot);
    return svg;
}

function formatPct(pct) {                              // 0.625 → ".625", 1 → "1.000"
    const text = Number(pct).toFixed(3);
    return text.startsWith("0") ? text.slice(1) : text;
}

/* ---------- 포스트시즌 대진표 (서버가 MLB API에서 받아 옴) ---------- */

function showSelected() {                              // 선택한 탭에 맞게: 포스트시즌이면 대진표, 아니면 순위표
    if (selectedLeague === "POST") loadPostseason(standings.season);
    else renderStandings();
}

async function loadPostseason(season) {
    message.textContent = "포스트시즌 대진을 불러오는 중입니다...";
    message.hidden = false;
    list.replaceChildren();
    try {
        const response = await fetch(`/api/standings/postseason?season=${encodeURIComponent(season)}`);
        if (!response.ok) throw new Error(`포스트시즌 API 오류 (${response.status})`);
        const data = await response.json();
        if (selectedLeague !== "POST") return;         // 불러오는 사이 다른 탭을 누른 경우
        renderPostseason(data);
    } catch (error) {
        console.error(error);
        message.textContent = "포스트시즌 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
}

function renderPostseason(data) {                      // 라운드 4칸: 와일드카드 → 디비전 → 챔피언십 → 월드시리즈
    if (!data.rounds.length) {
        message.textContent = `${data.season} 시즌 포스트시즌 경기가 아직 없습니다.`;
        return;
    }
    message.hidden = true;

    const bracket = el("div", "postseason-bracket");
    data.rounds.forEach(round => {
        const column = el("section", "postseason-round");
        column.append(el("h3", "postseason-round-title", round.name),
            el("p", "postseason-round-rule", `${round.best_of}전 ${Math.floor(round.best_of / 2) + 1}선승`));
        let lastLeague = "";
        round.series.forEach(series => {
            if (series.league && series.league !== lastLeague) {   // AL / NL 구분 글자
                column.append(el("p", "postseason-league", series.league));
                lastLeague = series.league;
            }
            column.append(createSeriesBox(series, round.code === "W"));
        });
        bracket.append(column);
    });
    list.replaceChildren(bracket, el("p", "standings-legend", "포스트시즌 기록은 MLB 공식 기록(statsapi.mlb.com)을 불러와 표시합니다."));
}

function createSeriesBox(series, isWorldSeries) {      // 시리즈 1개: 두 팀 + 승수
    const box = el("div", isWorldSeries ? "postseason-series world-series" : "postseason-series");
    series.teams.forEach(team => {
        const row = el("div", team.is_winner ? "postseason-team winner" : "postseason-team");
        const name = el("a", "postseason-team-name");  // 구단 클릭 → 팀 정보(로스터), 순위표와 같음
        name.href = `team-detail.html?id=${encodeURIComponent(team.team_id)}`;
        if (team.logo_url) {
            const logo = el("img", "postseason-logo");
            logo.src = team.logo_url;
            logo.alt = "";
            name.append(logo);
        }
        name.append(team.team_name);
        row.append(name, el("strong", "postseason-wins", team.wins));
        box.append(row);
    });
    if (!series.finished) box.append(el("p", "postseason-status", "진행 중"));
    return box;
}

/* ---------- 이벤트 ---------- */

function setupEvents() {
    document.querySelectorAll(".standings-league-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            selectedLeague = tab.dataset.league;
            document.querySelectorAll(".standings-league-tab").forEach(t => {
                const isSelected = t === tab;
                t.classList.toggle("selected", isSelected);
                t.setAttribute("aria-selected", String(isSelected));
            });
            if (standings) showSelected();
        });
    });
    seasonSelect.addEventListener("change", () => loadStandings(seasonSelect.value));
}

setupEvents();
loadStandings();                                       // 처음엔 가장 최근 시즌
