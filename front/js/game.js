const API_BASE = "";                                  // API 주소의 앞부분 (같은 서버면 빈 문자열)
const DEFAULT_DATE = "2024-04-01";                    // 처음 화면에 보여 줄 날짜
const MONTH_ORDER = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]; // 월 버튼을 놓을 순서 (9월부터 8월까지)
const STATUS_LABELS = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" }; // 영어 상태값을 한글로 바꾸는 표

const dateInput = document.getElementById("game-date-picker"); // 날짜 입력칸 가져오기
const teamSelect = document.getElementById("select-team");     // 숨겨진 구단 선택 목록 가져오기
const gameList = document.getElementById("game-list");         // 경기 카드를 넣을 큰 상자
const emptyMessage = document.getElementById("no-game-message"); // 경기가 없을 때 보여 줄 문구
const calendar = document.getElementById("game-calendar");     // 달력 상자
const gameDataCache = new Map();        // 한 번 받은 달의 경기 목록을 저장해 두는 곳 (다시 요청 안 하려고)
const scheduleInfoCache = new Map();    // MLB 일정 정보를 저장해 두는 곳
let myFavoriteTeamId = null;            // 로그인한 사람이 고른 응원 구단 번호 (없으면 null)
let selectedScheduleDay = null;         // 선택한 날짜의 '일' 숫자 (예: 2일이면 2, 전체 보기면 null)

/* ---------- 공통 도우미 ---------- */

function el(tag, className = "", text = "") {           // 태그 이름, 클래스, 글자를 받아 요소를 만드는 함수
    const node = document.createElement(tag);           // tag 종류의 새 HTML 요소 만들기
    if (className) node.className = className;          // 클래스 이름이 있으면 붙이기
    if (text !== "") node.textContent = text;           // 글자가 있으면 넣기
    return node;                                        // 만든 요소 돌려주기
}

function formatKey(date) {                              // Date 객체를 "2024-04-02" 모양 문자열로 바꾸는 함수
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; // 년-월-일, 월과 일은 두 자리로 맞춤
}

function shiftDate(date, days) {                        // 날짜 문자열에 days일을 더하거나 빼는 함수
    const shifted = new Date(`${date}T12:00:00`);       // 정오로 만들어야 시차 때문에 날짜가 밀리지 않음
    shifted.setDate(shifted.getDate() + days);          // 날짜에 days만큼 더하기
    return formatKey(shifted);                          // 다시 문자열로 바꿔서 돌려주기
}

function getMonthRange(date) {                          // 날짜가 속한 달의 첫날과 마지막날을 구하는 함수
    const [year, month] = date.slice(0, 7).split("-").map(Number); // "2024-04" 를 나눠서 2024, 4 숫자로 만들기
    const mm = String(month).padStart(2, "0");          // 월을 두 자리 문자열로 (4 → "04")
    const lastDay = new Date(year, month, 0).getDate(); // 다음 달 0일 = 이번 달 마지막 날짜 숫자
    return [`${year}-${mm}-01`, `${year}-${mm}-${String(lastDay).padStart(2, "0")}`]; // [첫날, 마지막날] 배열
}

function involvesTeam(game, teamId) {                   // 이 경기에 해당 구단이 나오는지 확인하는 함수
    return String(game.home_team_id) === String(teamId) || String(game.away_team_id) === String(teamId); // 홈팀이나 원정팀 중 하나라도 같으면 true
}

