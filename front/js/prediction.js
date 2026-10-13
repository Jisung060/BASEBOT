// ==================================================
// 전역 변수 관리
// ==================================================
let currentGameData = null;
let currentUserPoints = 0;
let currentUserFavoriteTeamId = null; // ★ 선호 구단 ID 전역 관리

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

// ==================================================
// 3. 경기 목록 불러오기 (최신순)
// ==================================================
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
            const dateStr = g.game_date ? g.game_date.substring(0, 10) : "";
            
            // 상태 라벨 세분화 (FINAL, IN_PROGRESS/LIVE, SCHEDULED)
            let statusLabel = "[예정]";
            if (g.status === "FINAL") {
                statusLabel = "[종료]";
            } else if (g.status === "IN_PROGRESS" || g.status === "LIVE") {
                statusLabel = "[진행중]";
            }

            const opt = new Option(`${statusLabel} ${dateStr} - ${g.away_team_name} vs ${g.home_team_name}`, g.game_id);
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
        currentGameData = thisGame;

        const predRes = await fetch(`http://127.0.0.1:8000/api/predictions/matchup?home_team_id=${thisGame.home_team_id}&away_team_id=${thisGame.away_team_id}`);
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
    safeSetText("tdAwayVelo", `${pred.metrics_comparison?.away_avg_exit_velo || 0} mph`);
    safeSetText("tdHomeVelo", `${pred.metrics_comparison?.home_avg_exit_velo || 0} mph`);
    safeSetText("tdAwayBarrel", `${pred.metrics_comparison?.away_barrel_pct || 0}%`);
    safeSetText("tdHomeBarrel", `${pred.metrics_comparison?.home_barrel_pct || 0}%`);
    safeSetText("tdAwayWar", (pred.metrics_comparison?.away_avg_bwar || 0).toFixed(2));
    safeSetText("tdHomeWar", (pred.metrics_comparison?.home_avg_bwar || 0).toFixed(2));

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
    // 2. 경기 상태별 (FINAL / LIVE / SCHEDULED) 배너 및 승리팀 제어
    // ==================================================
    const resultBanner = document.getElementById("gameResultBanner");
    const statusPill = document.getElementById("gameStatusPill");
    const gameStatus = currentGameData ? currentGameData.status : "SCHEDULED";
    const myVote = voteStatus.my_vote;

    // 경기장 및 시간 표시
    const stadium = currentGameData?.stadium || "경기장 미정";
    const gameTime = currentGameData?.game_time ? currentGameData.game_time.substring(0, 5) : "";
    safeSetText("h2hPill", `${stadium} ${gameTime ? `(\${gameTime})` : ''} | ${pred.head_to_head_summary || '상대전적 요약'}`);

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
                const currentStreak = myVote.current_streak || myVote.prediction_streak || 1;
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
    // 3. 버튼 상태 및 안내 문구 제어
    // ==================================================
    const btnAway = document.getElementById("btnVoteAway");
    const btnHome = document.getElementById("btnVoteHome");
    const myVoteBox = document.getElementById("myVoteStatusBox");
    if (!btnAway || !btnHome) return;

    const userId = getLoggedInUserId();

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
            myVoteBox.innerHTML = `✔ 회원님은 <strong>${selectedTeamName}</strong>에 투표하셨습니다. (경기 종료 후 자동 정산)`;
        }
        return;
    }

    if (!userId) {
        enableBtn(btnAway, "로그인 후 투표 (원정)");
        enableBtn(btnHome, "로그인 후 투표 (홈)");
        if (myVoteBox) myVoteBox.innerHTML = `<span style="color: #777;">투표에 참여하시려면 먼저 <a href="login.html" style="color:#102d63; text-decoration:underline; font-weight:700;">로그인</a>해 주세요.</span>`;
        return;
    }

    if (currentUserPoints < 100) {
        disableBtn(btnAway, "포인트 부족 (100P 필요)");
        disableBtn(btnHome, "포인트 부족 (100P 필요)");
        if (myVoteBox) myVoteBox.innerHTML = `<span style="color: #d32f2f; font-weight: 700;">보유 포인트가 부족하여 투표할 수 없습니다. (현재: ${currentUserPoints} P / 필요: 100 P)</span>`;
        return;
    }

    enableBtn(btnAway, "원정팀 승리 투표 (100P)");
    enableBtn(btnHome, "홈팀 승리 투표 (100P)");
    if (myVoteBox) myVoteBox.innerHTML = "원하는 팀을 선택하여 승부예측 투표(100P)에 참여해 보세요!";
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

