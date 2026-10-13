const API_BASE = "";                                   // API 주소 앞부분 (같은 서버면 빈 문자열)
const DEFAULT_DATE = "2024-04-01";                     // 처음 보여 줄 날짜
const MONTH_ORDER = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]; // 월 버튼 순서
const STATUS_LABELS = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" };

const $ = id => document.getElementById(id);           // id로 요소를 찾는 짧은 함수
const dateInput = $("game-date-picker");               // 날짜 입력칸
const teamSelect = $("select-team");                   // 구단 선택 목록 (숨김)
const gameList = $("game-list");                       // 경기 목록을 넣을 상자
const emptyMessage = $("no-game-message");             // 경기가 없을 때 문구
const calendar = $("game-calendar");                   // 달력 상자
const monthCache = new Map();                          // 한 번 받은 달 데이터 저장 (중복 요청 방지)
const scheduleCache = new Map();                       // MLB 일정 데이터 저장
let myFavoriteTeamId = null;                           // 응원 구단 번호 (없으면 null)
let selectedDay = null;                                // 선택한 '일' 숫자 (전체 보기면 null)

/* ---------- 공통 도우미 ---------- */

function el(tag, className = "", text = "") {          // 요소 만들기 (태그, 클래스, 글자)
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
}

const pad = n => String(n).padStart(2, "0");           // 숫자를 두 자리 문자열로 (4 → "04")

