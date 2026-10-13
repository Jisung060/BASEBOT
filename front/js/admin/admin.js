/* =========================================================
   BASEBOT ADMIN - 공통 JavaScript
   파일: front/js/admin/admin.js

   이 파일은 관리자 메뉴 활성화, 기본 UI 동작을 담당합니다.
   실제 DB 연동은 아래 API 연동 지점에 각 페이지별 요청을 추가하세요.
========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    setActiveMenu();
    setCurrentDateDefaults();
    setupSearchResetFeedback();
    setupFormPlaceholders();
});

/* 현재 페이지에 해당하는 사이드바 메뉴 활성화 */
function setActiveMenu() {
    const currentFile = window.location.pathname.split("/").pop() || "dashboard.html";

    document.querySelectorAll(".admin-nav a").forEach((link) => {
        const linkFile = link.getAttribute("href").split("/").pop();
        if (linkFile === currentFile) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
        } else {
            link.classList.remove("active");
            link.removeAttribute("aria-current");
        }
    });
}

/* 날짜 필터 기본값은 임의로 채우지 않습니다. 필요한 페이지에서만 사용하세요. */
function setCurrentDateDefaults() {
    document.querySelectorAll("[data-default-today]").forEach((input) => {
        if (!input.value) {
            const today = new Date();
            const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 10);
            input.value = localDate;
        }
    });
}

/* 현재 HTML의 검색 폼은 API 미연동 상태임을 명확히 알립니다. */
function setupSearchResetFeedback() {
    document.querySelectorAll('form[method="get"][action="#"]').forEach((form) => {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            showAdminMessage("검색 API가 아직 연결되지 않았습니다. 백엔드 연동 후 사용할 수 있습니다.");
        });
    });
}

/* 폼 저장 버튼이 실제 저장을 수행한다고 오해하지 않도록 미연동 상태를 안내합니다. */
function setupFormPlaceholders() {
    document.querySelectorAll('form[method="post"][action="#"]').forEach((form) => {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            showAdminMessage("저장 API가 아직 연결되지 않았습니다. 입력한 내용은 저장되지 않았습니다.");
        });
    });

    document.querySelectorAll(".admin-content button").forEach((button) => {
        const text = button.textContent.trim();
        const isPlaceholderAction = [
            "데이터 검증",
            "문서 목록 새로고침",
            "재색인 실행",
            "수집 실행",
            "설정 저장",
            "변경 취소"
        ].includes(text);

        if (isPlaceholderAction && !button.closest("form")) {
            button.addEventListener("click", () => {
                if (text === "변경 취소") {
                    showAdminMessage("변경 취소 동작은 설정 저장 API 연동 후 구현할 수 있습니다.");
                } else {
                    showAdminMessage(`${text}: 실제 백엔드 API가 아직 연결되지 않았습니다.`);
                }
            });
        }
    });
}

/* 가벼운 화면 메시지 */
function showAdminMessage(message) {
    let toast = document.querySelector(".admin-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.className = "admin-toast";
        toast.setAttribute("role", "status");
        toast.style.cssText = [
            "position:fixed",
            "right:24px",
            "bottom:24px",
            "z-index:9999",
            "max-width:min(420px,calc(100vw - 32px))",
            "padding:14px 18px",
            "border-radius:10px",
            "background:#172554",
            "color:#fff",
            "box-shadow:0 8px 28px rgba(15,23,42,.2)",
            "font-size:13px",
            "line-height:1.6"
        ].join(";");
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.display = "block";

    if (toast._hideTimer) {
        window.clearTimeout(toast._hideTimer);
    }
    toast._hideTimer = window.setTimeout(() => {
        toast.style.display = "none";
    }, 3500);
}

/*
 * API 연동 시 참고 예시 (현재 실행되지 않음):
 *
 * async function loadDashboardStats() {
 *     const token = sessionStorage.getItem("access_token");
 *     const response = await fetch("/admin/dashboard/stats", {
 *         headers: { Authorization: `Bearer ${token}` }
 *     });
 *     if (!response.ok) throw new Error("관리자 통계를 불러오지 못했습니다.");
 *     const data = await response.json();
 *     // 화면 요소에 data 값을 반영
 * }
 *
 * 주의: 프런트엔드에서 토큰/role만 확인하는 것으로 보안이 완성되지 않습니다.
 * FastAPI 관리자 API에서도 JWT를 검증하고 DB의 role=ADMIN인지 확인해야 합니다.
 */
