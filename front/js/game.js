const API_BASE = "";                                   // API 주소 앞부분 (같은 서버면 빈 문자열)
const DEFAULT_DATE = "2024-04-01";                     // 처음 보여 줄 날짜
const MONTH_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 월 버튼 순서
const STATUS_LABELS = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" }; // 상태 영어를 한글로

const $ = id => document.getElementById(id);           // id로 요소를 찾는 짧은 함수
const dateInput = $("game-date-picker");               // 날짜 입력칸
const teamSelect = $("select-team");                   // 구단 선택 목록 (숨김)
const gameList = $("game-list");                       // 경기 목록을 넣을 상자
const emptyMessage = $("no-game-message");             // 경기가 없을 때 문구
const calendar = $("game-calendar");                   // 달력 상자
const monthCache = new Map();                          // 한 번 받은 달 데이터 저장 (중복 요청 방지)
const scheduleCache = new Map();                       // MLB 선발 투수 데이터 저장
let myFavoriteTeamId = null;                           // 응원 구단 번호 (없으면 null)
let selectedDay = null;                                // 선택한 '일' 숫자 (전체 보기면 null)
let showWholeMonth = false;                            // 달력의 '전체' 체크 (true면 그 달 경기 모두)
let postseasonMode = false;                            // '포스트시즌' 버튼을 눌렀는지 (true면 대진표 + 포스트시즌 경기)

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

// 홈구장 현지 시간대 (승부 예측 페이지 prediction.js와 같은 표, 나머지 구단은 동부 시간)
const TEAM_TIMEZONES = {
    158: "America/Chicago", 112: "America/Chicago", 145: "America/Chicago", 138: "America/Chicago",
    142: "America/Chicago", 118: "America/Chicago", 117: "America/Chicago", 140: "America/Chicago",
    115: "America/Denver", 109: "America/Phoenix",
    119: "America/Los_Angeles", 108: "America/Los_Angeles", 135: "America/Los_Angeles",
    137: "America/Los_Angeles", 136: "America/Los_Angeles", 133: "America/Los_Angeles"
};

