document.addEventListener("DOMContentLoaded", function () {

    /* ========================================
       사이드바
    ======================================== */

    fetch("../components/auth-sidebar.html")
        .then(response => response.text())
        .then(data => {

            document.getElementById("auth-sidebar").innerHTML = data;

            const menuItems =
                document.querySelectorAll(".auth-sidebar-menu a");

            menuItems.forEach(item => {

                item.classList.remove("active");

                if (item.textContent.trim() === "비밀번호 찾기") {
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
       회원정보 확인
    ======================================== */

    const verifyButton =
        document.getElementById("verifyButton");


    verifyButton.addEventListener("click", function () {

        const username =
            document.getElementById("username").value.trim();

        const email =
            document.getElementById("email").value.trim();


        // 아이디 검사
        if (username === "") {

            alert("아이디를 입력해주세요.");

            return;
        }


        // 이메일 검사
        if (email === "") {

            alert("이메일을 입력해주세요.");

            return;
        }


        /*
         * 현재는 백엔드 연결 전
         *
         * 나중에는
         *
         * username + email
         *        ↓
         * FastAPI
         *        ↓
         * users 테이블 확인
         *
         * 과정을 거치게 된다.
         */

        document
            .getElementById("password-find-step")
            .style.display = "none";

        document
            .getElementById("password-reset-step")
            .classList.add("active");

    });


    /* ========================================
       비밀번호 유효성 검사
    ======================================== */

    function validatePassword(password) {

        const hasLower =
            /[a-z]/.test(password);

        const hasUpper =
            /[A-Z]/.test(password);

        const hasNumber =
            /[0-9]/.test(password);

        const hasSpecial =
            /[!@#$%^&*(),.?":{}|<>_\-+=/\\[\]]/.test(password);


        let count = 0;

        if (hasLower) count++;
        if (hasUpper) count++;
        if (hasNumber) count++;
        if (hasSpecial) count++;


        /*
         * 2가지 조합 → 10~16자
         * 3가지 이상 → 8~16자
         */

        if (count === 2) {

            return password.length >= 10 &&
                   password.length <= 16;

        }

        if (count >= 3) {

            return password.length >= 8 &&
                   password.length <= 16;

        }

        return false;
    }


    /* ========================================
       비밀번호 변경
    ======================================== */

    const resetPasswordButton =
        document.getElementById("resetPasswordButton");


    resetPasswordButton.addEventListener(
        "click",
        function () {

            const newPassword =
                document.getElementById("newPassword")
                    .value;

            const newPasswordConfirm =
                document.getElementById("newPasswordConfirm")
                    .value;


            // 비밀번호 검사
            if (!validatePassword(newPassword)) {

                alert(
                    "비밀번호는 영문 대문자, 영문 소문자, 숫자, 특수문자 중 " +
                    "2가지 조합은 10~16자, " +
                    "3가지 이상 조합은 8~16자로 입력해주세요."
                );

                return;
            }


            // 비밀번호 확인
            if (newPassword !== newPasswordConfirm) {

                alert(
                    "비밀번호가 일치하지 않습니다."
                );

                return;
            }


            // 완료 화면
            document
                .getElementById("password-reset-step")
                .classList.remove("active");

            document
                .getElementById("password-complete-step")
                .classList.add("active");

        }
    );

});