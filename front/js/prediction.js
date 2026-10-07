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
            const statusLabel = g.status === "FINAL" ? "[종료]" : "[예정]";
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

    const winnerName = pred.predicted_winner_id === pred.home_team_id ? pred.home_team_name : pred.away_team_name;
    safeSetText("verdictText", `${winnerName} 승리 유력!`);
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
    // ★ 선호 구단(MY 구단) 뱃지 & 테두리 렌더링
    // ==================================================
    const awaySideEl = document.querySelector(".away-side");
    const homeSideEl = document.querySelector(".home-side");

    // 이전 뱃지 및 하이라이트 클래스 초기화
    document.querySelectorAll(".fav-side-badge").forEach(b => b.remove());
    if (awaySideEl) awaySideEl.classList.remove("is-my-team");
    if (homeSideEl) homeSideEl.classList.remove("is-my-team");

    const homeId = Number(pred.home_team_id);
    const awayId = Number(pred.away_team_id);
    const favId = currentUserFavoriteTeamId;

    if (favId) {
        if (awayId === favId && awaySideEl) {
            awaySideEl.classList.add("is-my-team");
            const badge = document.createElement("div");
            badge.className = "fav-side-badge";
            badge.textContent = "★ MY 구단";
            if (awayLogo) awaySideEl.insertBefore(badge, awayLogo);
            else awaySideEl.prepend(badge);
        }

        if (homeId === favId && homeSideEl) {
            homeSideEl.classList.add("is-my-team");
            const badge = document.createElement("div");
            badge.className = "fav-side-badge";
            badge.textContent = "★ MY 구단";
            if (homeLogo) homeSideEl.insertBefore(badge, homeLogo);
            else homeSideEl.prepend(badge);
        }
    }

    // 버튼 제어
    const btnAway = document.getElementById("btnVoteAway");
    const btnHome = document.getElementById("btnVoteHome");
    const myVoteBox = document.getElementById("myVoteStatusBox");
    if (!btnAway || !btnHome) return;

    const userId = getLoggedInUserId();
    const isGameFinal = (currentGameData && currentGameData.status === "FINAL");
    const myVote = voteStatus.my_vote;

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

    if (isGameFinal) {
        disableBtn(btnAway, "투표 마감 (경기 종료)");
        disableBtn(btnHome, "투표 마감 (경기 종료)");
        if (myVoteBox) myVoteBox.innerHTML = `<span style="color: #666;">종료된 경기입니다. 최종 결과 및 예측 지표를 확인하세요.</span>`;
        return;
    }

    if (myVote) {
        if (myVote.selected_team_id === currentGameData.away_team_id) {
            disableBtn(btnAway, "✔ 투표 완료 (원정팀)");
            disableBtn(btnHome, "투표 마감");
        } else {
            disableBtn(btnAway, "투표 마감");
            disableBtn(btnHome, "✔ 투표 완료 (홈팀)");
        }

        const selectedTeamName = (myVote.selected_team_id === currentGameData.home_team_id)
            ? pred.home_team_name 
            : pred.away_team_name;

        let resultMsg = "";
        if (myVote.is_correct === true) {
            resultMsg = ` <span style="color:#2e7d32;">(적중! +${myVote.reward_point}P 지급)</span>`;
        } else if (myVote.is_correct === false) {
            resultMsg = ` <span style="color:#d32f2f;">(미적중)</span>`;
        }
        if (myVoteBox) myVoteBox.innerHTML = `✔ 회원님은 <strong>${selectedTeamName}</strong>에 투표하셨습니다.${resultMsg}`;
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