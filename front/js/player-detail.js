document.addEventListener("DOMContentLoaded", () => {
    // 1. 공통 Header 및 Footer 로드 (팀원들 구현 방식 연동)
    loadComponent("header", "/components/header.html");
    loadComponent("footer", "/components/footer.html");

    // 2. URL에서 player_id 쿼리 파라미터 추출
    const urlParams = new URLSearchParams(window.location.search);
    // 전달된 ID가 없으면 기본값으로 바비 위트 주니어(677951) 또는 오타니(660271) 로드
    const playerId = urlParams.get("id") || "677951";

    // 3. 백엔드 API 호출 및 렌더링
    fetchPlayerDetail(playerId);
});

// 공통 컴포넌트 로더
async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (response.ok) {
            const html = await response.text();
            document.getElementById(elementId).innerHTML = html;
        }
    } catch (error) {
        console.warn(`컴포넌트 로드 실패 (${filePath}):`, error);
    }
}

// 선수 상세 API 호출 함수
async function fetchPlayerDetail(playerId) {
    const API_BASE_URL = "http://127.0.0.1:8000"; // FastAPI 백엔드 주소

    try {
        const response = await fetch(`${API_BASE_URL}/api/players/${playerId}`);
        if (!response.ok) {
            throw new Error(`선수 정보를 불러오지 못했습니다 (Status: ${response.status})`);
        }

        const data = await response.json();
        renderPlayerDetail(data);
    } catch (error) {
        console.error("데이터 로딩 오류:", error);
        document.getElementById("playerName").textContent = "선수 정보를 불러올 수 없습니다.";
        document.getElementById("playerStatsBody").innerHTML = `
            <tr>
                <td colspan="10" class="no-data">해당 선수의 데이터가 존재하지 않거나 서버 연결에 실패했습니다.</td>
            </tr>
        `;
    }
}

// 화면 렌더링
function renderPlayerDetail(data) {
    // 프로필 정보 매핑 + 브레드크럼 및 선수 프로필 텍스트
    document.getElementById("bcPlayerName").textContent = data.player_name;
    document.getElementById("playerName").textContent = data.player_name;
    document.getElementById("playerIdText").textContent = data.player_id;
    document.getElementById("playerTeamName").textContent = data.team_name || "소속 팀 없음 (FA)";
    document.getElementById("playerTeamBadge").textContent = data.team_code || "MLB";

    if (data.headshot_url) {
        document.getElementById("playerHeadshot").src = data.headshot_url;
    }

    // 2. 팀 링크 및 뱃지 처리
    const teamName = data.team_name || "소속 구단 없음 (FA)";
    document.getElementById("bcTeamName").textContent = teamName;
    document.getElementById("playerTeamName").textContent = teamName;
    document.getElementById("playerTeamBadge").textContent = data.team_code || "MLB";

    if (data.team_id) {
        // 같은 pages 폴더이므로 team-detail.html로 바로 연결
        document.getElementById("bcTeamLink").href = `team-detail.html?id=${data.team_id}`;
        
        const teamBadge = document.getElementById("playerTeamBadge");
        teamBadge.style.cursor = "pointer";
        teamBadge.onclick = () => location.href = `team-detail.html?id=${data.team_id}`;

        const teamNameEl = document.getElementById("playerTeamName");
        teamNameEl.style.cursor = "pointer";
        teamNameEl.style.textDecoration = "underline";
        teamNameEl.onclick = () => location.href = `team-detail.html?id=${data.team_id}`;
    }

    const stats = data.stats || [];

    if (stats.length > 0) {
        // 최신 시즌 기록 (첫 번째 항목)
        const latest = stats[0];

        // 하이라이트 지표 표시 (홈런 및 타율)
        document.getElementById("playerHighlightStat").textContent = 
            `${latest.season} 시즌 ${latest.home_runs}HR, 타율 ${latest.batting_avg?.toFixed(3) || '.000'}`;

        // 4개 요약 통계 카드 채우기
        document.getElementById("cardBwar").textContent = 
            latest.bwar !== null ? latest.bwar.toFixed(1) : "-";
        
        document.getElementById("cardExitVelo").innerHTML = 
            latest.avg_exit_velocity !== null 
                ? `${latest.avg_exit_velocity.toFixed(1)} <span class="unit">mph</span>` 
                : "-";

        document.getElementById("cardBarrel").innerHTML = 
            latest.barrel_percentage !== null 
                ? `${latest.barrel_percentage.toFixed(1)} <span class="unit">%</span>` 
                : "-";

        document.getElementById("cardHardHit").innerHTML = 
            latest.hard_hit_percentage !== null 
                ? `${latest.hard_hit_percentage.toFixed(1)} <span class="unit">%</span>` 
                : "-";

        // 테이블 렌더링
        const tbody = document.getElementById("playerStatsBody");
        tbody.innerHTML = "";

        stats.forEach(st => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${st.season}</strong></td>
                <td>${st.games}</td>
                <td>${st.batting_avg !== null ? st.batting_avg.toFixed(3) : "-"}</td>
                <td>${st.hits}</td>
                <td><strong>${st.home_runs}</strong></td>
                <td>${st.rbi}</td>
                <td>${st.bwar !== null ? st.bwar.toFixed(1) : "-"}</td>
                <td>${st.avg_exit_velocity !== null ? st.avg_exit_velocity.toFixed(1) + " mph" : "-"}</td>
                <td>${st.barrel_percentage !== null ? st.barrel_percentage.toFixed(1) + "%" : "-"}</td>
                <td>${st.hard_hit_percentage !== null ? st.hard_hit_percentage.toFixed(1) + "%" : "-"}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        document.getElementById("playerStatsBody").innerHTML = `
            <tr>
                <td colspan="10" class="no-data">등록된 시즌 세이버메트릭스 기록이 없습니다.</td>
            </tr>
        `;
    }
}