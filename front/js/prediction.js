// ==================================================
// 전역 변수 관리
// ==================================================
let currentGameData = null;
let currentUserPoints = 0;
let currentUserFavoriteTeamId = null; // ★ 선호 구단 ID 전역 관리

// ==================================================
// MLB 30개 구단 홈구장 현지 시간대(IANA TimeZone) 매핑
// ==================================================
const MLB_TEAM_TIMEZONES = {
    // 중부 시간 (Central Time)
    158: "America/Chicago", // Milwaukee Brewers
    112: "America/Chicago", // Chicago Cubs
    145: "America/Chicago", // Chicago White Sox
    138: "America/Chicago", // St. Louis Cardinals
    142: "America/Chicago", // Minnesota Twins
    118: "America/Chicago", // Kansas City Royals
    117: "America/Chicago", // Houston Astros
    140: "America/Chicago", // Texas Rangers
    // 산악 시간 (Mountain Time)
    115: "America/Denver",  // Colorado Rockies
    109: "America/Phoenix", // Arizona Diamondbacks (서머타임 미적용 지역 자동 반영)
    // 서부 시간 (Pacific Time)
    119: "America/Los_Angeles", // Los Angeles Dodgers
    108: "America/Los_Angeles", // Los Angeles Angels
    135: "America/Los_Angeles", // San Diego Padres
    137: "America/Los_Angeles", // San Francisco Giants
    136: "America/Los_Angeles", // Seattle Mariners
    133: "America/Los_Angeles"  // Athletics
    // 그 외 나머지 구단(양키스, 보스턴, 다저스 외 동부 구단)은 기본값 "America/New_York" (동부 시간)
};

function formatTimezoneParts(utcDateObj, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "short"
    });
    const parts = formatter.formatToParts(utcDateObj);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const hour = map.hour === "24" ? "00" : map.hour;
    return {
        date: `${map.year}-${map.month}-${map.day}`,
        time: `${hour}:${map.minute}`,
        tzShort: map.timeZoneName || ""
    };
}

/**
 * DB의 game_date, game_time을 받아 한국 시간(KST)과 구장 현지 시간으로 변환
 * (999999 등 테스트 경기는 입력된 시각 그대로 KST로 취급)
 */
function convertGameTimes(gameDateStr, gameTimeStr, homeTeamId, gameId = null) {
    if (!gameDateStr) {
        return {
            kstDate: "", kstTime: "시간 미정", kstFull: "시간 미정",
            localFull: "현지 시간 미정", utcDateObj: null
        };
    }

    const cleanDate = String(gameDateStr).substring(0, 10);
    const cleanTime = gameTimeStr ? String(gameTimeStr).substring(0, 8) : "00:00:00";

    // MLB 공식 경기(game_id != 999999)는 UTC 기준이므로 'Z'를 붙여 파싱
    const isTestGame = (Number(gameId) === 999999);
    const isoStr = isTestGame ? `${cleanDate}T${cleanTime}+09:00` : `${cleanDate}T${cleanTime}Z`;
    const utcDateObj = new Date(isoStr);

    if (isNaN(utcDateObj.getTime())) {
        return {
            kstDate: cleanDate, kstTime: cleanTime.substring(0, 5),
            kstFull: `${cleanDate} ${cleanTime.substring(0, 5)}`,
            localFull: "-", utcDateObj: null
        };
    }

    // 1. 한국 표준시 (Asia/Seoul)
    const kst = formatTimezoneParts(utcDateObj, "Asia/Seoul");

    // 2. 홈구장 현지 시간 (America/New_York, America/Chicago 등)
    const localTz = MLB_TEAM_TIMEZONES[Number(homeTeamId)] || "America/New_York";
    const local = formatTimezoneParts(utcDateObj, localTz);

    return {
        kstDate: kst.date,
        kstTime: kst.time,
        kstFull: `${kst.date} ${kst.time} (KST)`,
        localFull: `${local.date} ${local.time} (${local.tzShort})`,
        utcDateObj: utcDateObj
    };
}

// ==================================================
// 경기 시작 10분 전 마감 여부 및 마감 시각(KST) 계산 헬퍼
// ==================================================
function checkVoteDeadline(gameDateStr, gameTimeStr, homeTeamId, gameId = null) {
    const converted = convertGameTimes(gameDateStr, gameTimeStr, homeTeamId, gameId);
    if (!converted.utcDateObj) {
        return { isPastDeadline: false, deadlineText: "경기 시작 10분 전" };
    }

    const deadlineDt = new Date(converted.utcDateObj.getTime() - 10 * 60 * 1000);
    const now = new Date();
    const kstDeadline = formatTimezoneParts(deadlineDt, "Asia/Seoul");

    return {
        isPastDeadline: now >= deadlineDt,
        deadlineText: `${kstDeadline.time} KST`
    };
}

