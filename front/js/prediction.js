document.addEventListener("DOMContentLoaded", async () => {
    loadComponent("header", "../components/header.html");
    loadComponent("footer", "../components/footer.html");

    // 1. 경기 목록 드롭다운 로드
    await loadGameList();

    // 2. 경기 선택 버튼 이벤트
    document.getElementById("btnLoadGame").addEventListener("click", () => {
        const gameId = document.getElementById("gameSelect").value;
        if (gameId) loadSelectedGame(gameId);
    });

    // 3. 투표 버튼 이벤트 바인딩
    document.getElementById("btnVoteAway").addEventListener("click", () => handleVote("away"));
    document.getElementById("btnVoteHome").addEventListener("click", () => handleVote("home"));
});

let currentGameData = null;

// 로그인 사용자 식별 함수 (로그인 기능이 불안정하므로 sessionStorage/localStorage 확인 후 fallback 지원)
function getLoggedInUserId() {
    // 팀 프로젝트의 로그인 토큰/세션 키 확인
    const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
    if (userStr) {
        try {
            const u = JSON.parse(userStr);
            return u.user_id || u.id;
        } catch (e) {}
    }
    // 테스트용: 로그인 기능 복구 전까지 임시 테스트용 ID (없으면 null)
    return localStorage.getItem("test_user_id") || null;
}

// 1. DB에 적재된 경기 목록 불러오기
// loadGameList 함수 수정
async function loadGameList() {
    try {
        // 최신순(order=desc)으로 최근/미래 경기 우선 로드
        const res = await fetch("http://127.0.0.1:8000/api/games?order=desc&limit=50");
        const games = await res.json();
        const select = document.getElementById("gameSelect");
        select.innerHTML = "";

        if (games.length === 0) {
            select.innerHTML = `<option value="">등록된 경기가 없습니다</option>`;
            return;
        }

        games.forEach(g => {
            const dateStr = g.game_date.substring(0, 10);
            const statusLabel = g.status === "FINAL" ? "[종료]" : "[예정]";
            const opt = new Option(`${statusLabel} ${dateStr} - ${g.away_team_name} vs ${g.home_team_name}`, g.game_id);
            select.add(opt);
        });

        // 가장 최신(첫 번째) 경기 자동 선택 및 로드
        if (games.length > 0) {
            select.value = games[0].game_id;
            loadSelectedGame(games[0].game_id);
        }
    } catch (e) {
        console.error("경기 목록 로드 실패:", e);
    }
}

// 2. 특정 경기의 AI 분석 및 투표 현황 로드
async function loadSelectedGame(gameId) {
    const userId = getLoggedInUserId();

    try {
        // 1) 경기 정보 및 투표 현황 조회
        const voteUrl = userId 
            ? `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}&user_id=${userId}`
            : `http://127.0.0.1:8000/api/predictions/votes/status?game_id=${gameId}`;
        
        const voteRes = await fetch(voteUrl);
        const voteStatus = await voteRes.json();

        // 2) AI 승부예측 API 호출
        // games 목록에서 해당 경기 매치업 팀 ID 추출을 위해 단건 경기 또는 전체 조회
        const gamesRes = await fetch(`http://127.0.0.1:8000/api/games?limit=100`);
        const games = await gamesRes.json();
        const thisGame = games.find(g => g.game_id == gameId);

        if (!thisGame) return;
        currentGameData = thisGame;

        const predRes = await fetch(`http://127.0.0.1:8000/api/predictions/matchup?home_team_id=${thisGame.home_team_id}&away_team_id=${thisGame.away_team_id}`);
        const pred = await predRes.json();

        // 3. UI 바인딩
        renderPredictionUI(pred, voteStatus);
    } catch (err) {
        console.error("경기 로드 에러:", err);
    }
}

