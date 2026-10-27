
document.addEventListener("DOMContentLoaded", async () => {
    if (!await adminAccessReady) return;

    const tbody = document.getElementById(
        "withdrawalRequestsBody"
    );

    const refreshButton = document.getElementById(
        "refreshWithdrawalRequests"
    );

    // 해당 영역이 없는 페이지에서는 실행하지 않음
    if (!tbody) {
        return;
    }

    // 로그인 토큰
    function getToken() {
        return sessionStorage.getItem("access_token");
    }

    // API 요청
    async function requestApi(url, options = {}) {
        const token = getToken();

        if (!token) {
            throw new Error("로그인이 필요합니다.");
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                ...options.headers,
            },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.detail || "요청 처리에 실패했습니다."
            );
        }

        return data;
    }

    // 날짜 표시
    function formatDate(value) {
        if (!value) {
            return "-";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString("ko-KR");
    }

    // HTML 삽입 시 사용자 데이터 이스케이프
    function escapeHtml(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            (char) => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[char]
        );
    }

    // 탈퇴 신청 목록 조회
    async function loadWithdrawalRequests() {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="table-empty">
                    탈퇴 신청 내역을 불러오는 중입니다.
                </td>
            </tr>
        `;

        try {
            const data = await requestApi(
                "/admin/users?status=WITHDRAWAL_REQUESTED&limit=100"
            );

            const users = data.items || [];

            if (users.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="table-empty">
                            탈퇴 신청 회원이 없습니다.
                        </td>
                    </tr>
                `;

                return;
            }

            tbody.innerHTML = users.map((user) => `
                <tr>
                    <td>${escapeHtml(user.user_id)}</td>
                    <td>${escapeHtml(user.username)}</td>
                    <td>${escapeHtml(user.nickname)}</td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>
                        ${escapeHtml(
                            formatDate(user.withdrawal_requested_at)
                        )}
                    </td>
                    <td>
                        <button
                            type="button"
                            class="button button-primary"
                            data-action="approve"
                            data-user-id="${escapeHtml(user.user_id)}"
                        >
                            승인
                        </button>

                        <button
                            type="button"
                            class="button button-secondary"
                            data-action="reject"
                            data-user-id="${escapeHtml(user.user_id)}"
                        >
                            반려
                        </button>
                    </td>
                </tr>
            `).join("");

        } catch (error) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-empty">
                        ${escapeHtml(error.message)}
                    </td>
                </tr>
            `;
        }
    }

    // 승인 및 반려
    tbody.addEventListener("click", async (event) => {
        const button = event.target.closest(
            "button[data-action]"
        );

        if (!button) {
            return;
        }

        const userId = button.dataset.userId;
        const action = button.dataset.action;

        const isApprove = action === "approve";

        const message = isApprove
            ? "이 회원의 탈퇴를 승인하시겠습니까?"
            : "이 회원의 탈퇴 신청을 반려하시겠습니까?";

        if (!confirm(message)) {
            return;
        }

        button.disabled = true;

        try {
            const result = await requestApi(
                `/admin/users/${userId}/withdrawal/${action}`,
                {
                    method: "POST",
                }
            );

            alert(result.message);

            await loadWithdrawalRequests();

        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    });

    // 새로고침
    if (refreshButton) {
        refreshButton.addEventListener(
            "click",
            loadWithdrawalRequests
        );
    }

    // 최초 조회
    loadWithdrawalRequests();
});