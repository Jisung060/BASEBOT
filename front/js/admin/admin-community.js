
/* ========================================
   BASEBOT 관리자 - 커뮤니티 관리
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";


const communityPageState = {
    contents: { pageSize: 10, page: 1, sortKey: "created_at",  sortDir: "desc" },
    reports:  { pageSize: 10, page: 1, sortKey: "report_count", sortDir: "desc" },
    history:  { pageSize: 10, page: 1, sortKey: "reviewed_at", sortDir: "desc" }
};

// 정렬할 수 있는 열 (index: 표 제목 칸의 순서, 0부터 시작)
const communitySortColumns = {
    contents: [
        { index: 0, key: "type" },                       // 유형
        { index: 2, key: "nickname" },                   // 작성자
        { index: 3, key: "created_at", type: "date" },   // 작성일
        { index: 4, key: "report_count", type: "number" }, // 신고 수
        { index: 5, key: "status", type: "status" }      // 상태
    ],
    reports: [
        { index: 0, key: "post_id", type: "number" },             // 글 번호
        { index: 2, key: "report_count", type: "number" },        // 신고 건수
        { index: 4, key: "latest_reported_at", type: "date" },    // 최근 접수
        { index: 5, key: "status", type: "status" }               // 상태
    ],
    history: [
        { index: 0, key: "post_id", type: "number" },             // 글 번호
        { index: 2, key: "report_count", type: "number" },        // 신고 건수
        { index: 4, key: "reviewed_at", type: "date", fallback: "latest_reported_at" }, // 처리일
        { index: 5, key: "status", type: "status" }               // 처리 상태
    ]
};

// 상태 정렬 순서 (작을수록 위)
const communityStatusOrder = {
    PENDING: 0, REVIEWED: 1, ACCEPTED: 2, REJECTED: 3,   // 신고 상태
    ACTIVE: 0, HIDDEN: 1, DELETED: 2                      // 게시글 상태
};

// 정렬 값이 같을 때 이어서 비교할 기준 (최근 순)
const communityTieBreaker = {
    reports: "latest_reported_at",
    history: "reviewed_at"
};

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    setupCommunitySearch();
    setupCommunityMenu();
    setupRefreshButton();
    setupSortableHeaders();
    updateSearchFilters("contents");
    loadAdminCommunityData();
});

// ========================================
// 커뮤니티 메뉴 전환
// ========================================

function setupCommunityMenu() {
    const menuItems = document.querySelectorAll(
        ".community-menu-item"
    );

    menuItems.forEach((menuItem) => {
        menuItem.addEventListener("click", () => {
            const selectedTab = menuItem.dataset.tab;

            const contentsPanel =
                document.getElementById("contentsPanel");

            const reportsPanel =
                document.getElementById("reportsPanel");

            const historyPanel =
                document.getElementById("historyPanel");

            // 선택한 메뉴만 활성화
            menuItems.forEach((item) => {
                item.classList.toggle(
                    "active",
                    item === menuItem
                );
            });

            // 모든 박스를 먼저 숨김
            if (contentsPanel) contentsPanel.hidden = true;
            if (reportsPanel) reportsPanel.hidden = true;
            if (historyPanel) historyPanel.hidden = true;

            // 선택한 메뉴의 박스만 표시
            if (selectedTab === "contents" && contentsPanel) {
                contentsPanel.hidden = false;
            }

            if (selectedTab === "reports" && reportsPanel) {
                reportsPanel.hidden = false;
            }

            if (selectedTab === "history" && historyPanel) {
                historyPanel.hidden = false;
            }

            // 선택한 탭에 맞는 필터로 교체
            updateSearchFilters(selectedTab);

            // 메뉴를 바꿀 때 해당 메뉴의 목록 자동 조회
            loadAdminCommunityData();
        });
    });
}

// ========================================
// 표 제목 클릭 정렬
// ========================================

// 선택한 정렬 기준으로 목록을 정렬해서 반환 (원본은 바꾸지 않음)
function sortCommunityItems(items, tab) {
    const state = communityPageState[tab];

    const column = communitySortColumns[tab].find(
        (col) => col.key === state.sortKey
    );

    if (!column) {
        return items;
    }

    const direction = state.sortDir === "asc" ? 1 : -1;

    // 정렬에 쓸 값 꺼내기
    const getValue = (item) => {
        const value =
            item[column.key] ??
            (column.fallback ? item[column.fallback] : null);

        if (column.type === "date") {
            const time = new Date(value).getTime();
            return Number.isNaN(time) ? 0 : time;
        }

        if (column.type === "number") {
            return Number(value) || 0;
        }

        if (column.type === "status") {
            return communityStatusOrder[value] ?? 99;
        }

        // 신고 사유는 화면에 보이는 한글 이름 기준으로 정렬
        if (column.key === "reason") {
            return getReportReasonLabel(value);
        }

        return String(value ?? "");
    };

        return [...items].sort((a, b) => {
        const x = getValue(a);
        const y = getValue(b);

        const result =
            typeof x === "string"
                ? x.localeCompare(y, "ko")
                : x - y;

        if (result !== 0) {
            return result * direction;
        }

        // 값이 같으면 최근 것이 위로
        const tieKey = communityTieBreaker[tab];

        if (!tieKey) return 0;

        return (
            (new Date(b[tieKey]).getTime() || 0) -
            (new Date(a[tieKey]).getTime() || 0)
        );
    });
}


// 표 제목 칸을 클릭할 수 있게 만들기 (처음 한 번만 실행)
function setupSortableHeaders() {
    const panelIds = {
        contents: "contentsPanel",
        reports: "reportsPanel",
        history: "historyPanel"
    };

    for (const [tab, panelId] of Object.entries(panelIds)) {
        const panel = document.getElementById(panelId);

        if (!panel) continue;

        const headers = panel.querySelectorAll("thead th");

        for (const column of communitySortColumns[tab]) {
            const th = headers[column.index];

            if (!th) continue;

            th.classList.add("sortable");
            th.dataset.sortKey = column.key;
            th.tabIndex = 0;
            th.setAttribute("role", "button");

            // 정렬 방향 화살표
            const arrow = document.createElement("span");
            arrow.className = "sort-arrow";
            th.appendChild(arrow);

            const sortByThis = () => {
                changeCommunitySort(tab, column.key);
            };

            th.addEventListener("click", sortByThis);

            // 키보드(Enter / Space)로도 사용 가능
            th.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    sortByThis();
                }
            });
        }
    }

    updateSortIndicators();
}


// 정렬 기준 변경
function changeCommunitySort(tab, key) {
    const state = communityPageState[tab];

    if (state.sortKey === key) {
        // 같은 열을 다시 누르면 방향만 반대로
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";

    } else {
        state.sortKey = key;

        const column = communitySortColumns[tab].find(
            (col) => col.key === key
        );

        // 날짜/숫자는 큰 값부터, 글자는 가나다순부터
        state.sortDir =
            column && (column.type === "date" || column.type === "number")
                ? "desc"
                : "asc";
    }

    state.page = 1;

    updateSortIndicators();
    loadAdminCommunityData();
}


// 현재 정렬 기준 열에 ▲ / ▼ 표시
function updateSortIndicators() {
    const panelIds = {
        contents: "contentsPanel",
        reports: "reportsPanel",
        history: "historyPanel"
    };

    for (const [tab, panelId] of Object.entries(panelIds)) {
        const panel = document.getElementById(panelId);

        if (!panel) continue;

        const state = communityPageState[tab];

        panel.querySelectorAll("th.sortable").forEach((th) => {
            const isActive = th.dataset.sortKey === state.sortKey;
            const arrow = th.querySelector(".sort-arrow");

            th.classList.toggle("sorted", isActive);

            if (arrow) {
                arrow.textContent = isActive
                    ? (state.sortDir === "asc" ? "▲" : "▼")
                    : "↕";
            }

            th.setAttribute(
                "aria-sort",
                isActive
                    ? (state.sortDir === "asc" ? "ascending" : "descending")
                    : "none"
            );
        });
    }
}


function setupCommunityPagination(
    items,
    tab,
    panel,
    onPageChange
) {
    const state = communityPageState[tab];

    if (!state || !panel) {
        return items;
    }

    const totalPages = Math.max(
        1,
        Math.ceil(items.length / state.pageSize)
    );

    if (state.page > totalPages) {
        state.page = totalPages;
    }

    // ========================================
    // 1. 우측 상단: 표시 개수 설정
    // ========================================
    const heading = panel.querySelector(".panel-heading");

    if (heading) {
        let controls = heading.querySelector(
            ".community-heading-controls"
        );

        if (!controls) {
            controls = document.createElement("div");
            controls.className = "community-heading-controls";

            const countElement = heading.querySelector(
                "#contentTotalCount, #pendingReportCount, #historyTotalCount"
            );

            if (countElement) {
                heading.insertBefore(controls, countElement);
                controls.appendChild(countElement);
            } else {
                heading.appendChild(controls);
            }

            // 신고 처리에서는 처리 대기 건수를 먼저 배치
            const pendingCount = heading.querySelector("#pendingReportCount");

            if (pendingCount) {
                controls.insertBefore(pendingCount, controls.firstChild);
            }
        }

        // 표시 개수 선택 영역 생성
        let sizeLabel = controls.querySelector(
            ".community-page-size"
        );

        if (!sizeLabel) {
            sizeLabel = document.createElement("label");
            sizeLabel.className = "community-page-size";

            const sizeSelect = document.createElement("select");
            sizeSelect.setAttribute(
                "aria-label",
                "목록 표시 개수"
            );

            [10, 30, 50, 100].forEach((size) => {
                const option = document.createElement("option");
                option.value = size;
                option.textContent = `${size}개`;
                sizeSelect.appendChild(option);
            });

            sizeSelect.addEventListener("change", () => {
                state.pageSize = Number(sizeSelect.value);
                state.page = 1;
                onPageChange();
            });

            sizeLabel.appendChild(sizeSelect);
            controls.appendChild(sizeLabel);
        }

        // 현재 설정된 표시 개수 유지
        const sizeSelect = sizeLabel.querySelector("select");
        sizeSelect.value = String(state.pageSize);

        // 신고 처리 상단 요소 순서를 항상 동일하게 유지
        const pendingCount = heading.querySelector(
            "#pendingReportCount"
        );

        const totalCountLabel = heading.querySelector(
            "#reportTotalCount"
        );

        // 요소가 다른 위치에 있다면 상단 컨트롤 영역으로 이동
        if (pendingCount) {
            controls.appendChild(pendingCount);
        }

        if (totalCountLabel) {
            controls.appendChild(totalCountLabel);
        }

        // 처리 대기 → 전체 건수 → 표시 개수 선택 상자 순서
        if (pendingCount && totalCountLabel) {
            controls.append(
                pendingCount,
                totalCountLabel,
                sizeLabel
            );
        }
    }

    // ========================================
    // 2. 하단: 이전 / 페이지 번호 / 다음
    // ========================================
    let pagination = panel.querySelector(
        ".community-pagination"
    );

    if (!pagination) {
        pagination = document.createElement("div");
        pagination.className = "community-pagination";

        const tableWrap = panel.querySelector(".table-wrap");

        if (tableWrap) {
            tableWrap.after(pagination);
        } else {
            panel.appendChild(pagination);
        }
    }

    pagination.replaceChildren();

    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.textContent = "이전";
    prevButton.disabled = state.page <= 1;

    prevButton.addEventListener("click", () => {
        if (state.page > 1) {
            state.page -= 1;
            onPageChange();
        }
    });

    const pageLabel = document.createElement("span");
    pageLabel.textContent = `${state.page} / ${totalPages} 페이지`;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "다음";
    nextButton.disabled = state.page >= totalPages;

    nextButton.addEventListener("click", () => {
        if (state.page < totalPages) {
            state.page += 1;
            onPageChange();
        }
    });

    pagination.append(
        prevButton,
        pageLabel,
        nextButton
    );

    // 현재 페이지에 해당하는 데이터만 반환
    const startIndex = (state.page - 1) * state.pageSize;

    return items.slice(
        startIndex,
        startIndex + state.pageSize
    );
}

// ========================================
// 탭별 검색 필터 설정
// ========================================

const communityFilterConfig = {
    contents: {
        showType: true,
        showStatus: false,
        placeholder: "제목 / 내용 / 작성자"
    },
    reports: {
        showType: false,
        showStatus: true,
        statusLabel: "신고 상태",
        statusOptions: [
            ["", "전체 (대기 + 검토)"],
            ["PENDING", "처리 대기"],
            ["REVIEWED", "검토 완료"]
        ],
        placeholder: "제목 / 신고자 / 신고 내용"
    },
    history: {
        showType: false,
        showStatus: true,
        statusLabel: "처리 결과",
        statusOptions: [
            ["", "전체 결과"],
            ["ACCEPTED", "조치 승인"],
            ["REJECTED", "반려"]
        ],
        placeholder: "제목 / 신고자 / 신고 내용"
    }
};

// 선택한 탭에 맞게 필터를 보이거나 숨기고 선택지를 바꿈
function updateSearchFilters(tab) {
    const config = communityFilterConfig[tab];
    const form = document.querySelector(".filter-form");

    if (!config || !form) return;

    const typeLabel = form.querySelector('[data-filter="type"]');
    const statusLabel = form.querySelector('[data-filter="status"]');
    const statusSelect = form.querySelector('[name="report_status"]');
    const keywordInput = form.querySelector('[name="keyword"]');

    if (typeLabel) {
        typeLabel.style.display = config.showType ? "" : "none";
    }

    if (statusLabel) {
        statusLabel.style.display = config.showStatus ? "" : "none";
    }

    // 신고 상태 / 처리 결과 선택지를 탭에 맞게 다시 만들기
    if (config.showStatus && statusSelect) {
        statusSelect.replaceChildren();

        for (const [value, text] of config.statusOptions) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            statusSelect.appendChild(option);
        }

        const labelText = statusLabel.querySelector(".filter-label-text");

        if (labelText) {
            labelText.textContent = config.statusLabel;
        }
    }

    if (keywordInput) {
        keywordInput.placeholder = config.placeholder;
    }
}

// ========================================
// 검색 이벤트
// ========================================

function setupCommunitySearch() {
    const searchForm = document.querySelector(".filter-form");

    if (!searchForm) {
        console.error("커뮤니티 검색 폼을 찾을 수 없습니다.");
        return;
    }

    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        loadAdminCommunityData();
    });
}

// ========================================
// API 요청 공통 함수
// ========================================


async function requestAdminAPI(endpoint, options = {}) {
    const token = sessionStorage.getItem("access_token");

    if (!token) {
        throw new Error(
            "로그인 정보가 없습니다. 관리자 계정으로 로그인해 주세요."
        );
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        method: options.method || "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error(
                "로그인이 만료되었거나 인증 정보가 올바르지 않습니다."
            );
        }

        if (response.status === 403) {
            throw new Error("관리자 계정만 접근할 수 있습니다.");
        }

        const errorData = await response.json().catch(() => ({}));

        throw new Error(
            errorData.detail || `API 요청 실패: HTTP ${response.status}`
        );
    }

    return await response.json();
}

// ========================================
// 데이터 불러오기 (모든 곳에서 이 함수를 호출)
// 현재 탭 목록을 다시 불러오고, 성공하면 갱신 시각을 표시
// ========================================

let communityLoadFailed = false;   // 마지막 조회가 실패했는지
let isRefreshing = false;          // 새로고침 중복 클릭 방지

async function loadAdminCommunityData() {
    communityLoadFailed = false;

    await Promise.all([
        loadCurrentTabData(),
        loadSummaryCards(),
    ]);

    // 오류가 없을 때만 "마지막 갱신" 시각 변경
    if (!communityLoadFailed) {
        updateLastRefreshedTime();
    }
}


// 마지막 갱신 시각 표시 (예: 마지막 갱신 15:42:10)
function updateLastRefreshedTime() {
    const timeLabel = document.getElementById("lastRefreshedTime");

    if (!timeLabel) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");

    timeLabel.textContent =
        `마지막 갱신 ${pad(now.getHours())}:` +
        `${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}


// 새로고침 버튼
function setupRefreshButton() {
    const button = document.getElementById("communityRefreshButton");

    if (!button) return;

    button.addEventListener("click", async () => {
        // 이미 불러오는 중이면 무시
        if (isRefreshing) return;

        isRefreshing = true;
        button.disabled = true;
        button.classList.add("loading");

        try {
            await loadAdminCommunityData();

        } finally {
            // 너무 빨리 끝나도 회전이 보이도록 0.4초 뒤에 해제
            setTimeout(() => {
                button.disabled = false;
                button.classList.remove("loading");
                isRefreshing = false;
            }, 400);
        }
    });
}

// ========================================
// 상단 요약 카드 (총계 + 전일 대비)
// ========================================
function renderSummaryCard(numberId, data, todayLabel) {
    const numberElement = document.getElementById(numberId);
    if (!numberElement || !data) return;

    numberElement.textContent =
        Number(data.total || 0).toLocaleString("ko-KR");

    // 증감 영역이 없으면 숫자 바로 아래에 만들기
    const changeId = `${numberId}Change`;
    let changeElement = document.getElementById(changeId);

    if (!changeElement) {
        changeElement = document.createElement("div");
        changeElement.id = changeId;
        changeElement.className = "summary-change";
        numberElement.insertAdjacentElement("afterend", changeElement);
    }

    const today = Number(data.today || 0);
    const yesterday = Number(data.yesterday || 0);
    const diff = today - yesterday;

    // 증감 뱃지 문구
    let badgeClass = "flat";
    let badgeText = "– 변동 없음";

    if (diff > 0) {
        badgeClass = "up";
        badgeText = yesterday > 0
            ? `▲ ${Math.round((diff / yesterday) * 100)}%`
            : "▲ 신규";
    } else if (diff < 0) {
        badgeClass = "down";
        badgeText = `▼ ${Math.round((Math.abs(diff) / yesterday) * 100)}%`;
    }

    const text = document.createElement("span");
    text.className = "change-text";
    text.textContent =
        `${todayLabel} +${today.toLocaleString("ko-KR")} · ` +
        `어제 +${yesterday.toLocaleString("ko-KR")}`;

    const badge = document.createElement("span");
    badge.className = `change-badge ${badgeClass}`;
    badge.textContent = badgeText;

    changeElement.replaceChildren(text, badge);
}


async function loadSummaryCards() {
    try {
        const summary = await requestAdminAPI("/admin/community/summary");

        renderSummaryCard("totalPostCount", summary.posts, "오늘 작성");
        renderSummaryCard("totalCommentCount", summary.comments, "오늘 작성");
        renderSummaryCard("totalReportCount", summary.reports, "오늘 접수");
        renderSummaryCard("completedReportCount", summary.completed, "오늘 처리");

    } catch (error) {
        // 카드 오류가 목록 로딩을 막지 않도록 콘솔에만 기록
        console.error("요약 카드 불러오기 실패:", error);
    }
}

// ========================================
// 게시글 / 댓글 / 신고 데이터 불러오기
// ========================================


async function loadCurrentTabData()  {
    const searchForm = document.querySelector(".filter-form");

    if (!searchForm) return;

    // 현재 선택한 메뉴 확인
    const activeMenu = document.querySelector(
        ".community-menu-item.active"
    );

    const currentTab = activeMenu?.dataset.tab || "contents";

    // 검색 조건 가져오기
    const type = searchForm.querySelector('[name="type"]').value;
    const reportStatus = searchForm.querySelector(
        '[name="report_status"]'
    ).value;
    const keyword = searchForm.querySelector(
        '[name="keyword"]'
    ).value.trim();

    try {
        // ========================================
        // 1. 게시글 / 댓글 검색
        // ========================================
        if (currentTab === "contents") {
            if (type === "report") {
                renderContentTable([]);
                return;
            }

            const params = new URLSearchParams();

            if (keyword) {
                params.set("keyword", keyword);
            }

            const suffix = params.toString()
                ? `?${params.toString()}`
                : "";

            const requests = [];

            if (type === "all" || type === "post") {
                requests.push(
                    requestAdminAPI(
                        `/admin/community/posts${suffix}`
                    ).then(data => ({
                        kind: "posts",
                        data
                    }))
                );
            }

            if (type === "all" || type === "comment") {
                requests.push(
                    requestAdminAPI(
                        `/admin/community/comments${suffix}`
                    ).then(data => ({
                        kind: "comments",
                        data
                    }))
                );
            }

            const results = await Promise.all(requests);

            let posts = [];
            let comments = [];

            for (const result of results) {
                if (result.kind === "posts") {
                    posts = result.data.items || [];
                }

                if (result.kind === "comments") {
                    comments = result.data.items || [];
                }
            }

            renderContentTable([...posts, ...comments]);
            return;
        }

        // ========================================
        // 2. 신고 처리 / 처리 내역 검색
        // ========================================
        if (
            currentTab === "reports" ||
            currentTab === "history"
        ) {
            const params = new URLSearchParams();

            if (keyword) {
                params.set("keyword", keyword);
            }

            if (reportStatus) {
                params.set("report_status", reportStatus);
            }

            const suffix = params.toString()
                ? `?${params.toString()}`
                : "";

            const reportData = await requestAdminAPI(
                `/admin/community/reports${suffix}`
            );

                        // 신고 처리 메뉴: 처리가 필요한 건(처리 대기 + 검토 완료)만
            if (currentTab === "reports") {
                const queueItems = (reportData.items || []).filter(
                    report =>
                        report.status === "PENDING" ||
                        report.status === "REVIEWED"
                );

                const groups = groupReportsByPost(queueItems);

                renderReportTable({
                    ...reportData,
                    items: groups,
                    total: groups.length,
                    report_total: queueItems.length
                });
                return;
            }

            // 처리 내역 메뉴: 처리가 끝난 건(승인 + 반려)만, 최근 처리 순
            const historyItems = (reportData.items || [])
                .filter(
                    report =>
                        report.status === "ACCEPTED" ||
                        report.status === "REJECTED"
                )
                .sort((a, b) =>
                    new Date(b.reviewed_at || b.reported_at) -
                    new Date(a.reviewed_at || a.reported_at)
                );

            renderHistoryTable(groupReportsByPost(historyItems));
        }

    } catch (error) {
        console.error(
            "관리자 커뮤니티 데이터 조회 실패:",
            error
        );
        communityLoadFailed = true;

        showCommunityError(error.message);
    }
}


// ========================================
// 게시글 및 댓글 표 출력
// ========================================

function renderContentTable(items) {
    const panel = document.getElementById("contentsPanel");

    if (!panel) return;

    const tbody = panel.querySelector("tbody");
    const countLabel = panel.querySelector(".count-label");


    tbody.replaceChildren();

    // 선택한 정렬 기준으로 전체 목록 정렬 (페이지 나누기 전에)
    items = sortCommunityItems(items, "contents");

    // 전체 건수 표시
    if (countLabel) {
        countLabel.textContent = `총 ${items.length}건`;
    }

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(7, "표시할 콘텐츠가 없습니다.")
        );

        setupCommunityPagination(
            items,
            "contents",
            panel,
            loadAdminCommunityData
        );

        return;
    }

    // 현재 페이지에 표시할 목록만 가져오기
    items = setupCommunityPagination(
        items,
        "contents",
        panel,
        loadAdminCommunityData
    );


    for (const item of items) {
        const row = document.createElement("tr");

        appendCell(row, item.type === "post" ? "게시글" : "댓글");

        const titleCell = document.createElement("td");
        const title = document.createElement("div");
        title.textContent = item.title || "(제목 없음)";

        const content = document.createElement("small");
                content.textContent =
                    item.type === "post"
                        ? toPlainText(item.content)      // 게시글: HTML 태그 제거
                        : (item.content || "");          // 댓글: 사용자가 쓴 글 그대로

        titleCell.append(title, content);
        row.appendChild(titleCell);

        appendCell(row, item.nickname || "알 수 없음");
        appendDateCell(row, item.created_at);
        appendCell(row, item.report_count ?? 0);
        appendBadgeCell(
            row,
            getContentStatusLabel(item.status),
            (item.status || "").toLowerCase()
        );

        const actionCell = document.createElement("td");
        actionCell.appendChild(createContentActions(item));
        row.appendChild(actionCell);

         // 행을 클릭하면 상세 팝업 열기 (버튼, 링크 클릭은 제외)
        row.style.cursor = "pointer";

        row.addEventListener("click", (event) => {
            if (event.target.closest("button, a")) {
                return;
            }

            showContentDetail(item);
        });

        tbody.appendChild(row);
    }
}

// ========================================
// 신고 표 출력
// ========================================

function renderReportTable(data) {
    const panel = document.getElementById("reportsPanel");

    if (!panel) return;

    const tbody = panel.querySelector("tbody");
    const headingTag = panel.querySelector(".panel-heading .tag");
    const items = sortCommunityItems(data.items || [], "reports");

    // 전체 건수 표시 (글 수 + 신고 건수)
    let totalCountLabel = panel.querySelector("#reportTotalCount");

    if (!totalCountLabel) {
        totalCountLabel = document.createElement("span");
        totalCountLabel.id = "reportTotalCount";
        totalCountLabel.className = "count-label";
    }

    // 전체 건수와 처리 대기 건수를 같은 상단 영역에 배치
    const controls = panel.querySelector(".community-heading-controls");

    if (controls) {
        const pendingCount = controls.querySelector("#pendingReportCount");

        if (pendingCount) {
            pendingCount.after(totalCountLabel);
        } else {
            controls.appendChild(totalCountLabel);
        }
    } else {
        const heading = panel.querySelector(".panel-heading");

        if (heading) {
            heading.appendChild(totalCountLabel);
        }
    }

    totalCountLabel.textContent =
        `총 ${items.length}개 글 · 신고 ${data.report_total ?? items.length}건`;

    tbody.replaceChildren();

    if (headingTag) {
        headingTag.textContent = `처리 대기 ${data.pending_count ?? 0}건`;
    }

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(7, "처리할 신고가 없습니다.")
        );

        setupCommunityPagination(
            items,
            "reports",
            panel,
            loadAdminCommunityData
        );

        return;
    }

    const pageItems = setupCommunityPagination(
        items,
        "reports",
        panel,
        loadAdminCommunityData
    );

    for (const group of pageItems) {
        const row = document.createElement("tr");

        const hasPost =
            group.post_id !== null && group.post_id !== undefined;

        // 글 번호
        appendCell(row, hasPost ? group.post_id : "—");

        // 대상 (글 제목)
        const targetCell = document.createElement("td");
        targetCell.textContent = hasPost
            ? (group.title || "[제목 없음]")
            : "[삭제된 게시글]";
        row.appendChild(targetCell);

        // 신고 건수 / 사유 요약 / 최근 접수 / 상태
        appendCountCell(row, group.report_count);
        appendReasonCell(row, group);
        appendDateCell(row, group.latest_reported_at);
        appendBadgeCell(
            row,
            getReportStatusLabel(group.status),
            (group.status || "").toLowerCase()
        );

        // 처리는 팝업에서 신고 내용을 확인한 뒤 결정
        const actionCell = document.createElement("td");
        actionCell.appendChild(
            createActionButton("처리하기", "button button-primary", () => {
                showReportDetail(group);
            })
        );
        row.appendChild(actionCell);

        // 행 전체를 클릭해도 팝업 열기
        row.style.cursor = "pointer";

        row.addEventListener("click", (event) => {
            if (event.target.closest("button")) {
                return;
            }

            showReportDetail(group);
        });

        tbody.appendChild(row);
    }
}

// 처리 내역 목록 (글 단위)
function renderHistoryTable(items) {
    const panel = document.getElementById("historyPanel");

    if (!panel) return;

    const tbody = document.getElementById(
        "communityHistoryTableBody"
    );

    const countLabel = document.getElementById(
        "historyTotalCount"
    );

    if (!tbody) return;

    items = sortCommunityItems(items, "history");

    tbody.replaceChildren();

    if (countLabel) {
        const reportTotal = items.reduce(
            (sum, group) => sum + group.report_count,
            0
        );

        countLabel.textContent =
            `총 ${items.length}건 · 신고 ${reportTotal}건`;
    }

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(6, "처리된 신고 내역이 없습니다.")
        );

        setupCommunityPagination(
            items,
            "history",
            panel,
            loadAdminCommunityData
        );

        return;
    }

    items = setupCommunityPagination(
        items,
        "history",
        panel,
        loadAdminCommunityData
    );

    for (const group of items) {
        const row = document.createElement("tr");

        const hasPost =
            group.post_id !== null && group.post_id !== undefined;

        appendCell(row, hasPost ? group.post_id : "—");

        const targetCell = document.createElement("td");
        targetCell.textContent = hasPost
            ? (group.title || "[제목 없음]")
            : "[삭제된 게시글]";
        row.appendChild(targetCell);

        appendCountCell(row, group.report_count);
        appendReasonCell(row, group);
        appendDateCell(row, group.reviewed_at || group.latest_reported_at);
        appendBadgeCell(
            row,
            getReportStatusLabel(group.status),
            (group.status || "").toLowerCase()
        );

        // 행을 클릭하면 상세 팝업 열기
        row.style.cursor = "pointer";

        row.addEventListener("click", () => {
            showReportDetail(group);
        });

        tbody.appendChild(row);
    }
}

// ========================================
// 표 셀 / 빈 목록 공통 함수
// ========================================

function appendCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "—");
    row.appendChild(cell);
}

function createEmptyRow(columnCount, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = columnCount;
    cell.className = "table-empty";
    cell.textContent = message;

    row.appendChild(cell);

    return row;
}

// ========================================
// 게시글 / 댓글 표의 관리 칸
// ========================================

// 작은 버튼 (variant: "" 또는 "danger")
function createRowButton(label, variant, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `row-action${variant ? " " + variant : ""}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
}

// 사용자 화면의 게시글을 새 탭으로 여는 링크
function createRowLink(label, postId) {
    const link = document.createElement("a");
    link.className = "row-action";
    link.href = `../community-view.html?postId=${encodeURIComponent(postId)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = label;
    return link;
}

function createContentActions(item) {
    const box = document.createElement("div");
    box.className = "row-actions";

    // 상세: 본문 확인 + 삭제 / 수정 등 신중한 작업은 팝업에서
    box.appendChild(
        createRowButton("상세", "primary", () => showContentDetail(item))
    );

    // 숨김 / 숨김 해제: 되돌릴 수 있는 작업이라 행에서 바로
    if (item.type === "post") {
        box.appendChild(
            createRowButton(
                item.status === "HIDDEN" ? "숨김 해제" : "숨김",
                "",
                () => confirmPostVisibility(item)
            )
        );
    }

    return box;
}


// 숨김 / 숨김 해제 확인
function confirmPostVisibility(item, onDone) {
    const hiding = item.status !== "HIDDEN";
    const title = item.title || "(제목 없음)";

    let message;

    if (hiding) {
        message =
            `게시글 '${title}'을(를) 숨김 처리할까요?\n` +
            "일반 사용자에게 보이지 않게 되며, 나중에 '숨김 해제'로 되돌릴 수 있습니다.";

    } else {
        message =
            `게시글 '${title}'의 숨김을 해제할까요?\n` +
            "다시 일반 사용자에게 보입니다.";

        if (item.accepted_report_count > 0) {
            message +=
                `\n\n※ 이 글에는 승인된 신고가 ${item.accepted_report_count}건 있습니다. ` +
                "숨김을 해제해도 신고 처리 기록은 '조치 승인'으로 그대로 남습니다.";
        }
    }

    showAdminConfirm({
        title: hiding ? "게시글 숨김" : "숨김 해제",
        message,
        confirmLabel: hiding ? "숨기기" : "숨김 해제",
        danger: false,
        onConfirm: async () => {
            await setPostVisibility(
                item.post_id,
                hiding ? "HIDDEN" : "ACTIVE"
            );

            showAdminToast(
                hiding
                    ? "게시글을 숨김 처리했습니다."
                    : "숨김을 해제했습니다."
            );

            if (onDone) onDone();       // ← 추가 (상세 팝업 닫기)

            await loadAdminCommunityData();
        }
    });
}


// 삭제 확인 (되돌릴 수 없음)
function confirmDeletePost(item, onDone) {
    const title = item.title || "(제목 없음)";
    const commentCount = item.comment_count ?? 0;

    showAdminConfirm({
        title: "게시글 삭제",
        message:
            `게시글 '${title}'을(를) 삭제할까요?\n\n` +
            `· 게시글과 댓글 ${commentCount}개, 좋아요, 스크랩, 첨부 이미지가 영구적으로 삭제됩니다.\n` +
            "· 삭제한 뒤에는 복구할 수 없습니다.\n" +
            "· 이 글에 대한 신고 기록은 남지만 '삭제된 게시글'로 표시됩니다.\n\n" +
            "일시적으로 가리려는 것이라면 '숨김'을 사용하세요.",
        confirmLabel: "영구 삭제",
        danger: true,
        onConfirm: async () => {
            await deletePostByAdmin(item.post_id);

            showAdminToast("게시글을 삭제했습니다.");

            if (onDone) onDone();       // ← 추가 (상세 팝업 닫기)

            await loadAdminCommunityData();
        }
    });
}

// 댓글 삭제 API (달린 답글도 함께 삭제됨)
async function deleteCommentByAdmin(commentId) {
    return requestAdminAPI(
        `/admin/community/comments/${commentId}`,
        { method: "DELETE" }
    );
}


// 댓글 삭제 확인 (되돌릴 수 없음)
function confirmDeleteComment(item, onDone) {
    const isReply = Boolean(item.parent_comment_id);
    const kind = isReply ? "답글" : "댓글";

    const content = item.content || "";
    const preview =
        content.length > 40 ? content.slice(0, 40) + "…" : content;

    let message =
        `이 ${kind}을(를) 삭제할까요?\n\n` +
        `"${preview}"\n\n` +
        "· 삭제한 뒤에는 복구할 수 없습니다.\n" +
        "· 원글의 댓글 수에 자동으로 반영됩니다.";

    // 부모 댓글이면 달린 답글도 함께 삭제됨
    if (!isReply && item.reply_count > 0) {
        message +=
            `\n· 이 댓글에 달린 답글 ${item.reply_count}개도 함께 삭제됩니다.`;
    }

    showAdminConfirm({
        title: `${kind} 삭제`,
        message,
        confirmLabel: "영구 삭제",
        danger: true,
        onConfirm: async () => {
            const result = await deleteCommentByAdmin(item.comment_id);

            const count = result?.deleted_count ?? 1;

            showAdminToast(
                count > 1
                    ? `${kind}과 답글을 포함해 ${count}개를 삭제했습니다.`
                    : `${kind}을(를) 삭제했습니다.`
            );

            if (onDone) onDone();

            await loadAdminCommunityData();
        }
    });
}

// 팀 목록 (수정 폼용, 한 번만 불러와 재사용)
let adminTeamList = null;

async function loadAdminTeams() {
    if (adminTeamList) return adminTeamList;

    const data = await requestAdminAPI("/admin/community/teams");
    adminTeamList = data?.items || [];

    return adminTeamList;
}


// 게시글 분류 정정 API
async function updatePostClassification(postId, category, relatedTeamId) {
    return requestAdminAPI(
        `/admin/community/posts/${postId}/classification`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                category,
                related_team_id: relatedTeamId,
            }),
        }
    );
}


// 분류 수정 팝업 (카테고리 + 관련 팀)
async function showPostClassificationDialog(item, onDone) {
    let teams = [];

    try {
        teams = await loadAdminTeams();
    } catch (error) {
        showAdminToast(error.message || "팀 목록을 불러오지 못했습니다.");
        return;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";

    const heading = document.createElement("h3");
    heading.textContent = `분류 수정 · 게시글 #${item.post_id}`;
    dialog.appendChild(heading);

    const note = document.createElement("p");
    note.className = "confirm-message";
    note.textContent =
        "잘못 분류된 글을 바로잡습니다. 제목과 본문은 수정되지 않습니다.";
    dialog.appendChild(note);

    // 카테고리 선택
    const categoryLabel = document.createElement("label");
    categoryLabel.className = "filter-label-text";
    categoryLabel.textContent = "카테고리";

    const categorySelect = document.createElement("select");
    ["GENERAL", "ANALYSIS", "GAME_THREAD", "NEWS"].forEach((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = getCategoryLabel(code);
        if (code === item.category) option.selected = true;
        categorySelect.appendChild(option);
    });
    categoryLabel.appendChild(categorySelect);
    dialog.appendChild(categoryLabel);

    // 관련 팀 선택
    const teamLabel = document.createElement("label");
    teamLabel.className = "filter-label-text";
    teamLabel.textContent = "관련 팀";

    const teamSelect = document.createElement("select");

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "선택 안 함";
    teamSelect.appendChild(noneOption);

    teams.forEach((team) => {
        const option = document.createElement("option");
        option.value = String(team.team_id);
        option.textContent = team.team_name;
        if (team.team_id === item.related_team_id) option.selected = true;
        teamSelect.appendChild(option);
    });
    teamLabel.appendChild(teamSelect);
    dialog.appendChild(teamLabel);

    const errorBox = document.createElement("p");
    errorBox.className = "confirm-error";
    dialog.appendChild(errorBox);

    // 버튼
    const footer = document.createElement("div");
    footer.className = "report-dialog-footer";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "dialog-button";
    cancelButton.textContent = "취소";
    cancelButton.addEventListener("click", () => dialog.close());

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "dialog-button confirm";
    saveButton.textContent = "저장";
    saveButton.addEventListener("click", async () => {
        const teamValue = teamSelect.value;
        const teamId = teamValue === "" ? null : Number(teamValue);

        saveButton.disabled = true;
        errorBox.textContent = "";

        try {
            await updatePostClassification(
                item.post_id,
                categorySelect.value,
                teamId
            );

            showAdminToast("분류를 수정했습니다.");
            dialog.close();

            if (onDone) onDone();

            await loadAdminCommunityData();
        } catch (error) {
            errorBox.textContent =
                error.message || "분류를 수정하지 못했습니다.";
            saveButton.disabled = false;
        }
    });

    const actions = document.createElement("div");
    actions.className = "footer-actions";
    actions.append(cancelButton, saveButton);
    footer.appendChild(actions);
    dialog.appendChild(footer);

    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
}

// ========================================
// 게시글 / 댓글 상세 팝업
// - 본문 전체를 확인하고, 숨김 / 삭제 같은 작업을 처리
// ========================================
function showContentDetail(item) {
    const isPost = item.type === "post";

    const dialog = document.createElement("dialog");
    dialog.className = "report-dialog";

    // ----- 1. 머리글: 번호 + 상태 -----
    const head = document.createElement("div");
    head.className = "report-dialog-head";

    const heading = document.createElement("h2");
    heading.textContent = isPost
        ? `게시글 #${item.post_id}`
        : `${item.parent_comment_id ? "답글" : "댓글"} #${item.comment_id}`;
    head.appendChild(heading);

    if (isPost) {
        const statusBadge = document.createElement("span");
        statusBadge.className =
            `status-badge ${(item.status || "").toLowerCase()}`;
        statusBadge.textContent = getContentStatusLabel(item.status);
        head.appendChild(statusBadge);
    }

    dialog.appendChild(head);

    // ----- 2. 상세 정보 -----
    const list = document.createElement("dl");
    list.className = "report-detail-list";

    const addDetail = (label, value, className = "") => {
        const term = document.createElement("dt");
        term.textContent = label;

        const desc = document.createElement("dd");
        desc.textContent = String(value ?? "—");

        if (className) {
            desc.className = className;
        }

        list.append(term, desc);
    };

    if (isPost) {
        addDetail("제목", item.title || "(제목 없음)");
        addDetail("작성자", item.nickname || "알 수 없음");
        addDetail("카테고리", getCategoryLabel(item.category));
        addDetail("작성일", formatDate(item.created_at));
        addDetail("댓글", `${item.comment_count ?? 0}개`);
        addDetail(
            "신고",
            `${item.report_count ?? 0}건` +
            (item.accepted_report_count > 0
                ? ` (승인 ${item.accepted_report_count}건)`
                : "")
        );
        addDetail(
            "내용",
            toPlainText(item.content, 3000, true) || "(내용 없음)",
            "report-post-excerpt"
        );

        } else {
        addDetail("구분", item.parent_comment_id ? "답글" : "댓글");
        addDetail("원글 제목", item.title || "(제목 없음)");
        addDetail("작성자", item.nickname || "알 수 없음");
        addDetail("작성일", formatDate(item.created_at));

        // 부모 댓글이면 달린 답글 수 표시
        if (!item.parent_comment_id && item.reply_count > 0) {
            addDetail("답글", `${item.reply_count}개`);
        }

        addDetail(
            "내용",
            item.content || "(내용 없음)",
            "report-post-excerpt"
        );
    }
    dialog.appendChild(list);

    // ----- 3. 원글 보기 링크 (숨겨진 글은 사용자 화면에서 열리지 않음) -----
    if (!isPost || item.status === "ACTIVE") {
        const link = document.createElement("a");
        link.className = "report-post-link";
        link.href =
            `../community-view.html?postId=${encodeURIComponent(item.post_id)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "원글 보기 ↗";
        dialog.appendChild(link);
    }

    // ----- 4. 하단 버튼 -----
    const footer = document.createElement("div");
    footer.className = "report-dialog-footer plain";

    const left = document.createElement("div");
    left.className = "footer-left";

    const actions = document.createElement("div");
    actions.className = "footer-actions";

    if (isPost) {
        // 왼쪽: 숨김 / 숨김 해제
        const hideButton = document.createElement("button");
        hideButton.type = "button";
        hideButton.className = "dialog-button";
        hideButton.textContent =
            item.status === "HIDDEN" ? "숨김 해제" : "숨김";
        hideButton.addEventListener("click", () => {
            confirmPostVisibility(item, () => dialog.close());
        });
        left.appendChild(hideButton);

        // 분류 수정 (카테고리, 관련 팀)
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "dialog-button";
        editButton.textContent = "분류 수정";
        editButton.addEventListener("click", () => {
            showPostClassificationDialog(item, () => dialog.close());
        });
        left.appendChild(editButton);

        // 오른쪽: 삭제 (붉은 테두리로 구분)
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "dialog-button outline-danger";
        deleteButton.textContent = "삭제";
        deleteButton.addEventListener("click", () => {
            confirmDeletePost(item, () => dialog.close());
        });
        actions.appendChild(deleteButton);

    } else {
        // 댓글 / 답글 삭제
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "dialog-button outline-danger";
        deleteButton.textContent = "삭제";
        deleteButton.addEventListener("click", () => {
            confirmDeleteComment(item, () => dialog.close());
        });
        actions.appendChild(deleteButton);
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "dialog-button";
    closeButton.textContent = "닫기";
    closeButton.addEventListener("click", () => dialog.close());
    actions.appendChild(closeButton);

    footer.append(left, actions);
    dialog.appendChild(footer);

    // ----- 5. 팝업 열기 / 닫기 -----
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
}

// 게시글 본문(HTML)을 태그 없는 글자로 변환
// keepLineBreaks: true면 문단 / 줄바꿈을 유지 (상세 화면용)
function toPlainText(html, maxLength = 100, keepLineBreaks = false) {
    if (!html) return "";

    let source = html;

    if (keepLineBreaks) {
        source = source
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
    }

    // DOMParser는 스크립트를 실행하지 않아서 안전하게 글자만 꺼낼 수 있음
    const doc = new DOMParser().parseFromString(source, "text/html");
    let text = doc.body.textContent || "";

    text = keepLineBreaks
        ? text
            .replace(/[ \t\u00a0]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        : text.replace(/\s+/g, " ").trim();

    // 글자는 없고 이미지만 있는 게시글
    if (!text && /<img/i.test(html)) {
        return "[이미지]";
    }

    return text.length > maxLength
        ? text.slice(0, maxLength) + "…"
        : text;
}

// 짧은 날짜 칸 (마우스를 올리면 전체 날짜 표시)
function appendDateCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = formatDateShort(value);
    cell.title = formatDate(value);
    row.appendChild(cell);
}

// 배지 칸 (type: pending / reviewed / accepted / rejected / active / hidden / reason ...)
function appendBadgeCell(row, text, type) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");

    badge.className = `status-badge ${type}`;
    badge.textContent = text;

    cell.appendChild(badge);
    row.appendChild(cell);
}

// 신고 건수 칸 (3건 이상이면 강조)
function appendCountCell(row, count) {
    const cell = document.createElement("td");
    const label = document.createElement("span");

    label.className = `report-count${count >= 3 ? " many" : ""}`;
    label.textContent = `${count}건`;

    cell.appendChild(label);
    row.appendChild(cell);
}

// 신고 사유 칸 (예: 욕설 / 비방 3, 광고 2)
function appendReasonCell(row, group) {
    const cell = document.createElement("td");
    const chips = document.createElement("div");
    chips.className = "reason-chips";

    const entries = Object.entries(group.reason_counts)
        .sort((a, b) => b[1] - a[1]);

    for (const [reason, count] of entries) {
        const chip = document.createElement("span");
        chip.className = "status-badge reason";
        chip.textContent =
            group.report_count > 1
                ? `${getReportReasonLabel(reason)} ${count}`
                : getReportReasonLabel(reason);

        chips.appendChild(chip);
    }

    cell.appendChild(chips);
    row.appendChild(cell);
}

// 처리 버튼 만들기
function createActionButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", onClick);
    return button;
}

// ========================================
// 날짜 / 상태 / 신고 사유 표시
// ========================================

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleString("ko-KR");
}

function getContentStatusLabel(status) {
    const labels = {
        ACTIVE: "정상",
        HIDDEN: "숨김",
        DELETED: "삭제"
    };

    return labels[status] || status || "—";
}

function getReportStatusLabel(status) {
    const labels = {
        PENDING: "처리 대기",
        REVIEWED: "검토 완료",
        ACCEPTED: "조치 승인",
        REJECTED: "반려"
    };

    return labels[status] || status || "—";
}

function getReportReasonLabel(reason) {
    const labels = {
        ABUSE: "욕설 / 비방",
        AD: "광고",
        SPAM: "도배 / 스팸",
        INAPPROPRIATE: "부적절한 콘텐츠",
        ETC: "기타"
    };

    return labels[reason] || reason || "—";
}

// 카테고리 이름 함수
function getCategoryLabel(category) {
    const labels = {
        GENERAL: "자유",
        ANALYSIS: "분석",
        GAME_THREAD: "경기",
        NEWS: "뉴스"
    };

    return labels[category] || category || "—";
}

// 표에 보여줄 짧은 날짜 (예: 10.14 15:36, 올해가 아니면 연도 포함)
function formatDateShort(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    const pad = (n) => String(n).padStart(2, "0");

    const year =
        date.getFullYear() === new Date().getFullYear()
            ? ""
            : `${String(date.getFullYear()).slice(2)}.`;

    return `${year}${pad(date.getMonth() + 1)}.${pad(date.getDate())} `
         + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ========================================
// 오류 메시지 표시
// ========================================

function showCommunityError(message) {
    // 오류 메시지를 보여줄 표 3곳 (id, 칸 수)
    const targets = [
        { id: "communityContentTableBody", columns: 7 },
        { id: "communityReportTableBody", columns: 7 },
        { id: "communityHistoryTableBody", columns: 6 }
    ];

    for (const target of targets) {
        const tbody = document.getElementById(target.id);

        if (!tbody) continue;

        tbody.replaceChildren();
        tbody.appendChild(
            createEmptyRow(target.columns, message)
        );
    }
}


// 신고 상태 변경 API 호출
// (확인 / 완료 안내는 상세 팝업에서 처리)
async function applyReportStatus(reportId, newStatus) {
    return requestAdminAPI(
        `/admin/community/reports/${reportId}/status?new_status=${newStatus}`,
        {
            method: "PATCH"
        }
    );
}

// ========================================
// 신고를 글 단위 묶음으로 만들기
// - 신고 처리 탭: 같은 글의 대기/검토 중 신고를 한 줄로
// - 처리 내역 탭: 같은 글 + 같은 결과 + 같은 처리 시각을 한 줄로
// - 삭제된 글의 신고는 묶을 수 없으니 신고 1건씩 그대로
// ========================================
function groupReportsByPost(items) {
    const groups = new Map();

    for (const report of items) {
        const hasPost =
            report.post_id !== null && report.post_id !== undefined;

        const isDone =
            report.status === "ACCEPTED" || report.status === "REJECTED";

        let key;

        if (!hasPost) {
            key = `report-${report.report_id}`;
        } else if (isDone) {
            key = `post-${report.post_id}-${report.status}-${report.reviewed_at}`;
        } else {
            key = `post-${report.post_id}`;
        }

        if (!groups.has(key)) {
            groups.set(key, {
                group_key: key,
                post_id: report.post_id,
                title: report.title,
                post_author: report.post_author,
                post_status: report.post_status,
                post_excerpt: report.post_excerpt,
                status: report.status,
                reviewed_at: report.reviewed_at,
                reports: [],
                reason_counts: {},
                first_reported_at: report.reported_at,
                latest_reported_at: report.reported_at,
            });
        }

        const group = groups.get(key);

        group.reports.push(report);

        group.reason_counts[report.reason] =
            (group.reason_counts[report.reason] || 0) + 1;

        // 접수 시각 범위
        if (report.reported_at < group.first_reported_at) {
            group.first_reported_at = report.reported_at;
        }
        if (report.reported_at > group.latest_reported_at) {
            group.latest_reported_at = report.reported_at;
        }

        // 묶음 상태: 하나라도 대기면 대기, 모두 검토 중일 때만 검토 중
        if (!isDone && report.status === "PENDING") {
            group.status = "PENDING";
        }
    }

    // 표시용 보조 값
    return [...groups.values()].map((group) => ({
        ...group,
        report_count: group.reports.length,
        // 대표 신고 번호 (처리 취소 API 호출에 사용)
        report_id: group.reports[0].report_id,
    }));
}


// 사유 요약: "욕설 3 · 광고 2" (많은 순)
function formatReasonSummary(group) {
    return Object.entries(group.reason_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${getReportReasonLabel(reason)} ${count}`)
        .join(" · ");
}


// 글 단위 일괄 처리 API (승인 / 반려 / 검토 중)
async function processPostReports(postId, newStatus) {
    return requestAdminAPI(
        `/admin/community/posts/${postId}/reports/status?new_status=${newStatus}`,
        { method: "PATCH" }
    );
}

// 신고 처리 취소 API (승인/반려 → 대기)
async function revertReportStatus(reportId) {
    return requestAdminAPI(
        `/admin/community/reports/${reportId}/revert`,
        { method: "PATCH" }
    );
}


// 처리 취소 확인
function confirmRevertReport(report, onDone) {
    const isAccepted = report.status === "ACCEPTED";
    const label = isAccepted ? "승인 취소" : "반려 취소";

        const count = report.report_count || 1;

    const message = isAccepted
        ? "승인을 취소할까요?\n\n" +
          "· 이 글에서 승인된 신고가 모두 '신고 처리' 대기로 돌아갑니다.\n" +
          "· 숨김 처리된 게시글은 다시 공개됩니다."
        : "반려를 취소할까요?\n\n" +
          `· 함께 반려된 신고 ${count}건이 '신고 처리' 대기로 돌아갑니다.`;
    showAdminConfirm({
        title: label,
        message,
        confirmLabel: label,
        danger: isAccepted,
        onConfirm: async () => {
            const result = await revertReportStatus(report.report_id);

            let toast = "처리를 취소했습니다.";
            if (result?.reverted_count > 1) {
                toast = `신고 ${result.reverted_count}건의 처리를 취소했습니다.`;
            }
            if (result?.post_restored) {
                toast += " 게시글이 다시 공개되었습니다.";
            }
            showAdminToast(toast);

            if (onDone) onDone();

            await loadAdminCommunityData();
        }
    });
}


// 화면 오른쪽 아래에 잠깐 보이는 안내 메시지
function showAdminToast(message) {
    let box = document.getElementById("adminToastBox");

    if (!box) {
        box = document.createElement("div");
        box.id = "adminToastBox";
        box.className = "admin-toast-box";
        box.setAttribute("role", "status");
        box.setAttribute("aria-live", "polite");
        document.body.appendChild(box);
    }

    const toast = document.createElement("div");
    toast.className = "admin-toast";
    toast.textContent = message;
    box.appendChild(toast);

    // 3초 뒤 서서히 사라진 후 제거
    setTimeout(() => {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================================
// 공통 확인 팝업
// title        : 팝업 제목
// message      : 안내 문구 (\n 으로 줄바꿈)
// confirmLabel : 확정 버튼 글자
// danger       : true면 확정 버튼이 빨간색 (되돌릴 수 없는 작업)
// onConfirm    : 확정 시 실행할 비동기 함수 (오류가 나면 팝업 안에 표시)
// ========================================
function showAdminConfirm({
    title,
    message,
    confirmLabel = "확인",
    danger = false,
    onConfirm
}) {
    const dialog = document.createElement("dialog");
    dialog.className = "report-dialog confirm-dialog";

    const head = document.createElement("div");
    head.className = "report-dialog-head";

    const heading = document.createElement("h2");
    heading.textContent = title;
    head.appendChild(heading);

    const text = document.createElement("p");
    text.className = "confirm-message";
    text.textContent = message;

    const errorMessage = document.createElement("p");
    errorMessage.className = "report-dialog-error confirm-error";
    errorMessage.hidden = true;

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "dialog-button";
    cancelButton.textContent = "취소";
    cancelButton.addEventListener("click", () => dialog.close());

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className =
        `dialog-button confirm${danger ? " danger" : ""}`;
    confirmButton.textContent = confirmLabel;

    confirmButton.addEventListener("click", async () => {
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        errorMessage.hidden = true;

        try {
            await onConfirm();
            dialog.close();

        } catch (error) {
            console.error("관리자 작업 실패:", error);

            errorMessage.textContent =
                error.message || "처리 중 오류가 발생했습니다. 다시 시도해 주세요.";
            errorMessage.hidden = false;

            confirmButton.disabled = false;
            cancelButton.disabled = false;
        }
    });

    const footer = document.createElement("div");
    footer.className = "report-dialog-footer plain";

    const actions = document.createElement("div");
    actions.className = "footer-actions";
    actions.append(cancelButton, confirmButton);
    footer.appendChild(actions);

    dialog.append(head, text, errorMessage, footer);

    // 어두운 배경을 클릭하면 닫기
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
}


// 게시글 숨김 / 숨김 해제 API
async function setPostVisibility(postId, newStatus) {
    return requestAdminAPI(
        `/admin/community/posts/${postId}/status?new_status=${newStatus}`,
        { method: "PATCH" }
    );
}

// 게시글 삭제 API (영구 삭제)
async function deletePostByAdmin(postId) {
    return requestAdminAPI(
        `/admin/community/posts/${postId}`,
        { method: "DELETE" }
    );
}

// 묶음 처리: 글이 있으면 글 단위 일괄 API, 삭제된 글이면 신고 1건 API
async function processReportGroup(group, newStatus) {
    const hasPost =
        group.post_id !== null && group.post_id !== undefined;

    if (hasPost) {
        return processPostReports(group.post_id, newStatus);
    }

    return applyReportStatus(group.reports[0].report_id, newStatus);
}


// ========================================
// 신고 상세 / 처리 팝업 (글 단위)
// - 처리할 신고: 묶음 안의 신고들을 확인한 뒤 한 번에 승인 또는 반려
// - 처리가 끝난 신고(처리 내역): 내용 확인 + 처리 취소
// ========================================
function showReportDetail(group) {
    const canProcess =
        group.status === "PENDING" || group.status === "REVIEWED";

    const hasPost =
        group.post_id !== null && group.post_id !== undefined;

    const reports = [...(group.reports || [])].sort(
        (a, b) => new Date(b.reported_at) - new Date(a.reported_at)
    );

    // 이 글에서 실제로 처리될 신고 수
    // (검색 조건 때문에 목록에는 일부만 보일 수 있음)
    const openTotal = hasPost
        ? Math.max(
            group.report_count,
            ...reports.map((item) => item.same_post_open_count || 0)
        )
        : group.report_count;

    const dialog = document.createElement("dialog");
    dialog.className = "report-dialog";

    // ----- 1. 머리글 -----
    const head = document.createElement("div");
    head.className = "report-dialog-head";

    const heading = document.createElement("h2");
    heading.textContent = hasPost
        ? `게시글 No.${group.post_id} 신고`
        : `신고 #${group.report_id}`;

    const statusBadge = document.createElement("span");
    statusBadge.className =
        `status-badge ${(group.status || "").toLowerCase()}`;
    statusBadge.textContent = getReportStatusLabel(group.status);

    head.append(heading, statusBadge);
    dialog.appendChild(head);

    // ----- 2. 상세 정보 -----
    const list = document.createElement("dl");
    list.className = "report-detail-list";

    const addDetail = (label, value, className = "") => {
        const term = document.createElement("dt");
        term.textContent = label;

        const desc = document.createElement("dd");
        desc.textContent = String(value ?? "—");

        if (className) {
            desc.className = className;
        }

        list.append(term, desc);
    };

    addDetail(
        "게시글 번호",
        hasPost ? `No.${group.post_id}` : "삭제된 게시글"
    );
    addDetail(
        "제목",
        hasPost ? (group.title || "[제목 없음]") : "—"
    );

    if (hasPost) {
        addDetail("글 작성자", group.post_author || "알 수 없음");
        addDetail(
            "게시글 내용",
            group.post_excerpt || "(내용 없음)",
            "report-post-excerpt"
        );
        addDetail(
            "게시글 상태",
            getContentStatusLabel(group.post_status)
        );
    }

    addDetail(
        "접수 현황",
        `${group.report_count}건 · ${formatReasonSummary(group)}`
    );
    addDetail(
        "접수 기간",
        group.first_reported_at === group.latest_reported_at
            ? formatDate(group.latest_reported_at)
            : `${formatDate(group.first_reported_at)} ~ ${formatDate(group.latest_reported_at)}`
    );
    addDetail(
        "처리일",
        group.status === "PENDING"
            ? "아직 처리되지 않음"
            : formatDate(group.reviewed_at)
    );

    dialog.appendChild(list);

    // ----- 3. 접수된 신고 목록 -----
    const itemsBox = document.createElement("div");
    itemsBox.className = "report-items-box";

    const itemsTitle = document.createElement("h3");
    itemsTitle.textContent = `접수된 신고 ${group.report_count}건`;
    itemsBox.appendChild(itemsTitle);

    const itemList = document.createElement("ul");
    itemList.className = "report-items";

    for (const item of reports) {
        const li = document.createElement("li");

        const meta = document.createElement("div");
        meta.className = "report-item-meta";

        const who = document.createElement("strong");
        who.textContent = item.nickname || "알 수 없음";

        const reason = document.createElement("span");
        reason.className = "status-badge reason";
        reason.textContent = getReportReasonLabel(item.reason);

        const when = document.createElement("span");
        when.className = "report-item-date";
        when.textContent = formatDateShort(item.reported_at);

        meta.append(who, reason, when);

        const content = document.createElement("p");
        content.className = "report-item-content";
        content.textContent =
            item.report_content || "작성된 신고 내용이 없습니다.";

        li.append(meta, content);
        itemList.appendChild(li);
    }

    itemsBox.appendChild(itemList);
    dialog.appendChild(itemsBox);

    // 검색 조건 때문에 일부 신고만 보이는 경우 안내
    if (canProcess && openTotal > group.report_count) {
        const note = document.createElement("p");
        note.className = "report-dialog-note";
        note.textContent =
            `검색 조건 때문에 일부 신고만 표시되었습니다. ` +
            `처리하면 이 글의 미처리 신고 ${openTotal}건이 모두 처리됩니다.`;
        dialog.appendChild(note);
    }

    // ----- 4. 원글 보기 링크 (처리할 건에서만) -----
    if (canProcess && hasPost) {
        const link = document.createElement("a");
        link.className = "report-post-link";
        link.href =
            `../community-view.html?postId=${encodeURIComponent(group.post_id)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "원글 보기 ↗";
        dialog.appendChild(link);
    }

    // ----- 5. 닫기 버튼 (공통) -----
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "dialog-button";
    closeButton.textContent = "닫기";
    closeButton.addEventListener("click", () => dialog.close());

    if (!canProcess) {
        // 처리가 끝난 신고: 처리 취소 또는 닫기
        const footer = document.createElement("div");
        footer.className = "report-dialog-footer plain";

        const actions = document.createElement("div");
        actions.className = "footer-actions";

        const revertButton = document.createElement("button");
        revertButton.type = "button";
        revertButton.className = "dialog-button";
        revertButton.textContent =
            group.status === "ACCEPTED" ? "승인 취소" : "반려 취소";

        // 삭제된 게시글의 승인은 되돌릴 수 없음
        if (
            group.status === "ACCEPTED" &&
            (group.post_status === "DELETED" || !hasPost)
        ) {
            revertButton.disabled = true;
            revertButton.title =
                "삭제된 게시글은 승인을 취소할 수 없습니다.";
        }

        revertButton.addEventListener("click", () => {
            confirmRevertReport(group, () => dialog.close());
        });

        actions.append(revertButton, closeButton);
        footer.appendChild(actions);
        dialog.appendChild(footer);

    } else {
        // ----- 6. 처리 방법 선택 영역 -----
        const many = openTotal > 1;

        const options = [
            {
                status: "ACCEPTED",
                className: "accept",
                title: "신고 승인",
                desc: hasPost
                    ? "게시글이 숨김 처리되어 일반 사용자에게 보이지 않습니다." +
                      (many
                          ? ` 이 글의 신고 ${openTotal}건이 모두 승인됩니다.`
                          : "")
                    : "이미 삭제된 게시글이라 숨길 대상은 없고, 신고만 승인 처리됩니다.",
                confirmLabel: hasPost ? "승인하고 게시글 숨기기" : "승인하기",
                confirmClass: "danger",
                doneMessage: (count) =>
                    hasPost
                        ? `신고 ${count}건을 승인했습니다. 게시글이 숨김 처리되었습니다.`
                        : "신고를 승인했습니다."
            },
            {
                status: "REJECTED",
                className: "reject",
                title: "반려",
                desc: "게시글은 그대로 유지되고 " +
                      (many
                          ? `이 글의 신고 ${openTotal}건이 모두 반려됩니다.`
                          : "이 신고가 반려됩니다."),
                confirmLabel: "반려하기",
                confirmClass: "neutral",
                doneMessage: (count) => `신고 ${count}건을 반려했습니다.`
            }
        ];

        let selected = null;   // 선택한 처리 방법

        const decision = document.createElement("div");
        decision.className = "report-decision";

        const decisionTitle = document.createElement("h3");
        decisionTitle.textContent = "처리 방법을 선택하세요";

        const cards = document.createElement("div");
        cards.className = "decision-cards";

        const errorMessage = document.createElement("p");
        errorMessage.className = "report-dialog-error";
        errorMessage.hidden = true;

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "dialog-button confirm";
        confirmButton.textContent = "처리 확정";
        confirmButton.disabled = true;     // 방법을 고르기 전에는 비활성화

        const cardButtons = [];

        // 처리 중에는 모든 버튼을 잠그고, 끝나면 다시 풀기
        const setBusy = (busy) => {
            confirmButton.disabled = busy || !selected;
            closeButton.disabled = busy;
            cardButtons.forEach((button) => {
                button.disabled = busy;
            });
        };

        const showError = (error) => {
            console.error("신고 상태 변경 실패:", error);
            errorMessage.textContent =
                error.message || "처리 중 오류가 발생했습니다. 다시 시도해 주세요.";
            errorMessage.hidden = false;
        };

        // 승인 / 반려 카드
        for (const option of options) {
            const card = document.createElement("button");
            card.type = "button";
            card.className = `decision-card ${option.className}`;
            card.setAttribute("aria-pressed", "false");

            const cardTitle = document.createElement("strong");
            cardTitle.textContent = option.title;

            const cardDesc = document.createElement("span");
            cardDesc.textContent = option.desc;

            card.append(cardTitle, cardDesc);

            card.addEventListener("click", () => {
                selected = option;

                cardButtons.forEach((button) => {
                    button.setAttribute(
                        "aria-pressed",
                        String(button === card)
                    );
                });

                confirmButton.disabled = false;
                confirmButton.textContent = option.confirmLabel;
                confirmButton.className =
                    `dialog-button confirm ${option.confirmClass}`;

                errorMessage.hidden = true;
            });

            cardButtons.push(card);
            cards.appendChild(card);
        }

        // 처리 확정
        confirmButton.addEventListener("click", async () => {
            if (!selected) return;

            setBusy(true);

            try {
                const result = await processReportGroup(
                    group,
                    selected.status
                );

                dialog.close();

                const count =
                    result?.processed_count ?? group.report_count;

                showAdminToast(selected.doneMessage(count));

                // 처리된 신고는 목록에서 사라지고 처리 내역으로 이동
                await loadAdminCommunityData();

            } catch (error) {
                showError(error);
                setBusy(false);
            }
        });

        // 하단: 검토 중 링크 + 닫기 + 확정
        const footer = document.createElement("div");
        footer.className = "report-dialog-footer";

        // 대기 중인 신고가 있을 때만 "검토 중으로 표시" 보조 링크
        if (group.status === "PENDING") {
            const reviewLink = document.createElement("button");
            reviewLink.type = "button";
            reviewLink.className = "review-link";
            reviewLink.textContent = "판단이 어렵다면 '검토 중'으로 표시";

            reviewLink.addEventListener("click", async () => {
                setBusy(true);
                reviewLink.disabled = true;

                try {
                    await processReportGroup(group, "REVIEWED");

                    dialog.close();
                    showAdminToast("검토 중으로 표시했습니다.");
                    await loadAdminCommunityData();

                } catch (error) {
                    showError(error);
                    setBusy(false);
                    reviewLink.disabled = false;
                }
            });

            footer.appendChild(reviewLink);
        }

        const actions = document.createElement("div");
        actions.className = "footer-actions";
        actions.append(closeButton, confirmButton);

        footer.appendChild(actions);

        decision.append(decisionTitle, cards, errorMessage, footer);
        dialog.appendChild(decision);
    }

    // ----- 7. 팝업 열기 / 닫기 -----
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener("close", () => {
        dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
}