// DB의 game_date + game_time(UTC) → 한국 "04:10" / 현지 "09-27 12:10 PDT" (시간 정보가 없으면 null)
function getGameTimes(game) {
    if (!game.game_date || !game.game_time) return null;
    const utc = new Date(`${String(game.game_date).slice(0, 10)}T${String(game.game_time).slice(0, 8)}Z`);
    if (Number.isNaN(utc.getTime())) return null;
    const format = timeZone => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
            timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short"
        }).formatToParts(utc).map(part => [part.type, part.value]));
        return { date: `${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, zone: parts.timeZoneName };
    };
    const kst = format("Asia/Seoul");
    const local = format(TEAM_TIMEZONES[Number(game.home_team_id)] || "America/New_York");
    return { kst: kst.time, local: `${local.date} ${local.time} ${local.zone}` };   // "04:10" / "09-27 12:10 PDT"
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
    $("btn-today").addEventListener("click", goToToday);      // '오늘' 버튼: 오늘 날짜 경기로 이동
    $("btn-calendar").addEventListener("click", toggleCalendar);
    document.addEventListener("click", event => {      // 달력이 열린 상태에서 달력 바깥을 누르면 닫기
        if (calendar.hidden) return;
        const path = event.composedPath();             // 누른 순간의 경로 (달력 안 버튼이 다시 그려져도 정확)
        if (path.includes(calendar) || path.includes($("btn-calendar"))) return;
        calendar.hidden = true;
    });
    // 월 버튼은 init()에서 보여 줄 날짜가 정해진 뒤에 그림 (처음에 4월이 잠깐 보이는 문제 방지)
}

/* ---------- 오늘 / 초기화 버튼 ---------- */

function goToToday() {                 // 오늘 날짜의 경기만 보여 줌 (없으면 기본 '경기 없음' 문구)
    calendar.hidden = true;
    setSelectedDate(formatKey(new Date()));
}

async function goToRecentGame(wholeMonth = false) {   // 가장 최근에 끝난 경기 날짜로 이동 (wholeMonth: 그 달 전체 + 달력 '전체' 체크)
    calendar.hidden = true;
    try {
        // 1) DB에서 가장 최근에 끝난 경기 1개로 '어느 달'인지 찾기
        const response = await fetch(`${API_BASE}/api/games?status=FINAL&limit=1`);
        if (!response.ok) throw new Error(`경기 데이터 API 오류 (${response.status})`);
        const [latestGame] = await response.json();
        if (!latestGame) {
            renderMonthStrip();
            emptyMessage.textContent = "최근 경기 결과가 없습니다.";
            emptyMessage.hidden = false;
            return;
        }
        dateInput.value = String(latestGame.game_date).slice(0, 10); // 최근 경기의 달로 월 버튼 먼저 그리기
        renderMonthStrip();

        // 2) 그 달 경기 중 오늘 이전에 끝난 경기의 마지막 날짜 찾기 (한국 날짜 기준)
        const today = formatKey(new Date());
        let games = await fetchMonthGames(String(latestGame.game_date).slice(0, 10));
        if (teamSelect.value !== "ALL") {
            games = games.filter(g => involvesTeam(g, teamSelect.value)); // 구단을 골랐으면 그 구단 경기만
        }
        const lastDate = games
            .filter(g => g.status === "FINAL" && g.display_date <= today)
            .map(g => g.display_date)
            .sort()
            .pop();

        if (!lastDate) {
            emptyMessage.textContent = "최근 경기 결과가 없습니다.";
            emptyMessage.hidden = false;
            return;
        }
        if (wholeMonth) {                  // 처음 들어올 때: 최근 경기가 있는 달의 모든 경기
            dateInput.value = lastDate;
            selectedDay = null;
            showWholeMonth = true;         // 달력을 열면 '전체'가 체크된 상태
            renderMonthStrip();
            await loadGames();
            return;
        }
        setSelectedDate(lastDate);         // 그 날짜의 경기만 보여 줌
    } catch (error) {
        console.error(error);
        renderMonthStrip();                // 실패해도 월 버튼은 보이게
        emptyMessage.textContent = "최근 경기 데이터를 불러오지 못했습니다.";
        emptyMessage.hidden = false;
    }
}

/* ---------- 날짜 선택 ---------- */

function setSelectedDate(value) {                      // 하루를 고르면 '전체' 체크는 풀림
    if (!value) return;
    exitPostseason();                                  // 날짜를 고르면 포스트시즌 화면에서 나옴
    dateInput.value = value;
    selectedDay = Number(value.slice(-2));             // "2024-04-02" → 2 (일만 저장)
    showWholeMonth = false;
    renderMonthStrip();
    return loadGames();                                // 경기 수를 돌려줌 (오늘 경기 없음 확인용)
}

function changeMonth(year, month) {                    // 연도·월을 바꿔도 같은 '일' 숫자 유지
    exitPostseason();                                  // 월을 고르면 포스트시즌 화면에서 나옴
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(selectedDay ?? Number(dateInput.value.slice(-2)), lastDay); // 31일 → 그 달에 없으면 마지막 날
    dateInput.value = `${year}-${pad(month)}-${pad(day)}`;
    selectedDay = showWholeMonth ? null : day;         // '전체' 체크면 그 달 전체, 아니면 그날만
    renderMonthStrip();
    loadGames();
    if (!calendar.hidden) {                            // 달력이 열려 있으면 달력도 그 달로 다시 그리기
        calendar.dataset.month = dateInput.value.slice(0, 7);
        renderCalendar();
    }
}

function moveYear(delta) {                             // 연도만 바꾸기 (월·일은 그대로)
    const [y, m] = dateInput.value.split("-").map(Number);
    if (postseasonMode) {                              // 포스트시즌 화면이면 그 해 포스트시즌으로
        showPostseason(y + delta);
        return;
    }
    changeMonth(y + delta, m);
}

function setWholeMonth(checked) {                      // 달력의 '전체' 체크 → 달력에 보이는 달 기준
    showWholeMonth = checked;
    const [y, m] = calendar.dataset.month.split("-").map(Number);
    changeMonth(y, m);
}

function renderMonthStrip() {                          // 1월~12월 버튼 그리기
    const [year, selectedMonth] = dateInput.value.split("-").map(Number);
    $("year-display").textContent = year;
    if (!monthAvailability.has(year)) loadMonthAvailability(year);   // 경기가 있는 달 확인 (끝나면 다시 그림)
    const available = monthAvailability.get(year);     // Set이면 그 달들만 누를 수 있음 ("loading"·null이면 모두 누를 수 있음)
    const monthButtons = MONTH_ORDER.map(month => {
        const button = el("button", "month-option", `${month}월`);
        button.type = "button";
        if (available instanceof Set && !available.has(month)) {   // 경기가 하나도 없는 달: 회색 + 누를 수 없음
            button.disabled = true;
            button.title = "이 달에는 경기가 없습니다";
        }
        const selected = !postseasonMode && month === selectedMonth;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.addEventListener("click", () => changeMonth(year, month)); // 누르면 그 달의 같은 '일'로 이동
        return button;
    });
    const postseason = el("button", "month-option postseason-option", "포스트시즌");   // 12월 오른쪽
    postseason.type = "button";
    postseason.classList.toggle("selected", postseasonMode);
    postseason.setAttribute("aria-pressed", String(postseasonMode));
    postseason.addEventListener("click", () => showPostseason(year));
    $("month-strip").replaceChildren(...monthButtons, postseason);
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

    const wholeLabel = el("label", "game-calendar-all");        // '전체' 체크: 그 달 경기 모두 보기
    const wholeCheck = el("input");
    wholeCheck.type = "checkbox";
    wholeCheck.checked = showWholeMonth;
    wholeCheck.addEventListener("change", () => setWholeMonth(wholeCheck.checked));
    wholeLabel.append(wholeCheck, el("span", "", "전체"));

    const grid = el("div", "game-calendar-grid");
    ["일", "월", "화", "수", "목", "금", "토"].forEach(d => grid.append(el("span", "game-calendar-weekday", d)));
    for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i += 1) grid.append(el("span")); // 1일 앞 빈칸

    const lastDay = new Date(year, month, 0).getDate();
    for (let day = 1; day <= lastDay; day += 1) {
        const date = `${monthKey}-${pad(day)}`;
        const button = el("button", "game-calendar-day", String(day));
        button.type = "button";
        if (gameDays.has(date)) button.classList.add("has-games");
        if (!showWholeMonth && date === dateInput.value) button.classList.add("selected");
        button.addEventListener("click", () => {       // 날짜 선택하면 달력 닫기
            calendar.hidden = true;
            setSelectedDate(date);
        });
        grid.append(button);
    }
    calendar.replaceChildren(heading, wholeLabel, grid);

    function navButton(label, delta) {                 // 이전/다음 달 버튼
        const button = el("button", "", label);
        button.type = "button";
        button.addEventListener("click", () => {
            const target = new Date(year, month - 1 + delta, 1);
            if (showWholeMonth) {                      // '전체' 체크 상태면 목록도 그 달 전체 경기로
                changeMonth(target.getFullYear(), target.getMonth() + 1);
                return;
            }
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
        const isTeamView = teamSelect.value !== "ALL";                    // 구단을 골랐는지
        const selectedDate = selectedDay !== null                         // 선택한 날짜 (예: "2024-04-02")
            ? `${dateInput.value.slice(0, 7)}-${pad(selectedDay)}`
            : null;

        let games = await fetchMonthGames(dateInput.value);               // 선택한 달 전체 경기
        if (isTeamView) {
            games = games.filter(g => involvesTeam(g, teamSelect.value)); // 구단 경기만
        }
        if (selectedDate) {
            games = games.filter(g => g.display_date === selectedDate);   // 날짜를 골랐으면 그 날 경기만
        }

        if (games.length === 0) {
            emptyMessage.textContent = "선택한 조건에 맞는 MLB 경기 데이터가 없습니다.";
            emptyMessage.hidden = false;
            return 0;
        }

        gameList.classList.toggle("team-view", isTeamView);               // 구단 선택 시에만 2열 CSS 적용
        gameList.replaceChildren(...createDayGroups(games));
        return games.length;                                              // 보여 준 경기 수
    } catch (error) {
        console.error(error);
        emptyMessage.textContent = "MLB 경기 데이터를 불러오지 못했습니다. FastAPI 서버를 확인해 주세요.";
        emptyMessage.hidden = false;
        return null;                                                      // 불러오기 실패 (경기 없음과 구분)
    }
}

function createDayGroups(games) {                                        // 날짜별 박스 만들기
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
        heading.append(el("h3", "", title));
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
    if (game.status === "CANCELLED") card.classList.add("is-cancelled"); // 취소 경기: 흐리게 (클릭 안 됨)

    const time = el("div", "game-time");               // 위쪽 줄: 한국 시간 + 현지 시간 ……… 구장(오른쪽 끝) (DB 값)
    const times = getGameTimes(game);
    time.append(
        el("strong", "", times ? times.kst : "시간 미정"),                    // 한국 "04:10" (날짜는 목록 제목과 같아서 뺌)
        el("small", "game-local-time", times ? ` (${times.local})` : ""),     // 현지 " (09-27 12:10 PDT)"
        el("small", "game-venue-name", game.venue_name || "구장 정보 없음")   // 구장: 카드 오른쪽 위
    );
    if (game.series_label) time.prepend(el("span", "postseason-game-label", game.series_label));   // 포스트시즌: "WS 7차전"

    const scoreNode = createScoreNode(game, isFinal || isLive);

    const matchup = el("div", "matchup-summary");      // 가운데: 원정팀 · 점수 · 홈팀
    matchup.append(
        createTeamNode(game.away_team_name, game.away_team_code, game.away_logo_url, "away", game.away_team_id, game.away_pitcher, isFav(game.away_team_id)),
        scoreNode,
        createTeamNode(game.home_team_name, game.home_team_code, game.home_logo_url, "home", game.home_team_id, game.home_pitcher, isFav(game.home_team_id))
    );
    if (isFinal && Number(game.away_score) !== Number(game.home_score)) {   // 끝난 경기: 진 구단의 로고·이름을 살짝 흐리게
        const loserSide = Number(game.away_score) < Number(game.home_score) ? "away" : "home";
        matchup.querySelector(`.schedule-team-slot.${loserSide}`)?.classList.add("is-loser");
    }

    if (isFinal) {                                     // 포스트시즌도 같은 경기 상세로 (상세 페이지가 DB에 없으면 MLB에서 불러옴)
        const detailUrl = `game-detail.html?${new URLSearchParams({ id: game.game_id })}`;   // 경기 번호만 (상세 페이지가 번호로 찾음)
        card.classList.add("is-clickable");                    // 끝난 경기: 카드 클릭 → 경기 상세
        card.addEventListener("click", event => {
            if (event.target.closest("a")) return;             // 구단 이름·로고·하이라이트 링크는 원래대로
            saveState();                                       // 상세 페이지로 가기 전에 상태 저장
            location.href = detailUrl;
        });
    }
    if (isFinal) {
        const highlight = el("a", "highlight-button score-highlight-link", "하이라이트");
        highlight.href = `https://www.mlb.com/gameday/${encodeURIComponent(game.game_id)}/video`;
        highlight.target = "_blank";
        highlight.rel = "noopener noreferrer";
        scoreNode.append(highlight);                           // 하이라이트: 점수 바로 아래 (구단 이름이 덜 잘리게)
    }

    card.append(time, matchup);                                // 오른쪽 버튼 칸은 쓰지 않음
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
    const pitcher = el("small", "team-pitcher", pitcherName ? `${pitcherName} 선발` : "선발 미정");   // 선수명 뒤에 '선발'
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
            if (Number(game.away_score) > Number(game.home_score)) { away.className = "winner"; home.className = "loser"; }
            if (Number(game.home_score) > Number(game.away_score)) { home.className = "winner"; away.className = "loser"; }   // 진 쪽은 연하게
        }
        block.append(el("div", "score-line"));
        block.querySelector(".score-line").append(away, el("strong", "score-colon", ":"), home);   // ':'도 점수와 같은 크기 (점수 글자 규칙을 그대로 받음)
    } else if (game.status === "CANCELLED") {          // 취소 경기: 점수 자리에 '취소'만 크게
        block.append(el("span", "scheduled-vs cancelled-mark", "취소"));
        return block;
    } else {
        block.append(el("span", "scheduled-vs", "VS"));
    }
    block.prepend(el("span", "score-caption", STATUS_LABELS[game.status] || game.status || "상태 미정"));   // '경기 종료' 등: 점수 위
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
            const merged = { ...game, ...(schedule.get(String(game.game_id)) || {}) }; // MLB 선발 투수 정보 합치기
            // 한국 날짜로 묶기: DB의 game_date + game_time은 UTC → 한국 시간 날짜 (시간이 없으면 game_date 그대로)
            const startUtc = merged.game_time
                ? `${String(merged.game_date).slice(0, 10)}T${String(merged.game_time).slice(0, 8)}Z`
                : null;
            return { ...merged, display_date: koreanDate(startUtc, merged.game_date) };
        })
        .filter(game => game.display_date.startsWith(monthKey)); // 요청한 달만 남기기
    games.push(...await postseasonGamesInMonth(monthKey));     // 9~11월: 포스트시즌 경기도 함께 (MLB에서 바로)

    monthCache.set(monthKey, games);
    return games;
}