// ==================================================
// 로그인 유저 식별 (sessionStorage / localStorage 안전 검사)
// ==================================================
function getLoggedInUserId() {
    try {
        const userStr = sessionStorage.getItem("user") || localStorage.getItem("user");
        if (userStr) {
            const u = JSON.parse(userStr);
            if (u && (u.user_id || u.id)) return u.user_id || u.id;
        }
    } catch (e) {
        console.warn("유저 정보 파싱 실패:", e);
    }
    return localStorage.getItem("test_user_id") || null;
}

// ==================================================
// 1. 유저 보유 포인트 및 선호 구단 조회 함수
// ==================================================
async function fetchUserPoints() {
    const userId = getLoggedInUserId();
    const pointDisplay = document.getElementById("userPointDisplay");

    if (!userId) {
        if (pointDisplay) {
            pointDisplay.textContent = "로그인 필요";
            pointDisplay.style.color = "#888";
        }
        currentUserPoints = 0;
        currentUserFavoriteTeamId = null;
        return;
    }

    try {
        const res = await fetch(`http://127.0.0.1:8000/api/predictions/users/${userId}/points`);
        if (res.ok) {
            const data = await res.json();
            currentUserPoints = data.point || 0;
            // ★ 백엔드가 주는 favorite_team_id를 전역 변수에 저장!
            currentUserFavoriteTeamId = data.favorite_team_id ? Number(data.favorite_team_id) : null;

            if (pointDisplay) {
                pointDisplay.textContent = `${currentUserPoints.toLocaleString()} P`;
                pointDisplay.style.color = "#102d63";
            }
        }
    } catch (e) {
        console.error("포인트 및 선호 구단 조회 실패:", e);
    }
}

// ==================================================
// 2. 초기화 리스너 등록
// ==================================================
document.addEventListener("DOMContentLoaded", async () => {
    // 1. 유저 포인트 & 선호 구단 먼저 조회
    await fetchUserPoints();

    // 2. 경기 목록 로드 (로드 완료 후 첫 경기 자동 렌더링)
    await loadGameList();

    // 경기 선택 버튼 이벤트
    const btnLoad = document.getElementById("btnLoadGame");
    if (btnLoad) {
        btnLoad.addEventListener("click", () => {
            const gameSelect = document.getElementById("gameSelect");
            if (gameSelect && gameSelect.value) {
                loadSelectedGame(gameSelect.value);
            }
        });
    }

    // 투표 버튼 이벤트 바인딩
    const btnVoteAway = document.getElementById("btnVoteAway");
    if (btnVoteAway) {
        btnVoteAway.addEventListener("click", () => handleVote("away"));
    }

    const btnVoteHome = document.getElementById("btnVoteHome");
    if (btnVoteHome) {
        btnVoteHome.addEventListener("click", () => handleVote("home"));
    }
});


