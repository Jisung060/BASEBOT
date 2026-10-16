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
    ["순위", "팀", "경기", "승", "패", "승률", "게임차", "연속", "최근 10경기", "홈", "원정"]
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
        [team.streak, streakClass],
        [team.last10],
        [team.home],
        [team.away]
    ].forEach(([value, className]) => row.append(el("td", className || "", value)));
    return row;
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
