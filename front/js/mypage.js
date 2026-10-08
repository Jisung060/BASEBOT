/* ==================================================
   마이페이지 공통 JS
================================================== */

/* 마이페이지 사이드바 불러오기 */
fetch("/components/mypage-sidebar.html")
    .then(response => response.text())
    .then(data => {

        const sidebar =
            document.getElementById("mypage-sidebar");

        if (!sidebar) {
            return;
        }

        sidebar.innerHTML = data;

        setActiveMypageMenu();

    })
    .catch(error => {

        console.error(
            "마이페이지 사이드바 불러오기 실패:",
            error
        );

    });


/* ==================================================
   현재 페이지 사이드바 active
================================================== */

function setActiveMypageMenu() {

    const currentPage =
        document.body.dataset.page;

    if (!currentPage) {
        return;
    }

    const menuLinks =
        document.querySelectorAll(
            ".mypage-sidebar-menu a"
        );

    menuLinks.forEach(link => {

        link.classList.remove("active");

        if (
            link.dataset.page ===
            currentPage
        ) {
            link.classList.add("active");
        }

    });
}


/* ==================================================
   로그인 사용자 정보
================================================== */

function getLoginUser() {

    const user =
        sessionStorage.getItem("user");

    if (!user) {
        return null;
    }

    try {

        return JSON.parse(user);

    } catch (error) {

        console.error(
            "사용자 정보 변환 실패:",
            error
        );

        return null;
    }
}


/* ==================================================
   로그인 확인
================================================== */

function checkLogin() {

    const accessToken =
        sessionStorage.getItem(
            "access_token"
        );

    if (!accessToken) {

        alert(
            "로그인이 필요한 서비스입니다."
        );

        location.href =
            "login.html";

        return false;
    }

    return true;
}


/* ==================================================
   화면에 사용자 정보 표시
================================================== */

function renderUserInfo() {

    const user =
        getLoginUser();

    if (!user) {
        return;
    }

    const nickname =
        document.getElementById(
            "userNickname"
        ) ||
        document.getElementById(
            "profileNickname"
        );

    const username =
        document.getElementById(
            "userUsername"
        ) ||
        document.getElementById(
            "profileUsername"
        );

    const email =
        document.getElementById(
            "userEmail"
        );

    if (nickname && user.nickname) {
        nickname.textContent =
            user.nickname;
    }

    if (username && user.username) {
        username.textContent =
            user.username;
    }

    if (email && user.email) {
        email.textContent =
            user.email;
    }
}


/* ==================================================
   페이지 실행
================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        if (!checkLogin()) {
            return;
        }

        renderUserInfo();

    }
);