// 3. 경기 목록 불러오기 (드롭다운: 한국 시간 KST 기준 표시)
async function loadGameList() {
    const select = document.getElementById("gameSelect");
    if (!select) return;

    try {
        const res = await fetch("http://127.0.0.1:8000/api/games?order=desc&limit=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const games = await res.json();

        select.innerHTML = "";

        if (!games || games.length === 0) {
            select.innerHTML = `<option value="">등록된 경기가 없습니다</option>`;
            return;
        }

        games.forEach(g => {
            // ★ UTC 경기 시각을 한국 시간(KST) 날짜 및 시각으로 변환하여 드롭다운에 표시
            const tInfo = convertGameTimes(g.game_date, g.game_time, g.home_team_id, g.game_id);
            const dateTimeLabel = g.game_time
                ? `${tInfo.kstDate} ${tInfo.kstTime} (KST)`
                : `${tInfo.kstDate}`;

            let statusLabel = "[예정]";
            if (g.status === "FINAL") {
                statusLabel = "[종료]";
            } else if (g.status === "IN_PROGRESS" || g.status === "LIVE") {
                statusLabel = "[진행중]";
            }

            const opt = new Option(
                `${statusLabel} ${dateTimeLabel} - ${g.away_team_name} vs ${g.home_team_name}`,
                g.game_id
            );
            select.add(opt);
        });

        if (games.length > 0) {
            select.value = games[0].game_id;
            loadSelectedGame(games[0].game_id);
        }
    } catch (e) {
        console.error("경기 목록 로드 실패:", e);
        select.innerHTML = `<option value="">경기 목록을 불러올 수 없습니다 (서버 확인 필요)</option>`;
    }
}

// ==================================================
// 경기 시작 10분 전 마감 여부 및 마감 시각 계산 헬퍼
// ==================================================
function checkVoteDeadline(gameDateStr, gameTimeStr) {
    if (!gameDateStr || !gameTimeStr) {
        return { isPastDeadline: false, deadlineText: "경기 시작 10분 전" };
    }
    try {
        const cleanDate = gameDateStr.substring(0, 10);
        const cleanTime = gameTimeStr.substring(0, 5); // "HH:MM"
        const startDt = new Date(`${cleanDate}T${cleanTime}:00`);
        if (isNaN(startDt.getTime())) {
            return { isPastDeadline: false, deadlineText: "경기 시작 10분 전" };
        }

        // 10분 전 시각 계산
        const deadlineDt = new Date(startDt.getTime() - 10 * 60 * 1000);
        const now = new Date();

        const dh = String(deadlineDt.getHours()).padStart(2, "0");
        const dm = String(deadlineDt.getMinutes()).padStart(2, "0");

        return {
            isPastDeadline: now >= deadlineDt,
            deadlineText: `${dh}:${dm}`
        };
    } catch (e) {
        return { isPastDeadline: false, deadlineText: "경기 시작 10분 전" };
    }
}

// ==================================================
// 4. 선택 경기 AI 분석 및 투표 현황 로드
// ==================================================
async function loadSelectedGame(gameId) {
    const userId = getLoggedInUserId();

    try {
        const voteUrl = userId 
            ? `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}&user_id=${userId}`
            : `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}`;
        
        const voteRes = await fetch(voteUrl);
        const voteStatus = voteRes.ok ? await voteRes.json() : { total_votes: 0, home_vote_pct: 50, away_vote_pct: 50, my_vote: null };

        const gamesRes = await fetch(`http://127.0.0.1:8000/api/games?limit=100`);
        const games = await gamesRes.json();
        const thisGame = games.find(g => g.game_id == gameId);

        if (!thisGame) return;

        // ★ 백엔드 voteStatus.game_info의 상세 정보(stadium, game_time, winning_team_id 등)를 병합!
        currentGameData = {
            ...thisGame,
            ...(voteStatus.game_info || {})
        };
        const gameYear = currentGameData.game_date ? String(currentGameData.game_date).substring(0, 4) : "";
        const seasonParam = gameYear ? `&season=${gameYear}` : "";

        const predRes = await fetch(
            `http://127.0.0.1:8000/api/predictions/matchup?home_team_id=${currentGameData.home_team_id}&away_team_id=${currentGameData.away_team_id}${seasonParam}`
        );
        if (!predRes.ok) throw new Error("예측 API 호출 실패");
        const pred = await predRes.json();

        renderPredictionUI(pred, voteStatus);
    } catch (err) {
        console.error("경기 로드 에러:", err);
    }
}

// ==================================================
// 5. UI 렌더링 및 선호 구단 강조 / 버튼 제어
// ==================================================
function renderPredictionUI(pred, voteStatus) {
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    safeSetText("homeName", pred.home_team_name);
    safeSetText("awayName", pred.away_team_name);

    const homeLogo = document.getElementById("homeLogo");
    if (homeLogo) homeLogo.src = pred.home_logo_url;
    const awayLogo = document.getElementById("awayLogo");
    if (awayLogo) awayLogo.src = pred.away_logo_url;

    safeSetText("homeProbTag", `${pred.home_win_prob}%`);
    safeSetText("awayProbTag", `${pred.away_win_prob}%`);

    const gaugeHome = document.getElementById("gaugeHome");
    if (gaugeHome) gaugeHome.style.width = `${pred.home_win_prob}%`;
    const gaugeAway = document.getElementById("gaugeAway");
    if (gaugeAway) gaugeAway.style.width = `${pred.away_win_prob}%`;

    // const winnerName = pred.predicted_winner_id === pred.home_team_id ? pred.home_team_name : pred.away_team_name;
    // safeSetText("verdictText", `${winnerName} 승리 유력!`);
    // --------------------------------------------------
    // AI 예측 평결 문구 (확률 기반 동적 멘트 적용)
    // --------------------------------------------------
    const isHomePredicted = (pred.predicted_winner_id === pred.home_team_id);
    const winnerName = isHomePredicted ? pred.home_team_name : pred.away_team_name;
    const maxWinProb = Math.max(Number(pred.home_win_prob || 50), Number(pred.away_win_prob || 50));

    const dynamicVerdict = getVerdictMessage(winnerName, maxWinProb);
    safeSetText("verdictText", dynamicVerdict);
    safeSetText("h2hPill", pred.head_to_head_summary || "맞대결 전적 없음");

    safeSetText("thAwayName", pred.away_team_name);
    safeSetText("thHomeName", pred.home_team_name);
    renderSaberComparisonTable(pred.metrics_comparison);

    safeSetText("voteCountText", `총 ${voteStatus.total_votes || 0}표 참여`);
    const awayBar = document.getElementById("userVoteAwayBar");
    const homeBar = document.getElementById("userVoteHomeBar");
    if (awayBar) {
        awayBar.style.width = `${voteStatus.away_vote_pct}%`;
        awayBar.textContent = `${voteStatus.away_vote_pct}%`;
    }
    if (homeBar) {
        homeBar.style.width = `${voteStatus.home_vote_pct}%`;
        homeBar.textContent = `${voteStatus.home_vote_pct}%`;
    }

    // ==================================================
    // 1. 선호 구단 및 승리팀 하이라이트 초기화
    // ==================================================
    const awaySideEl = document.querySelector(".away-side");
    const homeSideEl = document.querySelector(".home-side");

    document.querySelectorAll(".fav-side-badge, .winner-badge").forEach(b => b.remove());
    if (awaySideEl) {
        awaySideEl.classList.remove("is-my-team", "is-winner");
    }
    if (homeSideEl) {
        homeSideEl.classList.remove("is-my-team", "is-winner");
    }

    const homeId = Number(pred.home_team_id);
    const awayId = Number(pred.away_team_id);
    const favId = currentUserFavoriteTeamId;

    if (favId) {
        if (awayId === favId && awaySideEl) {
            awaySideEl.classList.add("is-my-team");
            const badge = document.createElement("div");
            badge.className = "fav-side-badge";
            badge.textContent = "★ MY 구단";
            awaySideEl.prepend(badge);
        }
        if (homeId === favId && homeSideEl) {
            homeSideEl.classList.add("is-my-team");
            const badge = document.createElement("div");
            badge.className = "fav-side-badge";
            badge.textContent = "★ MY 구단";
            homeSideEl.prepend(badge);
        }
    }

    // ==================================================
    // 2. 경기장, 경기 시작 시간 및 경기 상태별 배너 제어
    // ==================================================
    const resultBanner = document.getElementById("gameResultBanner");
    const statusPill = document.getElementById("gameStatusPill");
    const gameStatus = currentGameData ? currentGameData.status : "SCHEDULED";
    const myVote = voteStatus.my_vote;

// ★ 한국 시간(KST)과 구장 현지 시간을 모두 변환하여 중앙 요약 박스에 표시
    const stadium = currentGameData?.stadium || "경기장 미정";
    const h2hText = pred.head_to_head_summary || "맞대결 기록 없음";
    const timeInfo = convertGameTimes(
        currentGameData?.game_date,
        currentGameData?.game_time,
        currentGameData?.home_team_id,
        currentGameData?.game_id
    );

    const h2hPillEl = document.getElementById("h2hPill");
    if (h2hPillEl) {
        h2hPillEl.innerHTML = `
            <div class="meta-line">🏟️ ${stadium}</div>
            <div class="meta-line">🇰🇷 한국: <strong>${timeInfo.kstFull}</strong></div>
            <div class="meta-line" style="font-size: 12px; color: #64748b;">🇺🇸 현지: ${timeInfo.localFull}</div>
            <div class="meta-line h2h-highlight">⚔️ ${h2hText}</div>
        `;
    }

    if (gameStatus === "FINAL") {
        // [A] 경기 종료 상태
        resultBanner.style.display = "flex";
        if (statusPill) {
            statusPill.className = "game-status-pill final";
            statusPill.textContent = "경기 종료 (FINAL)";
        }

        const awayScore = currentGameData.away_score ?? 0;
        const homeScore = currentGameData.home_score ?? 0;
        document.getElementById("gameScoreDisplay").textContent = `${awayScore} : ${homeScore}`;

        let actualWinnerId = currentGameData.winning_team_id ? Number(currentGameData.winning_team_id) : null;
        if (!actualWinnerId) {
            if (awayScore > homeScore) actualWinnerId = awayId;
            else if (homeScore > awayScore) actualWinnerId = homeId;
        }

        let actualWinnerName = "무승부";
        if (actualWinnerId === homeId) actualWinnerName = pred.home_team_name;
        else if (actualWinnerId === awayId) actualWinnerName = pred.away_team_name;

        document.getElementById("winningTeamText").textContent = `🏆 승리팀: ${actualWinnerName}`;

        if (actualWinnerId === awayId && awaySideEl) {
            awaySideEl.classList.add("is-winner");
            const winBadge = document.createElement("div");
            winBadge.className = "winner-badge";
            winBadge.textContent = "🏆 WINNER";
            awaySideEl.prepend(winBadge);
        } else if (actualWinnerId === homeId && homeSideEl) {
            homeSideEl.classList.add("is-winner");
            const winBadge = document.createElement("div");
            winBadge.className = "winner-badge";
            winBadge.textContent = "🏆 WINNER";
            homeSideEl.prepend(winBadge);
        }

        const badge = document.getElementById("outcomeBadge");
        const detail = document.getElementById("outcomeDetailText");

        if (myVote) {
            const pickedTeamName = (Number(myVote.selected_team_id) === homeId) ? pred.home_team_name : pred.away_team_name;
            const isCorrect = (myVote.is_correct === true || myVote.is_correct === 1 || String(myVote.is_correct).toLowerCase() === "true");
            const isIncorrect = (myVote.is_correct === false || myVote.is_correct === 0 || String(myVote.is_correct).toLowerCase() === "false");

            if (isCorrect) {
                badge.className = "outcome-badge win";
                badge.textContent = `🎉 예측 적중 성공! (+${myVote.reward_point || 200} P 획득)`;
                const currentStreak = myVote.prediction_streak || myVote.current_streak || 1;
                detail.innerHTML = `회원님의 선택: <strong>${pickedTeamName}</strong> <span style="color:#16a34a; font-weight:800; margin-left:8px;">🔥 현재 ${currentStreak}회 연속 적중 달성 중!</span>`;
            } else if (isIncorrect) {
                badge.className = "outcome-badge lose";
                badge.textContent = "😢 아쉬운 예측 실패 (0 P 획득)";
                detail.innerHTML = `회원님의 선택: <strong>${pickedTeamName}</strong> <span style="color:#dc2626; margin-left:8px;">(연속 적중 초기화)</span>`;
            } else {
                badge.className = "outcome-badge none";
                badge.textContent = "⏳ 경기 정산 대기 중";
                detail.innerHTML = `회원님의 선택: <strong>${pickedTeamName}</strong> (경기 결과 판정 대기)`;
            }
        } else {
            badge.className = "outcome-badge none";
            badge.textContent = "미참여 경기";
            detail.textContent = "이 경기에는 승부예측 투표를 진행하지 않았습니다.";
        }

    } else if (gameStatus === "LIVE" || gameStatus === "IN_PROGRESS") {
        // [B] 경기 진행 중 상태
        resultBanner.style.display = "flex";
        if (statusPill) {
            statusPill.className = "game-status-pill live";
            statusPill.textContent = "실시간 진행 중 (LIVE)";
        }

        const awayScore = currentGameData.away_score ?? 0;
        const homeScore = currentGameData.home_score ?? 0;
        document.getElementById("gameScoreDisplay").textContent = `${awayScore} : ${homeScore}`;
        document.getElementById("winningTeamText").textContent = `🔴 경기 실시간 진행 중 (승리팀 미정)`;

        const badge = document.getElementById("outcomeBadge");
        const detail = document.getElementById("outcomeDetailText");
        badge.className = "outcome-badge none";
        badge.textContent = "경기 진행 중";
        if (myVote) {
            const pickedTeamName = (Number(myVote.selected_team_id) === homeId) ? pred.home_team_name : pred.away_team_name;
            detail.innerHTML = `회원님의 선택: <strong>${pickedTeamName}</strong> (경기 종료 후 정산)`;
        } else {
            detail.textContent = "신규 투표가 마감되었습니다.";
        }

    } else {
        // [C] 경기 시작 전 (SCHEDULED)
        resultBanner.style.display = "none";
    }

    // ==================================================
    // 3. 버튼 상태 및 '경기 시작 10분 전 마감' 안내 문구 제어
    // ==================================================
    const btnAway = document.getElementById("btnVoteAway");
    const btnHome = document.getElementById("btnVoteHome");
    const myVoteBox = document.getElementById("myVoteStatusBox");
    if (!btnAway || !btnHome) return;

    const userId = getLoggedInUserId();
    const deadlineInfo = checkVoteDeadline(
        currentGameData?.game_date,
        currentGameData?.game_time,
        currentGameData?.home_team_id,
        currentGameData?.game_id
    );
    const deadlineNoticeHtml = `<div style="margin-top: 6px; font-size: 12.5px; color: #d97706; font-weight: 700;">⏰ 경기 시작 10분 전(${deadlineInfo.deadlineText})까지 투표 가능합니다.</div>`;

    const disableBtn = (btn, text) => {
        btn.disabled = true;
        btn.textContent = text;
        btn.style.opacity = "0.45";
        btn.style.cursor = "not-allowed";
        btn.style.backgroundColor = "#e0e0e0";
        btn.style.borderColor = "#ccc";
        btn.style.color = "#777";
    };

    const enableBtn = (btn, text) => {
        btn.disabled = false;
        btn.textContent = text;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        btn.style.backgroundColor = "#fff";
        btn.style.borderColor = "#102d63";
        btn.style.color = "#102d63";
    };

    if (gameStatus === "FINAL") {
        disableBtn(btnAway, "투표 마감 (경기 종료)");
        disableBtn(btnHome, "투표 마감 (경기 종료)");
        if (myVoteBox) myVoteBox.innerHTML = `<span style="color: #64748b;">종료된 경기입니다. 상단의 최종 경기 결과와 예측 판정 내역을 확인하세요.</span>`;
        return;
    }

    if (gameStatus === "LIVE" || gameStatus === "IN_PROGRESS") {
        disableBtn(btnAway, "투표 마감 (경기 진행 중)");
        disableBtn(btnHome, "투표 마감 (경기 진행 중)");
        if (myVoteBox) myVoteBox.innerHTML = `<span style="color: #dc2626; font-weight:700;">🔴 경기가 시작되어 신규 투표가 마감되었습니다.</span>`;
        return;
    }

    // [예정 경기(SCHEDULED)일 때]
    if (myVote) {
        if (Number(myVote.selected_team_id) === awayId) {
            disableBtn(btnAway, "✔ 투표 완료 (원정팀)");
            disableBtn(btnHome, "투표 마감");
        } else {
            disableBtn(btnAway, "투표 마감");
            disableBtn(btnHome, "✔ 투표 완료 (홈팀)");
        }

        const selectedTeamName = (Number(myVote.selected_team_id) === homeId) ? pred.home_team_name : pred.away_team_name;
        if (myVoteBox) {
            myVoteBox.innerHTML = `✔ 회원님은 <strong>${selectedTeamName}</strong>에 투표하셨습니다. (경기 종료 후 자동 정산)${deadlineNoticeHtml}`;
        }
        return;
    }

    // 경기 시작 10분 전이 지난 경우 투표 마감 처리
    if (deadlineInfo.isPastDeadline) {
        disableBtn(btnAway, "투표 마감 (시작 임박)");
        disableBtn(btnHome, "투표 마감 (시작 임박)");
        if (myVoteBox) {
            myVoteBox.innerHTML = `<span style="color: #dc2626; font-weight: 700;">⏰ 경기 시작 10분 전(${deadlineInfo.deadlineText})이 지나 투표가 마감되었습니다.</span>`;
        }
        return;
    }

    if (!userId) {
        enableBtn(btnAway, "로그인 후 투표 (원정)");
        enableBtn(btnHome, "로그인 후 투표 (홈)");
        if (myVoteBox) {
            myVoteBox.innerHTML = `<span style="color: #777;">투표에 참여하시려면 먼저 <a href="login.html" style="color:#102d63; text-decoration:underline; font-weight:700;">로그인</a>해 주세요.</span>${deadlineNoticeHtml}`;
        }
        return;
    }

    if (currentUserPoints < 100) {
        disableBtn(btnAway, "포인트 부족 (100P 필요)");
        disableBtn(btnHome, "포인트 부족 (100P 필요)");
        if (myVoteBox) {
            myVoteBox.innerHTML = `<span style="color: #d32f2f; font-weight: 700;">보유 포인트가 부족하여 투표할 수 없습니다. (현재: ${currentUserPoints} P / 필요: 100 P)</span>${deadlineNoticeHtml}`;
        }
        return;
    }

    enableBtn(btnAway, "원정팀 승리 투표 (100P)");
    enableBtn(btnHome, "홈팀 승리 투표 (100P)");
    if (myVoteBox) {
        myVoteBox.innerHTML = `원하는 팀을 선택하여 승부예측 투표(100P)에 참여해 보세요!${deadlineNoticeHtml}`;
    }
}

// ==================================================
// 6. 투표 실행
// ==================================================
async function handleVote(side) {
    if (currentGameData && currentGameData.status === "FINAL") {
        alert("이미 종료된 경기에는 투표할 수 없습니다.");
        return;
    }

    const userId = getLoggedInUserId();
    if (!userId) {
        if (confirm("로그인이 필요한 서비스입니다.\n로그인 페이지로 이동하시겠습니까?")) {
            location.href = "login.html";
        }
        return;
    }

    if (currentUserPoints < 100) {
        alert(`보유 포인트가 부족합니다.\n현재 보유 포인트: ${currentUserPoints} P (필요 포인트: 100 P)`);
        return;
    }

    if (!currentGameData) return;

    const selectedTeamId = side === "home" ? currentGameData.home_team_id : currentGameData.away_team_id;

    try {
        const response = await fetch("http://127.0.0.1:8000/api/predictions/votes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                game_id: currentGameData.game_id,
                user_id: parseInt(userId),
                selected_team_id: selectedTeamId,
                bet_point: 100
            })
        });

        const resData = await response.json();
        if (!response.ok) {
            alert(resData.detail || "투표에 실패했습니다.");
            return;
        }

        alert("100 포인트 베팅 및 투표가 완료되었습니다!");
        await fetchUserPoints();
        loadSelectedGame(currentGameData.game_id);
    } catch (e) {
        console.error("투표 요청 오류:", e);
        alert("서버 연결에 실패했습니다.");
    }
}

