// ==================================================
// 메인 - 공지사항 목록 (고정 공지 먼저, 최신순 4개)
// /api/notices 데이터로 main.html의 #main-notice-list를 채움
// ==================================================
async function loadMainNotices() {
    const list = document.getElementById('main-notice-list');
    if (!list) return;

    const CATEGORY_LABEL = { NOTICE: '일반', IMPORTANT: '중요', MAINTENANCE: '점검' };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    try {
        const response = await fetch('/api/notices?limit=4', { cache: 'no-store' });
        if (!response.ok) throw new Error('공지사항 로드 실패');

        const notices = (await response.json()).notices || [];
        if (notices.length === 0) {
            list.innerHTML = '<li><span>등록된 공지사항이 없습니다.</span></li>';
            return;
        }

        list.innerHTML = notices.map((n) => {
            const category = n.category.toLowerCase();
            const date = n.created_at ? n.created_at.slice(5, 10).replace('-', '.') : '-';
            return `
                <li class="${n.is_pinned ? 'pinned' : ''}">
                    <p class="notice-title">
                        ${n.is_pinned ? '<em class="notice-pin">고정</em>' : ''}
                        <em class="notice-badge ${category}">${CATEGORY_LABEL[n.category] || ''}</em>
                        <a href="/notice-view.html?id=${encodeURIComponent(n.notice_id)}"><strong>${esc(n.title)}</strong></a>
                    </p>
                    <span>${date}</span>
                </li>`;
        }).join('');
    } catch (err) {
        console.error('메인 공지사항 로드 에러:', err);
        list.innerHTML = '<li><span>공지사항을 불러오지 못했습니다.</span></li>';
    }
}

document.addEventListener('DOMContentLoaded', loadMainNotices);
