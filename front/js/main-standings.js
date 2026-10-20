// ==================================================
// 메인 - 팀 순위 (동부 | 중부 | 서부 3칸)
// 팀 순위 페이지와 같은 API(/api/standings)를 사용 → 가장 최근 시즌
// 다른 메인 스크립트와 이름이 겹치지 않게 함수 안에 넣음
// ==================================================
(() => {
    const DIVISION_LABELS = { East: "동부지구", Central: "중부", West: "서부" };
    const grid = document.getElementById("main-standings-grid");
    const leagueButtons = document.querySelectorAll(".main-standings-league");
    let standings = null;                              // API에서 받은 순위 데이터
    let selectedLeague = "AL";                         // 선택한 리그

    if (!grid) return;

    function el(tag, className, text) {                // 요소를 만드는 짧은 함수
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showMessage(text) {
        grid.replaceChildren(el("p", "main-standings-message", text));
    }

    async function loadStandings() {
        try {
            const response = await fetch("/api/standings", { cache: "no-store" });
            if (!response.ok) throw new Error(`팀 순위 API 오류 (${response.status})`);
            standings = await response.json();
            render();
        } catch (error) {
            console.error("메인 팀 순위 조회 오류:", error);
            showMessage("팀 순위를 불러오지 못했습니다.");
        }
    }

    function render() {                                // 선택한 리그의 지구 3개를 나란히 그리기
        const divisions = standings.divisions.filter(d => d.league === selectedLeague);
        if (!standings.season || divisions.every(d => d.teams.every(t => t.games === 0))) {
            showMessage("순위를 계산할 경기 결과가 없습니다.");
            return;
        }
        grid.replaceChildren(...divisions.map(createDivision));
    }

    function createDivision(division) {
        const box = el("div", "main-standings-division");
        box.append(el("h3", "main-standings-division-title", DIVISION_LABELS[division.division]));

        const header = el("div", "ranking-header main-standings-row");
        ["순위", "팀", "경기", "승", "패", "승률"].forEach(name => header.append(el("span", "", name)));
        box.append(header);

        division.teams.forEach(team => box.append(createTeamRow(team)));
        return box;
    }

    function createTeamRow(team) {
        // 지구 1위(플레이오프 진출권)는 왼쪽 파란 선
        const row = el("div", `ranking-row main-standings-row${team.rank === 1 ? " is-leader" : ""}`);

        const link = el("a", "main-standings-team");   // 팀 클릭 → 팀 정보(로스터)
        link.href = `/team-detail.html?id=${encodeURIComponent(team.team_id)}`;
        link.title = team.team_name;
        if (team.logo_url) {                           // 로고 (불러오지 못하면 숨김)
            const logo = el("img", "main-standings-logo");
            logo.src = team.logo_url;
            logo.alt = "";
            logo.loading = "lazy";
            logo.onerror = () => logo.remove();
            link.append(logo);
        }
        link.append(el("span", "main-standings-team-name", team.team_name));

        row.append(
            el("span", "main-standings-rank", team.rank),
            link,
            el("span", "", team.games),
            el("span", "", team.wins),
            el("span", "", team.losses),
            el("span", "", formatPct(team.pct))
        );
        return row;
    }

    function formatPct(pct) {                          // 0.589 → ".589", 1 → "1.000"
        const text = Number(pct).toFixed(3);
        return text.startsWith("0") ? text.slice(1) : text;
    }

    leagueButtons.forEach(button => {                  // 리그 변경 버튼
        button.addEventListener("click", () => {
            selectedLeague = button.dataset.league;
            leagueButtons.forEach(b => {
                const isSelected = b === button;
                b.classList.toggle("selected", isSelected);
                b.setAttribute("aria-selected", String(isSelected));
            });
            if (standings) render();
        });
    });

    loadStandings();
})();
