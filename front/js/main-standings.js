/* ==================================================
   BASEBOT 메인 페이지 구단 순위
   파일 위치: front/js/main-standings.js

   - /api/standings API 연동
   - AL/NL 전체 구단 데이터 통합
   - 승률 기준 상위 4개 구단 표시
   - 팀 로고 이미지 표시
   - 로고 이미지 로드 실패 시 기본 아이콘 표시
   - 기존 메인 페이지 HTML/CSS 구조 유지
================================================== */

document.addEventListener("DOMContentLoaded", loadMainStandings);

/**&#xA; * 메인 페이지 구단 순위 조회&#xA; */
async function loadMainStandings() {
    const standingsList = document.getElementById("main-standings-list");

    if (!standingsList) {
        return;
    }

    try {
        const response = await fetch("/api/standings", {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                `구단 순위 조회 실패: HTTP ${response.status}`
            );
        }

        const result = await response.json();

        if (
            !Array.isArray(result.divisions) ||
            !Array.isArray(result.wildcards)
        ) {
            throw new Error(
                "구단 순위 API 응답 형식이 올바르지 않습니다."
            );
        }

        // 지구별 순위 데이터를 하나의 배열로 통합
        const allTeams = result.divisions.flatMap(division =>
            Array.isArray(division.teams)
                ? division.teams
                : []
        );

        // 표시할 구단이 없는 경우
        if (allTeams.length === 0) {
            standingsList.innerHTML = `
                <div class="ranking-row">
                    <span>-</span>
                    <span>표시할 구단 순위가 없습니다.</span>
                    <span>-</span>
                    <span>-</span>
                    <span>-</span>
                    <span>-</span>
                </div>
            `;
            return;
        }

        // 승률 내림차순 → 승리 수 내림차순 → 팀 이름순
        allTeams.sort((a, b) => {
            const pctA = Number(a.pct) || 0;
            const pctB = Number(b.pct) || 0;

            if (pctB !== pctA) {
                return pctB - pctA;
            }

            const winsA = Number(a.wins) || 0;
            const winsB = Number(b.wins) || 0;

            if (winsB !== winsA) {
                return winsB - winsA;
            }

            return String(a.team_name || "").localeCompare(
                String(b.team_name || "")
            );
        });

        // 메인 페이지에는 상위 4개 구단 표시
        const topTeams = allTeams.slice(0, 4);

        standingsList.innerHTML = topTeams.map((team, index) => {
            const teamName = escapeStandingsHtml(
                team.team_name || "-"
            );

            const logoUrl = getValidLogoUrl(team.logo_url);

            const games = Number(team.games) || 0;
            const wins = Number(team.wins) || 0;
            const losses = Number(team.losses) || 0;
            const pct = Number(team.pct) || 0;

            // 로고 주소가 있는 경우 이미지 표시
            // 주소가 없거나 이미지 로드에 실패하면 기본 아이콘 표시
            const logoHtml = logoUrl
                ? `
                    <img
                        src="${escapeStandingsHtml(logoUrl)}"
                        alt="${teamName} 로고"
                        class="ranking-team-logo"
                        loading="lazy"
                        onerror="
                            this.onerror = null;
                            this.style.display = 'none';
                            this.nextElementSibling.style.display = 'inline-flex';
                        "
                    >
                    <span
                        class="ranking-team-logo-fallback"
                        style="display: none;"
                        aria-label="${teamName} 로고 없음"
                    >⚾</span>
                `
                : `
                    <span
                        class="ranking-team-logo-fallback"
                        aria-label="${teamName} 로고 없음"
                    >⚾</span>
                `;

            return `
                <div class="ranking-row">
                    <span>${index + 1}</span>

                    <span class="ranking-team">
                        ${logoHtml}
                        <span class="ranking-team-name">${teamName}</span>
                    </span>

                    <span>${games}</span>
                    <span>${wins}</span>
                    <span>${losses}</span>
                    <span>${pct.toFixed(3)}</span>
                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("메인 구단 순위 로드 오류:", error);

        standingsList.innerHTML = `
            <div class="ranking-row">
                <span>-</span>
                <span>구단 순위를 불러오지 못했습니다.</span>
                <span>-</span>
                <span>-</span>
                <span>-</span>
                <span>-</span>
            </div>
        `;
    }
}

/**&#xA; * 팀 로고 URL 검증&#xA; * HTTP 또는 HTTPS 주소만 허용&#xA; */
function getValidLogoUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return "";
    }

    try {
        const url = new URL(value.trim(), window.location.origin);

        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "";
        }

        return url.href;
    } catch (error) {
        return "";
    }
}

/**&#xA; * HTML 이스케이프&#xA; * DB에서 가져온 팀 이름과 이미지 URL을 HTML에 삽입할 때 사용&#xA; */
function escapeStandingsHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&")
        .replaceAll("<", "<")
        .replaceAll(">", ">")
        .replaceAll('"', """)
        .replaceAll("'", "'");
}