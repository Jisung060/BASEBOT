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

    findIdButton.addEventListener("click", function () {

        const nickname =
            document.getElementById("nickname").value.trim();

        const email =
            document.getElementById("email").value.trim();


        // 닉네임 검사
        if (nickname === "") {

            alert("닉네임을 입력해주세요.");

            return;
        }


        // 이메일 검사
        if (email === "") {

            alert("이메일을 입력해주세요.");

            return;
        }


        // 현재는 백엔드 연결 전
        alert(
            "아이디 찾기 기능은 백엔드 연결 후 구현됩니다."
        );

    });

});