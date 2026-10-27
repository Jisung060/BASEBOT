/* ==================================================
   BASEBOT 관리자 - 회원 관리
   파일: front/js/admin/admin-users.js
================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    const API_URL = "/admin/users";
    const PAGE_SIZE = 10;

    const filterForm = document.querySelector(".filter-form");
    const tableBody = document.querySelector(".table-wrap tbody");
    const countLabel = document.querySelector(".count-label");
    const detailArea = document.querySelector(".detail-placeholder");
    const pagination = document.getElementById("users-pagination");

    let currentPage = 1;
    let totalPages = 1;
    let totalUsers = 0;
    let isLoading = false;
    let isDetailLoading = false;
    let selectedUserId = null;

    if (
        !filterForm ||
        !tableBody ||
        !countLabel ||
        !detailArea ||
        !pagination
    ) {
        console.error("회원 관리 HTML 요소를 찾을 수 없습니다.");
        return;
    }

    if (!sessionStorage.getItem("access_token")) {
        alert("로그인이 필요합니다.");
        window.location.href = "/login.html";
        return;
    }

    // 공통 CSS에서 페이지네이션 레이아웃 관리
    pagination.classList.add("admin-pagination");
    pagination.setAttribute("aria-label", "회원 목록 페이지 이동");

    /* ==================================================
       공통 함수
    ================================================== */

    function getToken() {
        return sessionStorage.getItem("access_token");
    }

    function setText(element, value) {
        element.textContent =
            value === null || value === undefined || value === ""
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

    function getStatusLabel(value) {
        const labels = {
            ACTIVE: "정상",
            RESTRICTED: "활동 정지",
            WITHDRAWN: "탈퇴"
        };

        return labels[value] || value || "-";
    }

    function createButton(
        text,
        className,
        onClick,
        disabled = false
    ) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = className;
        button.textContent = text;
        button.disabled = disabled;
        button.addEventListener("click", onClick);

        return button;
    }

    /* ==================================================
       API 요청
    ================================================== */

    async function apiRequest(url) {
        const token = getToken();

        if (!token) {
            sessionStorage.removeItem("access_token");
            window.location.href = "/login.html";
            throw new Error("로그인이 필요합니다.");
        }

        const response = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json"
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            sessionStorage.removeItem("access_token");

            alert("로그인이 만료되었거나 인증 정보가 유효하지 않습니다.");
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
       테이블 메시지
    ================================================== */

    function showTableMessage(message) {
        tableBody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 9;
        cell.className = "table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tableBody.appendChild(row);
    }

    /* ==================================================
       회원 목록 조회
    ================================================== */

    async function loadUsers() {
        if (isLoading) {
            return;
        }

        isLoading = true;

        showTableMessage("회원 정보를 불러오는 중입니다.");
        countLabel.textContent = "조회 중...";
        renderPagination();

        const formData = new FormData(filterForm);
        const params = new URLSearchParams();

        const keyword = formData.get("keyword")?.trim();
        const role = formData.get("role");
        const accountStatus = formData.get("status");

        if (keyword) {
            params.set("keyword", keyword);
        }

        if (role) {
            params.set("role", role);
        }

        if (accountStatus) {
            params.set("status", accountStatus);
        }

        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String((currentPage - 1) * PAGE_SIZE));

        try {
            const result = await apiRequest(
                `${API_URL}?${params.toString()}`
            );

            totalUsers = Number(result.total) || 0;

            totalPages = Math.max(
                1,
                Math.ceil(totalUsers / PAGE_SIZE)
            );

            // 검색 결과가 줄어 현재 페이지를 벗어난 경우
            if (currentPage > totalPages) {
                currentPage = totalPages;
                isLoading = false;

                await loadUsers();
                return;
            }

            countLabel.textContent = `총 ${totalUsers}명`;
            tableBody.replaceChildren();

            if (!Array.isArray(result.items) || result.items.length === 0) {
                showTableMessage("검색 결과가 없습니다.");
                return;
            }

            result.items.forEach((user) => {
                const row = document.createElement("tr");

                const values = [
                    user.user_id,
                    user.username,
                    user.nickname,
                    user.email,
                    user.role,
                    user.grade,
                    getStatusLabel(user.status),
                    formatDate(user.created_at)
                ];

                values.forEach((value) => {
                    const cell = document.createElement("td");

                    setText(cell, value);
                    row.appendChild(cell);
                });

                const actionCell = document.createElement("td");

                const detailButton = createButton(
                    "상세 보기",
                    "button button-secondary",
                    () => loadUserDetail(user.user_id)
                );

                actionCell.appendChild(detailButton);
                row.appendChild(actionCell);
                tableBody.appendChild(row);
            });

        } catch (error) {
            console.error("회원 목록 조회 실패:", error);

            countLabel.textContent = "조회 실패";
            showTableMessage(error.message);

        } finally {
            isLoading = false;
            renderPagination();
        }
    }

    /* ==================================================
       페이지네이션
       이전 / 페이지 번호 최대 5개 / 다음
    ================================================== */

    function renderPagination() {
        pagination.replaceChildren();

        const visibleTotalPages = Math.max(totalPages, 1);
        const visiblePageCount = 5;

        function addPageButton(label, page, options = {}) {
            const isActive = options.active === true;

            const button = createButton(
                label,
                isActive
                    ? "button button-primary active"
                    : "button button-secondary",
                () => goToPage(page),
                isLoading ||
                    options.disabled === true ||
                    page < 1 ||
                    page > totalPages ||
                    page === currentPage
            );

            if (isActive) {
                button.setAttribute("aria-current", "page");
            }

            pagination.appendChild(button);
        }

        // 이전 버튼
        addPageButton("이전", currentPage - 1, {
            disabled: currentPage <= 1
        });

        // 현재 페이지를 기준으로 최대 5개 번호 표시
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

        // 첫 페이지와 생략 표시
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

        // 페이지 번호
        for (let page = startPage; page <= endPage; page++) {
            addPageButton(String(page), page, {
                active: page === currentPage
            });
        }

        // 마지막 페이지와 생략 표시
        if (endPage < visibleTotalPages) {
            if (endPage < visibleTotalPages - 1) {
                const ellipsis = document.createElement("span");
                ellipsis.className = "pagination-ellipsis";
                ellipsis.textContent = "...";
                ellipsis.setAttribute("aria-hidden", "true");

                pagination.appendChild(ellipsis);
            }

            addPageButton(String(visibleTotalPages), visibleTotalPages, {
                active: currentPage === visibleTotalPages
            });
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
        loadUsers();
    }

    /* ==================================================
       회원 상세 조회
    ================================================== */

    async function loadUserDetail(userId) {
        if (isDetailLoading) {
            return;
        }

        isDetailLoading = true;
        selectedUserId = userId;

        detailArea.textContent = "회원 상세 정보를 불러오는 중입니다.";

        try {
            const user = await apiRequest(
                `${API_URL}/${encodeURIComponent(userId)}`
            );

            // 요청 중 다른 회원을 선택했다면 이전 결과는 표시하지 않음
            if (selectedUserId !== userId) {
                return;
            }

            detailArea.replaceChildren();

            const title = document.createElement("h3");
            title.textContent = `${user.nickname || user.username} 회원 정보`;

            detailArea.appendChild(title);

            const details = [
                ["회원 ID", user.user_id],
                ["아이디", user.username],
                ["닉네임", user.nickname],
                ["이메일", user.email],
                ["권한", user.role],
                ["등급", user.grade],
                ["계정 상태", getStatusLabel(user.status)],
                ["보유 포인트", user.point],
                ["관심 팀 ID", user.favorite_team_id],
                ["현재 예측 연속 적중", user.prediction_streak],
                ["최대 예측 연속 적중", user.max_prediction_streak],
                ["가입일", formatDate(user.created_at)],
                ["최근 정보 수정일", formatDate(user.updated_at)]
            ];

            const list = document.createElement("dl");

            details.forEach(([label, value]) => {
                const term = document.createElement("dt");
                const description = document.createElement("dd");

                term.textContent = label;
                setText(description, value);

                list.appendChild(term);
                list.appendChild(description);
            });

            detailArea.appendChild(list);

            detailArea.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        } catch (error) {
            console.error("회원 상세 조회 실패:", error);

            if (selectedUserId === userId) {
                detailArea.textContent = error.message;
            }

        } finally {
            isDetailLoading = false;
        }
    }

    /* ==================================================
       검색 및 초기화
    ================================================== */

    filterForm.addEventListener("submit", (event) => {
        event.preventDefault();

        currentPage = 1;
        loadUsers();
    });

    filterForm.addEventListener("reset", () => {
        setTimeout(() => {
            currentPage = 1;
            loadUsers();
        }, 0);
    });

    /* ==================================================
       초기 실행
    ================================================== */

    renderPagination();
    loadUsers();
});