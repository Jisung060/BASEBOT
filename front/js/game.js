const API_BASE = "";
const DEFAULT_DATE = "2024-04-01";
const dateInput = document.getElementById("game-date-picker");
const teamSelect = document.getElementById("select-team");
let teamFilterReady = false;
const gameDataCache = new Map();
const scheduleInfoCache = new Map();
const inningScoreCache = new Map();
let highlightedGameDates = new Set();
let selectedScheduleDay = null;
let draggingDayStrip = false;
let dayStripDragMoved = false;
let dayStripDragStartX = 0;
let dayStripScrollStart = 0;
let suppressDayStripClick = false;

function setupDateControls() {
    dateInput.value = DEFAULT_DATE;
    dateInput.addEventListener("change", () => setSelectedDate(dateInput.value));
    teamSelect.addEventListener("change", loadGames);
    document.getElementById("btn-prev-year").addEventListener("click", () => moveYear(-1));
    document.getElementById("btn-next-year").addEventListener("click", () => moveYear(1));
    const topButton = document.getElementById("scroll-to-top");
    window.addEventListener("scroll", () => {
        topButton.hidden = window.scrollY < 280;
    }, { passive: true });
    topButton.addEventListener("click", scrollToTopQuickly);
    document.getElementById("btn-today").addEventListener("click", () => {
        dateInput.value = DEFAULT_DATE;
        selectedScheduleDay = null;
        renderMonthStrip();
        renderDayStrip();
        loadGames();
    });
    document.getElementById("btn-calendar").addEventListener("click", () => {
        if (typeof dateInput.showPicker === "function") dateInput.showPicker();
        else dateInput.click();
    });
    setupTeamPicker();
    setupDayStripDragging();
    renderMonthStrip();
    renderDayStrip();
}

function scrollToTopQuickly() {
    const startY = window.scrollY;
    if (startY <= 0) return;
    const startedAt = performance.now();
    const duration = 180;
    const animate = now => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        window.scrollTo(0, Math.round(startY * (1 - eased)));
        if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
}