async function postseasonGamesInMonth(monthKey) {      // 그 달(한국 날짜)에 열린 포스트시즌 경기 — 우리 DB에 있는 시즌만
    const [year, month] = monthKey.split("-").map(Number);
    if (month < 9 || month > 11) return [];            // 포스트시즌은 9월 말 ~ 11월 초
    try {
        if (!(await getDbSeasons()).includes(year)) return [];
        return (await fetchPostseason(year)).flatMap(s => s.games).filter(g => g.display_date.startsWith(monthKey));
    } catch (error) {
        console.warn("포스트시즌 경기를 불러오지 못해 정규시즌 경기만 표시합니다.", error);
        return [];
    }
}

/* ---------- 경기가 있는 달 (없는 달 버튼은 회색 · 누를 수 없음) ---------- */

const monthAvailability = new Map();                   // 연도 → 경기가 있는 달 Set (불러오는 중이면 "loading")

async function loadMonthAvailability(year) {           // 정규시즌 기간(MLB 시즌 정보) + 포스트시즌 경기 날짜로 계산
    monthAvailability.set(year, "loading");
    const months = new Set();
    try {
        if ((await getDbSeasons()).includes(year)) {   // 우리 DB에 없는 시즌은 모든 달이 비어 있음
            const response = await fetch(`https://statsapi.mlb.com/api/v1/seasons/${year}?sportId=1`, { signal: AbortSignal.timeout(8000) });
            const season = (await response.json()).seasons?.[0];
            if (season?.regularSeasonStartDate && season?.regularSeasonEndDate) {
                const end = shiftDate(season.regularSeasonEndDate, 1);   // 미국 마지막 밤 경기는 한국 날짜로 다음 날
                for (let d = season.regularSeasonStartDate.slice(0, 7); d <= end.slice(0, 7); d = shiftDate(`${d}-28`, 7).slice(0, 7)) {
                    months.add(Number(d.slice(5, 7)));
                }
            }
            (await fetchPostseason(year)).flatMap(s => s.games)
                .filter(g => g.status !== "CANCELLED")
                .forEach(g => months.add(Number(g.display_date.slice(5, 7))));
        }
        monthAvailability.set(year, months);
    } catch (error) {
        console.warn("경기가 있는 달을 확인하지 못해 모든 달을 누를 수 있게 둡니다.", error);
        monthAvailability.set(year, null);             // 모르면 막지 않음
    }
    if ($("year-display").textContent === String(year)) renderMonthStrip();   // 결과가 오면 월 버튼 다시 그리기
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

async function loadScheduleInfo(start, end) {          // MLB에서 선발 투수만 가져오기 (시간·구장은 DB 사용)
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
                away_pitcher: item.teams?.away?.probablePitcher?.fullName || "",
                home_pitcher: item.teams?.home?.probablePitcher?.fullName || ""
            });
        });
    } catch (error) {
        console.warn("MLB 선발 투수 정보를 불러오지 못했습니다.", error);
    }
    scheduleCache.set(key, info);
    return info;
}

