/* ==================================================
   메인 페이지 "오늘의 경기" 데이터 연동 (로고 및 풀네임 반영)
================================================== */

document.addEventListener("DOMContentLoaded", function () {
    loadMainTodayGames();
});

async function loadMainTodayGames() {
    const container = document.querySelector(".game-list");
    // 경기 일정 페이지(game.html)의 카드 목록과 구분
    if (!container || container.id === "game-list") return;

    try {
        const today = new Date().toISOString().split('T')[0];

        // 방금 games.py에 추가한 메인 전용 엔드포인트 호출
        let res = await fetch(`/api/games/main?date=${today}&limit=3`, { cache: "no-store" });
        if (!res.ok) throw new Error("오늘의 경기 데이터를 불러오지 못했습니다.");

        let games = await res.json();

        // 오늘 날짜 경기가 없다면 다가오는 전체 경기 3개 조회
        if (!Array.isArray(games) || games.length === 0) {
            res = await fetch(`/api/games/main?limit=3`, { cache: "no-store" });
            if (res.ok) {
                games = await res.json();
            }
        }

        if (!Array.isArray(games) || games.length === 0) {
            container.innerHTML = `<div style="text-align:center; width:100%; color:#777; padding:20px 0;">예정된 경기가 없습니다.</div>`;
            return;
        }

        container.innerHTML = "";

        games.forEach(game => {
            const card = document.createElement("div");
            card.className = "game-card";

            const timeStr = game.game_time ? String(game.game_time).slice(0, 5) : "시각 미정";

            let statusText = "경기 예정";
            if (game.status === "FINAL") statusText = `종료 (${game.away_score} : ${game.home_score})`;
            else if (game.status === "IN_PROGRESS") statusText = `진행 중 (${game.away_score} : ${game.home_score})`;
            else if (game.status === "CANCELLED") statusText = "경기 취소";

            // 팀 로고 이미지 HTML 생성 (없으면 빈 문자열)
            const awayLogoHtml = game.away_logo_url
                ? `<img src="${game.away_logo_url}" alt="${game.away_team_name}" style="width:22px; height:22px; vertical-align:middle; margin-right:6px; object-fit:contain;">`
                : "";
            const homeLogoHtml = game.home_logo_url
                ? `<img src="${game.home_logo_url}" alt="${game.home_team_name}" style="width:22px; height:22px; vertical-align:middle; margin-right:6px; object-fit:contain;">`
                : "";

            // 요약된 코드 대신 풀네임(`team_name`) 사용 (필요시 team_code로 변경 가능)
            const awayName = game.away_team_name || game.away_team_code || "원정팀";
            const homeName = game.home_team_name || game.home_team_code || "홈팀";

            card.innerHTML = `
                <div class="game-info">
                    ${timeStr}
                </div>
                <div class="game-team" style="display:flex; align-items:center; justify-content:center; gap:10px;">
                    <span style="display:inline-flex; align-items:center;">${awayLogoHtml}${awayName}</span>
                    <strong>VS</strong>
                    <span style="display:inline-flex; align-items:center;">${homeLogoHtml}${homeName}</span>
                </div>
                <div class="game-status">
                    ${statusText}
                </div>
            `;

            container.appendChild(card);
        });

    } catch (err) {
        console.error("메인 경기 로드 오류:", err);
        if (container) {
            container.innerHTML = `<div style="text-align:center; width:100%; color:#777; padding:20px 0;">경기 정보를 불러오는 데 실패했습니다.</div>`;
        }
    }
}