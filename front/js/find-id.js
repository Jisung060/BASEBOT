document.addEventListener("DOMContentLoaded", function () {


    /* ========================================
       사이드바 불러오기
    ======================================== */

    fetch("/components/auth-sidebar.html")
        .then(response => response.text())
        .then(data => {
            document.getElementById("auth-sidebar").innerHTML = data;
            // 현재 메뉴 활성화
            const menuItems =
                document.querySelectorAll(".auth-sidebar-menu a");
            menuItems.forEach(item => {
                item.classList.remove("active");
                if (item.textContent.trim() === "아이디 찾기") {
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

    /* ========================================
       아이디 찾기
    ======================================== */

    const findIdButton =
        document.getElementById("findIdButton");

    const nicknameInput =
        document.getElementById("nickname");

    const emailInput =
        document.getElementById("email");

    const findIdResult =
        document.getElementById("find-id-result");

    const foundUsername =
        document.getElementById("foundUsername");


    findIdButton.addEventListener(
        "click",
        function () {

            const nickname =
                nicknameInput.value.trim();

            const email =
                emailInput.value.trim();

            // 닉네임 검사
            if (nickname === "") {
                alert("닉네임을 입력해주세요.");
                nicknameInput.focus();
                return;
            }

            // 이메일 검사
            if (email === "") {
                alert("이메일을 입력해주세요.");
                emailInput.focus();
                return;
            }

            /* ========================================
               아이디 찾기 API 요청
            ======================================== */
            fetch("/auth/find-id", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    nickname: nickname,
                    email: email
                })
            })
                .then(response => {
                    return response.json();
                })
                .then(data => {
                    // 아이디 찾기 실패
                    if (!data.username) {
                        alert(
                            data.detail ||
                            "아이디를 찾을 수 없습니다."
                        );
                        return;
                    }
                    // 찾은 아이디 표시
                    foundUsername.textContent =
                        data.username;
                    // 결과 영역 표시
                    findIdResult.classList.add("active");
                })
                .catch(error => {
                    console.error(
                        "아이디 찾기 오류:",
                        error
                    );
                    alert(
                        "서버와 통신 중 오류가 발생했습니다."
                    );
                });
        }
    );

    /* ========================================
       Enter 키로 아이디 찾기
    ======================================== */

    nicknameInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                findIdButton.click();
            }
        }
    );

    emailInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                findIdButton.click();
            }
        }
    );
});