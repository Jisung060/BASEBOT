/* ==================================================
   BASEBOT 관리자 - 야구 지식 문서 / RAG 관리
   파일: front/js/admin/admin-chatbot-rag.js

   기존 admin-chatbot.js와 분리하여 관리한다.
================================================== */

(() => {
    "use strict";

    const API_URL = "/admin/chatbot/rag";

    let selectedFilename = null;
    let currentChunkPage = 1;
    const CHUNK_PAGE_SIZE = 10;

    const $ = (selector) => document.querySelector(selector);

    // 원본 문서 관리
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

    // 실제 ChromaDB 색인 조각 관리
    const chunkFilterForm = $("#rag-chunk-filter-form");
    const chunkKeywordInput = $("#rag-chunk-keyword");
    const chunkCategorySelect = $("#rag-chunk-category");
    const chunkList = $("#rag-chunk-list");
    const chunkTotal = $("#rag-chunk-total");
    const chunkPagination = $("#rag-chunk-pagination");
    const chunkRefreshButton = $("#rag-refresh-chunks");

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
        headers.set("Accept", "application/json");

        const response = await fetch(`${API_URL}${path}`, {
            ...options,
            headers,
            credentials: "same-origin",
        });

        const responseText = await response.text();

        let result = {};

        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch {
                result = {
                    detail: responseText,
                };
            }
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(
                    result.detail ||
                    "관리자 인증에 실패했습니다. 다시 로그인해 주세요."
                );
            }

            throw new Error(
                result.detail ||
                `요청에 실패했습니다. (${response.status})`
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

    // 안전하게 요소를 생성하고 텍스트를 표시한다.
    function createCell(value, className = "") {
        const cell = document.createElement("td");

        if (className) {
            cell.className = className;
        }

        cell.textContent = value ?? "-";

        return cell;
    }

    function showTableMessage(tbody, columnCount, message) {
        if (!tbody) return;

        tbody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = columnCount;
        cell.className = "table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    // --------------------------------------------------
    // 색인 현황 조회
    // --------------------------------------------------
    async function loadRagStatus() {
        const result = await apiRequest("/status");

        if (totalDocuments) {
            totalDocuments.textContent =
                result.total_documents ?? 0;
        }

        if (indexedDocuments) {
            indexedDocuments.textContent =
                result.indexed_documents ?? 0;
        }

        if (pendingDocuments) {
            pendingDocuments.textContent =
                result.pending_documents ?? 0;
        }

        if (lastIndexed) {
            lastIndexed.textContent = result.last_indexed_at
                ? formatDate(result.last_indexed_at)
                : "기록 없음";
        }
    }

    // --------------------------------------------------
    // 원본 문서 목록 조회
    // --------------------------------------------------
    async function loadDocuments() {
        clearStatus();

        if (!documentList) return;

        showTableMessage(
            documentList,
            6,
            "문서 목록을 불러오는 중입니다."
        );

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

                showTableMessage(
                    documentList,
                    6,
                    "조회된 야구 지식 문서가 없습니다."
                );

                await loadRagStatus();
                return;
            }

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
                    row.appendChild(createCell(value));
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
            showTableMessage(
                documentList,
                6,
                error.message
            );

            showStatus(error.message, true);
        }
    }

    // --------------------------------------------------
    // 선택한 원본 문서 내용 조회
    // --------------------------------------------------
    async function viewDocument() {
        if (!selectedFilename) {
            showStatus(
                "먼저 목록에서 문서를 선택해 주세요.",
                true
            );
            return;
        }

        clearStatus();

        if (viewButton) viewButton.disabled = true;

        try {
            const encodedPath = selectedFilename
                .split("/")
                .map((part) => encodeURIComponent(part))
                .join("/");

            const result = await apiRequest(
                `/documents/${encodedPath}`
            );

            if (detailFilename) {
                detailFilename.textContent = result.filename;
            }

            if (detailContent) {
                detailContent.textContent = result.content ?? "";
            }

            if (detailContainer) {
                detailContainer.hidden = false;
            }

        } catch (error) {
            showStatus(error.message, true);
        } finally {
            if (viewButton) viewButton.disabled = false;
        }
    }

    // --------------------------------------------------
    // ChromaDB 색인 조각 조회
    // --------------------------------------------------
    async function loadRagChunks() {
        if (!chunkList) return;

        showTableMessage(
            chunkList,
            4,
            "ChromaDB 색인 조각을 불러오는 중입니다."
        );

        if (chunkPagination) {
            chunkPagination.replaceChildren();
        }

        try {
            const params = new URLSearchParams();

            const keyword = chunkKeywordInput?.value.trim();
            const category = chunkCategorySelect?.value;

            params.set("page", String(currentChunkPage));
            params.set("page_size", String(CHUNK_PAGE_SIZE));

            if (keyword) {
                params.set("keyword", keyword);
            }

            if (category) {
                params.set("category", category);
            }

            const result = await apiRequest(
                `/chunks?${params.toString()}`
            );

            const items = result.items || [];

            if (chunkTotal) {
                chunkTotal.textContent =
                    `전체 색인 조각: ${result.total ?? 0}개`;
            }

            chunkList.replaceChildren();

            if (items.length === 0) {
                showTableMessage(
                    chunkList,
                    4,
                    "조회된 색인 조각이 없습니다. 재색인을 실행했는지 확인해 주세요."
                );
            } else {
                for (const item of items) {
                    const row = document.createElement("tr");

                    row.appendChild(
                        createCell(item.source || "-")
                    );

                    row.appendChild(
                        createCell(
                            getCategoryName(item.category)
                        )
                    );

                    const contentCell = document.createElement("td");
                    const contentPre = document.createElement("pre");

                    contentPre.textContent = item.content ?? "";
                    contentPre.style.whiteSpace = "pre-wrap";
                    contentPre.style.overflowWrap = "anywhere";
                    contentPre.style.margin = "0";
                    contentCell.appendChild(contentPre);
                    row.appendChild(contentCell);

                    const idCell = document.createElement("td");
                    const idCode = document.createElement("code");

                    idCode.textContent = item.id ?? "-";
                    idCell.appendChild(idCode);
                    row.appendChild(idCell);

                    chunkList.appendChild(row);
                }
            }

            renderChunkPagination(
                result.page ?? currentChunkPage,
                result.total_pages ?? 0,
                result.total ?? 0
            );

        } catch (error) {
            showTableMessage(
                chunkList,
                4,
                error.message
            );

            if (chunkTotal) {
                chunkTotal.textContent = "색인 조각 조회 실패";
            }

            if (chunkPagination) {
                chunkPagination.replaceChildren();
            }

            showStatus(error.message, true);
        }
    }

    // --------------------------------------------------
    // 색인 조각 페이지 이동
    // --------------------------------------------------
    function renderChunkPagination(page, totalPages, total) {
        if (!chunkPagination) return;

        chunkPagination.innerHTML = "";

        if (total === 0 || totalPages <= 1) return;

        // 페이지 번호를 10개씩 묶어서 표시
        const PAGE_GROUP_SIZE = 10;
        const currentGroup = Math.floor((page - 1) / PAGE_GROUP_SIZE);
        const startPage = currentGroup * PAGE_GROUP_SIZE + 1;
        const endPage = Math.min(
            startPage + PAGE_GROUP_SIZE - 1,
            totalPages
        );

        // 버튼 생성
        const createButton = (label, targetPage, active = false, disabled = false) => {
            const button = document.createElement("button");

            button.type = "button";
            button.textContent = label;

            if (active) {
                button.classList.add("active");
            }

            button.disabled = disabled;

            button.addEventListener("click", () => {
                if (
                    targetPage < 1 ||
                    targetPage > totalPages ||
                    targetPage === currentChunkPage
                ) {
                    return;
                }

                currentChunkPage = targetPage;
                loadRagChunks();
            });

            return button;
        };

        // 이전 페이지 묶음으로 이동
        chunkPagination.appendChild(
            createButton(
                "이전",
                startPage - 1,
                false,
                startPage === 1
            )
        );

        // 현재 페이지 묶음의 번호 표시
        for (let i = startPage; i <= endPage; i++) {
            chunkPagination.appendChild(
                createButton(
                    String(i),
                    i,
                    i === page
                )
            );
        }

        // 다음 페이지 묶음으로 이동
        chunkPagination.appendChild(
            createButton(
                "다음",
                endPage + 1,
                false,
                endPage === totalPages
            )
        );
    }

    // --------------------------------------------------
    // 색인 조각 검색 및 새로고침
    // --------------------------------------------------
    chunkFilterForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        currentChunkPage = 1;
        loadRagChunks();
    });

    chunkRefreshButton?.addEventListener("click", () => {
        loadRagChunks();
    });

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

        showStatus(
            "RAG 재색인을 실행하고 있습니다. 잠시 기다려 주세요."
        );

        try {
            const result = await apiRequest("/reindex", {
                method: "POST",
            });

            showStatus(
                result.message || "RAG 재색인이 완료되었습니다."
            );

            await Promise.all([
                loadDocuments(),
                loadRagChunks(),
            ]);

            if (result.last_indexed_at && lastIndexed) {
                lastIndexed.textContent =
                    formatDate(result.last_indexed_at);
            }

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
        if (detailContainer) {
            detailContainer.hidden = true;
        }
    });

    // --------------------------------------------------
    // 최초 실행
    // --------------------------------------------------
    async function initialize() {
        if (!await adminAccessReady) return;

        if (!documentList) return;

        if (detailContainer) {
            detailContainer.hidden = true;
        }

        const tasks = [
            loadDocuments(),
            loadRagStatus(),
        ];

        if (chunkList) {
            tasks.push(loadRagChunks());
        }

        await Promise.allSettled(tasks);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();
