
/* ========================================
   BASEBOT 관리자 - 커뮤니티 관리
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";

document.addEventListener("DOMContentLoaded", () => {
    setupCommunitySearch();
    loadAdminCommunityData();
});

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

async function requestAdminAPI(endpoint) {
    const token = sessionStorage.getItem("access_token");

    if (!token) {
        throw new Error(
            "로그인 정보가 없습니다. 관리자 계정으로 로그인해 주세요."
        );
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("로그인이 만료되었거나 인증 정보가 올바르지 않습니다.");
        }

        if (response.status === 403) {
            throw new Error("관리자 계정만 접근할 수 있습니다.");
        }

        throw new Error(`API 요청 실패: HTTP ${response.status}`);
    }

    return await response.json();
}

// ========================================
// 게시글 / 댓글 / 신고 데이터 불러오기
// ========================================

async function loadAdminCommunityData() {
    const searchForm = document.querySelector(".filter-form");

    if (!searchForm) return;

    const type = searchForm.querySelector('[name="type"]').value;
    const reportStatus = searchForm.querySelector(
        '[name="report_status"]'
    ).value;
    const keyword = searchForm.querySelector(
        '[name="keyword"]'
    ).value.trim();

    const contentPanel = document.querySelectorAll(
        ".admin-content > .panel"
    )[1];

    const reportPanel = document.querySelectorAll(
        ".admin-content > .panel"
    )[2];

    // 선택한 콘텐츠 유형에 따라 표 표시
    if (contentPanel) {
        contentPanel.hidden = type === "report";
    }

    if (reportPanel) {
        reportPanel.hidden = type === "post" || type === "comment";
    }

    try {
        const params = new URLSearchParams();

        if (keyword) {
            params.set("keyword", keyword);
        }

        const queryString = params.toString();
        const suffix = queryString ? `?${queryString}` : "";

        // 게시글 및 댓글 목록
        if (type === "all" || type === "post" || type === "comment") {
            const requests = [];

            if (type === "all" || type === "post") {
                requests.push(
                    requestAdminAPI(`/admin/community/posts${suffix}`)
                        .then(data => ({ kind: "posts", data }))
                );
            }

            if (type === "all" || type === "comment") {
                requests.push(
                    requestAdminAPI(`/admin/community/comments${suffix}`)
                        .then(data => ({ kind: "comments", data }))
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
        } else {
            renderContentTable([]);
        }

        // 신고 목록
        if (type === "all" || type === "report") {
            const reportParams = new URLSearchParams();

            if (keyword) {
                reportParams.set("keyword", keyword);
            }

            if (reportStatus) {
                reportParams.set("report_status", reportStatus);
            }

            const reportQuery = reportParams.toString();
            const reportSuffix = reportQuery ? `?${reportQuery}` : "";

            const reportData = await requestAdminAPI(
                `/admin/community/reports${reportSuffix}`
            );

            renderReportTable(reportData);
        } else {
            renderReportTable({ items: [], total: 0, pending_count: 0 });
        }

    } catch (error) {
        console.error("관리자 커뮤니티 데이터 조회 실패:", error);
        showCommunityError(error.message);
    }
}

// ========================================
// 게시글 및 댓글 표 출력
// ========================================

function renderContentTable(items) {
    const panels = document.querySelectorAll(
        ".admin-content > .panel"
    );

    const panel = panels[1];

    if (!panel) return;

    const tbody = panel.querySelector("tbody");
    const countLabel = panel.querySelector(".count-label");

    tbody.replaceChildren();

    if (countLabel) {
        countLabel.textContent = `총 ${items.length}건`;
    }

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(7, "표시할 콘텐츠가 없습니다.")
        );
        return;
    }

    // 최신 작성일 순으로 정렬
    items.sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
    });

    for (const item of items) {
        const row = document.createElement("tr");

        appendCell(row, item.type === "post" ? "게시글" : "댓글");

        const titleCell = document.createElement("td");
        const title = document.createElement("div");
        title.textContent = item.title || "(제목 없음)";

        const content = document.createElement("small");
        content.textContent = item.content || "";

        titleCell.append(title, content);
        row.appendChild(titleCell);

        appendCell(row, item.nickname || "알 수 없음");
        appendCell(row, formatDate(item.created_at));
        appendCell(row, item.report_count ?? 0);
        appendCell(row, getContentStatusLabel(item.status));

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
    const panels = document.querySelectorAll(
        ".admin-content > .panel"
    );

    const panel = panels[2];

    if (!panel) return;

    const tbody = panel.querySelector("tbody");
    const headingTag = panel.querySelector(".panel-heading .tag");
    const items = data.items || [];

    tbody.replaceChildren();

    if (headingTag) {
        headingTag.textContent =
            `처리 대기 ${data.pending_count ?? 0}건`;
    }

    if (items.length === 0) {
        tbody.appendChild(
            createEmptyRow(7, "신고 데이터가 없습니다.")
        );
        return;
    }

    for (const report of items) {
        const row = document.createElement("tr");

        appendCell(row, report.report_id);
        appendCell(row, report.title || "(삭제된 게시글)");
        appendCell(row, getReportReasonLabel(report.reason));

        const reporterCell = document.createElement("td");
        reporterCell.textContent = report.nickname || "알 수 없음";

        if (report.report_content) {
            reporterCell.title = report.report_content;
        }

        row.appendChild(reporterCell);

        appendCell(row, formatDate(report.reported_at));
        appendCell(row, getReportStatusLabel(report.status));

        const actionCell = document.createElement("td");
        actionCell.textContent = "—";
        actionCell.title = "신고 처리 API 연결 후 활성화됩니다.";
        row.appendChild(actionCell);

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

// ========================================
// 오류 메시지 표시
// ========================================

function showCommunityError(message) {
    const panels = document.querySelectorAll(
        ".admin-content > .panel"
    );

    for (const index of [1, 2]) {
        const panel = panels[index];

        if (!panel) continue;

        const tbody = panel.querySelector("tbody");

        if (!tbody) continue;

        tbody.replaceChildren();
        tbody.appendChild(
            createEmptyRow(7, message)
        );
    }
}
