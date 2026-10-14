/* ========================================
   BASEBOT 신고 내역
======================================== */

const API_BASE_URL = "http://127.0.0.1:8000";

let allMyReports = [];
let filteredMyReports = [];

let selectedStatus = "ALL";
let currentPage = 1;

const REPORTS_PER_PAGE = 5;


/* ========================================
   페이지 시작
======================================== */

document.addEventListener("DOMContentLoaded", () => {

    setupMyReportsEvents();
    loadMyReports();

});


/* ========================================
   신고 내역 불러오기
======================================== */

async function loadMyReports() {

    const token = sessionStorage.getItem("access_token");

    if (!token) {

        showMyReportsEmpty(
            "로그인 후 신고 내역을 확인할 수 있습니다."
        );

        return;
    }

    try {

        const response = await fetch(
            `${API_BASE_URL}/community/my-reports`,
            {
                method: "GET",

                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {

            throw new Error(
                "로그인이 만료되었습니다. 다시 로그인해주세요."
            );
        }

        if (!response.ok) {

            throw new Error(
                "신고 내역을 불러오지 못했습니다."
            );
        }

        allMyReports = await response.json();

        currentPage = 1;

        applyMyReportsFilters();

    } catch (error) {

        console.error(
            "신고 내역 불러오기 오류:",
            error
        );

        showMyReportsEmpty(
            error.message ||
            "신고 내역을 불러오지 못했습니다."
        );
    }
}


/* ========================================
   이벤트 설정
======================================== */

function setupMyReportsEvents() {

    /* 상태 필터 */

    const statusTabs =
        document.querySelectorAll(".my-reports-tab");

    statusTabs.forEach((tab) => {

        tab.addEventListener("click", () => {

            statusTabs.forEach((item) => {

                item.classList.remove("active");
                item.setAttribute(
                    "aria-pressed",
                    "false"
                );

            });

            tab.classList.add("active");

            tab.setAttribute(
                "aria-pressed",
                "true"
            );

            selectedStatus =
                tab.dataset.status || "ALL";

            currentPage = 1;

            applyMyReportsFilters();

        });

    });


    /* 검색 */

    const searchInput =
        document.getElementById(
            "myReportsSearchInput"
        );

    if (searchInput) {

        searchInput.addEventListener(
            "input",
            () => {

                currentPage = 1;

                applyMyReportsFilters();

            }
        );

    }


    /* 정렬 */

    const sortSelect =
        document.getElementById(
            "myReportsSort"
        );

    if (sortSelect) {

        sortSelect.addEventListener(
            "change",
            () => {

                currentPage = 1;

                applyMyReportsFilters();

            }
        );

    }

}


/* ========================================
   필터 적용
======================================== */

function applyMyReportsFilters() {

    const searchInput =
        document.getElementById(
            "myReportsSearchInput"
        );

    const keyword =
        searchInput
            ? searchInput.value.trim().toLowerCase()
            : "";

    filteredMyReports =
        allMyReports.filter((report) => {

            /* 처리 상태 */

            if (selectedStatus !== "ALL") {

                /*
                    '처리 대기' 탭에는 접수(PENDING)와
                    검토 중(REVIEWED) 상태를 함께 표시
                */

                const matchedStatuses =
                    selectedStatus === "PENDING"
                        ? ["PENDING", "REVIEWED"]
                        : [selectedStatus];

                if (
                    !matchedStatuses.includes(
                        report.status
                    )
                ) {
                    return false;
                }

            }


            /* 제목 검색 */

            if (keyword) {

                const title =
                    String(
                        report.title || ""
                    ).toLowerCase();

                if (!title.includes(keyword)) {
                    return false;
                }

            }

            return true;

        });


    /* 정렬 */

    const sortSelect =
        document.getElementById(
            "myReportsSort"
        );

    const sortType =
        sortSelect
            ? sortSelect.value
            : "newest";


    filteredMyReports.sort((a, b) => {

        const dateA =
            new Date(a.reported_at).getTime();

        const dateB =
            new Date(b.reported_at).getTime();

        if (sortType === "oldest") {
            return dateA - dateB;
        }

        return dateB - dateA;

    });


    renderMyReports();

}


/* ========================================
   신고 목록 출력
======================================== */

function renderMyReports() {

    const listElement =
        document.querySelector(
            ".my-reports-list"
        );

    const emptyElement =
        document.getElementById(
            "my-reports-empty"
        );

    if (!listElement) {
        return;
    }

    listElement.innerHTML = "";


    updateMyReportsCounts(
        filteredMyReports.length
    );


    if (filteredMyReports.length === 0) {

        if (emptyElement) {
            emptyElement.style.display = "block";
        }

        renderMyReportsPagination(0);

        return;
    }


    if (emptyElement) {
        emptyElement.style.display = "none";
    }


    const startIndex =
        (currentPage - 1) *
        REPORTS_PER_PAGE;

    const endIndex =
        startIndex +
        REPORTS_PER_PAGE;

    const pageReports =
        filteredMyReports.slice(
            startIndex,
            endIndex
        );


    pageReports.forEach((report) => {

        const item =
            document.createElement("li");

        item.className =
            "activity-item my-reports-item";


        /* 게시글 링크 */

        const link =
            document.createElement("a");

        link.href =
            `/community-view.html?postId=${
                encodeURIComponent(report.post_id)
            }`;

        link.className =
            "activity-link my-reports-link";


        /* 신고 사유 */

        const reason =
            document.createElement("span");

        reason.className =
            `my-reports-reason reason-${report.reason}`;

        reason.textContent =
            getMyReportsReasonName(
                report.reason
            );


        /* 게시글 제목 */

        const title =
            document.createElement("strong");

        title.className =
            "activity-title my-reports-title";

        title.textContent =
            report.title ||
            "(제목 없음)";


        /* 신고 날짜 */

        const meta =
            document.createElement("span");

        meta.className =
            "activity-meta my-reports-meta";

        const nickname =
            report.nickname ||
            "알 수 없는 작성자";

        const date =
            formatMyReportsDate(
                report.reported_at
            );

        meta.textContent =
            date
                ? `${nickname} · 신고 ${date}`
                : nickname;


        /* 신고 상태 */

        const status =
            document.createElement("span");

        status.className =
            `my-reports-status status-${report.status}`;

        status.textContent =
            getMyReportsStatusName(
                report.status
            );


        link.appendChild(reason);
        link.appendChild(title);
        link.appendChild(meta);
        link.appendChild(status);


        /* 신고 취소 버튼 */

        if (report.status === "PENDING") {

            const cancelButton =
                document.createElement("button");

            cancelButton.type = "button";

            cancelButton.className =
                "my-report-cancel-button";

            cancelButton.textContent =
                "신고 취소";


            cancelButton.addEventListener(
                "click",
                (event) => {

                    event.preventDefault();
                    event.stopPropagation();

                    handleCancelMyReport(
                        report,
                        cancelButton
                    );

                }
            );


            item.appendChild(link);
            item.appendChild(cancelButton);

        } else {

            item.appendChild(link);

        }


        listElement.appendChild(item);

    });


    renderMyReportsPagination(
        filteredMyReports.length
    );

}


/* ========================================
   신고 취소
   DELETE /community/reports/{report_id}
======================================== */

async function handleCancelMyReport(
    report,
    button
) {

    const confirmed =
        window.confirm(
            "이 신고를 취소하시겠습니까?"
        );

    if (!confirmed) {
        return;
    }

    const token =
        sessionStorage.getItem("access_token");

    if (!token) {

        alert(
            "로그인 후 신고를 취소할 수 있습니다."
        );

        return;
    }

    button.disabled = true;
    button.textContent = "취소 중...";

    try {

        const response = await fetch(
            `${API_BASE_URL}/community/reports/${report.report_id}`,
            {
                method: "DELETE",

                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {

            throw new Error(
                "로그인이 만료되었습니다. 다시 로그인해주세요."
            );
        }

        if (!response.ok) {

            /* 서버가 보낸 오류 메시지 사용 */

            let message =
                "신고 취소에 실패했습니다.";

            try {

                const errorData =
                    await response.json();

                if (
                    typeof errorData.detail === "string"
                ) {
                    message = errorData.detail;
                }

            } catch (parseError) {
                /* JSON이 아니면 기본 메시지 사용 */
            }

            throw new Error(message);
        }


        /* 화면 목록에서도 해당 신고 제거 */

        allMyReports =
            allMyReports.filter(
                (item) =>
                    Number(item.report_id) !==
                    Number(report.report_id)
            );

        applyMyReportsFilters();


        /* 마지막 페이지의 항목이 모두 사라졌다면 이전 페이지로 이동 */

        const lastPage =
            Math.max(
                1,
                Math.ceil(
                    filteredMyReports.length /
                    REPORTS_PER_PAGE
                )
            );

        if (currentPage > lastPage) {

            currentPage = lastPage;

            renderMyReports();

        }

    } catch (error) {

        console.error(
            "신고 취소 오류:",
            error
        );

        button.disabled = false;
        button.textContent = "신고 취소";

        alert(
            error.message ||
            "신고 취소에 실패했습니다."
        );

        /* 이미 처리된 신고라면 최신 상태로 다시 불러오기 */

        if (
            error.message &&
            error.message.includes("처리된 신고")
        ) {
            loadMyReports();
        }

    }

}


/* ========================================
   페이지네이션
======================================== */

function renderMyReportsPagination(
    totalCount
) {

    const pagination =
        document.getElementById(
            "my-reports-pagination"
        );

    if (!pagination) {
        return;
    }

    pagination.innerHTML = "";


    const totalPages =
        Math.ceil(
            totalCount /
            REPORTS_PER_PAGE
        );


    if (totalPages <= 1) {
        return;
    }


    /* 이전 (스크랩 페이지와 동일하게 항상 표시, 첫 페이지에서는 비활성) */

    const prev =
        createMyReportsPageButton(
            "‹",
            currentPage - 1
        );

    prev.classList.add("page-arrow");
    prev.setAttribute("aria-label", "이전 페이지");
    prev.disabled = currentPage === 1;

    pagination.appendChild(prev);


    /* 페이지 번호 */

    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        const button =
            createMyReportsPageButton(
                page,
                page
            );

        pagination.appendChild(button);

    }


    /* 다음 (스크랩 페이지와 동일하게 항상 표시, 마지막 페이지에서는 비활성) */

    const next =
        createMyReportsPageButton(
            "›",
            currentPage + 1
        );

    next.classList.add("page-arrow");
    next.setAttribute("aria-label", "다음 페이지");
    next.disabled = currentPage === totalPages;

    pagination.appendChild(next);

}


/* ========================================
   페이지 버튼 생성
======================================== */

function createMyReportsPageButton(
    text,
    page
) {

    const button =
        document.createElement("button");

    button.type = "button";

    button.className =
        "my-reports-page-button";

    if (page === currentPage) {

        button.classList.add("active");

    }

    button.textContent = text;

    button.addEventListener(
        "click",
        () => {

            currentPage = page;

            renderMyReports();

        }
    );

    return button;

}


/* ========================================
   상태 이름
======================================== */

function getMyReportsStatusName(
    status
) {

    const statusNames = {

        PENDING: "처리 대기",

        REVIEWED: "검토 중",

        ACCEPTED: "처리 완료",

        REJECTED: "반려"

    };

    return (
        statusNames[status] ||
        status ||
        "확인 중"
    );

}


/* ========================================
   신고 사유 이름
======================================== */

function getMyReportsReasonName(
    reason
) {

    const reasonNames = {

        ABUSE: "욕설·비방",

        AD: "광고",

        SPAM: "스팸",

        INAPPROPRIATE: "부적절한 내용",

        ETC: "기타"

    };

    return (
        reasonNames[reason] ||
        "기타"
    );

}


/* ========================================
   날짜 표시
======================================== */

function formatMyReportsDate(
    value
) {

    if (!value) {
        return "";
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "";
    }

    return date.toLocaleString(
        "ko-KR",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


/* ========================================
   개수 표시
======================================== */

function updateMyReportsCounts(
    count
) {

    const totalElement =
        document.querySelector(
            ".my-reports-box-header .my-posts-total"
        );

    const resultElement =
        document.getElementById(
            "myReportsResultCount"
        );

    if (totalElement) {

        totalElement.textContent =
            `총 ${count}개`;

    }

    if (resultElement) {

        resultElement.textContent =
            `신고 ${count}개`;

    }

}


/* ========================================
   빈 목록
======================================== */

function showMyReportsEmpty(
    message
) {

    const listElement =
        document.querySelector(
            ".my-reports-list"
        );

    const emptyElement =
        document.getElementById(
            "my-reports-empty"
        );

    if (listElement) {
        listElement.innerHTML = "";
    }

    if (emptyElement) {

        emptyElement.style.display =
            "block";

        const title =
            emptyElement.querySelector(
                "strong"
            );

        const description =
            emptyElement.querySelector(
                "p"
            );

        if (title) {
            title.textContent = message;
        }

        if (description) {
            description.style.display =
                "none";
        }

    }

    updateMyReportsCounts(0);

    renderMyReportsPagination(0);

}