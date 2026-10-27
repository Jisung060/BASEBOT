(() => {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const API = "/admin/news";
    const PAGE_SIZE = 20;
    let page = 1;
    let total = 0;
    let accessToken = "";
    const selectedIds = new Set();

    function readToken() {
        const keys = ["access_token", "accessToken", "token", "jwt_token", "jwt"];
        for (const store of [localStorage, sessionStorage]) {
            for (const key of keys) {
                const value = store.getItem(key);
                if (value && value !== "undefined" && value !== "null") return value;
            }
            const rawUser = store.getItem("user");
            if (rawUser) {
                try {
                    const user = JSON.parse(rawUser);
                    const value = user.access_token || user.accessToken || user.token || user.jwt;
                    if (value) return value;
                } catch (_) { /* user entry may not be JSON */ }
            }
        }
        // Also support projects that store the JWT under a differently named key.
        for (const store of [localStorage, sessionStorage]) {
            for (let i = 0; i < store.length; i += 1) {
                const value = store.getItem(store.key(i));
                if (value && /^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(value)) {
                    return value;
                }
            }
        }
        return "";
    }

    function message(id, text, type = "") {
        const el = $(id);
        el.textContent = text;
        el.className = `news-message ${type}`.trim();
    }

    function setStatus(text, type = "") {
        const el = $("connectionStatus");
        el.textContent = text;
        el.className = `news-status ${type}`.trim();
    }

    function authHeaders(json = false) {
        const headers = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        if (json) headers["Content-Type"] = "application/json";
        return headers;
    }

    async function request(path, options = {}) {
        const response = await fetch(`${API}${path}`, {
            ...options,
            headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) }
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
            setStatus("인증 실패", "error");
            throw new Error(data.detail || "관리자 로그인 상태를 확인해 주세요. 관리자 계정으로 다시 로그인해 주세요.");
        }
        if (!response.ok) {
            throw new Error(data.detail || `요청에 실패했습니다. (${response.status})`);
        }
        return data;
    }

    function setBusy(busy) {
        ["saveSettingsBtn", "crawlBtn", "reloadBtn", "searchBtn", "deleteSelectedBtn", "cleanupBtn"].forEach((id) => {
            const el = $(id);
            if (el) el.disabled = busy || !accessToken;
        });
        updateSelectionState();
    }

    function updateSelectionState() {
        $("deleteSelectedBtn").disabled = !accessToken || selectedIds.size === 0;
    }

    function makeEmptyRow(text) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.className = "table-empty";
        td.textContent = text;
        tr.appendChild(td);
        $("newsRows").replaceChildren(tr);
    }

    async function loadSettings() {
        const data = await request("/settings");
        $("intervalMinutes").value = data.interval_minutes;
    }

    async function loadNews() {
        if (!accessToken) return;
        setBusy(true);
        try {
            const keyword = $("keyword").value.trim();
            const startDate = $("startDate")?.value || "";
            const endDate = $("endDate")?.value || "";

            if (startDate && endDate && startDate > endDate) {
                message("listMessage", "시작일은 종료일보다 늦을 수 없습니다.", "error");
                return;
            }

            const params = new URLSearchParams({
                page: String(page),
                limit: String(PAGE_SIZE),
                keyword
            });
            if (startDate) params.set("start_date", startDate);
            if (endDate) params.set("end_date", endDate);

            const data = await request(`?${params.toString()}`);
            total = Number(data.total || 0);
            $("totalCount").textContent = `총 ${total.toLocaleString()}건`;
            const activeFilters = [];
            if (keyword) activeFilters.push(`검색어: \"${keyword}\"`);
            if (startDate) activeFilters.push(`시작일: ${startDate}`);
            if (endDate) activeFilters.push(`종료일: ${endDate}`);
            message(
                "listMessage",
                activeFilters.length
                    ? `${activeFilters.join(" · ")} 검색 결과 ${total.toLocaleString()}건`
                    : `전체 기사 ${total.toLocaleString()}건`,
                "success"
            );
            const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
            $("pageLabel").textContent = `${page} / ${pageCount} 페이지`;
            $("prevBtn").disabled = page <= 1;
            $("nextBtn").disabled = page >= pageCount;
            $("selectAll").checked = false;

            if (!Array.isArray(data.data) || data.data.length === 0) {
                makeEmptyRow("조회된 뉴스가 없습니다.");
                return;
            }

            const tbody = $("newsRows");
            tbody.replaceChildren();
            for (const item of data.data) {
                const tr = document.createElement("tr");

                const selectTd = document.createElement("td");
                const check = document.createElement("input");
                check.type = "checkbox";
                check.className = "news-table-check";
                check.checked = selectedIds.has(Number(item.news_id));
                check.setAttribute("aria-label", `기사 ${item.news_id} 선택`);
                check.addEventListener("change", () => {
                    if (check.checked) selectedIds.add(Number(item.news_id));
                    else selectedIds.delete(Number(item.news_id));
                    updateSelectionState();
                });
                selectTd.appendChild(check);

                const idTd = document.createElement("td");
                idTd.textContent = item.news_id;

                const titleTd = document.createElement("td");
                const link = document.createElement("a");
                link.className = "news-title-link";
                link.textContent = item.title || "(제목 없음)";
                link.href = item.source_url || "#";
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                titleTd.appendChild(link);

                const sourceTd = document.createElement("td");
                sourceTd.textContent = item.source_name || "-";

                const dateTd = document.createElement("td");
                dateTd.textContent = item.published_at || item.crawled_at || "-";

                const actionTd = document.createElement("td");
                const del = document.createElement("button");
                del.type = "button";
                del.className = "button button-danger news-delete-button";
                del.textContent = "삭제";
                del.addEventListener("click", () => deleteOne(Number(item.news_id), item.title || ""));
                actionTd.appendChild(del);

                tr.append(selectTd, idTd, titleTd, sourceTd, dateTd, actionTd);
                tbody.appendChild(tr);
            }
            updateSelectionState();
        } catch (error) {
            message("listMessage", error.message, "error");
            makeEmptyRow("뉴스 목록을 불러오지 못했습니다. 아래 오류 메시지를 확인해 주세요.");
        } finally {
            setBusy(false);
        }
    }

    async function deleteOne(id, title) {
        if (!confirm(`이 기사를 DB에서 삭제할까요?\n\n${title}`)) return;
        try {
            await request(`/${id}`, { method: "DELETE" });
            selectedIds.delete(id);
            message("listMessage", "기사를 삭제했습니다.", "success");
            await loadNews();
        } catch (error) {
            message("listMessage", error.message, "error");
        }
    }

    async function initialize() {
        if (!await adminAccessReady) return;

        accessToken = readToken();
        if (!accessToken) {
            setStatus("로그인 필요", "error");
            message(
                "settingsMessage",
                "저장된 로그인 토큰을 찾을 수 없습니다. BASEBOT 관리자 계정으로 로그인한 뒤 이 페이지를 다시 열어 주세요.",
                "error"
            );
            makeEmptyRow("관리자 로그인 후 뉴스 목록을 조회할 수 있습니다.");
            setBusy(true);
            return;
        }

        try {
            await loadSettings();
            setStatus("관리자 인증 완료", "connected");
            message("settingsMessage", "관리자 인증이 확인되었습니다.", "success");
            await loadNews();
        } catch (error) {
            setStatus("인증 실패", "error");
            message("settingsMessage", error.message, "error");
            setBusy(true);
        }
    }

    $("saveSettingsBtn").addEventListener("click", async () => {
        const minutes = Number($("intervalMinutes").value);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
            message("settingsMessage", "수집 간격은 1~1440분 사이의 정수로 입력해 주세요.", "error");
            return;
        }
        setBusy(true);
        try {
            const data = await request("/settings", {
                method: "PUT",
                body: JSON.stringify({ interval_minutes: minutes })
            });
            message("settingsMessage", `자동 수집 간격을 ${data.interval_minutes}분으로 저장했습니다. 기존 대기 중인 주기 이후 새 간격이 적용됩니다.`, "success");
        } catch (error) {
            message("settingsMessage", error.message, "error");
        } finally {
            setBusy(false);
        }
    });

    $("crawlBtn").addEventListener("click", async () => {
        if (!confirm("MLB Korea에서 지금 최신 뉴스를 수집할까요?")) return;
        setBusy(true);
        message("settingsMessage", "뉴스 수집 중입니다. 기사 수에 따라 시간이 걸릴 수 있습니다.");
        try {
            const data = await request("/crawl", { method: "POST" });
            const result = data.result || {};
            message(
                "settingsMessage",
                `수집 완료 · 신규 ${result.new ?? 0}건 · 갱신 ${result.updated ?? 0}건 · 비 MLB 제외 ${result.skipped_non_mlb ?? 0}건`,
                "success"
            );
            page = 1;
            await loadNews();
        } catch (error) {
            message("settingsMessage", error.message, "error");
        } finally {
            setBusy(false);
        }
    });

    $("searchForm").addEventListener("submit", (event) => {
        event.preventDefault();
        page = 1;
        loadNews();
    });

    $("reloadBtn").addEventListener("click", () => {
        $("keyword").value = "";
        if ($("startDate")) $("startDate").value = "";
        if ($("endDate")) $("endDate").value = "";
        page = 1;
        message("listMessage", "");
        loadNews();
    });
    $("prevBtn").addEventListener("click", () => {
        if (page > 1) { page -= 1; loadNews(); }
    });
    $("nextBtn").addEventListener("click", () => {
        if (page * PAGE_SIZE < total) { page += 1; loadNews(); }
    });

    $("selectAll").addEventListener("change", (event) => {
        const checked = event.target.checked;
        document.querySelectorAll("#newsRows .news-table-check").forEach((box) => {
            box.checked = checked;
            const id = Number(box.getAttribute("aria-label").match(/\d+/)?.[0]);
            if (id) checked ? selectedIds.add(id) : selectedIds.delete(id);
        });
        updateSelectionState();
    });

    $("deleteSelectedBtn").addEventListener("click", async () => {
        const ids = [...selectedIds];
        if (!ids.length || !confirm(`선택한 ${ids.length}개 기사를 DB에서 삭제할까요?`)) return;
        setBusy(true);
        try {
            const data = await request("/bulk-delete", {
                method: "POST",
                body: JSON.stringify({ ids })
            });
            ids.forEach((id) => selectedIds.delete(id));
            message("listMessage", `${data.deleted ?? 0}개 기사를 삭제했습니다.`, "success");
            await loadNews();
        } catch (error) {
            message("listMessage", error.message, "error");
        } finally {
            setBusy(false);
        }
    });

    $("cleanupBtn").addEventListener("click", async () => {
        if (!confirm("제목에 KBO·NPB·CPBL 등 다른 리그가 명확히 표시된 저장 기사를 삭제할까요? 삭제는 되돌릴 수 없습니다.")) return;
        setBusy(true);
        try {
            const data = await request("/cleanup-non-mlb", { method: "POST" });
            selectedIds.clear();
            message("listMessage", `비 MLB 판별 기사 ${data.deleted ?? 0}건을 삭제했습니다.`, "success");
            page = 1;
            await loadNews();
        } catch (error) {
            message("listMessage", error.message, "error");
        } finally {
            setBusy(false);
        }
    });

    initialize();
})();
