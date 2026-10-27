/* ==================================================
   BASEBOT 관리자 - AI 챗봇 관리
   파일: front/js/admin/admin-chatbot.js
================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    const API_URL = "/admin/chatbot";
    const PAGE_SIZE = 10;

    const statCards = document.querySelectorAll(
        ".stat-grid .stat-card strong"
    );

    const filterForm = document.querySelector(".filter-form");
    const tableBodies = document.querySelectorAll(".table-wrap tbody");
    const tableWraps = document.querySelectorAll(".table-wrap");
    const panels = document.querySelectorAll(".panel");

    const sessionTableBody = tableBodies[0];
    const messageTableBody = tableBodies[1];
    const sessionTableWrap = tableWraps[0];

    const pagination = document.getElementById(
        "chatbot-session-pagination"
    );

    const detailPanel = Array.from(panels).find((panel) => {
        const heading = panel.querySelector(".panel-heading h2");
        return heading?.textContent.trim() === "대화 상세 내역";
    });

    if (
        !filterForm ||
        !sessionTableBody ||
        !messageTableBody ||
        !sessionTableWrap ||
        !detailPanel ||
        !pagination ||
        statCards.length < 4
    ) {
        console.error("AI 챗봇 관리 HTML 요소를 찾을 수 없습니다.");
        return;
    }

    const token = sessionStorage.getItem("access_token");

    if (!token) {
        alert("로그인이 필요합니다.");
        window.location.href = "/login.html";
        return;
    }

    let currentPage = 1;
    let totalPages = 1;
    let totalSessions = 0;
    let selectedSessionId = null;
    let isLoading = false;
    let isDeleting = false;

    const detailButtons = detailPanel.querySelectorAll(
        ".button-row button"
    );

    const closeButton = detailButtons[0];
    const deleteButton = detailButtons[1];

    if (!closeButton || !deleteButton) {
        console.error("대화 상세 내역의 버튼을 찾을 수 없습니다.");
        return;
    }

    /* ==================================================
       초기 레이아웃
       페이지네이션 크기와 간격은 admin.css에서 관리
    ================================================== */

    detailPanel.hidden = true;
    deleteButton.disabled = true;

    pagination.classList.add("admin-pagination");

    const sessionListArea = document.createElement("div");
    sessionListArea.className = "session-list-area";

    sessionTableWrap.parentElement.insertBefore(
        sessionListArea,
        sessionTableWrap
    );

    sessionListArea.appendChild(sessionTableWrap);
    sessionListArea.appendChild(pagination);

    Object.assign(sessionListArea.style, {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: "0",
        height: "680px",
        minHeight: "0",
        boxSizing: "border-box"
    });

    Object.assign(sessionTableWrap.style, {
        flex: "1 1 0",
        height: "0",
        minHeight: "0",
        width: "100%",
        minWidth: "0",
        overflowY: "auto",
        overflowX: "auto",
        boxSizing: "border-box"
    });

    /* ==================================================
       공통 함수
    ================================================== */

    function setText(element, value) {
        element.textContent =
            value === null ||
            value === undefined ||
            value === ""
                ? "-"
                : String(value);
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleString("ko-KR");
    }

    function createButton(
        label,
        className,
        onClick,
        disabled = false
    ) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.disabled = disabled;

        button.addEventListener("click", onClick);

        return button;
    }

    function showTableMessage(tbody, message, colSpan) {
        tbody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = colSpan;
        cell.className = "table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    /* ==================================================
       API 요청
    ================================================== */

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${sessionStorage.getItem("access_token") || token}`,
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            sessionStorage.removeItem("access_token");

            alert(
                "로그인이 만료되었거나 인증 정보가 유효하지 않습니다."
            );

            window.location.href = "/login.html";

            throw new Error("인증 실패");
        }

        if (response.status === 403) {
            throw new Error("관리자 권한이 없습니다.");
        }

        if (!response.ok) {
            throw new Error(
                data.detail || `API 오류 (${response.status})`
            );
        }

        return data;
    }

    /* ==================================================
       통계 조회
    ================================================== */

    async function loadStats() {
        try {
            const result = await apiRequest(`${API_URL}/stats`);

            setText(statCards[0], result.session_count);
            setText(statCards[1], result.total_messages);
            setText(statCards[2], result.user_questions);
            setText(statCards[3], result.assistant_answers);

        } catch (error) {
            console.error("챗봇 통계 조회 실패:", error);

            statCards.forEach((element) => {
                element.textContent = "-";
            });
        }
    }

    /* ==================================================
       대화 세션 목록 조회
    ================================================== */

    async function loadSessions() {
        if (isLoading) {
            return;
        }

        isLoading = true;
        renderPagination();

        showTableMessage(
            sessionTableBody,
            "대화 기록을 불러오는 중입니다.",
            7
        );

        try {
            const formData = new FormData(filterForm);
            const params = new URLSearchParams();

            const sessionId = formData.get("session_id")?.trim();
            const userId = formData.get("user_id")?.trim();
            const title = formData.get("title")?.trim();
            const startDate = formData.get("start_date");
            const endDate = formData.get("end_date");

            if (sessionId) {
                params.set("session_id", sessionId);
            }

            if (userId) {
                params.set("user_id", userId);
            }

            if (title) {
                params.set("title", title);
            }

            if (startDate) {
                params.set("start_date", startDate);
            }

            if (endDate) {
                params.set("end_date", endDate);
            }

            params.set("limit", String(PAGE_SIZE));
            params.set(
                "offset",
                String((currentPage - 1) * PAGE_SIZE)
            );

            const result = await apiRequest(
                `${API_URL}/sessions?${params.toString()}`
            );

            totalSessions = Number(result.total) || 0;

            totalPages = Math.max(
                1,
                Math.ceil(totalSessions / PAGE_SIZE)
            );

            // 검색 결과가 줄어 현재 페이지가 범위를 벗어나면 마지막 페이지로 이동
            if (currentPage > totalPages) {
                currentPage = totalPages;
                isLoading = false;

                await loadSessions();
                return;
            }

            sessionTableBody.replaceChildren();

            if (!Array.isArray(result.items) || result.items.length === 0) {
                showTableMessage(
                    sessionTableBody,
                    "검색 결과가 없습니다.",
                    7
                );

                return;
            }

            result.items.forEach((session) => {
                const row = document.createElement("tr");

                const values = [
                    session.session_id,
                    session.user_id,
                    session.title,
                    session.message_count,
                    formatDate(session.last_message_at),
                    formatDate(session.created_at)
                ];

                values.forEach((value) => {
                    const cell = document.createElement("td");

                    setText(cell, value);
                    row.appendChild(cell);
                });

                const actionCell = document.createElement("td");

                const detailButton = createButton(
                    "상세",
                    "button button-secondary",
                    () => loadSessionDetail(session.session_id)
                );

                actionCell.appendChild(detailButton);
                row.appendChild(actionCell);

                sessionTableBody.appendChild(row);
            });

        } catch (error) {
            console.error("대화 세션 조회 실패:", error);

            showTableMessage(
                sessionTableBody,
                error.message,
                7
            );

        } finally {
            isLoading = false;
            renderPagination();
        }
    }

    /* ==================================================
       페이지네이션
       이전 / 페이지 번호 최대 5개 / 다음
       스타일은 admin.css의 공통 스타일 사용
    ================================================== */

    function renderPagination() {
        pagination.replaceChildren();

        const visibleTotalPages = Math.max(totalPages, 1);
        const visiblePageCount = 5;

        function addPageButton(label, page, options = {}) {
            const button = createButton(
                label,
                options.active
                    ? "button button-primary active"
                    : "button button-secondary",
                () => goToPage(page),
                isLoading ||
                    options.disabled === true ||
                    page < 1 ||
                    page > totalPages ||
                    page === currentPage
            );

            if (options.active) {
                button.setAttribute("aria-current", "page");
            }

            pagination.appendChild(button);
        }

        // 이전 버튼
        addPageButton("이전", currentPage - 1, {
            disabled: currentPage <= 1
        });

        // 현재 페이지 기준으로 최대 5개 번호 표시
        let startPage = Math.max(
            1,
            currentPage - Math.floor(visiblePageCount / 2)
        );

        let endPage = Math.min(
            visibleTotalPages,
            startPage + visiblePageCount - 1
        );

        startPage = Math.max(
            1,
            endPage - visiblePageCount + 1
        );

        // 첫 페이지 및 생략 표시
        if (startPage > 1) {
            addPageButton("1", 1, {
                active: currentPage === 1
            });

            if (startPage > 2) {
                const ellipsis = document.createElement("span");
                ellipsis.className = "pagination-ellipsis";
                ellipsis.textContent = "...";
                ellipsis.setAttribute("aria-hidden", "true");

                pagination.appendChild(ellipsis);
            }
        }

        // 페이지 번호 버튼
        for (let page = startPage; page <= endPage; page++) {
            addPageButton(String(page), page, {
                active: page === currentPage
            });
        }

        // 마지막 페이지 및 생략 표시
        if (endPage < visibleTotalPages) {
            if (endPage < visibleTotalPages - 1) {
                const ellipsis = document.createElement("span");
                ellipsis.className = "pagination-ellipsis";
                ellipsis.textContent = "...";
                ellipsis.setAttribute("aria-hidden", "true");

                pagination.appendChild(ellipsis);
            }

            addPageButton(
                String(visibleTotalPages),
                visibleTotalPages,
                {
                    active: currentPage === visibleTotalPages
                }
            );
        }

        // 다음 버튼
        addPageButton("다음", currentPage + 1, {
            disabled: currentPage >= totalPages
        });
    }

    function goToPage(page) {
        if (
            isLoading ||
            page < 1 ||
            page > totalPages ||
            page === currentPage
        ) {
            return;
        }

        currentPage = page;
        loadSessions();
    }

    /* ==================================================
       대화 상세 조회
    ================================================== */

    async function loadSessionDetail(sessionId) {
        selectedSessionId = sessionId;
        deleteButton.disabled = true;

        detailPanel.hidden = false;

        const detailHeading = detailPanel.querySelector(
            ".panel-heading p"
        );

        if (detailHeading) {
            detailHeading.textContent =
                `세션 ${sessionId}의 메시지를 불러오는 중입니다.`;
        }

        showTableMessage(
            messageTableBody,
            "메시지를 불러오는 중입니다.",
            5
        );

        detailPanel.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        try {
            const result = await apiRequest(
                `${API_URL}/sessions/${encodeURIComponent(sessionId)}/messages`
            );

            if (selectedSessionId !== sessionId) {
                return;
            }

            if (detailHeading) {
                detailHeading.textContent =
                    "선택한 세션의 사용자 질문과 AI 응답을 확인합니다.";
            }

            messageTableBody.replaceChildren();

            if (!result.session) {
                throw new Error("대화 세션을 찾을 수 없습니다.");
            }

            if (
                !Array.isArray(result.messages) ||
                result.messages.length === 0
            ) {
                showTableMessage(
                    messageTableBody,
                    "등록된 메시지가 없습니다.",
                    5
                );
            } else {
                result.messages.forEach((message) => {
                    const row = document.createElement("tr");

                    const values = [
                        message.message_id,
                        message.role === "USER" ? "사용자" : "AI 응답",
                        message.content,
                        message.generated_sql,
                        formatDate(message.created_at)
                    ];

                    values.forEach((value) => {
                        const cell = document.createElement("td");

                        setText(cell, value);
                        row.appendChild(cell);
                    });

                    messageTableBody.appendChild(row);
                });
            }

            deleteButton.disabled = false;

        } catch (error) {
            console.error("대화 상세 조회 실패:", error);

            if (selectedSessionId === sessionId) {
                showTableMessage(
                    messageTableBody,
                    error.message,
                    5
                );

                deleteButton.disabled = true;
            }
        }
    }

    /* ==================================================
       상세 내역 닫기
    ================================================== */

    closeButton.addEventListener("click", () => {
        detailPanel.hidden = true;
        selectedSessionId = null;
        deleteButton.disabled = true;
    });

    /* ==================================================
       세션 삭제
    ================================================== */

    deleteButton.addEventListener("click", async () => {
        if (!selectedSessionId || isDeleting) {
            alert("삭제할 대화 세션을 선택해 주세요.");
            return;
        }

        const confirmed = confirm(
            "이 대화 세션을 삭제하시겠습니까?\n" +
            "연결된 모든 메시지도 함께 삭제됩니다."
        );

        if (!confirmed) {
            return;
        }

        isDeleting = true;
        deleteButton.disabled = true;

        try {
            const result = await apiRequest(
                `${API_URL}/sessions/${encodeURIComponent(selectedSessionId)}`,
                {
                    method: "DELETE"
                }
            );

            alert(result.message || "대화 세션이 삭제되었습니다.");

            detailPanel.hidden = true;
            selectedSessionId = null;
            currentPage = 1;

            await Promise.all([
                loadStats(),
                loadSessions()
            ]);

        } catch (error) {
            console.error("대화 세션 삭제 실패:", error);
            alert(error.message);

        } finally {
            isDeleting = false;

            if (selectedSessionId) {
                deleteButton.disabled = false;
            }
        }
    });

    /* ==================================================
       검색 및 초기화
    ================================================== */

    filterForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const formData = new FormData(filterForm);
        const startDate = formData.get("start_date");
        const endDate = formData.get("end_date");

        if (startDate && endDate && startDate > endDate) {
            alert("시작일은 종료일보다 늦을 수 없습니다.");
            return;
        }

        currentPage = 1;
        loadSessions();
    });

    filterForm.addEventListener("reset", () => {
        setTimeout(() => {
            currentPage = 1;
            loadSessions();
        }, 0);
    });

    /* ==================================================
       초기 실행
    ================================================== */

    renderPagination();
    loadStats();
    loadSessions();
});