/* ==================================================
   회원정보 수정
================================================== */

document.addEventListener(
    "DOMContentLoaded",
    async function () {

        /* ==================================================
           로그인 확인
        ================================================== */
        const user =
            JSON.parse(
                sessionStorage.getItem("user")
            );

        const token =
            sessionStorage.getItem(
                "access_token"
            );

        if (!token) {
            alert("로그인이 필요합니다.");
            location.href = "/login.html";
            return;
        }

        /* ==================================================
           HTML 요소
        ================================================== */

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
        const favoriteTeam =
            document.getElementById(
                "editFavoriteTeam"
            );
        const memberEditForm =
            document.getElementById(
                "memberEditForm"
            );

        /* ==================================================
           현재 회원정보 조회
        ================================================== */

        try {

            const response =
                await fetch(
                    "/users/me",
                    {
                        method: "GET",

                        headers: {
                            "Authorization":
                                `Bearer ${token}`
                        }
                    }
                );

            /* 로그인 만료 */

            if (response.status === 401) {

                alert(
                    "로그인이 만료되었습니다."
                );

                sessionStorage.removeItem("access_token");
                sessionStorage.removeItem("user");

                location.href =
                    "/login.html";

                return;
            }

            if (!response.ok) {

                throw new Error(
                    "회원정보를 불러오지 못했습니다."
                );
            }

            const data =
                await response.json();


            /* ==================================================
               회원정보 화면 표시
            ================================================== */

            if (username) {
                username.value =
                    data.username || "";

            }

            if (nickname) {
                nickname.value =
                    data.nickname || "";

            }

            if (email) {
                email.value =
                    data.email || "";

            }


            if (favoriteTeam) {
                favoriteTeam.value =
                    data.favorite_team_id
                    ? String(data.favorite_team_id)
                    : "";

            }


        } catch (error) {

            console.error(
                "회원정보 조회 오류:",
                error
            );

            alert(
                "회원정보를 불러오는 중 오류가 발생했습니다."
            );
            return;
        }


        /* ==================================================
           회원정보 저장
        ================================================== */

        if (memberEditForm) {

            memberEditForm.addEventListener(
                "submit",
                async function (event) {

                    event.preventDefault();

                    /* 입력값 */

                    const nicknameValue =
                        nickname.value.trim();

                    const emailValue =
                        email.value.trim();

                    const favoriteTeamValue =
                        favoriteTeam.value;


                    /* ==================================================
                       기본 입력값 확인
                    ================================================== */

                    if (!nicknameValue) {
                        alert(
                            "닉네임을 입력해주세요."
                        );
                        nickname.focus();
                        return;
                    }

                    if (!emailValue) {
                        alert(
                            "이메일을 입력해주세요."
                        );
                        email.focus();
                        return;
                    }


                    /* ==================================================
                       수정 데이터
                    ================================================== */

                    const requestData = {
                        nickname:
                            nicknameValue,
                        email:
                            emailValue,
                        favorite_team_id:
                            favoriteTeamValue
                                ? Number(favoriteTeamValue)
                                : null

                    };

                    try {


                        /* ==================================================
                           회원정보 수정 API
                        ================================================== */

                        const response =
                            await fetch(
                                "/users/me",
                                {
                                    method: "PUT",

                                    headers: {

                                        "Content-Type":
                                            "application/json",

                                        "Authorization":
                                            `Bearer ${token}`

                                    },

                                    body:
                                        JSON.stringify(
                                            requestData
                                        )
                                }
                            );

                        /* ==================================================
                           응답 처리
                        ================================================== */

                        const data =
                            await response.json();

                        /* 로그인 만료 */

                        if (
                            response.status === 401
                        ) {

                            alert(
                                "로그인이 만료되었습니다."
                            );

                            localStorage.removeItem(
                                "access_token"
                            );

                            localStorage.removeItem(
                                "loginUser"
                            );

                            location.href =
                                "/login.html";

                            return;
                        }

                        /* 닉네임 / 이메일 중복 */
                        if (
                            response.status === 409
                        ) {
                            alert(
                                data.detail
                            );
                            return;
                        }

                        /* 기타 오류 */
                        if (!response.ok) {
                            alert(
                                data.detail ||
                                "회원정보 수정에 실패했습니다."
                            );
                            return;
                        }

                        /* ==================================================
                           수정 성공
                        ================================================== */

                        alert(
                            "회원정보가 수정되었습니다."
                        );

                        /* ==================================================
                           localStorage 회원정보도 갱신
                        ================================================== */

                        const loginUser =
                            getLoginUser();

                        if (loginUser) {

                            loginUser.nickname =
                                data.nickname;

                            loginUser.email =
                                data.email;

                            loginUser.favorite_team_id =
                                data.favorite_team_id;

                            localStorage.setItem(
                                "loginUser",
                                JSON.stringify(
                                    loginUser
                                )
                            );
                        }

                        /* 마이페이지 이동 */
                        location.href =
                            "/mypage.html";

                    } catch (error) {
                        console.error(
                            "회원정보 수정 오류:",
                            error
                        );
                        alert(
                            "회원정보 수정 중 오류가 발생했습니다."
                        );
                    }
                }
            );
        }
    }
);