/* ---------- 포스트시즌 (서버·DB 없이 MLB 공식 API에서 바로 불러옴) ---------- */

const POSTSEASON_ROUNDS = [                            // [MLB 경기 종류 코드, 이름, 약자] — 대진표 왼쪽부터
    ["F", "와일드카드", "WC"], ["D", "디비전 시리즈", "DS"], ["L", "챔피언십 시리즈", "CS"], ["W", "월드시리즈", "WS"]
];
const postseasonCache = new Map();                     // 시즌별로 한 번 받은 결과 저장
const teamLogoUrl = teamId => `https://www.mlbstatic.com/team-logos/${teamId}.svg`;   // DB 로고 주소와 같은 모양
const capLogoUrl = teamId => `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`;   // 어두운 바탕용 모자 로고 (대진표)

// 대진표 동그란 배지 바탕색: 구단 대표(모자) 색 (MLB 'Postseason Picture'처럼)
const TEAM_COLORS = {
    108: "#BA0021", 109: "#A71930", 110: "#27251F", 111: "#0C2340", 112: "#0E3386", 113: "#C6011F",
    114: "#00385D", 115: "#33006F", 116: "#0C2340", 117: "#002D62", 118: "#004687", 119: "#005A9C",
    120: "#AB0003", 121: "#002D72", 133: "#003831", 134: "#27251F", 135: "#2F241D", 136: "#0C2C56",
    137: "#27251F", 138: "#C41E3A", 139: "#092C5C", 140: "#003278", 141: "#134A8E", 142: "#002B5C",
    143: "#E81828", 144: "#13274F", 145: "#27251F", 146: "#14171A", 147: "#0C2340", 158: "#12284B"
};

async function showPostseason(year) {                  // '포스트시즌' 버튼: 구단 목록 대신 대진표, 아래에 포스트시즌 경기
    postseasonMode = true;
    calendar.hidden = true;
    dateInput.value = `${year}-10-01`;                 // 연도 표시용 (월을 다시 누르면 그 달로 돌아감)
    renderMonthStrip();
    $("team-filter").style.display = "none";
    const bracket = $("postseason-bracket");
    bracket.hidden = false;
    bracket.replaceChildren(el("p", "postseason-message", "포스트시즌 대진을 불러오는 중입니다..."));
    gameList.replaceChildren();
    emptyMessage.hidden = true;
    try {
        const dbSeasons = await getDbSeasons();
        if (!dbSeasons.includes(year)) {               // 우리 DB에 없는 시즌은 외부(MLB)에서도 가져오지 않음
            bracket.replaceChildren(el("p", "postseason-message", `${year} 시즌은 BASEBOT DB에 정보가 없어 포스트시즌을 표시하지 않습니다.`));
            return;
        }
        const series = await fetchPostseason(year);
        if (!postseasonMode || $("year-display").textContent !== String(year)) return;   // 불러오는 사이 다른 버튼을 누른 경우
        if (!series.length) {
            bracket.replaceChildren(el("p", "postseason-message", `${year} 시즌 포스트시즌 경기가 아직 없습니다.`));
            return;
        }
        postseasonSeries = series;
        psRound = series[series.length - 1].code;      // 처음엔 가장 최근 라운드 탭 (예: 월드시리즈 진행 중이면 WS)
        psLeague = "ALL";
        psSeriesId = null;
        const pct = await getSeasonPct(year);            // 시드(1~6번) 계산용 승률 (우리 DB 순위)
        if (!postseasonMode || $("year-display").textContent !== String(year)) return;
        renderPostseasonBracket(bracket, series, pct, year);
        renderPostseasonGames();
    } catch (error) {
        console.error(error);
        bracket.replaceChildren(el("p", "postseason-message", "포스트시즌 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    }
}

async function isPostseasonMonth(today) {             // 오늘이 속한 달(한국 날짜)에 포스트시즌 경기가 있는지
    try {
        const year = today.getFullYear();
        if (!(await getDbSeasons()).includes(year)) return false;   // 우리 DB에 없는 시즌은 보지 않음
        const monthKey = formatKey(today).slice(0, 7);  // 예: "2026-10"
        return (await fetchPostseason(year)).some(s => s.games.some(g => g.display_date.startsWith(monthKey)));
    } catch (error) {
        console.warn("포스트시즌 기간 확인 실패 → 이번 달 경기로 시작", error);
        return false;
    }
}

function exitPostseason() {                            // 월·날짜를 고르면 원래 화면(구단 목록)으로
    if (!postseasonMode) return;
    postseasonMode = false;
    $("team-filter").style.display = "";
    $("postseason-bracket").hidden = true;
}

let dbSeasonsPromise = null;                           // 우리 DB에 있는 시즌 목록 (한 번만 받음)

function getDbSeasons() {                              // 순위 API의 seasons = DB에 끝난 경기가 있는 시즌 (예: [2026, 2025, 2024])
    if (!dbSeasonsPromise) {
        dbSeasonsPromise = fetch(`${API_BASE}/api/standings`)
            .then(response => {
                if (!response.ok) throw new Error(`순위 API 오류 (${response.status})`);
                return response.json();
            })
            .then(data => (data.seasons || []).map(Number))
            .catch(error => { dbSeasonsPromise = null; throw error; });   // 실패하면 다음에 다시 시도
    }
    return dbSeasonsPromise;
}

async function fetchPostseason(year) {                 // MLB에서 시리즈별 경기를 받아 대진·경기 카드용으로 정리
    if (postseasonCache.has(year)) return postseasonCache.get(year);
    const url = `https://statsapi.mlb.com/api/v1/schedule/postseason/series?season=${year}&sportId=1&hydrate=probablePitcher,team`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`MLB 포스트시즌 API 오류 (${response.status})`);
    const data = await response.json();

    const roundIndex = code => POSTSEASON_ROUNDS.findIndex(([c]) => c === code);
    const series = (data.series || []).map(item => {
        const games = (item.games || []).filter(g => g.status?.detailedState !== "Cancelled");   // 열리지 않은 '필요 시' 경기 제외
        const first = games[0];
        const round = first && POSTSEASON_ROUNDS[roundIndex(first.gameType)];
        if (!round) return null;
        const teams = [first.teams.away.team, first.teams.home.team];       // MLB 대진표 기준: 하위 시드(1차전 원정) 위, 상위 시드(1차전 홈) 아래
        const wins = Object.fromEntries(teams.map(team => [team.id, 0]));
        games.forEach(game => ["home", "away"].forEach(side => {              // 끝난 경기의 승리 팀 세기
            const info = game.teams[side];
            if (game.status?.abstractGameState === "Final" && info.isWinner && info.team.id in wins) wins[info.team.id] += 1;
        }));
        const need = Math.floor((first.gamesInSeries || 0) / 2) + 1;         // 3전 2선승, 5전 3선승, 7전 4선승
        const description = first.seriesDescription || "";
        return {
            id: item.series?.id || `${round[0]}_${first.gamePk}`,          // 시리즈 구분 번호 (예: "D_1")
            code: round[0],
            league: /^(AL|NL)/.test(description) ? description.slice(0, 2) : "",   // 월드시리즈는 빈칸
            bestOf: first.gamesInSeries,
            need,
            teams: teams.map(team => ({ id: team.id, name: team.name, abbr: team.abbreviation || "", wins: wins[team.id], isWinner: wins[team.id] >= need })),
            games: games.map(game => toPostseasonGame(game, round[2]))
        };
    }).filter(Boolean).sort((a, b) => roundIndex(a.code) - roundIndex(b.code) || a.league.localeCompare(b.league));

    postseasonCache.set(year, series);
    return series;
}

function toPostseasonGame(game, short) {               // MLB 경기 → 경기 카드(createGameCard)가 쓰는 모양
    const state = game.status?.abstractGameState;
    const status = game.status?.detailedState === "Postponed" ? "CANCELLED"
        : state === "Final" ? "FINAL" : state === "Live" ? "IN_PROGRESS" : "SCHEDULED";
    const side = name => {
        const info = game.teams[name];
        return {
            [`${name}_team_id`]: info.team.id,
            [`${name}_team_name`]: info.team.name,
            [`${name}_team_code`]: info.team.abbreviation,
            [`${name}_logo_url`]: teamLogoUrl(info.team.id),
            [`${name}_score`]: info.score,
            [`${name}_pitcher`]: info.probablePitcher?.fullName || ""
        };
    };
    return {
        game_id: game.gamePk,
        is_postseason: true,
        series_label: `${short} ${game.seriesGameNumber}차전`,        // 예: "WS 7차전"
        status,
        scheduled_at: game.gameDate,
        game_date: game.gameDate.slice(0, 10),                         // UTC (정규시즌 DB와 같은 기준)
        game_time: game.status?.startTimeTBD ? null : game.gameDate.slice(11, 19),
        display_date: koreanDate(game.gameDate, game.gameDate),        // 한국 날짜로 묶기
        venue_name: game.venue?.name,
        ...side("away"),
        ...side("home")
    };
}

// 대진표 포스터: MLB 'Postseason Picture'와 같은 배치 (1536×864 그림 좌표, 화면 폭에 맞춰 늘고 줄어듦)
let postseasonSeries = [];                             // 지금 보고 있는 시즌의 시리즈 목록
let psRound = "W";                                     // 아래 탭에서 고른 라운드 (F / D / L / W)
let psLeague = "ALL";                                  // 리그 선택 (ALL / AL / NL)
let psSeriesId = null;                                 // 대진표에서 누른 시리즈 (그 시리즈 경기만 보기)

const POSTER = {                                       // AL(왼쪽) 기준 좌표, NL은 좌우를 뒤집어서 사용
    r: 50,                                             // 로고 동그라미 반지름
    wc: { x: 135, ys: [[63, 212], [405, 558]], joinX: 275 },   // 와일드카드: 위 짝(6·3), 아래 짝(5·4)
    ds: { x: 355, ys: [[135, 293], [486, 644]], joinX: 440 },  // 디비전: 위(WC 승자·2번), 아래(WC 승자·1번)
    cs: { x: 520, ys: [[216, 563]], joinX: 610 },              // 챔피언십
    ws: { x: 690, y: 351, r: 52 },                             // 월드시리즈 (AL 쪽 로고)
    champion: { x: 768, y: 504, r: 60 }                        // 우승 팀
};
const mirrorX = (x, league) => (league === "NL" ? 1536 - x : x);
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, text = "") {           // SVG 요소 만들기
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== "") node.textContent = text;
    return node;
}

