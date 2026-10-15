/* ==================================================
   BASEBOT 관리자 - AI 챗봇 관리
   파일: front/js/admin/admin-chatbot.js
================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const API_URL = "/admin/chatbot";
    const PAGE_SIZE = 10;

    const token = sessionStorage.getItem("access_token");

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
        statCards.length < 4
    ) {
        console.error(
            "AI 챗봇 관리 HTML 요소를 찾을 수 없습니다."
        );
        return;
    }

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

    const detailButtons = detailPanel.querySelectorAll(
        ".button-row button"
    );

    const closeButton = detailButtons[0];
    const deleteButton = detailButtons[1];

    if (!closeButton || !deleteButton) {
        console.error(
            "대화 상세 내역의 버튼을 찾을 수 없습니다."
        );
        return;
    }

    // 상세 내역은 세션을 선택한 뒤 표시
    detailPanel.hidden = true;
    deleteButton.disabled = true;

    /* ==================================================
       페이징 영역 설정
    ================================================== */

    const pagination = document.getElementById(
        "chatbot-session-pagination"
    );

    if (!pagination) {
        console.error("챗봇 페이징 영역을 찾을 수 없습니다.");
        return;
    }

    /*
       세션 테이블과 페이지네이션을 하나의 영역으로 구성합니다.
       기존 HTML 파일은 수정하지 않습니다.
    */
    const sessionListArea = document.createElement("div");

    sessionListArea.className = "session-list-area";

    sessionTableWrap.parentElement.insertBefore(
        sessionListArea,
        sessionTableWrap
    );

    sessionListArea.appendChild(sessionTableWrap);
    sessionListArea.appendChild(pagination);

    /*
       목록 영역의 전체 높이를 고정합니다.
       테이블 영역만 스크롤되며 페이지네이션은 아래쪽에 유지됩니다.
    */
    sessionListArea.style.display = "flex";
    sessionListArea.style.flexDirection = "column";
    sessionListArea.style.width = "100%";
    sessionListArea.style.height = "680px";
    sessionListArea.style.minHeight = "680px";
    sessionListArea.style.boxSizing = "border-box";
    sessionListArea.style.minWidth = "0";

    // 테이블 영역은 남은 공간을 사용하고, 내용은 내부에서 스크롤
    sessionTableWrap.style.flex = "1 1 0";
    sessionTableWrap.style.height = "0";
    sessionTableWrap.style.minHeight = "0";
    sessionTableWrap.style.width = "100%";
    sessionTableWrap.style.minWidth = "0";
    sessionTableWrap.style.overflowY = "auto";
    sessionTableWrap.style.overflowX = "auto";
    sessionTableWrap.style.boxSizing = "border-box";

    // 페이지네이션은 항상 아래쪽에 고정하고 가운데 정렬
    pagination.style.display = "flex";
    pagination.style.flex = "0 0 64px";
    pagination.style.width = "100%";
    pagination.style.height = "64px";
    pagination.style.minHeight = "64px";
    pagination.style.justifyContent = "center";
    pagination.style.alignItems = "center";
    pagination.style.flexWrap = "wrap";
    pagination.style.gap = "8px";
    pagination.style.margin = "0";
    pagination.style.padding = "16px 0 0";
    pagination.style.boxSizing = "border-box";

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
                Authorization: `Bearer ${token}`,
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
            const result = await apiRequest(
                `${API_URL}/stats`
            );

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

        showTableMessage(
            sessionTableBody,
            "대화 기록을 불러오는 중입니다.",
            7
        );

        pagination.replaceChildren();

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

            totalSessions = result.total || 0;

            totalPages = Math.max(
                1,
                Math.ceil(totalSessions / PAGE_SIZE)
            );

            // 삭제 또는 검색 결과 감소로 페이지 범위를 벗어난 경우
            if (currentPage > totalPages) {
                currentPage = totalPages;
                isLoading = false;

                await loadSessions();
                return;
            }

            sessionTableBody.replaceChildren();

            if (!result.items || result.items.length === 0) {
                showTableMessage(
                    sessionTableBody,
                    "검색 결과가 없습니다.",
                    7
                );

                renderPagination();
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

            renderPagination();

        } catch (error) {
            console.error("대화 세션 조회 실패:", error);

            showTableMessage(
                sessionTableBody,
                error.message,
                7
            );

            pagination.replaceChildren();
            pagination.style.visibility = "hidden";

        } finally {
            isLoading = false;
        }
    }

    /* ==================================================
       페이지 이동
    ================================================== */

    function renderPagination() {
        pagination.replaceChildren();

        // 렌더링할 때도 고정 레이아웃 유지
        pagination.style.display = "flex";
        pagination.style.flex = "0 0 64px";
        pagination.style.width = "100%";
        pagination.style.height = "64px";
        pagination.style.minHeight = "64px";
        pagination.style.justifyContent = "center";
        pagination.style.alignItems = "center";
        pagination.style.flexWrap = "wrap";
        pagination.style.gap = "8px";
        pagination.style.margin = "0";
        pagination.style.padding = "16px 0 0";
        pagination.style.boxSizing = "border-box";

        // 데이터가 없거나 페이지가 하나뿐이어도 공간은 유지
        if (totalSessions === 0 || totalPages <= 1) {
            pagination.style.visibility = "hidden";
            return;
        }

        pagination.style.visibility = "visible";

        // 이전 버튼
        pagination.appendChild(
            createButton(
                "이전",
                "button button-secondary",
                () => goToPage(currentPage - 1),
                currentPage === 1
            )
        );

        // 페이지 번호
        for (let page = 1; page <= totalPages; page++) {
            pagination.appendChild(
                createButton(
                    String(page),
                    page === currentPage
                        ? "button button-primary"
                        : "button button-secondary",
                    () => goToPage(page),
                    page === currentPage
                )
            );
        }

        // 다음 버튼
        pagination.appendChild(
            createButton(
                "다음",
                "button button-secondary",
                () => goToPage(currentPage + 1),
                currentPage === totalPages
            )
        );
    }

    function goToPage(page) {
        if (
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

            const session = result.session;

            if (detailHeading) {
                detailHeading.textContent =
                    "선택한 세션의 사용자 질문과 AI 응답을 확인합니다.";
            }

            messageTableBody.replaceChildren();

            if (!session) {
                throw new Error("대화 세션을 찾을 수 없습니다.");
            }

            if (!result.messages || result.messages.length === 0) {
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
                        message.role === "USER"
                            ? "사용자"
                            : "AI 응답",
                        message.content,
                        message.generated_sql,
                        formatDate(message.created_at)
                    ];

                    values.forEach((value) => {
                        const cell = document.createElement("td");

                        // 사용자 입력을 HTML로 해석하지 않도록 textContent 사용
                        setText(cell, value);

                        row.appendChild(cell);
                    });

                    messageTableBody.appendChild(row);
                });
            }

            deleteButton.disabled = false;

        } catch (error) {
            console.error("대화 상세 조회 실패:", error);

            showTableMessage(
                messageTableBody,
                error.message,
                5
            );

            deleteButton.disabled = true;
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
        if (!selectedSessionId) {
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

            deleteButton.disabled = false;
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

    loadStats();
    loadSessions();
});