function formatKey(date) {                             // Date → "2024-04-02"
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDate(dateStr, days) {                    // 날짜 문자열에 days일 더하기
    const d = new Date(`${dateStr}T12:00:00`);         // 정오로 잡아야 시차 때문에 날짜가 안 밀림
    d.setDate(d.getDate() + days);
    return formatKey(d);
}

function monthRange(dateStr) {                         // 달의 첫날과 마지막날 구하기
    const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
    const last = new Date(y, m, 0).getDate();          // 0일 = 전월 마지막날
    return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(last)}`];
}

function involvesTeam(game, teamId) {                  // 홈 또는 원정에 이 구단이 있는지
    return String(game.home_team_id) === String(teamId) || String(game.away_team_id) === String(teamId);
}

function koreanDate(scheduledAt, fallback) {           // 시작 시간을 한국 날짜("2024-04-02")로
    const date = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(date.getTime())) return String(fallback).slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-CA", {   // 한국 시간대 기준 년-월-일
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTime(dateTime) {                        // 시작 시간을 "07:40" 모양으로
    const date = new Date(dateTime);
    if (!dateTime || Number.isNaN(date.getTime())) return "시간 미정";
    return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
}

/* ---------- 이벤트 연결 ---------- */

function setupEvents() {
    dateInput.value = DEFAULT_DATE;
    dateInput.addEventListener("change", () => setSelectedDate(dateInput.value));
    teamSelect.addEventListener("change", () => {      // 구단이 바뀌면 목록 다시 그리기
        loadGames();
        if (!calendar.hidden) renderCalendar();
    });
    $("btn-prev-year").addEventListener("click", () => moveYear(-1));
    $("btn-next-year").addEventListener("click", () => moveYear(1));
    $("btn-today").addEventListener("click", () => {   // '최근' 버튼: 기본 날짜로
        dateInput.value = DEFAULT_DATE;
        selectedDay = null;
        renderMonthStrip();
        loadGames();
    });
    $("btn-calendar").addEventListener("click", toggleCalendar);

    const topButton = $("scroll-to-top");              // 280px 이상 내려가면 맨 위로 버튼 보이기
    window.addEventListener("scroll", () => { topButton.hidden = window.scrollY < 280; }, { passive: true });
    topButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    renderMonthStrip();
}

/* ---------- 날짜 선택 ---------- */

function setSelectedDate(value) {
    if (!value) return;
    dateInput.value = value;
    selectedDay = Number(value.slice(-2));             // "2024-04-02" → 2 (일만 저장)
    renderMonthStrip();
    loadGames();
}

function moveYear(delta) {                             // 연도만 바꾸고 1일로
    const [y, m] = dateInput.value.split("-").map(Number);
    dateInput.value = `${y + delta}-${pad(m)}-01`;
    selectedDay = null;
    renderMonthStrip();
    loadGames();
}

function renderMonthStrip() {                          // 9월~8월 버튼 그리기
    const [year, selectedMonth] = dateInput.value.split("-").map(Number);
    $("year-display").textContent = year;
    $("month-strip").replaceChildren(...MONTH_ORDER.map(month => {
        const button = el("button", "month-option", `${month}월`);
        button.type = "button";
        const selected = month === selectedMonth;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.addEventListener("click", () => {       // 누르면 그 달 1일로 이동
            dateInput.value = `${year}-${pad(month)}-01`;
            selectedDay = null;
            renderMonthStrip();
            loadGames();
        });
        return button;
    }));
}

/* ---------- 달력 ---------- */

async function toggleCalendar() {
    calendar.hidden = !calendar.hidden;
    if (!calendar.hidden) {
        calendar.dataset.month = dateInput.value.slice(0, 7); // 보여 줄 달 저장 ("2024-04")
        await renderCalendar();
    }
}

async function renderCalendar() {
    const monthKey = calendar.dataset.month;
    const [year, month] = monthKey.split("-").map(Number);
    const games = await fetchMonthGames(`${monthKey}-01`);
    const visible = teamSelect.value === "ALL" ? games : games.filter(g => involvesTeam(g, teamSelect.value));
    const gameDays = new Set(visible.map(g => g.display_date)); // 경기가 있는 날짜 모음

    const heading = el("div", "game-calendar-heading");
    heading.append(navButton("‹", -1), el("strong", "", `${year}년 ${month}월`), navButton("›", 1));

    const grid = el("div", "game-calendar-grid");
    ["일", "월", "화", "수", "목", "금", "토"].forEach(d => grid.append(el("span", "game-calendar-weekday", d)));
    for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i += 1) grid.append(el("span")); // 1일 앞 빈칸

    const lastDay = new Date(year, month, 0).getDate();
    for (let day = 1; day <= lastDay; day += 1) {
        const date = `${monthKey}-${pad(day)}`;
        const button = el("button", "game-calendar-day", String(day));
        button.type = "button";
        if (gameDays.has(date)) button.classList.add("has-games");
        if (date === dateInput.value) button.classList.add("selected");
        button.addEventListener("click", () => {       // 날짜 선택하면 달력 닫기
            calendar.hidden = true;
            setSelectedDate(date);
        });
        grid.append(button);
    }
    calendar.replaceChildren(heading, grid);

    function navButton(label, delta) {                 // 이전/다음 달 버튼
        const button = el("button", "", label);
        button.type = "button";
        button.addEventListener("click", () => {
            const target = new Date(year, month - 1 + delta, 1);
            calendar.dataset.month = formatKey(target).slice(0, 7);
            renderCalendar();
        });
        return button;
    }
}

/* ---------- 구단 선택 ---------- */

function addTeamOption(value, name, logoUrl, code) {   // 구단 버튼 하나 추가
    const option = el("button", "team-rail-option");
    option.type = "button";
    option.dataset.teamId = String(value);
    option.append(createTeamLogo(logoUrl, code, "team-picker-logo"), el("span", "team-rail-name", name));
    if (myFavoriteTeamId && String(value) === String(myFavoriteTeamId)) {
        option.classList.add("is-favorite-team");      // 응원 구단 강조
        option.append(el("span", "team-favorite-badge", "★ MY"));
    }
    option.addEventListener("click", () => {
        teamSelect.value = value;                      // 숨겨진 select 값 바꾸기
        updateTeamRail();
        teamSelect.dispatchEvent(new Event("change")); // change 이벤트로 목록 갱신
    });
    $("team-rail").append(option);
}

function updateTeamRail() {                            // 선택된 구단 버튼만 눌린 상태로
    document.querySelectorAll(".team-rail-option").forEach(option => {
        option.setAttribute("aria-pressed", String(option.dataset.teamId === String(teamSelect.value)));
    });
}

function createTeamLogo(logoUrl, code, className) {    // 로고 이미지, 실패 시 약자 글자
    const wrapper = el("span", className);
    const showCode = () => { wrapper.textContent = code || "MLB"; wrapper.classList.add("logo-fallback"); };
    if (!logoUrl) { showCode(); return wrapper; }
    const img = el("img");
    img.src = logoUrl;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = showCode;
    wrapper.append(img);
    return wrapper;
}

async function loadTeams() {
    try {
        const [response, favoriteId] = await Promise.all([
            fetch(`${API_BASE}/api/teams`),
            getFavoriteTeamId()
        ]);
        if (!response.ok) throw new Error(`구단 API 오류 (${response.status})`);
        const teams = await response.json();
        myFavoriteTeamId = favoriteId;
        teams.sort((a, b) => a.team_name.localeCompare(b.team_name)); // 이름순 정렬
        teams.forEach(team => {
            teamSelect.add(new Option(`${team.team_name} (${team.team_code})`, team.team_id));
            addTeamOption(team.team_id, team.team_name, team.logo_url, team.team_code);
        });
        updateTeamRail();
    } catch (error) {
        console.error(error);
        teamSelect.add(new Option("구단 목록을 불러오지 못했습니다", "", true, true));
    }
}

async function getFavoriteTeamId() {                   // 응원 구단 번호 구하기 (서버 값 우선, 없으면 저장값)
    let user = null;
    try {
        user = JSON.parse(sessionStorage.getItem("user") || localStorage.getItem("user") || "null");
    } catch (error) {
        console.warn("사용자 정보를 읽지 못했습니다.", error);
    }
    if (!user) return null;
    const userId = user.user_id || user.id;
    if (userId) {
        try {
            const response = await fetch(`${API_BASE}/api/predictions/users/${encodeURIComponent(userId)}/points`);
            if (response.ok) {
                const data = await response.json();
                if (data.favorite_team_id) return Number(data.favorite_team_id);
            }
        } catch (error) {
            console.warn("최신 선호 구단을 가져오지 못했습니다.", error);
        }
    }
    const cachedId = user.favorite_team_id || user.team_id;
    return cachedId ? Number(cachedId) : null;
}

/* ---------- 경기 목록 ---------- */

async function loadGames() {
    gameList.replaceChildren();
    emptyMessage.hidden = true;
    try {
        let games = await fetchMonthGames(dateInput.value);   // 선택한 달 전체 경기
        if (teamSelect.value !== "ALL") games = games.filter(g => involvesTeam(g, teamSelect.value));
        if (selectedDay !== null) {                           // 날짜를 골랐으면 그 날만
            const target = `${dateInput.value.slice(0, 7)}-${pad(selectedDay)}`;
            games = games.filter(g => g.display_date === target);
        }
        if (games.length === 0) {
            emptyMessage.textContent = selectedDay === null
                ? "선택한 달에 MLB 경기 데이터가 없습니다."
                : "선택한 날짜에 MLB 경기 데이터가 없습니다.";
            emptyMessage.hidden = false;
            return;
        }
        // 한 구단을 골랐을 때만 team-view 클래스 (CSS에서 날짜 박스를 2열로 배치)
        gameList.classList.toggle("team-view", teamSelect.value !== "ALL");
        gameList.replaceChildren(...createDayGroups(games));
    } catch (error) {
        console.error(error);
        emptyMessage.textContent = "MLB 경기 데이터를 불러오지 못했습니다. FastAPI 서버를 확인해 주세요.";
        emptyMessage.hidden = false;
    }
}

function createDayGroups(games) {                      // 날짜별로 묶어서 박스 만들기
    const grouped = new Map();
    games.forEach(game => {
        if (!grouped.has(game.display_date)) grouped.set(game.display_date, []);
        grouped.get(game.display_date).push(game);
    });
    return [...grouped.keys()].sort().map(date => {
        const dayGames = grouped.get(date).sort((a, b) =>      // 시작 시간 순
            String(a.scheduled_at || "99").localeCompare(String(b.scheduled_at || "99")));
        const title = new Date(`${date}T12:00:00`).toLocaleDateString("ko-KR", {
            month: "long", day: "numeric", weekday: "long"     // "4월 2일 화요일"
        });
        const heading = el("header", "game-day-heading");
        heading.append(el("h3", "", title), el("span", "", `${dayGames.length}경기`));
        const cards = el("div", "game-day-cards");
        cards.append(...dayGames.map(createGameCard));
        const group = el("section", "game-day-group");
        group.append(heading, cards);
        return group;
    });
}

function createGameCard(game) {
    const isFinal = game.status === "FINAL";
    const isLive = game.status === "IN_PROGRESS";
    const favoriteId = myFavoriteTeamId ? String(myFavoriteTeamId) : null;
    const hasFavorite = favoriteId && (String(game.away_team_id) === favoriteId || String(game.home_team_id) === favoriteId);
    const isFav = teamId => hasFavorite && String(teamId) === favoriteId;

    const card = el("article", "game-card");
    if (hasFavorite && teamSelect.value !== favoriteId) card.classList.add("favorite-game-card");

    const time = el("div", "game-time");               // 왼쪽: 시간과 구장 (구장은 DB 값)
    time.append(
        el("strong", "", formatTime(game.scheduled_at)),
        el("small", "game-venue-name", game.venue_name || "구장 정보 없음")
    );

    const matchup = el("div", "matchup-summary");      // 가운데: 원정팀 · 점수 · 홈팀
    matchup.append(
        createTeamNode(game.away_team_name, game.away_team_code, game.away_logo_url, "away", game.away_team_id, game.away_pitcher, isFav(game.away_team_id)),
        createScoreNode(game, isFinal || isLive),
        createTeamNode(game.home_team_name, game.home_team_code, game.home_logo_url, "home", game.home_team_id, game.home_pitcher, isFav(game.home_team_id))
    );

    const actions = el("div", "game-venue game-actions"); // 오른쪽: 끝난 경기만 버튼 표시
    if (isFinal) {
        const gameDate = String(game.game_date || dateInput.value).slice(0, 10);
        const detail = el("a", "detail-button", "박스스코어");
        detail.href = `game-detail.html?${new URLSearchParams({ id: game.game_id, date: gameDate })}`;
        const highlight = el("a", "highlight-button score-highlight-link", "하이라이트");
        highlight.href = `https://www.mlb.com/gameday/${encodeURIComponent(game.game_id)}/video`;
        highlight.target = "_blank";
        highlight.rel = "noopener noreferrer";
        actions.append(detail, highlight);
    }

    card.append(time, matchup, actions);
    return card;
}