function renderPredictionUI(pred, voteStatus) {
    // 팀 기본 정보 및 로고
    document.getElementById("homeName").textContent = pred.home_team_name;
    document.getElementById("awayName").textContent = pred.away_team_name;
    document.getElementById("homeLogo").src = pred.home_logo_url;
    document.getElementById("awayLogo").src = pred.away_logo_url;

    // AI 확률
    document.getElementById("homeProbTag").textContent = `${pred.home_win_prob}%`;
    document.getElementById("awayProbTag").textContent = `${pred.away_win_prob}%`;
    document.getElementById("gaugeHome").style.width = `${pred.home_win_prob}%`;
    document.getElementById("gaugeAway").style.width = `${pred.away_win_prob}%`;

    const winnerName = pred.predicted_winner_id === pred.home_team_id ? pred.home_team_name : pred.away_team_name;
    document.getElementById("verdictText").textContent = `${winnerName} 승리 유력!`;
    document.getElementById("h2hPill").textContent = pred.head_to_head_summary;

    // 세이버메트릭스 테이블
    document.getElementById("thAwayName").textContent = pred.away_team_name;
    document.getElementById("thHomeName").textContent = pred.home_team_name;
    document.getElementById("tdAwayVelo").textContent = `${pred.metrics_comparison.away_avg_exit_velo} mph`;
    document.getElementById("tdHomeVelo").textContent = `${pred.metrics_comparison.home_avg_exit_velo} mph`;
    document.getElementById("tdAwayBarrel").textContent = `${pred.metrics_comparison.away_barrel_pct}%`;
    document.getElementById("tdHomeBarrel").textContent = `${pred.metrics_comparison.home_barrel_pct}%`;
    document.getElementById("tdAwayWar").textContent = pred.metrics_comparison.away_avg_bwar.toFixed(2);
    document.getElementById("tdHomeWar").textContent = pred.metrics_comparison.home_avg_bwar.toFixed(2);

    // 4. 팬 투표 현황 반영 (DB 기반)
    document.getElementById("voteCountText").textContent = `총 ${voteStatus.total_votes}표 참여`;
    const awayBar = document.getElementById("userVoteAwayBar");
    const homeBar = document.getElementById("userVoteHomeBar");

    awayBar.style.width = `${voteStatus.away_vote_pct}%`;
    awayBar.textContent = `${voteStatus.away_vote_pct}%`;
    homeBar.style.width = `${voteStatus.home_vote_pct}%`;
    homeBar.textContent = `${voteStatus.home_vote_pct}%`;

    // 5. 나의 투표 상태 및 버튼 비활성화 제어 (중복 방지)
    const btnAway = document.getElementById("btnVoteAway");
    const btnHome = document.getElementById("btnVoteHome");
    const myVoteBox = document.getElementById("myVoteStatusBox");

    if (voteStatus.my_vote) {
        btnAway.disabled = true;
        btnHome.disabled = true;
        btnAway.style.opacity = "0.5";
        btnHome.style.opacity = "0.5";
        btnAway.style.cursor = "not-allowed";
        btnHome.style.cursor = "not-allowed";

        const selectedTeamName = voteStatus.my_vote.selected_team_id === currentGameData.home_team_id 
            ? pred.home_team_name 
            : pred.away_team_name;
        
        let resultMsg = "";
        if (voteStatus.my_vote.is_correct === true) {
            resultMsg = ` <span style="color:#2e7d32;">(적중! +${voteStatus.my_vote.reward_point}P 지급 완료)</span>`;
        } else if (voteStatus.my_vote.is_correct === false) {
            resultMsg = ` <span style="color:#d32f2f;">(미적중)</span>`;
        }

        myVoteBox.innerHTML = `✔ 회원님은 <strong>${selectedTeamName}</strong>에 투표하셨습니다.${resultMsg}`;
    } else {
        btnAway.disabled = false;
        btnHome.disabled = false;
        btnAway.style.opacity = "1";
        btnHome.style.opacity = "1";
        btnAway.style.cursor = "pointer";
        btnHome.style.cursor = "pointer";
        myVoteBox.innerHTML = "아직 투표하지 않으셨습니다. 팀을 선택해 투표에 참여해 보세요!";
    }
}

// 3. 투표 실행 함수 (비로그인 체크 및 중복 방지)
async function handleVote(side) {
    const userId = getLoggedInUserId();

    // 1) 비로그인 방어
    if (!userId) {
        const goToLogin = confirm("로그인이 필요한 서비스입니다.\n로그인 페이지로 이동하시겠습니까?");
        if (goToLogin) {
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

        alert("100 포인트가 베팅되었으며 투표가 성공적으로 완료되었습니다!");
        // 새로고침 없이 최신 투표 현황 재조회
        loadSelectedGame(currentGameData.game_id);
    } catch (e) {
        console.error("투표 요청 오류:", e);
        alert("서버 연결에 실패했습니다.");
    }
}

async function loadComponent(id, path) {
    try {
        const res = await fetch(path);
        if (res.ok) document.getElementById(id).innerHTML = await res.text();
    } catch(e) {}
}