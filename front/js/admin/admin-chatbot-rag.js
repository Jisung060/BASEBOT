

/* ==================================================
   BASEBOT 관리자 - 야구 지식 문서 / RAG 관리
   파일: front/js/admin/admin-chatbot-rag.js

   기존 admin-chatbot.js와 분리하여 관리한다.
================================================== */

(() => {
    "use strict";

    const API_URL = "/admin/chatbot/rag";

    let selectedFilename = null;

    const $ = (selector) => document.querySelector(selector);

    const documentList = $("#rag-document-list");
    const filterForm = $("#rag-document-filter-form");
    const keywordInput = $("#rag-document-keyword");
    const categorySelect = $("#rag-document-category");

    const totalDocuments = $("#rag-total-documents");
    const indexedDocuments = $("#rag-indexed-documents");
    const pendingDocuments = $("#rag-pending-documents");
    const lastIndexed = $("#rag-last-indexed");

    const detailContainer = $("#rag-document-detail");
    const detailFilename = $("#rag-detail-filename");
    const detailContent = $("#rag-detail-content");

    const operationStatus = $("#rag-operation-status");
    const refreshButton = $("#rag-refresh-documents");
    const viewButton = $("#rag-view-document");
    const reindexButton = $("#rag-reindex");
    const closeDetailButton = $("#rag-close-detail");

    // --------------------------------------------------
    // 공통 API 요청
    // --------------------------------------------------
    async function apiRequest(path, options = {}) {
        const token = sessionStorage.getItem("access_token");

        if (!token) {
            throw new Error("로그인이 필요합니다.");
        }

        const headers = new Headers(options.headers || {});

        headers.set("Authorization", `Bearer ${token}`);

        const response = await fetch(`${API_URL}${path}`, {
            ...options,
            headers,
        });

        let result = {};

        try {
            result = await response.json();
        } catch {
            result = {};
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("관리자 인증에 실패했습니다. 다시 로그인해 주세요.");
            }

            throw new Error(
                result.detail || `요청에 실패했습니다. (${response.status})`
            );
        }

        return result;
    }

    // --------------------------------------------------
    // 화면 메시지
    // --------------------------------------------------
    function showStatus(message, isError = false) {
        if (!operationStatus) return;

        operationStatus.hidden = false;
        operationStatus.textContent = message;

        // 기존 CSS를 변경하지 않고 기본 텍스트 색상만 적용
        operationStatus.style.color = isError ? "#c0392b" : "";
    }

    function clearStatus() {
        if (!operationStatus) return;

        operationStatus.hidden = true;
        operationStatus.textContent = "";
        operationStatus.style.color = "";
    }

    function formatDate(value) {
        if (!value) return "-";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString("ko-KR");
    }

    function formatFileSize(bytes) {
        if (bytes == null) return "-";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getCategoryName(category) {
        const names = {
            rules: "야구 규칙",
            terms: "야구 용어",
            statistics: "기록 및 통계",
            positions: "포지션",
            strategy: "야구 전략",
            faq: "자주 묻는 질문",
            general: "일반",
        };

        return names[category] || category || "일반";
    }

    function getIndexStatus(status) {
        const statuses = {
            INDEXED: "색인 완료",
            PENDING: "색인 대기",
            NOT_INDEXED: "미색인",
        };

        return statuses[status] || "확인 필요";
    }

    // --------------------------------------------------
    // 색인 현황 조회
    // --------------------------------------------------
    async function loadRagStatus() {
        const result = await apiRequest("/status");

        totalDocuments.textContent =
            result.total_documents ?? 0;

        indexedDocuments.textContent =
            result.indexed_documents ?? 0;

        pendingDocuments.textContent =
            result.pending_documents ?? 0;

        lastIndexed.textContent = result.last_indexed_at
            ? formatDate(result.last_indexed_at)
            : "기록 없음";
    }

    // --------------------------------------------------
    // 문서 목록 조회
    // --------------------------------------------------
    async function loadDocuments() {
        clearStatus();

        if (!documentList) return;

        documentList.replaceChildren();

        const loadingRow = document.createElement("tr");
        const loadingCell = document.createElement("td");

        loadingCell.colSpan = 6;
        loadingCell.className = "table-empty";
        loadingCell.textContent = "문서 목록을 불러오는 중입니다.";

        loadingRow.appendChild(loadingCell);
        documentList.appendChild(loadingRow);

        try {
            const params = new URLSearchParams();

            const keyword = keywordInput?.value.trim();
            const category = categorySelect?.value;

            if (keyword) params.set("keyword", keyword);
            if (category) params.set("category", category);

            const query = params.toString();
            const result = await apiRequest(
                `/documents${query ? `?${query}` : ""}`
            );

            documentList.replaceChildren();

            const items = result.items || [];

            if (items.length === 0) {
                selectedFilename = null;

                const row = document.createElement("tr");
                const cell = document.createElement("td");

                cell.colSpan = 6;
                cell.className = "table-empty";
                cell.textContent = "조회된 야구 지식 문서가 없습니다.";

                row.appendChild(cell);
                documentList.appendChild(row);

                await loadRagStatus();
                return;
            }

            // 검색 결과에 선택한 문서가 없으면 선택 상태를 초기화한다.
            if (
                selectedFilename &&
                !items.some(
                    (item) => item.filename === selectedFilename
                )
            ) {
                selectedFilename = null;
            }

            for (const item of items) {
                const row = document.createElement("tr");

                if (item.filename === selectedFilename) {
                    row.style.backgroundColor = "#f1f5f9";
                }

                const values = [
                    item.name,
                    getCategoryName(item.category),
                    item.extension,
                    formatDate(item.modified_at),
                    getIndexStatus(item.index_status),
                ];

                for (const value of values) {
                    const cell = document.createElement("td");
                    cell.textContent = value ?? "-";
                    row.appendChild(cell);
                }

                const actionCell = document.createElement("td");
                const selectButton = document.createElement("button");

                selectButton.type = "button";
                selectButton.className = "button button-secondary";
                selectButton.textContent =
                    item.filename === selectedFilename
                        ? "선택됨"
                        : "선택";

                selectButton.addEventListener("click", () => {
                    selectedFilename = item.filename;

                    // 목록을 다시 요청하지 않고 선택 표시만 갱신한다.
                    loadDocuments();
                });

                actionCell.appendChild(selectButton);
                row.appendChild(actionCell);

                row.title =
                    `${item.filename} (${formatFileSize(item.size_bytes)})`;

                documentList.appendChild(row);
            }

            await loadRagStatus();

        } catch (error) {
            documentList.replaceChildren();

            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 6;
            cell.className = "table-empty";
            cell.textContent = error.message;

            row.appendChild(cell);
            documentList.appendChild(row);

            showStatus(error.message, true);
        }
    }

    // --------------------------------------------------
    // 선택 문서 내용 조회
    // --------------------------------------------------
    async function viewDocument() {
        if (!selectedFilename) {
            showStatus("먼저 목록에서 문서를 선택해 주세요.", true);
            return;
        }

        clearStatus();

        if (viewButton) viewButton.disabled = true;

        try {
            // 경로 구분자는 유지하고 경로의 각 요소를 인코딩한다.
            const encodedPath = selectedFilename
                .split("/")
                .map((part) => encodeURIComponent(part))
                .join("/");

            const result = await apiRequest(
                `/documents/${encodedPath}`
            );

            detailFilename.textContent = result.filename;
            detailContent.textContent = result.content ?? "";
            detailContainer.hidden = false;

        } catch (error) {
            showStatus(error.message, true);
        } finally {
            if (viewButton) viewButton.disabled = false;
        }
    }

    // --------------------------------------------------
    // RAG 재색인
    // --------------------------------------------------
    async function reindexDocuments() {
        const confirmed = window.confirm(
            "야구 지식 문서를 재색인할까요?\n" +
            "문서 수에 따라 시간이 걸릴 수 있습니다."
        );

        if (!confirmed) return;

        clearStatus();

        if (reindexButton) reindexButton.disabled = true;
        if (refreshButton) refreshButton.disabled = true;

        showStatus("RAG 재색인을 실행하고 있습니다. 잠시 기다려 주세요.");

        try {
            const result = await apiRequest("/reindex", {
                method: "POST",
            });

            showStatus(
                result.message || "RAG 재색인이 완료되었습니다."
            );

            // 새 색인 상태와 문서 목록을 다시 불러온다.
            await loadDocuments();

            if (result.last_indexed_at) {
                lastIndexed.textContent =
                    formatDate(result.last_indexed_at);
            }

            // loadDocuments()가 성공 메시지를 초기화할 수 있으므로 재표시한다.
            showStatus(
                result.message || "RAG 재색인이 완료되었습니다."
            );

        } catch (error) {
            showStatus(error.message, true);
        } finally {
            if (reindexButton) reindexButton.disabled = false;
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    // --------------------------------------------------
    // 이벤트 연결
    // --------------------------------------------------
    filterForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        loadDocuments();
    });

    refreshButton?.addEventListener("click", () => {
        loadDocuments();
    });

    viewButton?.addEventListener("click", () => {
        viewDocument();
    });

    reindexButton?.addEventListener("click", () => {
        reindexDocuments();
    });

    closeDetailButton?.addEventListener("click", () => {
        detailContainer.hidden = true;
    });

    // --------------------------------------------------
    // 최초 실행
    // --------------------------------------------------
    async function initialize() {
        if (!documentList) return;

        if (detailContainer) {
            detailContainer.hidden = true;
        }

        try {
            await Promise.all([
                loadDocuments(),
                loadRagStatus(),
            ]);
        } catch (error) {
            showStatus(error.message, true);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();