function getKoreanGameDate(scheduledAt, fallbackDate) { // 경기 시간을 한국 날짜 문자열로 바꾸는 함수
    const fallback = String(fallbackDate).slice(0, 10); // 시간 정보가 없을 때 쓸 날짜 (앞 10글자만)
    if (!scheduledAt) return fallback;                  // 경기 시간이 없으면 기본 날짜 사용
    const date = new Date(scheduledAt);                 // 경기 시간 문자열을 Date 객체로 바꾸기
    if (Number.isNaN(date.getTime())) return fallback;  // 잘못된 시간이면 기본 날짜 사용
    const parts = new Intl.DateTimeFormat("en-CA", {    // 한국 시간대(Asia/Seoul) 기준으로 년, 월, 일을 뽑는 설정
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {}); // 뽑은 조각들을 { year, month, day } 객체로 모으기
    return `${parts.year}-${parts.month}-${parts.day}`; // 한국 날짜 문자열 돌려주기
}

function getDisplayDate(game) {                         // 화면에 보여 줄 경기 날짜를 구하는 함수
    return game.display_date || getKoreanGameDate(game.scheduled_at, game.game_date); // 이미 계산된 값이 있으면 그것을, 없으면 새로 계산
}

function formatGameTime(dateTime) {                     // 경기 시작 시간을 "07:40" 모양으로 바꾸는 함수
    const date = new Date(dateTime);                    // 시간 문자열을 Date로 바꾸기
    if (!dateTime || Number.isNaN(date.getTime())) return "시간 미정"; // 시간이 없거나 잘못됐으면 "시간 미정"
    return new Intl.DateTimeFormat("ko-KR", {           // 한국 형식으로 시간을 보여 주는 설정
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false // 한국 시간, 시·분 두 자리, 24시간제
    }).format(date);                                    // 실제로 글자로 바꿔서 돌려주기
}

/* ---------- 초기화 및 이벤트 ---------- */

function setupEvents() {                                // 버튼과 입력칸에 클릭·변경 기능을 붙이는 함수
    dateInput.value = DEFAULT_DATE;                     // 날짜 입력칸에 처음 날짜 넣기
    dateInput.addEventListener("change", () => setSelectedDate(dateInput.value)); // 날짜를 바꾸면 그 날짜로 선택
    teamSelect.addEventListener("change", () => {       // 구단을 바꾸면
        loadGames();                                    // 경기 목록을 다시 불러오기
        if (!calendar.hidden) renderCalendar();         // 달력이 열려 있으면 달력도 다시 그리기
    });
    document.getElementById("btn-prev-year").addEventListener("click", () => moveYear(-1)); // 왼쪽 화살표: 작년으로
    document.getElementById("btn-next-year").addEventListener("click", () => moveYear(1));  // 오른쪽 화살표: 내년으로
    document.getElementById("btn-today").addEventListener("click", () => { // '최근' 버튼을 누르면
        dateInput.value = DEFAULT_DATE;                 // 기본 날짜로 되돌리기
        selectedScheduleDay = null;                     // 특정 '일' 선택 해제
        renderMonthStrip();                             // 월 버튼 모양 다시 그리기
        loadGames();                                    // 경기 목록 다시 불러오기
    });
    document.getElementById("btn-calendar").addEventListener("click", toggleCalendar); // 달력 버튼: 달력 열고 닫기

    const topButton = document.getElementById("scroll-to-top"); // 맨 위로 가기 버튼 가져오기
    window.addEventListener("scroll", () => {           // 화면을 스크롤할 때마다
        topButton.hidden = window.scrollY < 280;        // 280px 아래로 내려갔을 때만 버튼 보이기
    }, { passive: true });                              // 스크롤을 빠르게 하도록 설정
    topButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" })); // 누르면 부드럽게 맨 위로
    renderMonthStrip();                                 // 월 버튼 목록 그리기
}

/* ---------- 날짜 선택 ---------- */

function setSelectedDate(value) {                       // 날짜 문자열을 받아 선택 상태로 만드는 함수
    if (!value) return;                                 // 값이 비어 있으면 아무것도 하지 않음
    dateInput.value = value;                            // 입력칸에 날짜 넣기
    selectedScheduleDay = Number(value.slice(-2));      // 뒤 두 글자(일)를 숫자로 저장 (예: "2024-04-02" → 2)
    renderMonthStrip();                                 // 월 버튼 모양 갱신
    loadGames();                                        // 그 날짜의 경기 불러오기
}

function moveYear(delta) {                              // 연도를 delta만큼 옮기는 함수 (-1 또는 1)
    const [year, month] = dateInput.value.split("-").map(Number); // 현재 날짜에서 연도와 월 꺼내기
    dateInput.value = `${year + delta}-${String(month).padStart(2, "0")}-01`; // 연도만 바꾸고 1일로 설정
    selectedScheduleDay = null;                         // 특정 '일' 선택 해제
    renderMonthStrip();                                 // 월 버튼 모양 갱신
    loadGames();                                        // 경기 목록 다시 불러오기
}

function renderMonthStrip() {                           // 1월~12월 버튼 줄을 그리는 함수
    const [year, selectedMonth] = dateInput.value.split("-").map(Number); // 현재 연도와 월 꺼내기
    document.getElementById("year-display").textContent = year; // 화면의 연도 글자 바꾸기
    const strip = document.getElementById("month-strip"); // 월 버튼을 넣을 상자 가져오기
    strip.replaceChildren(...MONTH_ORDER.map(month => {   // 기존 버튼을 지우고 MONTH_ORDER 순서대로 새로 만들기
        const button = el("button", "month-option", `${month}월`); // "9월" 같은 버튼 만들기
        button.type = "button";                         // 폼 제출이 되지 않도록 일반 버튼으로 설정
        const selected = month === selectedMonth;       // 지금 보고 있는 달인지 확인
        button.classList.toggle("selected", selected);  // 선택된 달이면 selected 클래스 붙이기
        button.setAttribute("aria-pressed", String(selected)); // 화면 읽기 프로그램에 선택 상태 알려 주기
        button.setAttribute("aria-label", `${year}년 ${month}월`); // 화면 읽기 프로그램용 설명
        button.addEventListener("click", () => {        // 이 달 버튼을 누르면
            dateInput.value = `${year}-${String(month).padStart(2, "0")}-01`; // 그 달 1일로 날짜 설정
            selectedScheduleDay = null;                 // 특정 '일' 선택 해제
            renderMonthStrip();                         // 버튼 모양 갱신
            loadGames();                                // 경기 목록 불러오기
        });
        return button;                                  // 완성된 버튼 돌려주기
    }));
}

/* ---------- 달력 ---------- */

async function toggleCalendar() {                       // 달력을 열거나 닫는 함수
    calendar.hidden = !calendar.hidden;                 // 숨김 상태를 반대로 바꾸기 (열림 ↔ 닫힘)
    if (!calendar.hidden) {                             // 달력이 열렸다면
        calendar.dataset.month = dateInput.value.slice(0, 7); // 지금 날짜의 "년-월"을 저장 (예: "2024-04")
        await renderCalendar();                         // 달력 내용 그리기 (경기 데이터를 기다림)
    }
}

async function renderCalendar() {                       // 달력 한 달 치를 그리는 함수
    const monthKey = calendar.dataset.month || dateInput.value.slice(0, 7); // 보여 줄 달 ("2024-04")
    const [year, month] = monthKey.split("-").map(Number); // 연도와 월 숫자로 나누기
    const games = await fetchAndEnrichMonthGames(`${monthKey}-01`); // 그 달의 경기 목록 가져오기
    const visibleGames = teamSelect.value === "ALL" ? games : games.filter(game => involvesTeam(game, teamSelect.value)); // 구단 필터 적용 (전체면 그대로)
    const gameDays = new Set(visibleGames.map(getDisplayDate)); // 경기가 있는 날짜들만 모은 집합 (중복 없음)

    const heading = el("div", "game-calendar-heading");   // 달력 맨 위 줄(이전 달, 제목, 다음 달) 상자
    heading.append(
        calendarNavButton("‹", "이전 달", -1),          // 왼쪽 버튼: 이전 달
        el("strong", "", `${year}년 ${month}월`),       // 가운데 제목
        calendarNavButton("›", "다음 달", 1)           // 오른쪽 버튼: 다음 달
    );

    const grid = el("div", "game-calendar-grid");        // 날짜 칸들을 넣을 격자 상자
    ["일", "월", "화", "수", "목", "금", "토"].forEach(label => grid.append(el("span", "game-calendar-weekday", label))); // 요일 글자 7개 넣기
    const firstWeekday = new Date(year, month - 1, 1).getDay(); // 1일이 무슨 요일인지 (0=일요일)
    for (let i = 0; i < firstWeekday; i += 1) grid.append(el("span")); // 1일 앞에 빈 칸을 요일만큼 넣기

    const daysInMonth = new Date(year, month, 0).getDate(); // 이 달의 마지막 날짜 숫자 (28~31)
    for (let day = 1; day <= daysInMonth; day += 1) {    // 1일부터 마지막 날까지 반복
        const date = `${monthKey}-${String(day).padStart(2, "0")}`; // "2024-04-02" 모양 날짜 문자열
        const button = el("button", "game-calendar-day", String(day)); // 날짜 버튼 만들기
        button.type = "button";                          // 일반 버튼으로 설정
        if (gameDays.has(date)) button.classList.add("has-games"); // 경기가 있는 날이면 표시용 클래스 붙이기
        if (date === dateInput.value) button.classList.add("selected"); // 지금 선택된 날이면 강조 클래스 붙이기
        button.addEventListener("click", () => {         // 날짜를 누르면
            calendar.hidden = true;                      // 달력 닫기
            setSelectedDate(date);                       // 그 날짜 선택
        });
        grid.append(button);                             // 격자에 버튼 넣기
    }
    calendar.replaceChildren(heading, grid);             // 달력 상자 안의 내용을 새로 교체
}

function calendarNavButton(label, ariaLabel, delta) {   // 달력의 이전/다음 달 버튼을 만드는 함수
    const button = el("button", "", label);             // "‹" 또는 "›" 글자 버튼 만들기
    button.type = "button";                             // 일반 버튼으로 설정
    button.setAttribute("aria-label", ariaLabel);       // 화면 읽기 프로그램용 설명
    button.addEventListener("click", () => moveCalendarMonth(delta)); // 누르면 delta만큼 달 이동
    return button;                                      // 만든 버튼 돌려주기
}

function moveCalendarMonth(delta) {                     // 달력에서 달을 옮기는 함수
    const [year, month] = (calendar.dataset.month || dateInput.value.slice(0, 7)).split("-").map(Number); // 현재 보고 있는 연도와 월
    const target = new Date(year, month - 1 + delta, 1); // delta달 뒤(또는 앞)의 1일 Date 만들기
    calendar.dataset.month = formatKey(target).slice(0, 7); // "년-월"만 잘라서 저장
    renderCalendar();                                   // 달력 다시 그리기
}

/* ---------- 구단 선택 ---------- */

function addTeamOption(value, name, logoUrl, code) {    // 구단 하나를 아래 구단 목록에 추가하는 함수
    const option = el("button", "team-rail-option");    // 구단 버튼 만들기
    option.type = "button";                             // 일반 버튼으로 설정
    option.dataset.teamId = String(value);              // 구단 번호를 data-team-id 속성에 저장
    option.append(createTeamLogo(logoUrl, code, "team-picker-logo"), el("span", "team-rail-name", name)); // 로고와 이름 넣기
    if (myFavoriteTeamId && String(value) === String(myFavoriteTeamId)) { // 응원 구단이면
        option.classList.add("is-favorite-team");       // 강조 클래스 붙이기
        option.title = `${name} · MY 구단`;             // 마우스를 올리면 나오는 설명
        option.append(el("span", "team-favorite-badge", "★ MY")); // "★ MY" 표시 붙이기
    }
    option.addEventListener("click", () => {            // 구단 버튼을 누르면
        teamSelect.value = value;                       // 숨겨진 선택 목록의 값을 이 구단으로 바꾸기
        updateTeamRail();                               // 눌린 버튼 표시 갱신
        teamSelect.dispatchEvent(new Event("change", { bubbles: true })); // change 이벤트를 일으켜 경기 목록 갱신
    });
    document.getElementById("team-rail").append(option); // 구단 목록 상자에 버튼 추가
}

function updateTeamRail() {                             // 현재 선택된 구단 버튼만 '눌린 상태'로 표시하는 함수
    document.querySelectorAll(".team-rail-option").forEach(option => { // 모든 구단 버튼을 하나씩
        option.setAttribute("aria-pressed", String(option.dataset.teamId === String(teamSelect.value))); // 현재 선택된 구단이면 true
    });
}

function createTeamLogo(logoUrl, code, className) {     // 구단 로고 이미지를 만드는 함수
    const wrapper = el("span", className);              // 로고를 감싸는 상자 만들기
    const showFallback = () => {                        // 로고를 못 불러왔을 때 실행할 함수
        wrapper.textContent = code || "MLB";            // 로고 대신 구단 약자(예: "LAA") 보여 주기
        wrapper.classList.add("logo-fallback");         // 대체 글자용 스타일 붙이기
    };
    if (!logoUrl) {                                     // 로고 주소가 없으면
        showFallback();                                 // 바로 약자 보여 주기
        return wrapper;                                 // 상자 돌려주기
    }
    const image = el("img");                            // 이미지 요소 만들기
    image.src = logoUrl;                                // 로고 주소 넣기
    image.alt = "";                                     // 대체 설명은 비워 두기 (장식용 이미지)
    image.loading = "lazy";                             // 화면에 가까워질 때 불러오기 (속도 향상)
    image.onerror = showFallback;                       // 이미지 불러오기가 실패하면 약자 보여 주기
    wrapper.append(image);                              // 상자 안에 이미지 넣기
    return wrapper;                                     // 상자 돌려주기
}

async function loadTeams() {                            // 구단 목록을 서버에서 받아 화면에 넣는 함수
    try {
        const [response, favoriteTeamId] = await Promise.all([ // 구단 목록 요청과 응원 구단 확인을 동시에 시작
            fetch(`${API_BASE}/api/teams`),             // 구단 목록 API 요청
            getFavoriteTeamId()                         // 응원 구단 번호 가져오기
        ]);
        if (!response.ok) throw new Error(`구단 API 오류 (${response.status})`); // 응답이 실패면 오류 발생시키기
        const teams = await response.json();            // 응답 본문을 JSON(자바스크립트 데이터)으로 바꾸기
        myFavoriteTeamId = favoriteTeamId;              // 응원 구단 번호 저장
        teams.sort((a, b) => a.team_name.localeCompare(b.team_name)); // 구단 이름 가나다순 정렬
        teams.forEach(team => {                         // 구단 하나씩
            teamSelect.add(new Option(`${team.team_name} (${team.team_code})`, team.team_id)); // 숨겨진 선택 목록에 항목 추가
            addTeamOption(team.team_id, team.team_name, team.logo_url, team.team_code);       // 보이는 구단 버튼 추가
        });
        updateTeamRail();                               // 선택 상태 표시 갱신
    } catch (error) {                                   // 위에서 오류가 나면
        console.error(error);                           // 개발자 도구 콘솔에 오류 기록
        teamSelect.add(new Option("구단 목록을 불러오지 못했습니다", "", true, true)); // 선택 목록에 오류 문구 넣기
    }
}

async function getFavoriteTeamId() {                    // 응원 구단 번호를 구하는 함수
    let user = null;                                    // 로그인 사용자 정보를 담을 변수
    try {
        user = JSON.parse(sessionStorage.getItem("user") || localStorage.getItem("user") || "null"); // 저장된 사용자 정보를 꺼내 객체로 바꾸기 (세션 우선)
    } catch (error) {                                   // 저장된 값이 잘못돼 있으면
        console.warn("사용자 정보를 읽지 못했습니다.", error); // 경고만 남기고 계속 진행
    }
    if (!user) return null;                             // 로그인 정보가 없으면 응원 구단 없음
    const userId = user.user_id || user.id;             // 사용자 번호 (두 이름 중 있는 것 사용)
    if (userId) {                                       // 사용자 번호가 있으면
        try {
            const response = await fetch(`${API_BASE}/api/predictions/users/${encodeURIComponent(userId)}/points`); // 서버에서 최신 사용자 정보 요청
            if (response.ok) {                          // 성공했으면
                const data = await response.json();     // 응답을 객체로 바꾸기
                if (data.favorite_team_id) return Number(data.favorite_team_id); // 서버 값이 있으면 그것을 숫자로 돌려주기
            }
        } catch (error) {                               // 요청이 실패하면
            console.warn("최신 선호 구단을 가져오지 못했습니다.", error); // 경고만 남기고 아래 저장값 사용
        }
    }
    const cachedId = user.favorite_team_id || user.team_id; // 브라우저에 저장된 구단 번호
    return cachedId ? Number(cachedId) : null;          // 있으면 숫자로, 없으면 null 돌려주기
}

/* ---------- 경기 목록 ---------- */

async function loadGames() {                            // 선택한 조건에 맞는 경기를 불러와 화면에 그리는 함수
    gameList.replaceChildren();                         // 기존 경기 목록을 모두 지우기
    emptyMessage.hidden = true;                         // "경기 없음" 문구 숨기기
    try {
        let games = await fetchAndEnrichMonthGames(dateInput.value); // 선택한 달의 경기 목록 받기
        if (teamSelect.value !== "ALL") games = games.filter(game => involvesTeam(game, teamSelect.value)); // 구단을 골랐으면 그 구단 경기만 남기기
        if (selectedScheduleDay !== null) {             // 특정 날짜를 골랐으면
            const targetDate = `${dateInput.value.slice(0, 7)}-${String(selectedScheduleDay).padStart(2, "0")}`; // "2024-04-02" 모양 날짜 만들기
            games = games.filter(game => getDisplayDate(game) === targetDate); // 그 날짜 경기만 남기기
        }
        if (games.length === 0) {                       // 보여 줄 경기가 하나도 없으면
            emptyMessage.textContent = selectedScheduleDay === null // 날짜를 골랐는지에 따라 다른 문구 준비
                ? "선택한 달에 MLB 경기 데이터가 없습니다. 2024년 수집 기간의 월을 선택해 주세요."
                : "선택한 날짜에 MLB 경기 데이터가 없습니다.";
            emptyMessage.hidden = false;                // 문구 보이기
            return;                                     // 아래 코드는 실행하지 않고 끝내기
        }
        // 한 구단을 선택했을 때만 team-view 클래스를 붙여 2열 격자 CSS를 적용한다
        gameList.classList.toggle("team-view", teamSelect.value !== "ALL"); // 구단을 골랐으면 클래스 붙이고, 전체면 떼기
        gameList.replaceChildren(...createDayGroups(games)); // 날짜별 묶음을 만들어 목록에 넣기
    } catch (error) {                                   // 데이터 받기에 실패하면
        console.error(error);                           // 콘솔에 오류 기록
        emptyMessage.textContent = "MLB 경기 데이터를 불러오지 못했습니다. FastAPI 서버와 /api/games 연결을 확인해 주세요."; // 안내 문구 넣기
        emptyMessage.hidden = false;                    // 문구 보이기
    }
}

function createDayGroups(games) {                       // 경기들을 날짜별로 묶어 화면 요소를 만드는 함수
    const grouped = new Map();                          // 날짜를 키, 그 날의 경기 배열을 값으로 저장할 Map
    games.forEach(game => {                             // 경기 하나씩
        const date = getDisplayDate(game);              // 그 경기의 한국 날짜 구하기
        if (!grouped.has(date)) grouped.set(date, []);  // 이 날짜가 처음이면 빈 배열 만들어 두기
        grouped.get(date).push(game);                   // 그 날짜 배열에 경기 넣기
    });
    return [...grouped.keys()].sort().map(date => {     // 날짜들을 오름차순으로 정렬한 뒤 하나씩 처리
        const dayGames = grouped.get(date).sort((a, b) => // 그 날의 경기를 시작 시간 순으로 정렬
            String(a.scheduled_at || "99:99").localeCompare(String(b.scheduled_at || "99:99")) // 시간 정보가 없으면 맨 뒤로
        );
        const title = new Date(`${date}T12:00:00`).toLocaleDateString("ko-KR", { // 날짜를 "4월 2일 화요일" 모양 글자로 바꾸기
            month: "long", day: "numeric", weekday: "long"
        });
        const heading = el("header", "game-day-heading"); // 날짜 제목 줄 상자 만들기
        heading.append(el("h3", "", title), el("span", "", `${dayGames.length}경기`)); // 제목과 "N경기" 글자 넣기
        const cards = el("div", "game-day-cards");       // 그 날의 경기 카드를 넣을 상자
        cards.append(...dayGames.map(createGameCard));   // 경기마다 카드를 만들어 넣기
        const group = el("section", "game-day-group");   // 날짜 묶음 전체 상자
        group.append(heading, cards);                    // 묶음 안에 제목과 카드 상자 넣기
        return group;                                    // 완성된 묶음 돌려주기
    });
}

function createGameCard(game) {                         // 경기 한 개의 카드를 만드는 함수
    const isFinal = game.status === "FINAL";            // 경기가 끝났는지 확인
    const isLive = game.status === "IN_PROGRESS";       // 경기가 진행 중인지 확인
    const favoriteId = myFavoriteTeamId ? String(myFavoriteTeamId) : null; // 응원 구단 번호를 문자열로 (없으면 null)
    const hasFavorite = favoriteId && (String(game.away_team_id) === favoriteId || String(game.home_team_id) === favoriteId); // 이 경기에 응원 구단이 나오는지
    const isFavoriteTeam = teamId => hasFavorite && String(teamId) === favoriteId; // 특정 팀이 응원 구단인지 확인하는 작은 함수

    const card = el("article", "game-card");            // 카드 상자 만들기
    if (hasFavorite && teamSelect.value !== favoriteId) card.classList.add("favorite-game-card"); // 응원 구단 경기면 강조 (구단을 직접 골랐을 땐 제외)

    const time = el("div", "game-time");                // 왼쪽 시간·구장 영역 만들기
    time.append(
        el("strong", "", formatGameTime(game.scheduled_at)), // 시작 시간 글자 넣기
        el("small", "game-venue-name", game.venue_name || "구장 정보 없음") // 구장 이름 넣기 (없으면 안내 문구)
    );

    const matchup = el("div", "matchup-summary");       // 가운데 대진(팀, 점수, 팀) 영역 만들기
    matchup.append(
        createTeamNode(game.away_team_name, game.away_team_code, game.away_logo_url, "away", game.away_team_id, game.away_pitcher, isFavoriteTeam(game.away_team_id)), // 원정팀 칸
        createScoreNode(game, isFinal || isLive),       // 점수(또는 VS) 칸
        createTeamNode(game.home_team_name, game.home_team_code, game.home_logo_url, "home", game.home_team_id, game.home_pitcher, isFavoriteTeam(game.home_team_id)) // 홈팀 칸
    );

    const actions = el("div", "game-venue game-actions"); // 오른쪽 버튼 영역 만들기
    if (isFinal) {                                      // 경기가 끝났을 때만
        const gameDate = String(game.game_date || dateInput.value).slice(0, 10); // 경기 날짜 앞 10글자 (예: "2024-04-02")
        const detail = el("a", "detail-button", "박스스코어"); // "박스스코어" 링크 만들기
        detail.href = `game-detail.html?${new URLSearchParams({ id: game.game_id, date: gameDate })}`; // 상세 페이지 주소 (?id=...&date=...)
        const highlight = el("a", "highlight-button score-highlight-link", "하이라이트"); // "하이라이트" 링크 만들기
        highlight.href = `https://www.mlb.com/gameday/${encodeURIComponent(game.game_id)}/video`; // MLB 영상 페이지 주소
        highlight.target = "_blank";                    // 새 탭에서 열기
        highlight.rel = "noopener noreferrer";          // 새 탭 보안 설정
        actions.append(detail, highlight);              // 두 링크를 버튼 영역에 넣기
    }

    card.append(time, matchup, actions);                // 카드 안에 시간, 대진, 버튼 영역 순서로 넣기
    return card;                                        // 완성된 카드 돌려주기
}

function createTeamNode(name, code, logoUrl, side, teamId, pitcherName, isFavoriteTeam) { // 팀 한 쪽(로고, 이름, 선발 투수)을 만드는 함수
    const slot = el("div", `schedule-team-slot ${side}`); // 팀 칸 상자 (side는 "away" 또는 "home")
    const teamHref = `team-detail.html?id=${encodeURIComponent(teamId || "")}`; // 팀 상세 페이지 주소

    const logoLink = el("a", "schedule-team-logo-link"); // 로고를 감싸는 링크 만들기
    logoLink.href = teamHref;                           // 로고를 누르면 팀 페이지로 이동
    logoLink.setAttribute("aria-label", `${name || "팀"} 정보 보기`); // 화면 읽기 프로그램용 설명
    const logo = el("img", "team-mark team-logo-img");  // 로고 이미지 만들기
    logo.src = logoUrl || "";                           // 로고 주소 넣기
    logo.alt = `${name} 로고`;                          // 화면 읽기 프로그램용 설명
    logo.loading = "lazy";                              // 화면에 보일 때 불러오기
    logo.onerror = () => logo.replaceWith(el("span", "team-mark team-mark-fallback", code || "MLB")); // 로고 실패 시 약자 글자로 바꾸기
    logoLink.append(logo);                              // 링크 안에 로고 넣기
    if (isFavoriteTeam) {                               // 응원 구단이면
        logoLink.classList.add("favorite-game-logo");   // 강조 클래스 붙이기
        logoLink.append(el("span", "favorite-game-badge", "★ MY")); // "★ MY" 표시 붙이기
    }

    const copy = el("span", "team-copy");               // 팀 이름과 선발 투수를 넣을 상자
    const label = el("a", "team-name", name || "팀 정보 없음"); // 팀 이름 링크 만들기
    label.href = teamHref;                              // 이름을 누르면 팀 페이지로 이동
    const pitcher = el("small", "team-pitcher", pitcherName ? `선발 ${pitcherName}` : "선발 미정"); // 선발 투수 글자 (없으면 "선발 미정")
    copy.append(label, pitcher);                        // 이름과 선발 투수를 상자에 넣기

    if (side === "home") slot.append(copy, logoLink);   // 홈팀은 글자가 앞, 로고가 뒤 (오른쪽 정렬)
    else slot.append(logoLink, copy);                   // 원정팀은 로고가 앞, 글자가 뒤 (왼쪽 정렬)
    return slot;                                        // 완성된 팀 칸 돌려주기
}

function createScoreNode(game, showScore) {             // 가운데 점수 칸을 만드는 함수
    const block = el("div", "score-block");             // 점수 상자 만들기
    if (showScore) {                                    // 점수를 보여 줘야 하면 (끝났거나 진행 중)
        const awayRuns = game.away_score ?? "-";        // 원정팀 점수 (없으면 "-")
        const homeRuns = game.home_score ?? "-";        // 홈팀 점수 (없으면 "-")
        const line = el("div", "score-line");           // "7 : 4" 한 줄 상자
        const away = el("strong", "", String(awayRuns)); // 원정팀 점수 글자
        const home = el("strong", "", String(homeRuns)); // 홈팀 점수 글자
        if (game.status === "FINAL") {                  // 경기가 끝났다면
            if (Number(awayRuns) > Number(homeRuns)) away.className = "winner"; // 원정팀이 더 많으면 강조
            if (Number(homeRuns) > Number(awayRuns)) home.className = "winner"; // 홈팀이 더 많으면 강조
        }
        line.append(away, el("span", "", ":"), home);   // 점수, 콜론, 점수 순서로 넣기
        block.append(line);                             // 상자에 넣기
    } else {
        block.append(el("span", "scheduled-vs", "VS")); // 아직 시작 안 했으면 "VS" 표시
    }
    block.append(el("span", "score-caption", STATUS_LABELS[game.status] || game.status || "상태 미정")); // 아래 상태 글자 ("경기 종료" 등) 넣기
    return block;                                       // 완성된 점수 칸 돌려주기
}

/* ---------- 데이터 불러오기 ---------- */

async function fetchAndEnrichMonthGames(date) {         // 한 달 경기 데이터를 받아 정보를 보충하는 함수
    const monthKey = date.slice(0, 7);                  // "2024-04" 모양 달 키
    if (gameDataCache.has(monthKey)) return gameDataCache.get(monthKey); // 이미 받아 둔 달이면 저장된 것을 바로 돌려주기

    const [monthStart, monthEnd] = getMonthRange(date); // 그 달의 첫날과 마지막날 구하기
    // UTC 날짜와 한국 날짜가 다른 경기를 포함하려고 앞뒤 하루를 더 가져온다
    const startDate = shiftDate(monthStart, -1);        // 시작일을 하루 앞당기기
    const endDate = shiftDate(monthEnd, 1);             // 종료일을 하루 늦추기
    const rawGames = await fetchMonthGames(startDate, endDate); // 서버에서 기간 내 경기들 받아오기

    let games = [];                                     // 최종 경기 목록을 담을 배열
    if (rawGames.length) {                              // 받은 경기가 있으면
        const scheduleInfo = await loadScheduleInfo(startDate, endDate); // MLB에서 시작 시간·구장·선발 투수 정보 받기
        games = rawGames
            .map(game => {                              // 경기마다
                const enriched = { ...game, ...(scheduleInfo.get(String(game.game_id)) || {}) }; // 기존 정보에 MLB 정보를 합치기
                return { ...enriched, display_date: getKoreanGameDate(enriched.scheduled_at, enriched.game_date) }; // 한국 날짜 정보 추가
            })
            .filter(game => game.display_date.startsWith(monthKey)); // 요청한 달에 속한 경기만 남기기 (앞뒤 여분 날짜 제거)
    }
    gameDataCache.set(monthKey, games);                 // 받은 결과를 캐시에 저장
    return games;                                       // 경기 목록 돌려주기
}

async function fetchMonthGames(startDate, endDate) {    // 기간 안의 모든 날짜별 경기를 받아 하나의 배열로 합치는 함수
    const dates = [];                                   // 날짜 문자열을 모을 배열
    for (let day = new Date(`${startDate}T12:00:00`); formatKey(day) <= endDate; day.setDate(day.getDate() + 1)) { // 시작일부터 종료일까지 하루씩 반복
        dates.push(formatKey(day));                     // 그 날짜 문자열을 배열에 넣기
    }
    const games = [];                                   // 전체 경기를 담을 배열
    for (let i = 0; i < dates.length; i += 6) {         // 날짜를 6개씩 나눠서 처리 (한 번에 너무 많이 요청하지 않으려고)
        const batch = await Promise.all(dates.slice(i, i + 6).map(fetchDayGames)); // 6개 날짜를 동시에 요청하고 모두 끝날 때까지 기다리기
        batch.forEach(dayGames => games.push(...dayGames)); // 받은 날짜별 경기를 전체 배열에 합치기
    }
    return games;                                       // 전체 경기 목록 돌려주기
}

async function fetchDayGames(date) {                    // 하루치 경기를 서버에서 받는 함수
    const response = await fetch(`${API_BASE}/api/games?date=${encodeURIComponent(date)}&limit=100`); // /api/games 주소로 요청 (날짜 지정, 최대 100개)
    if (!response.ok) throw new Error(`경기 데이터 API 오류 (${response.status})`); // 실패하면 오류 발생
    return response.json();                             // 응답을 JSON 데이터로 바꿔서 돌려주기
}

async function loadScheduleInfo(startDate, endDate) {   // MLB 공식 일정에서 시작 시간, 구장, 선발 투수를 받는 함수
    const cacheKey = `${startDate}:${endDate}`;         // 기간을 키로 쓸 문자열
    if (scheduleInfoCache.has(cacheKey)) return scheduleInfoCache.get(cacheKey); // 이미 받은 기간이면 저장된 값 사용

    const scheduleByGameId = new Map();                 // 경기 번호를 키로 정보를 저장할 Map
    try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher`; // MLB 일정 API 주소 (sportId=1은 MLB)
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) }); // 요청 보내기 (8초가 지나면 취소)
        if (!response.ok) throw new Error(`MLB 일정 API 오류 (${response.status})`); // 실패하면 오류 발생
        const data = await response.json();             // 응답을 객체로 바꾸기
        (data.dates || []).flatMap(item => item.games || []).forEach(item => { // 날짜별 경기 목록을 하나로 펴서 경기마다
            scheduleByGameId.set(String(item.gamePk), { // 경기 번호(gamePk)를 키로 정보 저장
                scheduled_at: item.gameDate,            // 경기 시작 시간
                venue_name: item.venue?.name || "",     // 구장 이름 (없으면 빈 문자열)
                away_pitcher: item.teams?.away?.probablePitcher?.fullName || "", // 원정 선발 투수 이름
                home_pitcher: item.teams?.home?.probablePitcher?.fullName || ""  // 홈 선발 투수 이름
            });
        });
    } catch (error) {                                   // 요청이 실패하면
        console.warn("MLB 시작 시간·선발 투수 정보를 불러오지 못했습니다.", error); // 경고만 남기고 계속 진행 (정보 없이 표시)
    }
    scheduleInfoCache.set(cacheKey, scheduleByGameId);  // 결과를 캐시에 저장
    return scheduleByGameId;                            // 정보 Map 돌려주기
}

/* ---------- 시작 ---------- */

setupEvents();                                          // 버튼과 입력칸 이벤트 연결
addTeamOption("ALL", "전체 구단", "", "MLB");           // 맨 앞에 "전체 구단" 버튼 추가
loadTeams();                                            // 구단 목록 불러오기
loadGames();                                            // 처음 화면의 경기 목록 불러오기