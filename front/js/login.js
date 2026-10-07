document.addEventListener("DOMContentLoaded", function () {

    /* ==================================================
       Auth Sidebar 불러오기
    ================================================== */

    fetch("/components/auth-sidebar.html")
        .then(response => response.text())
        .then(data => {

            document.getElementById("auth-sidebar").innerHTML = data;

            // 현재 페이지 로그인 메뉴 활성화
            const menuItems =
                document.querySelectorAll(
                    ".auth-sidebar-menu a"
                );
            menuItems.forEach(item => {
                item.classList.remove("active");
                if (
                    item.textContent.trim() === "로그인"
                ) {
                    item.classList.add("active");
                }
            });
        })
        .catch(error => {
            console.error(
                "Auth Sidebar 불러오기 실패:",
                error
            );
        });

    /* ==================================================
       로그인 버튼
    ================================================== */

    const loginButton =
        document.getElementById("loginButton");

    loginButton.addEventListener(
        "click",
        async function () {

            const username =
                document
                    .getElementById("username")
                    .value
                    .trim();

            const password =
                document
                    .getElementById("password")
                    .value;

            /* ==================================================
               아이디 검사
            ================================================== */
            if (username === "") {

                alert("아이디를 입력해주세요.");
                document
                    .getElementById("username")
                    .focus();
                return;
            }

            /* ==================================================
               비밀번호 검사
            ================================================== */

            if (password === "") {

                alert("비밀번호를 입력해주세요.");

                document
                    .getElementById("password")
                    .focus();

                return;
            }

            /* ==================================================
               백엔드 로그인 요청
            ================================================== */
            try {
                const response = await fetch(
                    "/auth/login",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type": "application/json"
                        },

                        body: JSON.stringify({
                            username: username,
                            password: password
                        })
                    }
                );

                const data = await response.json();
                /* ==================================================
                   로그인 실패
                ================================================== */

                if (!response.ok) {

                    alert(
                        data.detail ||
                        "로그인에 실패했습니다."
                    );

                    return;
                }
                /* ==================================================
                   JWT 저장
                ================================================== */
                sessionStorage.setItem("access_token", data.access_token);

                console.log("로그인 응답 data:", data);
                console.log("저장하려는 token:", data.access_token);
                console.log(
                    "저장 직후 token:",
                    sessionStorage.getItem("access_token")
                );
                /* ==================================================
                   로그인 사용자 정보 저장
                ================================================== */
                sessionStorage.setItem(
                    "user",
                    JSON.stringify({
                        user_id: data.user_id,
                        username: data.username,
                        nickname: data.nickname
                    })
                );

                /* ==================================================
                   로그인 성공
                ================================================== */
                alert(
                    data.nickname +
                    "님, 로그인되었습니다."
                );

                /* ==================================================
                   메인 페이지 이동
                ================================================== */
                location.href = "/";

            } catch (error) {
                console.error(
                    "로그인 요청 실패:",
                    error
                );
                alert(
                    "서버와 연결할 수 없습니다."
                );
            }
        }
    );
});


/* ==================================================
   Enter 키로 로그인
================================================== */

const usernameInput =
    document.getElementById("username");

const passwordInput =
    document.getElementById("password");


usernameInput.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Enter") {

            loginButton.click();
        }
    }
);

passwordInput.addEventListener(
    "keydown",
    function (event) {
        if (event.key === "Enter") {

            loginButton.click();
        }
    }
);