const seasonPctCache = new Map();
async function getSeasonPct(year) {                    // 우리 DB 순위로 구단별 승률 (1·2번 시드 구분용) + 리그 순위(pct.rank)
    if (seasonPctCache.has(year)) return seasonPctCache.get(year);
    const pct = new Map();
    pct.rank = new Map();                              // 구단 → 정규리그 순위 (AL·NL 각각 승률순 1~15위)
    try {
        const response = await fetch(`${API_BASE}/api/standings?season=${encodeURIComponent(year)}`);
        if (response.ok) {
            const divisions = (await response.json()).divisions;
            divisions.forEach(d => d.teams.forEach(t => pct.set(t.team_id, Number(t.pct) || 0)));
            ["AL", "NL"].forEach(league => divisions
                .filter(d => d.league === league)
                .flatMap(d => d.teams)
                .sort((a, b) => (Number(b.pct) || 0) - (Number(a.pct) || 0) || (b.wins || 0) - (a.wins || 0))
                .forEach((t, i) => pct.rank.set(t.team_id, i + 1)));
        }
    } catch (error) {
        console.warn("순위(승률)를 불러오지 못해 시드는 표시하지 않습니다.", error);
    }
    seasonPctCache.set(year, pct);
    return pct;
}

// 리그별로 포스터 자리에 시리즈·팀 배치 + 시드 계산 (시리즈 teams = [1차전 원정(하위 시드), 1차전 홈(상위 시드)])
function layoutLeague(series, league, pct) {
    const wc = series.filter(s => s.code === "F" && s.league === league);
    const ds = series.filter(s => s.code === "D" && s.league === league);
    const cs = series.find(s => s.code === "L" && s.league === league) || null;
    const seeds = new Map();
    const hosts = ds.map(s => s.teams[1]).sort((a, b) => (pct.get(b.id) ?? 0) - (pct.get(a.id) ?? 0));   // DS 홈팀 = 1·2번 시드 (승률 높은 쪽이 1번)
    const dsTop = ds.find(s => s.teams[1].id === hosts[1]?.id) || ds[0] || null;   // 위: 2번 시드가 있는 DS
    const dsBottom = ds.find(s => s !== dsTop) || null;                             // 아래: 1번 시드가 있는 DS
    const shares = (a, b) => a && b && a.teams.some(t => b.teams.some(x => x.id === t.id));
    const wcTop = wc.find(w => shares(w, dsTop)) || wc[0] || null;                  // 2번 시드와 만나는 WC = 3번 vs 6번
    const wcBottom = wc.find(w => w !== wcTop) || null;                              // 1번 시드와 만나는 WC = 4번 vs 5번
    if (pct.size && ds.length === 2) {
        seeds.set(dsBottom.teams[1].id, 1).set(dsTop.teams[1].id, 2);
        if (wcTop) seeds.set(wcTop.teams[1].id, 3).set(wcTop.teams[0].id, 6);
        if (wcBottom) seeds.set(wcBottom.teams[1].id, 4).set(wcBottom.teams[0].id, 5);
    }
    let csTeams = cs ? cs.teams : [];
    if (cs && dsTop && !shares({ teams: [cs.teams[0]] }, dsTop)) csTeams = [cs.teams[1], cs.teams[0]];   // CS 위 = 위쪽 DS 승자
    return { wc: [wcTop, wcBottom], ds: [dsTop, dsBottom], cs, csTeams, seeds };
}

