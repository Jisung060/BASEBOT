
/* ==================================================
   BASEBOT 관리자 - 회원 관리
   파일: front/js/admin/admin-users.js
================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const API_URL = "/admin/users";
    const PAGE_SIZE = 10;

    const token = sessionStorage.getItem("access_token");

    const filterForm = document.querySelector(".filter-form");
    const tableBody = document.querySelector(".table-wrap tbody");
    const countLabel = document.querySelector(".count-label");
    const detailArea = document.querySelector(".detail-placeholder");
    const pagination = document.getElementById("users-pagination");

    let currentPage = 1;
    let totalPages = 1;
    let totalUsers = 0;
    let isLoading = false;

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

    if (!token) {
        alert("로그인이 필요합니다.");
        window.location.href = "/login.html";
        return;
    }

    /* ==================================================
       공통 함수
    ================================================== */

    function setText(element, value) {
        element.textContent =
            value === null || value === undefined || value === ""
                ? "-"
                : String(value);
    }

    function formatDate(value) {
        if (!value) return "-";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
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

    function createButton(text, className, onClick, disabled = false) {
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
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json"
            }
        });

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
            const errorData = await response.json().catch(() => ({}));

            throw new Error(
                errorData.detail || `API 오류 (${response.status})`
            );
        }

        return response.json();
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
        if (isLoading) return;

        isLoading = true;

        showTableMessage("회원 정보를 불러오는 중입니다.");
        countLabel.textContent = "조회 중...";
        pagination.replaceChildren();

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

        // 현재 페이지에 필요한 회원만 조회
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String((currentPage - 1) * PAGE_SIZE));

        try {
            const result = await apiRequest(
                `${API_URL}?${params.toString()}`
            );

            totalUsers = result.total ?? 0;
            totalPages = Math.max(
                1,
                Math.ceil(totalUsers / PAGE_SIZE)
            );

            // 회원이 삭제되는 등의 이유로 현재 페이지가
            // 마지막 페이지를 벗어난 경우 마지막 페이지로 이동
            if (currentPage > totalPages) {
                currentPage = totalPages;
                isLoading = false;
                await loadUsers();
                return;
            }

            countLabel.textContent = `총 ${totalUsers}명`;
            tableBody.replaceChildren();

            if (!result.items || result.items.length === 0) {
                showTableMessage("검색 결과가 없습니다.");
                renderPagination();
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

            renderPagination();

        } catch (error) {
            console.error("회원 목록 조회 실패:", error);

            countLabel.textContent = "조회 실패";
            showTableMessage(error.message);
            pagination.replaceChildren();

        } finally {
            isLoading = false;
        }
    }

    /* ==================================================
       페이징 버튼 생성
    ================================================== */

    function renderPagination() {
        pagination.replaceChildren();

        // 결과가 없거나 한 페이지뿐이면 페이지 이동 버튼 숨김
        if (totalUsers === 0 || totalPages <= 1) {
            return;
        }

        // 이전 페이지
        pagination.appendChild(
            createButton(
                "이전",
                "button button-secondary",
                () => goToPage(currentPage - 1),
                currentPage === 1
            )
        );

        // 페이지 번호
        // 현재 페이지 기준으로 최대 5개 번호 표시
        const startPage = Math.max(
            1,
            Math.min(
                currentPage - 2,
                totalPages - 4
            )
        );

        const endPage = Math.min(
            totalPages,
            startPage + 4
        );

        for (let page = startPage; page <= endPage; page++) {
            const pageButton = createButton(
                String(page),
                page === currentPage
                    ? "button button-primary"
                    : "button button-secondary",
                () => goToPage(page)
            );

            if (page === currentPage) {
                pageButton.setAttribute("aria-current", "page");
            }

            pagination.appendChild(pageButton);
        }

        // 다음 페이지
        pagination.appendChild(
            createButton(
                "다음",
                "button button-secondary",
                () => goToPage(currentPage + 1),
                currentPage === totalPages
            )
        );
    }

    /* ==================================================
       페이지 이동
    ================================================== */

    function goToPage(page) {
        if (
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
        detailArea.textContent =
            "회원 상세 정보를 불러오는 중입니다.";

        try {
            const user = await apiRequest(
                `${API_URL}/${encodeURIComponent(userId)}`
            );

            detailArea.replaceChildren();

            const title = document.createElement("h3");
            title.textContent = `${user.nickname} 회원 정보`;

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
            detailArea.textContent = error.message;
        }
    }

    /* ==================================================
       검색 및 초기화
    ================================================== */

    filterForm.addEventListener("submit", (event) => {
        event.preventDefault();

        // 새로운 검색은 항상 1페이지부터 시작
        currentPage = 1;
        loadUsers();
    });

    filterForm.addEventListener("reset", () => {
        // 폼의 초기화가 끝난 후 목록 재조회
        setTimeout(() => {
            currentPage = 1;
            loadUsers();
        }, 0);
    });

    /* ==================================================
       초기 실행
    ================================================== */

    loadUsers();
});
