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
   DB에서 회원정보 조회
================================================== */

async function loadUserInfoFromDB() {

    const accessToken =
        sessionStorage.getItem(
            "access_token"
        );

    if (!accessToken) {
        return;
    }

    try {

        const response =
            await fetch(
                "/users/mypage",
                {
                    method: "GET",

                    headers: {
                        "Authorization":
                            `Bearer ${accessToken}`
                    }
                }
            );


        /* ==================================================
           로그인 만료
        ================================================== */

        if (response.status === 401) {

            alert(
                "로그인이 만료되었습니다."
            );

            sessionStorage.removeItem(
                "access_token"
            );

            sessionStorage.removeItem(
                "user"
            );

            location.href =
                "login.html";

            return;
        }


        /* ==================================================
           기타 오류
        ================================================== */

        if (!response.ok) {

            throw new Error(
                "회원정보를 불러오지 못했습니다."
            );
        }




        /* ==================================================
           DB 데이터
        ================================================== */

        const data =
            await response.json();

        console.log(
            "DB 회원정보:",
            data
        );


        /* ==================================================
           프로필 닉네임
        ================================================== */

        const profileNickname =
            document.getElementById(
                "profileNickname"
            );

        if (profileNickname) {

            profileNickname.textContent =
                data.nickname || "회원";
        }


        /* ==================================================
           프로필 아이디
        ================================================== */

        const profileUsername =
            document.getElementById(
                "profileUsername"
            );

        if (profileUsername) {

            profileUsername.textContent =
                data.username || "-";
        }


        /* ==================================================
           회원정보 - 아이디
        ================================================== */

        const userUsername =
            document.getElementById(
                "userUsername"
            );

        if (userUsername) {

            userUsername.textContent =
                data.username || "-";
        }


        /* ==================================================
           회원정보 - 닉네임
        ================================================== */

        const userNickname =
            document.getElementById(
                "userNickname"
            );

        if (userNickname) {

            userNickname.textContent =
                data.nickname || "-";
        }


        /* ==================================================
           회원정보 - 이메일
        ================================================== */

        const userEmail =
            document.getElementById(
                "userEmail"
            );

        if (userEmail) {

            userEmail.textContent =
                data.email || "-";
        }


        /* ==================================================
           회원정보 - 관심 팀
        ================================================== */

        const userFavoriteTeam =
            document.getElementById(
                "userFavoriteTeam"
            );

        if (userFavoriteTeam) {

            if (data.favorite_team_name) {

                userFavoriteTeam.textContent =
                    data.favorite_team_name;

            } else {

                userFavoriteTeam.textContent =
                    "설정된 관심 팀이 없습니다.";
            }
        }


        /* ==================================================
           포인트
        ================================================== */

        const userPoint =
            document.getElementById("userPoint");

        if (userPoint) {

            userPoint.textContent =
                `${Number(data.point || 0).toLocaleString()} P`;
        }


        /* ==================================================
           등급
        ================================================== */

        const userGrade =
            document.getElementById("userGrade");

        if (userGrade) {

            userGrade.textContent =
                data.grade || "-";
        }


        /* ==================================================
           회원 등급 뱃지
        ================================================== */

        const userGradeBadge =
            document.getElementById("userGradeBadge");

        if (userGradeBadge) {

            userGradeBadge.textContent =
                data.grade || "-";
        }


        /* ==================================================
           현재 연속 적중
        ================================================== */

        const userPredictionStreak =
            document.getElementById(
                "userPredictionStreak"
            );

        if (userPredictionStreak) {

            userPredictionStreak.textContent =
                `${data.prediction_streak || 0}회`;
        }


        /* ==================================================
           최고 연속 적중
        ================================================== */

        const userMaxPredictionStreak =
            document.getElementById(
                "userMaxPredictionStreak"
            );

        if (userMaxPredictionStreak) {

            userMaxPredictionStreak.textContent =
                `${data.max_prediction_streak || 0}회`;
        }


    } catch (error) {

        console.error(
            "DB 회원정보 조회 오류:",
            error
        );

        alert(
            "회원정보를 불러오는 중 오류가 발생했습니다."
        );
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

        loadUserInfoFromDB();

    }
);