// 1. 선호 구단 ID 추출 함수
function getUserFavoriteTeamId() {
    try {
        const userStr = sessionStorage.getItem("user") || localStorage.getItem("user");
        if (userStr) {
            const u = JSON.parse(userStr);
            return u.favorite_team_id || u.team_id || null;
        }
    } catch (e) {}
    return null;
}

// 2. 기존의 팀 카드 생성 부분 (기존 그리드 컨테이너 구조 그대로 유지)
const myTeamId = getUserFavoriteTeamId();

// teams 반복문 내부에서:
teams.forEach(t => {
    const isMyTeam = (myTeamId && Number(t.team_id) === Number(myTeamId));

    // 기존 card 생성 코드에 클래스 조건부 추가
    const card = document.createElement("div");
    card.className = `team-card ${isMyTeam ? "my-favorite-team" : ""}`;

    // card.innerHTML 맨 위에 뱃지 추가 (기존 내부 요소 구조는 그대로 유지)
    card.innerHTML = `
        ${isMyTeam ? '<span class="fav-team-badge">★ MY 구단</span>' : ''}
        <div class="team-logo-wrap">
            <img src="${t.logo_url}" alt="${t.team_name}" class="team-logo">
        </div>
        <div class="team-info">
            <h3>${t.team_name}</h3>
            <p>${t.city || ""} · ${t.stadium || ""}</p>
        </div>
    `;

    // 기존의 클릭 이벤트 및 기존 지구별 컨테이너 appendChild 유지
    // targetDivisionContainer.appendChild(card);
});