function createTeamNode(name, code, logoUrl, side, teamId, pitcherName, isFavoriteTeam) {
    const slot = el("div", `schedule-team-slot ${side}`);
    const teamHref = `team-detail.html?id=${encodeURIComponent(teamId || "")}`;

    const logoLink = el("a", "schedule-team-logo-link");
    logoLink.href = teamHref;
    const logo = el("img", "team-mark team-logo-img");
    logo.src = logoUrl || "";
    logo.alt = `${name} 로고`;
    logo.loading = "lazy";
    logo.onerror = () => logo.replaceWith(el("span", "team-mark team-mark-fallback", code || "MLB"));
    logoLink.append(logo);
    if (isFavoriteTeam) {
        logoLink.classList.add("favorite-game-logo");
        logoLink.append(el("span", "favorite-game-badge", "★ MY"));
    }

    const copy = el("span", "team-copy");              // 팀 이름과 선발 투수
    const label = el("a", "team-name", name || "팀 정보 없음");
    label.href = teamHref;
    const pitcher = el("small", "team-pitcher", pitcherName ? `선발 ${pitcherName}` : "선발 미정");
    copy.append(label, pitcher);

    if (side === "home") slot.append(copy, logoLink);  // 홈팀은 글자가 로고 앞
    else slot.append(logoLink, copy);                  // 원정팀은 로고가 글자 앞
    return slot;
}