function seriesResultText(item) {                      // 시리즈 스코어만: "2-1" (많이 이긴 쪽 먼저, 아직 경기 없으면 빈칸)
    const [a, b] = item.teams;
    if (a.wins + b.wins === 0) return "";
    return `${Math.max(a.wins, b.wins)}-${Math.min(a.wins, b.wins)}`;
}

function renderPostseasonBracket(box, series, pct, year) {
    const svg = svgEl("svg", { viewBox: "0 0 1536 712", class: "ps-poster", role: "img", "aria-label": `${year} MLB 포스트시즌 대진표` });
    const defs = svgEl("defs");
    const shadow = svgEl("filter", { id: "ps-shadow", x: "-30%", y: "-30%", width: "160%", height: "160%" });
    shadow.append(svgEl("feDropShadow", { dx: "0", dy: "5", stdDeviation: "5", "flood-color": "#000", "flood-opacity": "0.35" }));
    defs.append(shadow);
    svg.append(defs);
    const lines = svgEl("g", { class: "ps-lines" });
    const winLines = svgEl("g", { class: "ps-lines win" });   // 이겨서 올라간 길 (굵게, 위에 그림)
    const marks = svgEl("g");                          // 로고·글자
    svg.append(lines, winLines, marks);

    const line = (d, isWin) => (isWin ? winLines : lines).append(svgEl("path", { d }));
    const text = (x, y, value, cls, lines2) => {       // 글자 (lines2: 두 줄로 나눌 때)
        const node = svgEl("text", { x, y, class: cls, "text-anchor": "middle" });
        (lines2 || [value]).forEach((part, i) => node.append(svgEl("tspan", { x, dy: i ? "1.1em" : "0" }, part)));
        marks.append(node);
    };
    const selectSeries = item => {                     // 시리즈 누르기 → 아래에 그 시리즈 경기 (탭도 그 라운드로)
        psSeriesId = item.id;
        psRound = item.code;
        renderPostseasonGames();
        gameList.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const growSeries = (id, on) =>                     // 한 시리즈(경기한 두 구단)의 로고를 함께 크게
        svg.querySelectorAll(`.ps-badge[data-series="${id}"]`).forEach(node => node.classList.toggle("grow", on));
    let favTagShown = false;                           // '★ MY'는 선호 구단이 처음 나오는 자리 한 곳만
    const badge = (x, y, r, team, faded, seed, seedBelow, seriesItem) => {   // 구단 색 동그라미 + 모자 로고 (+ 시드 번호)
        const g = svgEl("g", { class: "ps-badge" });
        if (team && seriesItem) {                      // 로고를 눌러도 그 시리즈 경기, 마우스를 올리면 그 시리즈 두 로고가 커짐
            g.classList.add("clickable");
            g.dataset.series = seriesItem.id;
            g.addEventListener("click", () => selectSeries(seriesItem));
            g.addEventListener("mouseenter", () => growSeries(seriesItem.id, true));
            g.addEventListener("mouseleave", () => growSeries(seriesItem.id, false));
        }
        if (!team) {                                   // 아직 정해지지 않은 자리
            g.append(svgEl("circle", { cx: x, cy: y, r, class: "ps-empty" }));
            marks.append(g);
            return;
        }
        g.append(svgEl("circle", { cx: x, cy: y, r, class: "ps-backdrop" }));   // 배경색 동그라미: 흐린 로고 뒤로 선이 비치지 않게
        const face = svgEl("g", { class: faded ? "ps-face loser" : "ps-face" });   // 진 팀은 이 부분만 흐리게
        face.append(svgEl("circle", { cx: x, cy: y, r, fill: TEAM_COLORS[team.id] || "#152b52", class: "ps-ring", filter: "url(#ps-shadow)" }));
        const size = r * 1.2;
        const img = svgEl("image", { x: x - size / 2, y: y - size / 2, width: size, height: size, href: capLogoUrl(team.id) });
        img.addEventListener("error", () => img.setAttribute("href", teamLogoUrl(team.id)), { once: true });
        face.append(img);
        const rank = r < 60 ? pct.rank?.get(team.id) : null;   // 정규리그 순위: 로고 동그라미 안쪽 왼쪽 위 작은 숫자 (모양은 그대로, 우승 팀 자리는 뺌)
        if (rank) face.append(svgEl("text", { x: x - r * 0.5, y: y - r * 0.3, "text-anchor": "middle", class: "ps-rank-text" }, String(rank)));
        g.append(face, svgEl("title", {}, team.name));
        marks.append(g);
        if (myFavoriteTeamId && String(team.id) === String(myFavoriteTeamId)) {   // 선호 구단: 금색 테두리는 모든 자리, '★ MY'는 처음 한 곳만
            g.querySelector(".ps-ring").classList.add("favorite");
            if (favTagShown) return;
            favTagShown = true;
            const tag = svgEl("g", { class: "ps-fav" });
            const top = y - r - 14;                    // 로고 위쪽 (테두리에 살짝 걸치게)
            tag.append(svgEl("rect", { x: x - 30, y: top, width: 60, height: 24, rx: 12 }),
                svgEl("text", { x, y: top + 18, "text-anchor": "middle" }, "★ MY"));
            marks.append(tag);
        }
    };
    const hit = (item, x1, y1, x2, y2) => {            // 시리즈 누르는 영역 → 아래에 그 시리즈 경기
        if (!item) return;
        const area = svgEl("rect", { x: x1, y: y1, width: x2 - x1, height: y2 - y1, rx: 24, class: "ps-hit", "data-id": item.id });
        area.append(svgEl("title", {}, `${item.teams.map(t => `${t.name} ${t.wins}승`).join(" vs ")} · 누르면 경기 기록`));
        area.addEventListener("click", () => selectSeries(item));
        area.addEventListener("mouseenter", () => growSeries(item.id, true));
        area.addEventListener("mouseleave", () => growSeries(item.id, false));
        svg.insertBefore(area, lines);                 // 선·로고보다 아래 (로고에 마우스 올림이 되도록, 빈 곳을 눌러도 선택)
    };
    // 한 시리즈: 위·아래 로고 + 가운데 결과 글자 + 다음 라운드 자리로 이어지는 선
    const drawSeries = (item, teams, x, [yTop, yBottom], league, join, next, seedsOn, resultLines, resultY = null, byeSeedOnly = false) => {
        const r = POSTER.r;
        const winner = item?.teams.find(t => t.isWinner);
        const dir = league === "NL" ? -1 : 1;          // AL은 오른쪽으로, NL은 왼쪽으로 이어짐
        [[teams[0], yTop, false], [teams[1], yBottom, true]].forEach(([team, y, below]) => {
            const showSeed = seedsOn && team && (!byeSeedOnly || below);   // DS는 아래(쉬고 올라온 1·2번)만 시드 표시
            badge(x, y, r, team, winner && team && team.id !== winner.id, showSeed ? seedsOn.get(team.id) : null, below, item);
            if (!next || !team) return;
            const start = x + dir * r;
            const isWin = winner && team.id === winner.id;
            line(isWin ? `M${start} ${y} H${join} V${next.y} H${next.x - dir * next.r}` : `M${start} ${y} H${join} V${next.y}`, isWin);
        });
        if (next && !winner) line(`M${join} ${next.y} H${next.x - dir * next.r}`, false);   // 아직 아무도 안 올라감
        const result = item ? seriesResultText(item) : "";
        if (result) text(x, resultY ?? (yTop + yBottom) / 2 + 10, result, "ps-result");   // 스코어: 두 로고 사이 정중앙 (resultY가 있으면 그 높이)
        hit(item, x - r - 14, yTop - r - 14, x + r + 40, yBottom + r + 14);
    };

    ["AL", "NL"].forEach(league => {
        const L = layoutLeague(series, league, pct);
        const mx = x => mirrorX(x, league);
        const wsX = mx(POSTER.ws.x);
        // 와일드카드 → 디비전 (위 짝은 DS 위쪽 첫 자리, 아래 짝은 DS 아래쪽 첫 자리)
        POSTER.wc.ys.forEach((ys, i) => {
            const item = L.wc[i];
            const target = { x: mx(POSTER.ds.x), y: POSTER.ds.ys[i][0], r: POSTER.r };
            if (item) drawSeries(item, item.teams, mx(POSTER.wc.x), ys, league, mx(POSTER.wc.joinX), target, L.seeds, false);
        });
        // 디비전 → 챔피언십 (위 DS 승자는 CS 위, 아래 DS 승자는 CS 아래)
        POSTER.ds.ys.forEach((ys, i) => {
            const item = L.ds[i];
            const target = { x: mx(POSTER.cs.x), y: POSTER.cs.ys[0][i], r: POSTER.r };
            if (item) drawSeries(item, item.teams, mx(POSTER.ds.x), ys, league, mx(POSTER.ds.joinX), L.cs || item.teams.some(t => t.isWinner) ? target : null, L.seeds, true, null, true);
            else if (L.wc[i]) badge(mx(POSTER.ds.x), ys[0], POSTER.r, null);
        });
        // 챔피언십 → 월드시리즈
        const csTarget = { x: wsX, y: POSTER.ws.y, r: POSTER.ws.r };
        if (L.cs) drawSeries(L.cs, L.csTeams, mx(POSTER.cs.x), POSTER.cs.ys[0], league, mx(POSTER.cs.joinX), csTarget, null, true, 432);   // 스코어: 'ALCS' 글자와 아래 로고 사이 빈 공간 가운데
        // 리그 이름 표시 (그림의 'WILDCARD', 'ALDS', 'ALCS' 자리)
        const rule = code => {                         // 몇 전 몇 선승제 (예: "3전 2선승제")
            const item = series.find(s => s.code === code);
            return item ? `${item.bestOf}전 ${item.need}선승제` : "";
        };
        text(mx(POSTER.wc.x), 292, rule("F"), "ps-rule");   // 와일드카드 문구: 두 짝 사이 가운데
        text(mx(POSTER.wc.x), 314, league === "AL" ? "AMERICAN LEAGUE" : "NATIONAL LEAGUE", "ps-label-small");
        text(mx(POSTER.wc.x), 347, "WILDCARD", "ps-label");
        text(mx(POSTER.ds.x) + (league === "AL" ? 8 : -8), 373, rule("D"), "ps-rule");
        text(mx(POSTER.ds.x) + (league === "AL" ? 8 : -8), 407, `${league}DS`, "ps-label");
        text(mx(POSTER.cs.x), 326, rule("L"), "ps-rule");
        text(mx(POSTER.cs.x), 360, `${league}CS`, "ps-label");
    });

    // 월드시리즈: AL 팀 왼쪽 · NL 팀 오른쪽, 끝나면 아래에 우승 팀
    const ws = series.find(s => s.code === "W");
    const alIds = series.filter(s => s.league === "AL").flatMap(s => s.teams.map(t => t.id));
    const wsTeams = ws ? [...ws.teams].sort((a, b) => Number(!alIds.includes(a.id)) - Number(!alIds.includes(b.id))) : [null, null];
    const champion = ws?.teams.find(t => t.isWinner) || null;
    const C = POSTER.champion;
    [["AL", wsTeams[0]], ["NL", wsTeams[1]]].forEach(([league, team]) => {
        const x = mirrorX(POSTER.ws.x, league);
        badge(x, POSTER.ws.y, POSTER.ws.r, team, champion && team && team.id !== champion.id, null, false, ws);
        if (!team) return;
        const isWin = champion && team.id === champion.id;
        const joinY = POSTER.ws.y + POSTER.ws.r + 30;
        line(isWin ? `M${x} ${POSTER.ws.y + POSTER.ws.r} V${joinY} H${C.x} V${C.y - C.r}` : `M${x} ${POSTER.ws.y + POSTER.ws.r} V${joinY} H${C.x}`, isWin);
    });
    if (champion) {
        badge(C.x, C.y, C.r, champion, false);
    } else if (ws) {
        badge(C.x, C.y, C.r, null);
    }
    text(C.x, C.y + C.r + 40, "CHAMPION", "ps-winner");   // 우승 팀 자리 아래 'CHAMPION'
    if (ws && seriesResultText(ws)) text(768, POSTER.ws.y + 10, seriesResultText(ws), "ps-result");   // 월드시리즈 스코어: 두 로고 사이 정중앙
    if (ws) hit(ws, mirrorX(POSTER.ws.x, "AL") - 70, POSTER.ws.y - 70, mirrorX(POSTER.ws.x, "NL") + 70, POSTER.ws.y + 70);

    // 가운데 위: MLB 로고 + 'POSTSEASON' + 연도
    marks.append(svgEl("image", { x: 723, y: 4, width: 90, height: 50, href: "https://www.mlbstatic.com/team-logos/league-on-light/1.svg" }));
    text(768, 114, "POSTSEASON", "ps-title");
    text(768, 160, String(year), "ps-year");   // 연도: POSTSEASON 아래, 크게
    // 월드시리즈 로고 위: 몇 전 몇 선승제 → 'World Series'
    if (ws) text(768, 200, `${ws.bestOf}전 ${ws.need}선승제`, "ps-rule");   // 위·아래 글자와 간격 같게
    text(768, 250, "World Series", "ps-ws-title");

    // 아래: 라운드 탭 + 리그 선택 → 경기 목록 거르기 (네이버 스포츠 포스트시즌 화면 참고)
    const tabs = el("div", "ps-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.append(...POSTSEASON_ROUNDS.map(([code, name]) => {
        const tab = el("button", "ps-tab", name.replace(" ", ""));   // "디비전 시리즈" → "디비전시리즈"
        tab.type = "button";
        tab.dataset.round = code;
        tab.setAttribute("role", "tab");
        tab.disabled = !series.some(s => s.code === code);          // 아직 없는 라운드는 누를 수 없음
        tab.addEventListener("click", () => { psRound = code; psSeriesId = null; renderPostseasonGames(); });
        return tab;
    }));
    const league = el("select", "ps-league-select");
    league.setAttribute("aria-label", "리그 선택");
    league.append(new Option("리그 전체", "ALL"), new Option("아메리칸리그 (AL)", "AL"), new Option("내셔널리그 (NL)", "NL"));
    league.addEventListener("change", () => { psLeague = league.value; psSeriesId = null; renderPostseasonGames(); });

    box.replaceChildren(svg, tabs, league);
}

