/* ==================================================
   회원정보 수정
================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const user =
            getLoginUser();

        if (!user) {
            return;
        }

        const username =
            document.getElementById(
                "editUsername"
            );

        const nickname =
            document.getElementById(
                "editNickname"
            );

        const email =
            document.getElementById(
                "editEmail"
            );

        if (username && user.username) {
            username.value =
                user.username;
        }

        if (nickname && user.nickname) {
            nickname.value =
                user.nickname;
        }

        if (email && user.email) {
            email.value =
                user.email;
        }


        /* 회원정보 저장 */
        const memberEditForm =
            document.getElementById(
                "memberEditForm"
            );

        if (memberEditForm) {

            memberEditForm.addEventListener(
                "submit",
                function (event) {

                    event.preventDefault();

                    /*
                     * 현재는 화면 동작만 연결.
                     * 실제 DB 저장은 회원정보 수정 API 연결 후
                     * fetch("/users/me") 등의 API 호출로 교체.
                     */

                    alert(
                        "회원정보 수정 API 연결 후 저장됩니다."
                    );
                }
            );
        }


        /* 비밀번호 변경 */
        const passwordForm =
            document.getElementById(
                "passwordForm"
            );

        if (passwordForm) {

            passwordForm.addEventListener(
                "submit",
                function (event) {

                    event.preventDefault();

                    const newPassword =
                        document.getElementById(
                            "newPassword"
                        ).value;

                    const confirmPassword =
                        document.getElementById(
                            "newPasswordConfirm"
                        ).value;

                    if (
                        newPassword !==
                        confirmPassword
                    ) {

                        alert(
                            "새 비밀번호가 일치하지 않습니다."
                        );

                        return;
                    }

                    alert(
                        "비밀번호 변경 API 연결 후 저장됩니다."
                    );
                }
            );
        }

    }
);