function setupDayStripDragging() {
    const strip = document.getElementById("day-strip");
    strip.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        draggingDayStrip = true;
        dayStripDragMoved = false;
        dayStripDragStartX = event.clientX;
        dayStripScrollStart = strip.scrollLeft;
        strip.classList.add("dragging");
    });
    window.addEventListener("pointermove", event => {
        if (!draggingDayStrip) return;
        const distance = event.clientX - dayStripDragStartX;
        if (Math.abs(distance) > 4) dayStripDragMoved = true;
        if (dayStripDragMoved) {
            event.preventDefault();
            strip.scrollLeft = dayStripScrollStart - distance;
        }
    });
    const stopDragging = () => {
        if (!draggingDayStrip) return;
        draggingDayStrip = false;
        strip.classList.remove("dragging");
        if (dayStripDragMoved) {
            suppressDayStripClick = true;
            window.setTimeout(() => { suppressDayStripClick = false; }, 0);
        }
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    strip.addEventListener("click", event => {
        if (!suppressDayStripClick) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

function setupTeamPicker() {
    addTeamPickerOption("ALL", "전체 구단", "", "MLB");
}

function addTeamPickerOption(value, name, logoUrl, code) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "team-rail-option";
    option.dataset.teamId = String(value);
    option.setAttribute("aria-pressed", String(String(teamSelect.value) === String(value)));
    option.append(createTeamLogo(logoUrl, code, "team-picker-logo"));
    const nameLabel = document.createElement("span");
    nameLabel.className = "team-rail-name";
    nameLabel.textContent = name;
    option.append(nameLabel);
    option.addEventListener("click", () => {
        teamSelect.value = value;
        teamSelect.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelectorAll(".team-rail-option").forEach(item => item.setAttribute("aria-pressed", String(item === option)));
    });
    document.getElementById("team-rail").append(option);
}

function createTeamLogo(logoUrl, code, className) {
    const wrapper = document.createElement("span");
    wrapper.className = className;
    if (!logoUrl) {
        wrapper.textContent = code || "MLB";
        wrapper.classList.add("logo-fallback");
        return wrapper;
    }
    const image = document.createElement("img");
    image.src = logoUrl;
    image.alt = "";
    image.loading = "lazy";
    image.onerror = () => {
        wrapper.textContent = code || "MLB";
        wrapper.classList.add("logo-fallback");
    };
    wrapper.append(image);
    return wrapper;
}

function setSelectedDate(value) {
    if (!value) return;
    dateInput.value = value;
    selectedScheduleDay = Number(value.slice(-2));
    renderMonthStrip();
    renderDayStrip();
    loadGames();
}

function moveYear(delta) {
    const [year, month] = dateInput.value.split("-").map(Number);
    dateInput.value = `${year + delta}-${String(month).padStart(2, "0")}-01`;
    selectedScheduleDay = null;
    renderMonthStrip();
    renderDayStrip();
    loadGames();
}

function renderMonthStrip() {
    const strip = document.getElementById("month-strip");
    const [year, selectedMonth] = dateInput.value.split("-").map(Number);
    document.getElementById("year-display").textContent = year;
    const fragment = document.createDocumentFragment();
    for (let offset = -7; offset < 5; offset += 1) {
        const monthDate = new Date(year, selectedMonth - 1 + offset, 1);
        const monthYear = monthDate.getFullYear();
        const month = monthDate.getMonth() + 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "month-option";
        button.textContent = `${month}월`;
        const selected = monthYear === year && month === selectedMonth;
        button.setAttribute("aria-label", `${monthYear}년 ${month}월`);
        button.setAttribute("aria-pressed", String(selected));
        if (selected) button.classList.add("selected");
        button.addEventListener("click", () => {
            dateInput.value = `${monthYear}-${String(month).padStart(2, "0")}-01`;
            selectedScheduleDay = null;
            renderMonthStrip();
            renderDayStrip();
            loadGames();
        });
        fragment.append(button);
    }
    strip.replaceChildren(fragment);
}

function renderDayStrip() {
    const strip = document.getElementById("day-strip");
    const [year, month] = dateInput.value.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
    const fragment = document.createDocumentFragment();
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = `day-option day-option-all${selectedScheduleDay === null ? " selected" : ""}`;
    allButton.textContent = "전체";
    allButton.setAttribute("aria-pressed", String(selectedScheduleDay === null));
    allButton.addEventListener("click", () => {
        if (suppressDayStripClick) return;
        selectedScheduleDay = null;
        dateInput.value = `${year}-${String(month).padStart(2, "0")}-01`;
        renderDayStrip();
        loadGames();
    });
    fragment.append(allButton);
    for (let day = 1; day <= daysInMonth; day += 1) {
        const button = document.createElement("button");
        button.type = "button";
        const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        button.className = `day-option${selectedScheduleDay === day ? " selected" : ""}${highlightedGameDates.has(dateKey) ? " has-games" : ""}`;
        const weekday = document.createElement("span");
        weekday.textContent = weekdayLabels[new Date(year, month - 1, day).getDay()];
        const number = document.createElement("strong");
        number.textContent = day;
        button.append(weekday, number);
        button.setAttribute("aria-label", `${year}년 ${month}월 ${day}일 ${weekday.textContent}요일`);
        button.setAttribute("aria-pressed", String(selectedScheduleDay === day));
        button.addEventListener("click", () => {
            if (suppressDayStripClick) return;
            selectedScheduleDay = day;
            dateInput.value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            renderDayStrip();
            loadGames();
        });
        fragment.append(button);
    }
    strip.replaceChildren(fragment);
    strip.querySelector(".day-option.selected")?.scrollIntoView({ block: "nearest", inline: "center" });
}

async function loadTeams() {
    try {
        const response = await fetch(`${API_BASE}/api/teams`);
        if (!response.ok) throw new Error(`구단 API 오류 (${response.status})`);
        const teams = await response.json();
        teams.sort((a, b) => a.team_name.localeCompare(b.team_name));
        teams.forEach(team => {
            teamSelect.add(new Option(`${team.team_name} (${team.team_code})`, team.team_id));
            addTeamPickerOption(team.team_id, team.team_name, team.logo_url, team.team_code);
        });
        teamFilterReady = true;
        renderMonthStrip();
    } catch (error) {
        console.error(error);
        teamSelect.add(new Option("구단 목록을 불러오지 못했습니다", "", true, true));
    }
}

async function loadGames() {
    const date = dateInput.value;
    const list = document.getElementById("game-list");
    const empty = document.getElementById("no-game-message");
    const dateLabel = document.getElementById("date-display-text");
    const dateObject = new Date(`${date}T12:00:00`);
    dateLabel.textContent = selectedScheduleDay === null
        ? `${dateObject.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })} 일정`
        : dateObject.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    empty.hidden = true;
    list.replaceChildren();

    try {
        let games = [...await fetchAndEnrichMonthGames(date)];
        if (teamFilterReady && teamSelect.value !== "ALL") {
            games = games.filter(game => String(game.home_team_id) === teamSelect.value || String(game.away_team_id) === teamSelect.value);
        }
        highlightedGameDates = new Set(games.map(game => String(game.game_date).slice(0, 10)));
        renderDayStrip();
        if (selectedScheduleDay !== null) {
            const selectedDate = dateInput.value.slice(0, 7) + `-${String(selectedScheduleDay).padStart(2, "0")}`;
            games = games.filter(game => String(game.game_date).slice(0, 10) === selectedDate);
        }
        if (games.length === 0) {
            empty.textContent = selectedScheduleDay === null
                ? "선택한 달에 MLB 경기 데이터가 없습니다. 2024년 수집 기간의 월을 선택해 주세요."
                : "선택한 날짜에 MLB 경기 데이터가 없습니다.";
            empty.hidden = false;
            return;
        }
        list.replaceChildren(...createMonthlyGroups(games));
    } catch (error) {
        console.error(error);
        empty.textContent = "MLB 경기 데이터를 불러오지 못했습니다. FastAPI 서버와 /api/games 연결을 확인해 주세요.";
        empty.hidden = false;
    }
}

async function fetchAndEnrichMonthGames(date) {
    const cacheKey = `month:${date.slice(0, 7)}`;
    if (gameDataCache.has(cacheKey)) return gameDataCache.get(cacheKey);
    const [startDate, endDate] = getMonthRange(date);
    let games = await fetchMonthGames(startDate, endDate);
    if (games.length) {
        const scheduleInfo = await loadScheduleInfo(startDate, endDate);
        games = games.map(game => ({ ...game, ...(scheduleInfo.get(String(game.game_id)) || {}) }));
    }
    gameDataCache.set(cacheKey, games);
    return games;
}

async function fetchDayGames(date) {
    const response = await fetch(`${API_BASE}/api/games?date=${encodeURIComponent(date)}&limit=100`);
    if (!response.ok) throw new Error(`경기 데이터 API 오류 (${response.status})`);
    return response.json();
}

function getMonthRange(date) {
    const [year, month] = date.slice(0, 7).split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return [`${year}-${String(month).padStart(2, "0")}-01`, `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`];
}

async function fetchMonthGames(startDate, endDate) {
    const start = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    const dates = [];
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }
    const games = [];
    for (let index = 0; index < dates.length; index += 6) {
        const batch = await Promise.all(dates.slice(index, index + 6).map(fetchDayGames));
        batch.forEach(dayGames => games.push(...dayGames));
    }
    return games;
}

function createMonthlyGroups(games) {
    const grouped = new Map();
    games.forEach(game => {
        const date = String(game.game_date).slice(0, 10);
        if (!grouped.has(date)) grouped.set(date, []);
        grouped.get(date).push(game);
    });
    return [...grouped.entries()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB)).map(([date, dayGames]) => {
        const group = document.createElement("section");
        group.className = "game-day-group";
        const heading = document.createElement("header");
        heading.className = "game-day-heading";
        const dateHeading = document.createElement("h3");
        dateHeading.textContent = new Date(`${date}T12:00:00`).toLocaleDateString("ko-KR", {
            month: "long", day: "numeric", weekday: "long"
        });
        const count = document.createElement("span");
        count.textContent = `${dayGames.length}경기`;
        heading.append(dateHeading, count);
        const cards = document.createElement("div");
        cards.className = "game-day-cards";
        cards.append(...dayGames.map(createGameCard));
        group.append(heading, cards);
        return group;
    });
}

