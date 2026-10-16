/* ==================================================
   메인 페이지 경기 예측 (투표) 연동
================================================== */

document.addEventListener("DOMContentLoaded", function () {
    loadMainPrediction();
});

async function loadMainPrediction() {
    const box = document.querySelector(".content-box .prediction-box");
    const resultArea = document.querySelector(".content-box .prediction-result");
    if (!box || !resultArea) return;

    try {
        // 백엔드 라우터의 /api/predictions/main 엔드포인트 호출
        const res = await fetch("/api/predictions/main", { cache: "no-store" });
        if (!res.ok) {
            throw new Error("예측 경기 정보를 불러오지 못했습니다.");
        }

        const data = await res.json();
        const game = data.game; // 라우터가 {"game": {...}} 형태 또는 null을 반환함

        if (!game) {
            box.innerHTML = `<div class="prediction-no-game" style="text-align:center; width:100%; color:#777;">오늘 진행되는 예측 경기가 없습니다.</div>`;
            resultArea.innerHTML = "진행 중인 예측 투표가 없습니다.";
            return;
        }

        const home = game.home_team;
        const away = game.away_team;

        // UI 렌더링 (홈팀/원정팀 로고 및 이름 반영)
        box.innerHTML = `
            <div class="prediction-team" data-team-id="${home.team_id}" style="cursor:pointer;" onclick="submitPrediction('${game.game_id}', '${home.team_id}')">
                <div class="team-logo">
                    ${home.logo_url ? `<img src="${home.logo_url}" alt="${home.team_name}" style="max-width:100%; max-height:100%; object-fit:contain;">` : home.team_name.charAt(0)}
                </div>
                <span>${home.team_name}</span>
            </div>
            <div class="prediction-vs">
                VS
            </div>
            <div class="prediction-team" data-team-id="${away.team_id}" style="cursor:pointer;" onclick="submitPrediction('${game.game_id}', '${away.team_id}')">
                <div class="team-logo">
                    ${away.logo_url ? `<img src="${away.logo_url}" alt="${away.team_name}" style="max-width:100%; max-height:100%; object-fit:contain;">` : away.team_name.charAt(0)}
                </div>
                <span>${away.team_name}</span>
            </div>
        `;

        resultArea.innerHTML = `현재까지 총 ${game.vote_count}명이 투표에 참여했습니다. 원하는 팀을 클릭해 투표하세요!`;

    } catch (err) {
        console.error("메인 경기 예측 로드 실패:", err);
        resultArea.innerHTML = "경기 예측 정보를 불러오지 못했습니다.";
    }
}

// 예측 투표 제출 함수
async function submitPrediction(gameId, selectedTeamId) {
    const accessToken = sessionStorage.getItem("access_token");

    // 세션에 유저 정보가 있는지 확인 (백엔드 VoteRequest가 user_id를 요구함)
    let user = null;
    try {
        user = JSON.parse(sessionStorage.getItem("user") || localStorage.getItem("user") || "null");
    } catch (e) {}

    const userId = user ? (user.user_id || user.id) : null;

    if (!accessToken || !userId) {
        alert("로그인 후 경기 예측에 참여할 수 있습니다.");
        location.href = "login.html";
        return;
    }

    try {
        const response = await fetch(`/api/predictions/votes`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                game_id: Number(gameId),
                user_id: Number(userId),
                selected_team_id: Number(selectedTeamId),
                bet_point: 100 // 기본 베팅 포인트
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || "예측 투표에 실패했습니다.");
        }

        const result = await response.json();
        alert(result.message || "경기 예측이 성공적으로 등록되었습니다!");

        const resultArea = document.querySelector(".content-box .prediction-result");
        if (resultArea) {
            resultArea.innerHTML = `투표 완료! (성공적으로 등록되었습니다)`;
        }

        // 투표 후 데이터 새로고침
        loadMainPrediction();

    } catch (err) {
        console.error("예측 투표 오류:", err);
        alert(err.message || "오류가 발생했습니다. 다시 시도해주세요.");
    }
}