function createScoreNode(game, showScore) {
    const block = el("div", "score-block");
    if (showScore) {
        const away = el("strong", "", String(game.away_score ?? "-"));
        const home = el("strong", "", String(game.home_score ?? "-"));
        if (game.status === "FINAL") {                 // 이긴 쪽 점수 강조
            if (Number(game.away_score) > Number(game.home_score)) away.className = "winner";
            if (Number(game.home_score) > Number(game.away_score)) home.className = "winner";
        }
        block.append(el("div", "score-line"), el("span", "score-caption", ""));
        block.querySelector(".score-line").append(away, el("span", "", ":"), home);
    } else {
        block.append(el("span", "scheduled-vs", "VS"));
    }
    block.append(el("span", "score-caption", STATUS_LABELS[game.status] || game.status || "상태 미정"));
    return block;
}

/* ---------- 데이터 불러오기 ---------- */

async function fetchMonthGames(dateStr) {              // 한 달 경기 가져와서 날짜 정보 붙이기
    const monthKey = dateStr.slice(0, 7);
    if (monthCache.has(monthKey)) return monthCache.get(monthKey);

    const [first, last] = monthRange(dateStr);
    const start = shiftDate(first, -1);                // UTC와 한국 날짜 차이 대비, 앞뒤 하루 여유
    const end = shiftDate(last, 1);
    const rawGames = await fetchGamesByRange(start, end);
    const schedule = await loadScheduleInfo(start, end);

    const games = rawGames
        .map(game => {
            const merged = { ...game, ...(schedule.get(String(game.game_id)) || {}) }; // MLB 시간·선발 정보 합치기
            return { ...merged, display_date: koreanDate(merged.scheduled_at, merged.game_date) };
        })
        .filter(game => game.display_date.startsWith(monthKey)); // 요청한 달만 남기기

    monthCache.set(monthKey, games);
    return games;
}