function renderPostseasonGames() {                     // 고른 라운드·리그의 경기만 날짜별 카드로
    document.querySelectorAll(".ps-tab").forEach(tab => {
        const selected = tab.dataset.round === psRound;
        tab.classList.toggle("selected", selected);
        tab.setAttribute("aria-selected", String(selected));
    });
    const league = document.querySelector(".ps-league-select");
    if (league) {
        league.value = psLeague;
        league.disabled = psRound === "W";             // 월드시리즈는 두 리그가 만나서 리그 선택 없음
    }
    document.querySelectorAll(".ps-hit").forEach(area => area.classList.toggle("selected", area.dataset.id === psSeriesId));   // 누른 시리즈 표시
    const games = postseasonSeries
        .filter(s => psSeriesId                        // 대진표에서 시리즈를 눌렀으면 그 시리즈 경기만
            ? s.id === psSeriesId
            : s.code === psRound && (psRound === "W" || psLeague === "ALL" || s.league === psLeague))
        .flatMap(s => s.games);
    gameList.classList.remove("team-view");
    emptyMessage.hidden = games.length !== 0;
    if (!games.length) emptyMessage.textContent = "선택한 조건에 맞는 포스트시즌 경기가 없습니다.";
    gameList.replaceChildren(...createDayGroups(games));   // 날짜별 경기 카드 (정규시즌과 같은 모양)
}

