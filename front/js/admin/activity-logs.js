/* ==================================================
   BASEBOT 관리자 - 관리자 활동 이력
   파일: front/js/admin/activity-logs.js
================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    const form = document.getElementById("activity-log-search");
    const tbody = document.getElementById("activity-log-tbody");
    const totalElement = document.getElementById("activity-log-total");
    const pagination = document.getElementById("activity-log-pagination");

    if (!form || !tbody || !totalElement || !pagination) {
        console.error("활동 로그 페이지의 HTML 요소를 찾을 수 없습니다.");
        return;
    }

    let currentPage = 1;
    const pageSize = 20;
    let totalPages = 1;
    let isLoading = false;

    /* ==================================================
       공통 함수
    ================================================== */

    function getToken() {
        return sessionStorage.getItem("access_token");
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function showTableMessage(message) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 6;
        cell.className = "table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.replaceChildren(row);
    }

    /* ==================================================
       페이지네이션
       회원 관리 페이지와 동일한 페이지 번호 방식
    ================================================== */

    function updatePagination() {
        const visibleTotalPages = Math.max(totalPages, 1);

        pagination.replaceChildren();

        // 페이지 버튼 생성
        function createPageButton(label, page, options = {}) {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "button";
            button.textContent = label;

            if (options.active) {
                button.classList.add("button-primary", "active");
                button.setAttribute("aria-current", "page");
            } else {
                button.classList.add("button-secondary");
            }

            button.disabled =
                isLoading ||
                options.disabled === true ||
                page < 1 ||
                page > totalPages;

            button.addEventListener("click", () => {
                if (
                    isLoading ||
                    page < 1 ||
                    page > totalPages ||
                    page === currentPage
                ) {
                    return;
                }

                currentPage = page;
                loadLogs();
            });

            return button;
        }

        // 이전 버튼
        pagination.appendChild(
            createPageButton("이전", currentPage - 1, {
                disabled: currentPage <= 1
            })
        );

        // 현재 페이지를 기준으로 최대 5개 페이지 번호 표시
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(visibleTotalPages, startPage + 4);

        // 마지막 페이지에 가까우면 앞쪽 페이지 번호 보정
        startPage = Math.max(1, endPage - 4);

        // 첫 페이지가 표시되지 않으면 생략 표시
        if (startPage > 1) {
            pagination.appendChild(
                createPageButton("1", 1, {
                    active: currentPage === 1
                })
            );

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
            pagination.appendChild(
                createPageButton(String(page), page, {
                    active: page === currentPage
                })
            );
        }

        // 마지막 페이지가 표시되지 않으면 생략 표시
        if (endPage < visibleTotalPages) {
            if (endPage < visibleTotalPages - 1) {
                const ellipsis = document.createElement("span");
                ellipsis.className = "pagination-ellipsis";
                ellipsis.textContent = "...";
                ellipsis.setAttribute("aria-hidden", "true");

                pagination.appendChild(ellipsis);
            }

            pagination.appendChild(
                createPageButton(
                    String(visibleTotalPages),
                    visibleTotalPages,
                    {
                        active: currentPage === visibleTotalPages
                    }
                )
            );
        }

        // 다음 버튼
        pagination.appendChild(
            createPageButton("다음", currentPage + 1, {
                disabled: currentPage >= totalPages
            })
        );
    }

    /* ==================================================
       활동 로그 조회
    ================================================== */

    async function loadLogs() {
        if (isLoading) {
            return;
        }

        isLoading = true;
        updatePagination();

        const params = new URLSearchParams({
            page: String(currentPage),
            size: String(pageSize)
        });

        const adminInput = document.getElementById("activity-log-admin");
        const actionInput = document.getElementById("activity-log-action");
        const resultInput = document.getElementById("activity-log-result");
        const startInput = document.getElementById("activity-log-start");
        const endInput = document.getElementById("activity-log-end");

        const adminUsername = adminInput?.value.trim() || "";
        const actionType = actionInput?.value || "";
        const result = resultInput?.value || "";
        const startDate = startInput?.value || "";
        const endDate = endInput?.value || "";

        if (adminUsername) {
            params.set("admin_username", adminUsername);
        }

        if (actionType) {
            params.set("action_type", actionType);
        }

        if (result) {
            params.set("result", result);
        }

        if (startDate) {
            params.set("start_date", startDate);
        }

        if (endDate) {
            params.set("end_date", endDate);
        }

        const token = getToken();

        if (!token) {
            showTableMessage("로그인이 필요합니다.");
            totalElement.textContent = "로그인 필요";

            isLoading = false;
            updatePagination();
            return;
        }

        showTableMessage("활동 이력을 불러오는 중입니다.");

        try {
            const response = await fetch(
                `/admin/activity-logs?${params.toString()}`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "application/json"
                    }
                }
            );

            if (response.status === 401) {
                sessionStorage.removeItem("access_token");

                throw new Error(
                    "로그인이 만료되었거나 인증 정보가 유효하지 않습니다."
                );
            }

            if (response.status === 403) {
                throw new Error("관리자 권한이 없습니다.");
            }

            if (!response.ok) {
                let message = `로그 조회 실패 (HTTP ${response.status})`;

                try {
                    const errorData = await response.json();
                    message = errorData.detail || message;
                } catch {
                    // 응답 본문이 JSON이 아닌 경우 기본 메시지 사용
                }

                throw new Error(message);
            }

            const data = await response.json();
            const total = Number(data.total) || 0;

            // total_pages가 정상적으로 전달되면 우선 사용
            const responseTotalPages = Number(data.total_pages);

            if (
                data.total_pages !== null &&
                data.total_pages !== undefined &&
                data.total_pages !== "" &&
                Number.isFinite(responseTotalPages)
            ) {
                totalPages = Math.max(responseTotalPages, 0);
            } else {
                totalPages = Math.ceil(total / pageSize);
            }

            // 데이터가 없어도 페이지네이션은 1페이지 기준으로 표시
            if (totalPages === 0) {
                currentPage = 1;
            } else if (currentPage > totalPages) {
                // 검색 결과가 줄어들어 현재 페이지가 범위를 벗어난 경우
                currentPage = totalPages;
                isLoading = false;
                await loadLogs();
                return;
            }

            totalElement.textContent = `총 ${total}건`;

            if (!data.items || data.items.length === 0) {
                showTableMessage("조회된 활동 이력이 없습니다.");
                return;
            }

            const rows = data.items.map((log) => {
                const createdAt = log.created_at
                    ? new Date(log.created_at).toLocaleString("ko-KR")
                    : "-";

                const target = [
                    log.target_type,
                    log.target_name,
                    log.target_id
                ].filter(
                    (value) =>
                        value !== null &&
                        value !== undefined &&
                        value !== ""
                );

                const actionLabel = {
                    USER: "회원 관리",
                    COMMUNITY: "커뮤니티 관리",
                    BASEBALL_DATA: "야구 데이터 관리",
                    NOTICE: "공지사항 관리",
                    CHATBOT: "챗봇 관리"
                }[log.action_type] || log.action_type || "-";

                const resultLabel =
                    log.result === "SUCCESS" ? "성공" : "실패";

                return `
                    <tr>
                        <td>${escapeHtml(createdAt)}</td>
                        <td>${escapeHtml(log.admin_username || "-")}</td>
                        <td>${escapeHtml(actionLabel)}</td>
                        <td>${escapeHtml(target.join(" / ") || "-")}</td>
                        <td title="${escapeHtml(log.error_message || "")}">
                            ${escapeHtml(log.description || "-")}
                        </td>
                        <td>${escapeHtml(resultLabel)}</td>
                    </tr>
                `;
            });

            tbody.innerHTML = rows.join("");

        } catch (error) {
            console.error("활동 로그 조회 오류:", error);

            showTableMessage(error.message);
            totalElement.textContent = "로그 조회 실패";

            if (
                error.message.includes("로그인이 만료") ||
                error.message === "관리자 권한이 없습니다."
            ) {
                alert(error.message);

                if (error.message.includes("로그인이 만료")) {
                    window.location.href = "/login.html";
                }
            }

        } finally {
            isLoading = false;
            updatePagination();
        }
    }

    /* ==================================================
       검색
    ================================================== */

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const startDate =
            document.getElementById("activity-log-start")?.value || "";

        const endDate =
            document.getElementById("activity-log-end")?.value || "";

        if (startDate && endDate && startDate > endDate) {
            alert("시작일은 종료일보다 늦을 수 없습니다.");
            return;
        }

        currentPage = 1;
        loadLogs();
    });

    /* ==================================================
       초기 실행
    ================================================== */

    updatePagination();
    loadLogs();
});