const DIVISION_LABELS = { East: "동부", Central: "중부", West: "서부" };   // 지구 영어 → 한글
const LEAGUE_LABELS = { AL: "아메리칸리그", NL: "내셔널리그" };

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
    message.textContent = "팀 순위를 불러오는 중입니다...";
    message.hidden = false;
    list.replaceChildren();
    try {
        const query = season ? `?season=${encodeURIComponent(season)}` : "";
        const response = await fetch(`/api/standings${query}`);
        if (!response.ok) throw new Error(`팀 순위 API 오류 (${response.status})`);
        standings = await response.json();
        renderSeasonOptions();
        renderStandings();
    } catch (error) {
        console.error(error);
        message.textContent = "팀 순위를 불러오지 못했습니다. FastAPI 서버를 확인해 주세요.";
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
    list.replaceChildren(...divisions.map(createDivisionTable));
}

function createDivisionTable(division) {
    const section = el("section", "standings-division");
    section.append(el("h2", "standings-division-title", `${LEAGUE_LABELS[division.league]} ${DIVISION_LABELS[division.division]}`));

    const wrap = el("div", "standings-table-wrap");
    const table = el("table", "standings-table");
    const head = el("thead");
    const headRow = el("tr");
    ["순위", "팀", "경기", "승", "패", "승률", "게임차", "최근 10경기", "연속", "트렌드", "타율", "평균자책"]
        .forEach(name => headRow.append(el("th", "", name)));
    head.append(headRow);

    const body = el("tbody");
    division.teams.forEach(team => body.append(createTeamRow(team)));

    table.append(head, body);
    wrap.append(table);
    section.append(wrap);
    return section;
}

function createTeamRow(team) {
    const row = el("tr");
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
            if (standings) renderStandings();
        });
    });
    seasonSelect.addEventListener("change", () => loadStandings(seasonSelect.value));
}

setupEvents();
loadStandings();                                       // 처음엔 가장 최근 시즌