async function loadScheduleInfo(startDate, endDate = startDate) {
    const cacheKey = `${startDate}:${endDate}`;
    if (scheduleInfoCache.has(cacheKey)) return scheduleInfoCache.get(cacheKey);
    const scheduleByGameId = new Map();
    try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&hydrate=probablePitcher`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`MLB 일정 API 오류 (${response.status})`);
        const data = await response.json();
        (data.dates || []).flatMap(item => item.games || []).forEach(item => {
            scheduleByGameId.set(String(item.gamePk), {
                scheduled_at: item.gameDate,
                venue_name: item.venue?.name || "",
                away_pitcher: item.teams?.away?.probablePitcher?.fullName || "",
                home_pitcher: item.teams?.home?.probablePitcher?.fullName || ""
            });
        });
    } catch (error) {
        console.warn("MLB 시작 시간·선발 투수 정보를 불러오지 못했습니다.", error);
    }
    scheduleInfoCache.set(cacheKey, scheduleByGameId);
    return scheduleByGameId;
}

function formatGameTime(dateTime) {
    if (!dateTime) return "시간 미정";
    const date = new Date(dateTime);
    if (Number.isNaN(date.getTime())) return "시간 미정";
    return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

function createGameCard(game) {
    const card = document.createElement("article");
    card.className = "game-card";
    const statusLabels = { FINAL: "경기 종료", IN_PROGRESS: "경기 중", SCHEDULED: "경기 예정", CANCELLED: "취소" };
    const statusLabel = statusLabels[game.status] || game.status || "상태 미정";
    const isFinal = game.status === "FINAL";
    const isLive = game.status === "IN_PROGRESS";
    const awayRuns = game.away_score ?? "-";
    const homeRuns = game.home_score ?? "-";

    const timeCell = document.createElement("div");
    timeCell.className = "game-time";
    const startTime = document.createElement("strong");
    startTime.textContent = formatGameTime(game.scheduled_at);
    const venueName = document.createElement("small");
    venueName.className = "game-venue-name";
    venueName.textContent = game.venue_name || "구장 정보 없음";
    timeCell.append(startTime, venueName);

    const matchup = document.createElement("div");
    matchup.className = "matchup-summary";
    const scoreNode = createScoreNode(game, awayRuns, homeRuns, statusLabel, isFinal || isLive);
    if (isFinal) {
        const highlightsLink = document.createElement("a");
        highlightsLink.className = "highlight-button score-highlight-link";
        highlightsLink.textContent = "하이라이트";
        highlightsLink.href = `https://www.mlb.com/gameday/${encodeURIComponent(game.game_id)}/video`;
        highlightsLink.target = "_blank";
        highlightsLink.rel = "noopener noreferrer";
        scoreNode.append(highlightsLink);
        const previewArrow = document.createElement("span");
        previewArrow.className = "inning-preview-arrow";
        previewArrow.textContent = "⌄";
        previewArrow.setAttribute("aria-hidden", "true");
        scoreNode.append(previewArrow);
    }
    matchup.append(
        createTeamNode(game.away_team_name, game.away_team_code, game.away_logo_url, "away", game.away_team_id, game.away_pitcher),
        scoreNode,
        createTeamNode(game.home_team_name, game.home_team_code, game.home_logo_url, "home", game.home_team_id, game.home_pitcher)
    );

    const venue = document.createElement("div");
    venue.className = "game-venue game-actions";
    if (isFinal) {
        const link = document.createElement("a");
        link.className = "detail-button";
        link.textContent = "박스스코어";
        const gameDate = String(game.game_date || dateInput.value).slice(0, 10);
        const query = new URLSearchParams({ id: game.game_id, date: gameDate });
        link.href = `game-detail.html?${query.toString()}`;
        venue.append(link);
    }
    card.append(timeCell, matchup, venue);
    if (isFinal) {
        const quickDetail = document.createElement("div");
        quickDetail.className = "game-quick-detail is-collapsed";
        quickDetail.setAttribute("aria-hidden", "true");
        quickDetail.innerHTML = '<p class="quick-loading">이닝별 점수를 불러오는 중입니다.</p>';
        card.append(quickDetail);
        card.classList.add("is-expandable");
        card.tabIndex = 0;
        card.setAttribute("aria-expanded", "false");
        card.setAttribute("aria-label", `${game.away_team_name} ${awayRuns} 대 ${homeRuns} ${game.home_team_name}, 이닝 점수 펼치기`);

        const toggleInnings = async () => {
            const expanded = card.getAttribute("aria-expanded") === "true";
            card.setAttribute("aria-expanded", String(!expanded));
            quickDetail.classList.toggle("is-expanded", !expanded);
            quickDetail.classList.toggle("is-collapsed", expanded);
            quickDetail.setAttribute("aria-hidden", String(expanded));
            if (!expanded && quickDetail.dataset.loaded !== "true") {
                quickDetail.replaceChildren(Object.assign(document.createElement("p"), {
                    className: "quick-loading",
                    textContent: "이닝별 점수를 불러오는 중입니다."
                }));
                const result = await loadInningScore(game.game_id);
                renderQuickInnings(quickDetail, result, game);
            }
        };

        card.addEventListener("click", event => {
            if (event.target.closest("a, button") || quickDetail.contains(event.target)) return;
            toggleInnings();
        });
        card.addEventListener("keydown", event => {
            if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            toggleInnings();
        });
    }
    return card;
}