async function fetchGamesByRange(start, end) {         // 기간 안의 날짜를 6개씩 나눠 요청
    const dates = [];
    for (let d = new Date(`${start}T12:00:00`); formatKey(d) <= end; d.setDate(d.getDate() + 1)) {
        dates.push(formatKey(d));
    }
    const games = [];
    for (let i = 0; i < dates.length; i += 6) {
        const batch = await Promise.all(dates.slice(i, i + 6).map(fetchDayGames));
        batch.forEach(day => games.push(...day));
    }
    return games;
}

async function fetchDayGames(date) {                   // 하루치 경기 (DB 값)
    const response = await fetch(`${API_BASE}/api/games?date=${encodeURIComponent(date)}&limit=100`);
    if (!response.ok) throw new Error(`경기 데이터 API 오류 (${response.status})`);
    return response.json();
}

async function loadScheduleInfo(start, end) {          // MLB에서 시작 시간과 선발 투수만 가져오기 (장소는 DB 사용)
    const key = `${start}:${end}`;
    if (scheduleCache.has(key)) return scheduleCache.get(key);

    const info = new Map();
    try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=probablePitcher`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`MLB 일정 API 오류 (${response.status})`);
        const data = await response.json();
        (data.dates || []).flatMap(day => day.games || []).forEach(item => {
            info.set(String(item.gamePk), {
                scheduled_at: item.gameDate,           // 시작 시간
                away_pitcher: item.teams?.away?.probablePitcher?.fullName || "",
                home_pitcher: item.teams?.home?.probablePitcher?.fullName || ""
            });
        });
    } catch (error) {
        console.warn("MLB 시작 시간·선발 투수 정보를 불러오지 못했습니다.", error);
    }
    scheduleCache.set(key, info);
    return info;
}

/* ---------- 시작 ---------- */

setupEvents();
addTeamOption("ALL", "전체 구단", "", "MLB");          // 맨 앞의 "전체 구단" 버튼
loadTeams();
loadGames();