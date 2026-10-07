document.addEventListener("DOMContentLoaded", function () {


    /* ========================================
       사이드바
    ======================================== */

    fetch("/components/auth-sidebar.html")
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

    const usernameInput =
        document.getElementById("username");

    const emailInput =
        document.getElementById("email");

    const passwordFindStep =
        document.getElementById("password-find-step");

    const passwordResetStep =
        document.getElementById("password-reset-step");

    verifyButton.addEventListener(
        "click",
        function () {
            const username =
                usernameInput.value.trim();
            const email =
                emailInput.value.trim();

            // 아이디 검사
            if (username === "") {
                alert("아이디를 입력해주세요.");
                usernameInput.focus();
                return;
            }

            // 이메일 검사
            if (email === "") {
                alert("이메일을 입력해주세요.");
                emailInput.focus();
                return;
            }

            /* ========================================
               회원정보 확인 API
            ======================================== */

            fetch("/auth/verify-password-reset", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    username: username,
                    email: email

                })
            })
                .then(response => {
                    return response.json();
                })
                .then(data => {
                    // 회원정보 확인 실패
                    if (!data.verified) {
                        alert(
                            data.detail ||
                            "입력하신 정보와 일치하는 회원이 없습니다."
                        );
                        return;
                    }

                    // 회원정보 확인 성공
                    passwordFindStep.style.display =
                        "none";
                    passwordResetStep.classList.add(
                        "active"
                    );
                })
                .catch(error => {
                    console.error(
                        "회원정보 확인 오류:",
                        error
                    );

                    alert(
                        "서버와 통신 중 오류가 발생했습니다."
                    );
                });
        }
    );


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
            return (
                password.length >= 10 &&
                password.length <= 16
            );
        }

        if (count >= 3) {
            return (
                password.length >= 8 &&
                password.length <= 16
            );
        }
        return false;
    }


    /* ========================================
       비밀번호 변경
    ======================================== */

    const resetPasswordButton =
        document.getElementById("resetPasswordButton");

    const passwordCompleteStep =
        document.getElementById("password-complete-step");

    const newPasswordInput =
        document.getElementById("newPassword");

    const newPasswordConfirmInput =
        document.getElementById("newPasswordConfirm");


    resetPasswordButton.addEventListener(
        "click",
        function () {

            const username =
                usernameInput.value.trim();

            const email =
                emailInput.value.trim();

            const newPassword =
                newPasswordInput.value;

            const newPasswordConfirm =
                newPasswordConfirmInput.value;

            // 비밀번호 검사
            if (!validatePassword(newPassword)) {
                alert(
                    "비밀번호는 영문 대문자, 영문 소문자, 숫자, 특수문자 중 " +
                    "2가지 조합은 10~16자, " +
                    "3가지 이상 조합은 8~16자로 입력해주세요."
                );
                newPasswordInput.focus();
                return;
            }

            // 비밀번호 확인 검사
            if (newPasswordConfirm === "") {
                alert(
                    "비밀번호 확인을 입력해주세요."
                );
                newPasswordConfirmInput.focus();
                return;
            }

            // 비밀번호 일치 검사
            if (newPassword !== newPasswordConfirm) {
                alert(
                    "비밀번호가 일치하지 않습니다."
                );
                newPasswordConfirmInput.focus();
                return;
            }


            /* ========================================
               비밀번호 변경 API
            ======================================== */

            fetch("/auth/reset-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    username: username,
                    email: email,
                    new_password: newPassword

                })
            })
                .then(response => {
                    return response.json();
                })
                .then(data => {
                    // 비밀번호 변경 실패
                    if (!data.message) {
                        alert(
                            data.detail ||
                            "비밀번호 변경에 실패했습니다."
                        );
                        return;
                    }


                    /* ========================================
                       완료 화면
                    ======================================== */
                    passwordResetStep.classList.remove(
                        "active"
                    );
                    passwordCompleteStep.classList.add(
                        "active"
                    );
                })
                .catch(error => {
                    console.error(
                        "비밀번호 변경 오류:",
                        error
                    );
                    alert(
                        "서버와 통신 중 오류가 발생했습니다."
                    );
                });
        }
    );


    /* ========================================
       Enter 키
    ======================================== */

    usernameInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                verifyButton.click();
            }
        }
    );


    emailInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                verifyButton.click();
            }
        }
    );

    newPasswordInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                resetPasswordButton.click();
            }
        }
    );

    newPasswordConfirmInput.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                resetPasswordButton.click();
            }
        }
    );
});