
/* ========================================
   BASEBOT 관리자 - 커뮤니티 관리
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";


const communityPageState = {
    contents: { pageSize: 10, page: 1, sortKey: "created_at",  sortDir: "desc" },
    reports:  { pageSize: 10, page: 1, sortKey: "reported_at", sortDir: "desc" },
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
        { index: 0, key: "report_id", type: "number" },  // 번호
        { index: 2, key: "reason" },                     // 신고 사유
        { index: 3, key: "nickname" },                   // 신고자
        { index: 4, key: "reported_at", type: "date" },  // 접수일
        { index: 5, key: "status", type: "status" }      // 상태
    ],
    history: [
        { index: 0, key: "report_id", type: "number" },  // 번호
        { index: 2, key: "reason" },                     // 신고 사유
        { index: 3, key: "nickname" },                   // 신고자
        { index: 4, key: "reviewed_at", type: "date", fallback: "reported_at" }, // 처리일
        { index: 5, key: "status", type: "status" }      // 처리 상태
    ]
};

// 상태 정렬 순서 (작을수록 위)
const communityStatusOrder = {
    PENDING: 0, REVIEWED: 1, ACCEPTED: 2, REJECTED: 3,   // 신고 상태
    ACTIVE: 0, HIDDEN: 1, DELETED: 2                      // 게시글 상태
};

document.addEventListener("DOMContentLoaded", () => {
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

        return result * direction;
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

    await loadCurrentTabData();

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

                renderReportTable({
                    ...reportData,
                    items: queueItems,
                    total: queueItems.length
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

            renderHistoryTable(historyItems);
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
        actionCell.textContent = "—";
        actionCell.title = "관리 기능은 처리 API 연결 후 활성화됩니다.";
        row.appendChild(actionCell);

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

        // 전체 신고 건수 표시
        let totalCountLabel = panel.querySelector(
            "#reportTotalCount"
        );

        if (!totalCountLabel) {
            totalCountLabel = document.createElement("span");
            totalCountLabel.id = "reportTotalCount";
            totalCountLabel.className = "count-label";
        }

        // 전체 건수와 처리 대기 건수를 같은 상단 영역에 배치
        const controls = panel.querySelector(
            ".community-heading-controls"
        );

        if (controls) {
            const pendingCount = controls.querySelector(
                "#pendingReportCount"
            );

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
            `총 ${data.total ?? items.length}건`;

    tbody.replaceChildren();

    if (headingTag) {
    headingTag.textContent =
        `처리 대기 ${data.pending_count ?? 0}건`;
}

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(7, "신고 데이터가 없습니다.")
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


    for (const report of pageItems) {
        const row = document.createElement("tr");


        appendCell(row, report.report_id);

        const targetCell = document.createElement("td");

        if (report.post_id !== null && report.post_id !== undefined) {
            targetCell.textContent =
                `[No.${report.post_id}] - ${report.title || "[제목 없음]"}`;
        } else {
            targetCell.textContent = "[삭제된 게시글]";
        }

        row.appendChild(targetCell);

        appendBadgeCell(row, getReportReasonLabel(report.reason), "reason");



        const reporterCell = document.createElement("td");
        reporterCell.textContent = report.nickname || "알 수 없음";

        if (report.report_content) {
            reporterCell.title = report.report_content;
        }

        row.appendChild(reporterCell);

        appendDateCell(row, report.reported_at);
        appendBadgeCell(
            row,
            getReportStatusLabel(report.status),
            (report.status || "").toLowerCase()
        );

                const actionCell = document.createElement("td");

        // 처리는 상세 팝업에서 내용을 확인한 뒤 결정
        actionCell.appendChild(
            createActionButton("처리하기", "button button-primary", () => {
                showReportDetail(report);
            })
        );

        row.appendChild(actionCell);
        // 신고 행 전체를 클릭하면 상세 팝업 열기
        row.style.cursor = "pointer";

        row.addEventListener("click", (event) => {
            // 검토, 승인, 반려 버튼을 클릭한 경우에는 상세 팝업을 열지 않음
            if (event.target.closest("button")) {
                return;
            }

            showReportDetail(report);
        });

        tbody.appendChild(row);

    }
}

// 처리 내역 목록
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
        countLabel.textContent = `총 ${items.length}건`;
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


    for (const report of items) {
        const row = document.createElement("tr");

        appendCell(row, report.report_id);

        const targetCell = document.createElement("td");

        if (report.post_id !== null && report.post_id !== undefined) {
            targetCell.textContent =
                `[No.${report.post_id}] - ${report.title || "[제목 없음]"}`;
        } else {
            targetCell.textContent = "[삭제된 게시글]";
        }

        row.appendChild(targetCell);

        appendBadgeCell(row, getReportReasonLabel(report.reason), "reason");
        appendCell(row, report.nickname || "알 수 없음");
        appendDateCell(row, report.reviewed_at || report.reported_at);   // 처리일
        appendBadgeCell(
            row,
            getReportStatusLabel(report.status),
            (report.status || "").toLowerCase()
        );

                // 행을 클릭하면 신고 상세 팝업 열기
        row.style.cursor = "pointer";

        row.addEventListener("click", () => {
            showReportDetail(report);
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

// 게시글 본문(HTML)을 태그 없는 짧은 글자로 변환
// DOMParser는 스크립트를 실행하지 않아서 안전하게 글자만 꺼낼 수 있음
function toPlainText(html, maxLength = 100) {
    if (!html) return "";

    const doc = new DOMParser().parseFromString(html, "text/html");

    const text = (doc.body.textContent || "")
        .replace(/\s+/g, " ")
        .trim();

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
// 신고 상세 / 처리 팝업
// - 처리 대기 / 검토 완료 신고: 내용을 확인한 뒤 승인 또는 반려로 처리
// - 처리가 끝난 신고(처리 내역): 내용만 확인 (읽기 전용)
// ========================================
function showReportDetail(report) {
    const canProcess =
        report.status === "PENDING" || report.status === "REVIEWED";

    const hasPost =
        report.post_id !== null && report.post_id !== undefined;

    const dialog = document.createElement("dialog");
    dialog.className = "report-dialog";

    // ----- 1. 머리글: 신고 번호 + 현재 상태 -----
    const head = document.createElement("div");
    head.className = "report-dialog-head";

    const heading = document.createElement("h2");
    heading.textContent = `신고 #${report.report_id}`;

    const statusBadge = document.createElement("span");
    statusBadge.className =
        `status-badge ${(report.status || "").toLowerCase()}`;
    statusBadge.textContent = getReportStatusLabel(report.status);

    head.append(heading, statusBadge);
    dialog.appendChild(head);

    // ----- 2. 상세 정보 -----
    const list = document.createElement("dl");
    list.className = "report-detail-list";

    const addDetail = (label, value) => {
        const term = document.createElement("dt");
        term.textContent = label;

        const desc = document.createElement("dd");
        desc.textContent = String(value ?? "—");

        list.append(term, desc);
    };

    addDetail(
        "게시글 번호",
        hasPost ? `No.${report.post_id}` : "삭제된 게시글"
    );
    addDetail(
        "제목",
        hasPost ? (report.title || "[제목 없음]") : "—"
    );
    addDetail("신고 사유", getReportReasonLabel(report.reason));
    addDetail("신고자", report.nickname || "알 수 없음");
    addDetail("접수일", formatDate(report.reported_at));
    addDetail(
        "처리일",
        report.status === "PENDING"
            ? "아직 처리되지 않음"
            : formatDate(report.reviewed_at)
    );
    addDetail(
        "신고 내용",
        report.report_content || "작성된 신고 내용이 없습니다."
    );
    dialog.appendChild(list);

    // ----- 3. 원글 보기 링크 (처리할 건에서만) -----
    if (canProcess && hasPost) {
        const link = document.createElement("a");
        link.className = "report-post-link";
        link.href =
            `../community-view.html?postId=${encodeURIComponent(report.post_id)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "원글 보기 ↗";
        dialog.appendChild(link);
    }

    // ----- 4. 닫기 버튼 (공통) -----
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "dialog-button";
    closeButton.textContent = "닫기";
    closeButton.addEventListener("click", () => dialog.close());

    if (!canProcess) {
        // 처리가 끝난 신고: 닫기만 가능
        const footer = document.createElement("div");
        footer.className = "report-dialog-footer plain";

        const actions = document.createElement("div");
        actions.className = "footer-actions";
        actions.appendChild(closeButton);

        footer.appendChild(actions);
        dialog.appendChild(footer);

    } else {
        // ----- 5. 처리 방법 선택 영역 -----
        const options = [
            {
                status: "ACCEPTED",
                className: "accept",
                title: "신고 승인",
                desc: hasPost
                    ? "게시글이 숨김 처리되어 일반 사용자에게 보이지 않습니다."
                    : "이미 삭제된 게시글이라 숨길 대상은 없고, 신고만 승인 처리됩니다.",
                confirmLabel: hasPost ? "승인하고 게시글 숨기기" : "승인하기",
                confirmClass: "danger",
                doneMessage: hasPost
                    ? "신고를 승인했습니다. 게시글이 숨김 처리되었습니다."
                    : "신고를 승인했습니다."
            },
            {
                status: "REJECTED",
                className: "reject",
                title: "반려",
                desc: "게시글은 그대로 유지되고 신고만 종료됩니다.",
                confirmLabel: "반려하기",
                confirmClass: "neutral",
                doneMessage: "신고를 반려했습니다."
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
                await applyReportStatus(report.report_id, selected.status);

                dialog.close();
                showAdminToast(selected.doneMessage);

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

        // 처리 대기 건에만 "검토 중으로 표시" 보조 링크
        if (report.status === "PENDING") {
            const reviewLink = document.createElement("button");
            reviewLink.type = "button";
            reviewLink.className = "review-link";
            reviewLink.textContent = "판단이 어렵다면 '검토 중'으로 표시";

            reviewLink.addEventListener("click", async () => {
                setBusy(true);
                reviewLink.disabled = true;

                try {
                    await applyReportStatus(report.report_id, "REVIEWED");

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

    // ----- 6. 팝업 열기 / 닫기 -----
    // 팝업 바깥(어두운 배경)을 클릭하면 닫기
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