// ==================================================
// 확률 구간별 AI 예측 메시지 생성 헬퍼 함수
// ==================================================
function getVerdictMessage(winnerName, maxProb) {
    const prob = Number(maxProb);

    if (prob >= 75.0) {
        return `🔥 ${winnerName} 압도적 승리 우세!`;
    } else if (prob >= 65.0) {
        return `⚡ ${winnerName} 승리 유력! (데이터 우세)`;
    } else if (prob >= 55.0) {
        return `⚾ ${winnerName} 우세 예상 (접전 속 우위)`;
    } else {
        return `⚔️ ${winnerName} 근소 우세 (초박빙 승부)`;
    }
}

// ==================================================
// 세이버메트릭스 비교 표 동적 렌더링 (Extension 제외 전 지표 반영 & 우세 팀 자동 하이라이트)
// ==================================================
function renderSaberComparisonTable(mc) {
    const tbody = document.getElementById("saberComparisonBody");
    if (!tbody || !mc) return;

    const fmtSigned = v => (v !== null && v !== undefined) ? (Number(v) > 0 ? `+${v}` : `${v}`) : '-';

    const rows = [
        { category: "⚾ 타격 생산력 · 배트 트래킹 · 타구질 (Batting & Bat Tracking)" },
        {
            label: "wRC+ (조정 득점 창출력)",
            desc: "리그 평균 100 기준 팀 타선 생산력",
            away: mc.away_wrc_plus,
            home: mc.home_wrc_plus,
            format: v => `${v ?? '-'}`,
            higherIsBetter: true
        },
        {
            label: "팀 타격 득점 가치 (Batting Run Value)",
            desc: "Savant Swing-Take 기반 팀 타격 총 득점 기여",
            away: mc.away_batting_rv,
            home: mc.home_batting_rv,
            format: fmtSigned,
            higherIsBetter: true
        },
        {
            label: "xwOBA / xBA / xSLG (기대 슬래시 라인)",
            desc: "타구 속도와 발사각 기반 기대 가중출루율 · 기대타율 · 기대장타율",
            away: mc.away_xwoba,
            home: mc.home_xwoba,
            format: (v, side) => side === "away"
                ? `${Number(mc.away_xwoba || 0).toFixed(3)} / ${Number(mc.away_xba || 0).toFixed(3)} / ${Number(mc.away_xslg || 0).toFixed(3)}`
                : `${Number(mc.home_xwoba || 0).toFixed(3)} / ${Number(mc.home_xba || 0).toFixed(3)} / ${Number(mc.home_xslg || 0).toFixed(3)}`,
            higherIsBetter: true
        },
        {
            label: "평균 배트 스피드 (Bat Speed)",
            desc: "팀 타자들의 평균 스윙 속도",
            away: mc.away_bat_speed,
            home: mc.home_bat_speed,
            format: v => v !== undefined ? `${Number(v).toFixed(1)} mph` : '-',
            higherIsBetter: true
        },
        {
            label: "스퀘어업 정타 비율 (Squared-Up %)",
            desc: "스윙 대비 배트 중심에 정확히 맞힌 정타 비율",
            away: mc.away_squared_up_pct,
            home: mc.home_squared_up_pct,
            format: v => v !== undefined ? `${Number(v).toFixed(1)}%` : '-',
            higherIsBetter: true
        },
        {
            label: "평균 타구속도 (Exit Velocity)",
            desc: "타자가 타격한 공의 평균 속도",
            away: mc.away_avg_exit_velo,
            home: mc.home_avg_exit_velo,
            format: v => v ? `${Number(v).toFixed(1)} mph` : '-',
            higherIsBetter: true
        },
        {
            label: "배럴 타구 비율 (Barrel %)",
            desc: "장타 확률이 극대화되는 이상적 타구 비율",
            away: mc.away_barrel_pct,
            home: mc.home_barrel_pct,
            format: v => v ? `${Number(v).toFixed(1)}%` : '-',
            higherIsBetter: true
        },
        {
            label: "하드힛 비율 (Hard-Hit %)",
            desc: "95mph 이상의 강한 타구 비율",
            away: mc.away_hard_hit_pct,
            home: mc.home_hard_hit_pct,
            format: v => v ? `${Number(v).toFixed(1)}%` : '-',
            higherIsBetter: true
        },
        { category: "🔥 마운드 억제력 · 구종별 가치 (Pitching & Pitch Run Value)" },
        {
            label: "팀 투구 종합 가치 (Pitching Run Value)",
            desc: "마운드 전체의 평균 대비 실점 억제 득점 가치",
            away: mc.away_pitching_rv,
            home: mc.home_pitching_rv,
            format: fmtSigned,
            higherIsBetter: true
        },
        {
            label: "구종별 득점 가치 (속구 / 변화구 / 오프스피드)",
            desc: "Fastball · Breaking · Offspeed 구종 그룹별 Run Value 합계",
            away: (mc.away_fb_rv || 0) + (mc.away_brk_rv || 0) + (mc.away_off_rv || 0),
            home: (mc.home_fb_rv || 0) + (mc.home_brk_rv || 0) + (mc.home_off_rv || 0),
            format: (v, side) => side === "away"
                ? `속구 ${fmtSigned(mc.away_fb_rv)} / 변화 ${fmtSigned(mc.away_brk_rv)} / 오프 ${fmtSigned(mc.away_off_rv)}`
                : `속구 ${fmtSigned(mc.home_fb_rv)} / 변화 ${fmtSigned(mc.home_brk_rv)} / 오프 ${fmtSigned(mc.home_off_rv)}`,
            higherIsBetter: true
        },
        {
            label: "팀 평균 FIP / xERA (수비무관 · 기대 자책점)",
            desc: "투수 본연의 억제력(FIP) 및 타구질 기반 기대 평균자책점(xERA) (낮을수록 우세)",
            away: mc.away_xera,
            home: mc.home_xera,
            format: (v, side) => side === "away"
                ? `FIP ${Number(mc.away_fip || 0).toFixed(2)} / xERA ${Number(mc.away_xera || 0).toFixed(2)}`
                : `FIP ${Number(mc.home_fip || 0).toFixed(2)} / xERA ${Number(mc.home_xera || 0).toFixed(2)}`,
            higherIsBetter: false
        },
        {
            label: "팀 평균 ERA / 피기대타율 (xBA)",
            desc: "9이닝당 평균 자책점 및 투수진 평균 피기대타율 (낮을수록 우세)",
            away: mc.away_era,
            home: mc.home_era,
            format: (v, side) => side === "away"
                ? `ERA ${Number(mc.away_era || 0).toFixed(2)} / 피xBA ${Number(mc.away_pit_xba || 0).toFixed(3)}`
                : `ERA ${Number(mc.home_era || 0).toFixed(2)} / 피xBA ${Number(mc.home_pit_xba || 0).toFixed(3)}`,
            higherIsBetter: false
        },
        {
            label: "포심 평균 구속 (Fastball Velo)",
            desc: "투수진의 포심 패스트볼 평균 구속",
            away: mc.away_fastball_velo,
            home: mc.home_fastball_velo,
            format: v => v ? `${Number(v).toFixed(1)} mph` : '-',
            higherIsBetter: true
        },
        {
            label: "탈삼진율 (K%) / 헛스윙 유도율 (Whiff%)",
            desc: "상대 타자 대비 탈삼진 비율 및 스윙 대비 헛스윙 유도율",
            away: mc.away_pit_k_pct,
            home: mc.home_pit_k_pct,
            format: (v, side) => side === "away"
                ? `K% ${Number(mc.away_pit_k_pct || 0).toFixed(1)}% / Whiff% ${Number(mc.away_pit_whiff_pct || 0).toFixed(1)}%`
                : `K% ${Number(mc.home_pit_k_pct || 0).toFixed(1)}% / Whiff% ${Number(mc.home_pit_whiff_pct || 0).toFixed(1)}%`,
            higherIsBetter: true
        },
        {
            label: "투수 땅볼 유도율 (GB %)",
            desc: "인플레이 타구 중 땅볼 유도 비율",
            away: mc.away_pit_gb_pct,
            home: mc.home_pit_gb_pct,
            format: v => v ? `${Number(v).toFixed(1)}%` : '-',
            higherIsBetter: true
        },
        { category: "🧤 수비 · 포수 프레이밍 · 주루 · WAR (Fielding, Catching & Running)" },
        {
            label: "팀 종합 수비 가치 (Fielding Run Value)",
            desc: "수비 범위(OAA) + 송구(Arm) + 포수 수비를 통합한 총 수비 득점 가치",
            away: mc.away_fielding_rv,
            home: mc.home_fielding_rv,
            format: fmtSigned,
            higherIsBetter: true
        },
        {
            label: "수비 범위 (OAA) / 외야 송구 가치 (Arm Value)",
            desc: "평균 대비 추가 아웃 처리 수(OAA) 및 외야수 송구 득점 기여",
            away: mc.away_team_oaa,
            home: mc.home_team_oaa,
            format: (v, side) => side === "away"
                ? `OAA ${fmtSigned(mc.away_team_oaa)} / Arm ${fmtSigned(mc.away_arm_value)}`
                : `OAA ${fmtSigned(mc.home_team_oaa)} / Arm ${fmtSigned(mc.home_arm_value)}`,
            higherIsBetter: true
        },
        {
            label: "포수 프레이밍 득점 가치 (Catcher Framing)",
            desc: "포수진의 스트라이크 존 보더라인 프레이밍 득점 기여",
            away: mc.away_framing_runs,
            home: mc.home_framing_runs,
            format: fmtSigned,
            higherIsBetter: true
        },
        {
            label: "팀 주루 가치 (Baserunning RV) / 주루 속도",
            desc: "도루·추가 진루 기반 주루 득점 가치 및 평균 스프린트 스피드",
            away: mc.away_sprint_speed,
            home: mc.home_sprint_speed,
            format: (v, side) => side === "away"
                ? `BSR ${fmtSigned(mc.away_bsr_rv)} (${Number(mc.away_sprint_speed || 0).toFixed(1)} ft/s)`
                : `BSR ${fmtSigned(mc.home_bsr_rv)} (${Number(mc.home_sprint_speed || 0).toFixed(1)} ft/s)`,
            higherIsBetter: true
        },
        {
            label: "선수단 평균 bWAR",
            desc: "대체 선수 대비 평균 승리 기여도",
            away: mc.away_avg_bwar,
            home: mc.home_avg_bwar,
            format: v => v !== undefined ? Number(v).toFixed(2) : '-',
            higherIsBetter: true
        }
    ];

    let html = "";
    rows.forEach(r => {
        if (r.category) {
            html += `<tr class="saber-category-row"><td colspan="3">${r.category}</td></tr>`;
            return;
        }

        const aVal = Number(r.away);
        const hVal = Number(r.home);
        let awayBetter = false;
        let homeBetter = false;

        if (!isNaN(aVal) && !isNaN(hVal) && aVal !== hVal) {
            if (r.higherIsBetter) {
                awayBetter = aVal > hVal;
                homeBetter = hVal > aVal;
            } else {
                awayBetter = aVal < hVal;
                homeBetter = hVal < aVal;
            }
        }

        html += `
            <tr>
                <td class="metric-num ${awayBetter ? 'is-better' : ''}">
                    ${awayBetter ? '<span class="better-dot"></span>' : ''}${r.format(r.away, "away")}
                </td>
                <td class="metric-label-cell">
                    ${r.label}
                    <span class="metric-sub-desc">${r.desc}</span>
                </td>
                <td class="metric-num ${homeBetter ? 'is-better' : ''}">
                    ${r.format(r.home, "home")}${homeBetter ? '<span class="better-dot"></span>' : ''}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}