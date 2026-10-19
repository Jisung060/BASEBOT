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

// ==================================================
// 회원 탈퇴 신청
// ==================================================

document.addEventListener("DOMContentLoaded", () => {
    const withdrawalButton = document.getElementById(
        "withdrawalRequestButton"
    );

    if (!withdrawalButton) {
        return;
    }

    withdrawalButton.addEventListener("click", async () => {
        const confirmed = confirm(
            "회원 탈퇴를 신청하시겠습니까?\n" +
            "관리자 승인 후 탈퇴 처리됩니다."
        );

        if (!confirmed) {
            return;
        }

        const token = sessionStorage.getItem("access_token");

        if (!token) {
            alert("로그인이 필요합니다.");
            return;
        }

        withdrawalButton.disabled = true;

        try {
            const response = await fetch(
                "/users/me/withdrawal-request",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    data.detail || "탈퇴 신청에 실패했습니다."
                );
            }

            alert(data.message);

            // 신청 완료 후 버튼 비활성화
            withdrawalButton.textContent = "탈퇴 신청 완료";

        } catch (error) {
            alert(error.message);

            withdrawalButton.disabled = false;
        }
    });
});

document.addEventListener("DOMContentLoaded", async function () {

    // -----------------------------------------
    // 1. 관심 구단 한글 목록 로드 함수
    // -----------------------------------------
    const selectElement = document.getElementById("editFavoriteTeam");

    async function loadFavoriteTeams() {
        if (!selectElement) return;

        try {
            const response = await fetch("http://127.0.0.1:8000/api/teams");
            if (!response.ok) throw new Error("팀 목록 조회 실패");

            const teams = await response.json();

            // 기존 하드코딩 옵션(영문) 초기화
            selectElement.innerHTML = '<option value="">선택하지 않음</option>';

            teams.forEach(team => {
                const option = document.createElement("option");
                option.value = team.team_id || team.id;

                // main.js의 전역 한글 매핑 객체 활용
                const koreanName = window.koreanTeamNames && window.koreanTeamNames[team.team_code];
                option.textContent = koreanName || team.team_name;

                selectElement.appendChild(option);
            });

        } catch (error) {
            console.error("관심 팀 목록 로딩 오류:", error);
        }
    }

    // -----------------------------------------
    // 2. 초기 실행
    // -----------------------------------------
    await loadFavoriteTeams(); // 관심 구단 목록 채우기

    // (기존에 작성된 회원정보 조회 / 비밀번호 변경 / 탈퇴 처리 로직이 있다면 이 아래에 위치)

});