async function loadInningScore(gameId) {
    const key = String(gameId);
    if (!inningScoreCache.has(key)) {
        inningScoreCache.set(key, fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(key)}/feed/live`, {
            signal: AbortSignal.timeout(10000)
        }).then(response => {
            if (!response.ok) throw new Error(`이닝 점수 조회 오류 (${response.status})`);
            return response.json();
        }).then(feed => {
            const live = feed.liveData || {};
            if (!live.linescore?.innings?.length) throw new Error("이닝별 점수가 제공되지 않습니다.");
            return { linescore: live.linescore, teams: live.boxscore?.teams || {} };
        }).catch(error => ({ error })));
    }
    return inningScoreCache.get(key);
}

function renderQuickInnings(container, result, game) {
    const note = document.createElement("p");
    note.className = result.error ? "quick-loading" : "quick-game-note";
    note.textContent = result.error ? "이닝별 점수를 불러오지 못했습니다." : "이닝별 점수";
    container.replaceChildren(note);
    if (result.error) return;

    const { linescore, teams } = result;
    const table = document.createElement("table");
    table.className = "quick-inning-table";
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["팀", ...linescore.innings.map(inning => inning.num), "득점", "안타", "실책"].forEach(label => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.append(th);
    });
    head.append(headerRow);
    const body = document.createElement("tbody");
    ["away", "home"].forEach(side => {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        name.textContent = game[`${side}_team_code`] || game[`${side}_team_name`] || side;
        row.append(name);
        linescore.innings.forEach(inning => {
            const cell = document.createElement("td");
            const score = inning[side]?.runs;
            cell.textContent = score == null ? (side === "home" && inning.isTopInning ? "" : "-") : String(score);
            row.append(cell);
        });
        const totals = linescore.teams?.[side] || {};
        [totals.runs ?? game[`${side}_score`] ?? "-", totals.hits ?? teams[side]?.teamStats?.batting?.hits ?? "-", totals.errors ?? "-"].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.append(cell);
        });
        body.append(row);
    });
    table.append(head, body);
    container.append(table);
    container.dataset.loaded = "true";
}

function createTeamNode(name, code, logoUrl, side, teamId, pitcherName) {
    const slot = document.createElement("div");
    slot.className = `schedule-team-slot ${side}`;
    const teamHref = `team-detail.html?id=${encodeURIComponent(teamId || "")}`;
    const logoLink = document.createElement("a");
    logoLink.className = "schedule-team-logo-link";
    logoLink.href = teamHref;
    logoLink.setAttribute("aria-label", `${name || "팀"} 정보 보기`);
    const logo = document.createElement("img");
    logo.className = "team-mark team-logo-img";
    logo.src = logoUrl || "";
    logo.alt = `${name} 로고`;
    logo.loading = "lazy";
    logo.onerror = () => {
        const fallback = document.createElement("span");
        fallback.className = "team-mark team-mark-fallback";
        fallback.textContent = code || "MLB";
        logo.replaceWith(fallback);
    };
    logoLink.append(logo);
    const copy = document.createElement("span");
    copy.className = "team-copy";
    const label = document.createElement("a");
    label.className = "team-name";
    label.href = teamHref;
    label.textContent = name || "팀 정보 없음";
    const pitcher = document.createElement("small");
    pitcher.className = "team-pitcher";
    pitcher.textContent = pitcherName ? `선발 ${pitcherName}` : "선발 미정";
    copy.append(label, pitcher);
    if (side === "home") slot.append(copy, logoLink);
    else slot.append(logoLink, copy);
    return slot;
}

function createScoreNode(game, awayRuns, homeRuns, statusLabel, showScore) {
    const block = document.createElement("div");
    block.className = "score-block";
    if (showScore) {
        const line = document.createElement("div");
        line.className = "score-line";
        const away = document.createElement("strong");
        away.textContent = awayRuns;
        const divider = document.createElement("span");
        divider.textContent = ":";
        const home = document.createElement("strong");
        home.textContent = homeRuns;
        if (Number(awayRuns) > Number(homeRuns) && game.status === "FINAL") away.className = "winner";
        if (Number(homeRuns) > Number(awayRuns) && game.status === "FINAL") home.className = "winner";
        line.append(away, divider, home);
        block.append(line);
    } else {
        const vs = document.createElement("span");
        vs.className = "scheduled-vs";
        vs.textContent = "VS";
        block.append(vs);
    }
    const caption = document.createElement("span");
    caption.className = "score-caption";
    caption.textContent = statusLabel;
    block.append(caption);
    return block;
}

setupDateControls();
loadTeams();
loadGames();
