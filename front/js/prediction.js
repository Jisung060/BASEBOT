// ==================================================
// 1. 공통 컴포넌트 로더 (상대 경로 안전 로드)
// ==================================================
async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (response.ok) {
            const html = await response.text();
            const targetEl = document.getElementById(elementId);
            if (targetEl) targetEl.innerHTML = html;
        } else {
            console.warn(`컴포넌트 로드 실패 (${filePath}): HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn(`컴포넌트 로드 에러 (${filePath}):`, error);
    }
}

// ==================================================
// 2. 로그인 유저 식별 (안전 검사)
// ==================================================
function getLoggedInUserId() {
    try {
        const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
        if (userStr) {
            const u = JSON.parse(userStr);
            if (u && (u.user_id || u.id)) return u.user_id || u.id;
        }
    } catch (e) {
        console.warn("유저 정보 파싱 실패:", e);
    }
    return localStorage.getItem("test_user_id") || null;
}

let currentGameData = null;

// ==================================================
// 3. 페이지 초기화
// ==================================================
document.addEventListener("DOMContentLoaded", async () => {
    // Header & Footer 비동기 로드
    // loadComponent("header", "../components/header.html");
    // loadComponent("footer", "../components/footer.html");

    // 경기 목록 로드
    await loadGameList();

    // 이벤트 리스너 등록
    const btnLoad = document.getElementById("btnLoadGame");
    if (btnLoad) {
        btnLoad.addEventListener("click", () => {
            const gameSelect = document.getElementById("gameSelect");
            if (gameSelect && gameSelect.value) {
                loadSelectedGame(gameSelect.value);
            }
        });
    }

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
// 4. 경기 목록 불러오기
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

        // 최신 경기 자동 선택 및 분석 실행
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
// 5. 선택 경기 AI 분석 및 투표 현황 로드
// ==================================================
async function loadSelectedGame(gameId) {
    const userId = getLoggedInUserId();

    try {
        // 투표 현황 조회
        const voteUrl = userId 
            ? `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}&user_id=${userId}`
            : `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}`;
        
        const voteRes = await fetch(voteUrl);
        const voteStatus = voteRes.ok ? await voteRes.json() : { total_votes: 0, home_vote_pct: 50, away_vote_pct: 50, my_vote: null };

        // 경기 정보 조회
        const gamesRes = await fetch(`http://127.0.0.1:8000/api/games?limit=100`);
        const games = await gamesRes.json();
        const thisGame = games.find(g => g.game_id == gameId);

        if (!thisGame) return;
        currentGameData = thisGame;

        // AI 예측 데이터 조회
        const predRes = await fetch(`http://127.0.0.1:8000/api/predictions/matchup?home_team_id=${thisGame.home_team_id}&away_team_id=${thisGame.away_team_id}`);
        if (!predRes.ok) throw new Error("예측 API 호출 실패");
        const pred = await predRes.json();

        renderPredictionUI(pred, voteStatus);
    } catch (err) {
        console.error("경기 로드 에러:", err);
    }
}

// ==================================================
// 6. UI 렌더링 및 3중 버튼 비활성화 제어
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

    // 투표 바 렌더링
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

    enableBtn(btnAway, "원정팀 승리 투표 (100P)");
    enableBtn(btnHome, "홈팀 승리 투표 (100P)");
    if (myVoteBox) myVoteBox.innerHTML = "원하는 팀을 선택하여 승부예측 투표(100P)에 참여해 보세요!";
}

// ==================================================
// 7. 투표 실행
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
        loadSelectedGame(currentGameData.game_id);
    } catch (e) {
        console.error("투표 요청 오류:", e);
        alert("서버 연결에 실패했습니다.");
    }
}