/* ---------- 시작 ---------- */
/* ---------- 목록 상태 저장·복원 ---------- */

const STATE_KEY = "gameListState";                     // 저장할 이름

function saveState() {                                 // 지금 화면 상태를 저장
    sessionStorage.setItem(STATE_KEY, JSON.stringify({
        date: dateInput.value,                         // 선택한 달·날짜
        day: selectedDay,                              // 선택한 '일' (없으면 null)
        team: teamSelect.value,                        // 선택한 구단
        scrollY: window.scrollY,                       // 스크롤 위치
        postseason: postseasonMode ? {                 // 포스트시즌 화면이었으면: 시즌·라운드 탭·리그·누른 시리즈
            year: Number($("year-display").textContent),
            round: psRound,
            league: psLeague,
            seriesId: psSeriesId
        } : null
    }));
}

function takeSavedState() {                            // 저장한 상태를 꺼내고 지움
    const text = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);              // 한 번만 쓰도록 지움
    try { return text ? JSON.parse(text) : null; } catch { return null; }
}
async function init() {
    setupEvents();
    addTeamOption("ALL", "전체 구단", "", "MLB");
    const teamFilter = $("team-filter");
    teamFilter.style.display = "none";                 // 첫 화면(포스트시즌인지)이 정해질 때까지 구단 목록 숨김 → 떴다 사라지는 깜빡임 방지
    const postseasonCheck = isPostseasonMonth(new Date());   // 구단 목록을 받는 동안 포스트시즌 기간인지 함께 확인
    await loadTeams();                                 // 구단 목록이 먼저 만들어져야 구단을 복원할 수 있음
    const openToday = new URLSearchParams(location.search).get("date") === "today"; // 메인 '더보기 +'로 들어온 경우
    const savedState = takeSavedState();               // 저장된 상태 꺼내기 (꺼내면서 지움)
    const saved = openToday ? null : savedState;       // 오늘 보기면 저장된 상태는 쓰지 않음
    if (saved?.postseason) {                           // 포스트시즌 화면에서 경기 상세로 갔다가 돌아온 경우 → 그 화면 그대로
        const { year, round, league, seriesId } = saved.postseason;
        await showPostseason(year);
        psRound = round;
        psLeague = league;
        psSeriesId = seriesId;
        renderPostseasonGames();                       // 보던 라운드 탭·리그·시리즈의 경기 목록
        window.scrollTo({ top: saved.scrollY, behavior: "instant" });
        return;
    }
    if (openToday) {
        const today = formatKey(new Date());
        dateInput.value = today;                       // 오늘 날짜 선택 (구단은 기본값 '전체 구단')
        selectedDay = Number(today.slice(-2));
        renderMonthStrip();
        history.replaceState(null, "", location.pathname); // 주소의 ?date=today 지우기 (뒤로 가기 때 화면 복원되도록)
    } else if (saved) {
        dateInput.value = saved.date;                  // 달·날짜 복원
        selectedDay = saved.day;                       // 선택한 일 복원
        showWholeMonth = saved.day === null;           // 일이 없으면 '전체' 보기였음
        teamSelect.value = saved.team;                 // 구단 복원
        updateTeamRail();                              // 구단 버튼 표시 갱신
        renderMonthStrip();                            // 월 버튼 표시 갱신
    }
    if (openToday || saved) {
        teamFilter.style.display = "";                 // 정규시즌 화면 → 구단 목록 보이기
        const count = await loadGames();               // 오늘 보기 / 뒤로 가기 복원 → 그 날짜 경기 그리기
        if (openToday && count === 0) await goToRecentGame(); // 오늘 경기가 없으면 최근 경기 날짜로
    } else {
        // 그냥 들어오면 → 오늘이 속한 달 전체 ('전체' 체크). 예: 10월 22일이면 10월 경기 모두
        dateInput.value = formatKey(new Date());
        selectedDay = null;
        showWholeMonth = true;
        if (await postseasonCheck) {                   // 이번 달에 포스트시즌 경기가 있으면 포스트시즌 화면 먼저
            await showPostseason(new Date().getFullYear());
        } else {
            teamFilter.style.display = "";             // 정규시즌 화면 → 구단 목록 보이기
            renderMonthStrip();
            await loadGames();
        }
    }
    if (saved) window.scrollTo({ top: saved.scrollY, behavior: "instant" }); // 스크롤 위치 복원
}

init();