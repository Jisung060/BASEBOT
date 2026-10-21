/* =========================================
   공지사항 작성 / 수정 (notice-write.html)
   - 주소에 ?id=3 이 있으면 수정, 없으면 새 글 작성
   - 관리자만 사용 가능 (서버에서도 다시 확인함)
========================================= */

const form = document.getElementById("noticeWriteForm");
const editId = new URLSearchParams(location.search).get("id");   // 수정할 공지 번호 (없으면 null)

// 알림 팝업 (커뮤니티 공통 팝업과 같은 모양)
function showBasebotModal(title, message, callback = null) {
    const modal = document.getElementById("basebotModal");
    document.getElementById("basebotModalTitle").textContent = title;
    document.getElementById("basebotModalMessage").textContent = message;
    modal.classList.add("show");
    document.getElementById("basebotModalButton").onclick = () => {
        modal.classList.remove("show");
        if (callback) callback();
    };
}

// 로그인한 사용자가 관리자인지 확인
function isAdminUser() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user"));
        return Boolean(sessionStorage.getItem("access_token")) && user?.role === "ADMIN";
    } catch (error) {
        return false;
    }
}

// 수정 모드: 기존 공지 내용을 입력칸에 채움 (조회 수는 올리지 않음)
async function loadNoticeForEdit() {
    document.getElementById("writePageTitle").textContent = "공지사항 수정";
    document.getElementById("submitWriteButton").textContent = "수정완료";
    document.getElementById("cancelWriteButton").href = `notice-view.html?id=${encodeURIComponent(editId)}`;

    const response = await fetch(`/api/notices/${encodeURIComponent(editId)}?increase_view=false`);
    if (!response.ok) {
        showBasebotModal("오류", "수정할 공지사항을 찾을 수 없습니다.", () => location.href = "/notice.html");
        return;
    }
    const notice = await response.json();
    form.category.value = notice.category;
    form.is_pinned.value = notice.is_pinned ? "1" : "0";
    form.title.value = notice.title;
    form.content.value = notice.content;
}

// 작성완료 / 수정완료
form.addEventListener("submit", async event => {
    event.preventDefault();   // 페이지 새로고침 막기

    const data = {
        category: form.category.value,
        is_pinned: form.is_pinned.value === "1",
        title: form.title.value.trim(),
        content: form.content.value
    };

    if (!data.title || !data.content.trim()) {
        showBasebotModal("입력 확인", "제목과 내용을 입력해 주세요.");
        return;
    }

    try {
        const response = await fetch(editId ? `/api/notices/${encodeURIComponent(editId)}` : "/api/notices", {
            method: editId ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${sessionStorage.getItem("access_token")}`
            },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof result.detail === "string" ? result.detail : "저장에 실패했습니다.");
        }

        showBasebotModal(
            editId ? "수정 완료" : "등록 완료",
            result.message,
            () => location.href = `/notice-view.html?id=${encodeURIComponent(result.notice_id)}`
        );
    } catch (error) {
        console.error("공지사항 저장 오류:", error);
        showBasebotModal("저장 오류", error.message);
    }
});

// 시작: 관리자가 아니면 목록으로 돌려보냄
document.addEventListener("DOMContentLoaded", () => {
    if (!isAdminUser()) {
        showBasebotModal("접근 불가", "공지사항 작성은 관리자만 이용할 수 있습니다.", () => location.href = "/notice.html");
        return;
    }
    if (editId) loadNoticeForEdit();
});
