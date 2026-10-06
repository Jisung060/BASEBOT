/* =========================================================
   인증 페이지 공통 사이드바
========================================================= */

fetch("/components/auth-sidebar.html")
    .then(response => response.text())
    .then(data => {
        document.getElementById("auth-sidebar").innerHTML = data;
    })
    .catch(error => {
        console.error("Auth Sidebar 불러오기 실패:", error);
    });


/* =========================================================
   BASEBOT 회원가입
========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    let currentStep = 1;


    /* =====================================================
       Step 변경
    ====================================================== */

    function moveStep(step) {

        currentStep = step;

        // 모든 페이지 숨기기
        document.querySelectorAll(".signup-page").forEach(function (page) {
            page.classList.remove("active");
        });

        // 현재 페이지 표시
        const currentPage = document.getElementById("step" + step);

        if (currentPage) {
            currentPage.classList.add("active");
        }


        // Step 표시 변경
        document.querySelectorAll(".signup-step").forEach(function (stepElement) {

            const stepNumber =
                Number(stepElement.getAttribute("data-step"));

            stepElement.classList.remove("active");

            if (stepNumber === step) {
                stepElement.classList.add("active");
            }

        });

    }


    /* =====================================================
       Step 1 → Step 2
    ====================================================== */

    document.getElementById("step1Next").addEventListener("click", function () {

        const termsAgree =
            document.getElementById("termsAgree").checked;

        const privacyAgree =
            document.getElementById("privacyAgree").checked;


        if (!termsAgree) {

            alert("이용약관에 동의해주세요.");

            return;
        }


        if (!privacyAgree) {

            alert("개인정보 수집 및 이용에 동의해주세요.");

            return;
        }


        moveStep(2);

    });


    /* =====================================================
       아이디 유효성 검사
    ====================================================== */

    function validateUsername(username) {

        // 영문 소문자 + 숫자
        // 6~15자
        const usernameRegex = /^[a-z0-9]{6,15}$/;

        return usernameRegex.test(username);

    }


    /* =====================================================
       비밀번호 유효성 검사
    ====================================================== */

    function validatePassword(password) {

        // 길이
        const length = password.length;

        if (length < 8 || length > 16) {
            return false;
        }


        // 영문 대문자
        const hasUpper = /[A-Z]/.test(password);

        // 영문 소문자
        const hasLower = /[a-z]/.test(password);

        // 숫자
        const hasNumber = /[0-9]/.test(password);

        // 특수문자
        const hasSpecial = /[^A-Za-z0-9]/.test(password);


        let combinationCount = 0;

        if (hasUpper) combinationCount++;
        if (hasLower) combinationCount++;
        if (hasNumber) combinationCount++;
        if (hasSpecial) combinationCount++;


        /*
         * 2종류 조합 → 10~16자
         * 3종류 이상 → 8~16자
         */

        if (combinationCount === 2) {

            return length >= 10 && length <= 16;

        }


        if (combinationCount >= 3) {

            return length >= 8 && length <= 16;

        }


        return false;

    }


    /* =====================================================
       아이디 중복확인
    ====================================================== */

    const usernameInput =
        document.getElementById("username");

    const checkUsernameButton =
        document.getElementById("checkUsername");


    // 중복확인 상태
    let usernameChecked = false;

    // 중복확인한 아이디
    let checkedUsername = "";


    /* -----------------------------------------------------
       중복확인 버튼 클릭
    ------------------------------------------------------ */

    checkUsernameButton.addEventListener("click", async function () {

        const username = usernameInput.value.trim();


        // 아이디 입력 여부
        if (username === "") {

            alert("아이디를 입력해주세요.");

            usernameInput.focus();

            return;
        }


        // 아이디 형식 검사
        if (!validateUsername(username)) {

            alert(
                "아이디는 영문 소문자와 숫자를 조합하여\n" +
                "6~15자로 입력해주세요."
            );

            usernameInput.focus();

            return;
        }


        try {

            // FastAPI 아이디 중복확인 API
            const response = await fetch(
                "http://127.0.0.1:8000/auth/username-check?username=" +
                encodeURIComponent(username)
            );


            // FastAPI 응답 JSON
            const result = await response.json();


            /* ---------------------------------------------
               사용 가능한 아이디
            --------------------------------------------- */

            if (response.ok && result.available) {

                alert(result.message);

                usernameChecked = true;

                checkedUsername = username;

                return;
            }


            /* ---------------------------------------------
               이미 사용 중인 아이디
            --------------------------------------------- */

            usernameChecked = false;

            checkedUsername = "";

            alert(
                result.message ||
                "이미 사용 중인 아이디입니다."
            );


        } catch (error) {

            console.error("아이디 중복확인 오류:", error);

            alert(
                "서버와 연결할 수 없습니다.\n\n" +
                "FastAPI 서버가 실행 중인지 확인해주세요."
            );

        }

    });


    /* -----------------------------------------------------
       아이디 변경 시 중복확인 상태 초기화
    ------------------------------------------------------ */

    usernameInput.addEventListener("input", function () {

        usernameChecked = false;

        checkedUsername = "";

    });


    /* =====================================================
       Step 2 → Step 3
    ====================================================== */

    document.getElementById("step2Next").addEventListener("click", function () {

        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;

        const passwordConfirm =
            document.getElementById("passwordConfirm").value;

        const nickname =
            document.getElementById("nickname").value.trim();

        const email =
            document.getElementById("email").value.trim();


        /* -------------------------------------------------
           아이디
        ------------------------------------------------- */

        if (!validateUsername(username)) {

            alert(
                "아이디는 영문 소문자와 숫자를 조합하여\n" +
                "6~15자로 입력해주세요."
            );

            document.getElementById("username").focus();

            return;
        }


        /* -------------------------------------------------
           아이디 중복확인
        ------------------------------------------------- */

        if (
            !usernameChecked ||
            checkedUsername !== username
        ) {

            alert("아이디 중복확인을 해주세요.");

            document.getElementById("username").focus();

            return;
        }


        /* -------------------------------------------------
           비밀번호
        ------------------------------------------------- */

        if (!validatePassword(password)) {

            alert(
                "비밀번호 조건을 확인해주세요.\n\n" +
                "2종류 조합: 10~16자\n" +
                "3종류 이상 조합: 8~16자"
            );

            document.getElementById("password").focus();

            return;
        }


        /* -------------------------------------------------
           비밀번호 확인
        ------------------------------------------------- */

        if (password !== passwordConfirm) {

            alert("비밀번호가 일치하지 않습니다.");

            document.getElementById("passwordConfirm").focus();

            return;
        }


        /* -------------------------------------------------
           닉네임
        ------------------------------------------------- */

        if (nickname === "") {

            alert("닉네임을 입력해주세요.");

            document.getElementById("nickname").focus();

            return;
        }


        /* -------------------------------------------------
           이메일
        ------------------------------------------------- */

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {

            alert("올바른 이메일 주소를 입력해주세요.");

            document.getElementById("email").focus();

            return;
        }


        /* -------------------------------------------------
           회원정보 확인 화면에 출력
        ------------------------------------------------- */

        document.getElementById("confirmUsername").textContent =
            username;

        document.getElementById("confirmNickname").textContent =
            nickname;

        document.getElementById("confirmEmail").textContent =
            email;


        const favoriteTeam =
            document.getElementById("favoriteTeam");

        const selectedTeam =
            favoriteTeam.options[favoriteTeam.selectedIndex].text;


        document.getElementById("confirmFavoriteTeam").textContent =
            selectedTeam;


        moveStep(3);

    });


    /* =====================================================
       Step 2 → Step 1
    ====================================================== */

    document.getElementById("step2Prev").addEventListener("click", function () {

        moveStep(1);

    });


    /* =====================================================
       Step 3 → Step 2
    ====================================================== */

    document.getElementById("step3Prev").addEventListener("click", function () {

        moveStep(2);

    });


    /* =====================================================
       FastAPI 회원가입
    ====================================================== */

    async function signup() {

        // 입력값 가져오기
        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;

        const nickname =
            document.getElementById("nickname").value.trim();

        const email =
            document.getElementById("email").value.trim();

        const favoriteTeam =
            document.getElementById("favoriteTeam").value;


        // FastAPI로 보낼 데이터
        const data = {

            username: username,

            password: password,

            nickname: nickname,

            email: email,

            favorite_team_id:
                favoriteTeam === ""
                    ? null
                    : Number(favoriteTeam)

        };


        try {

            // FastAPI 회원가입 API 호출
            const response = await fetch(
                "http://127.0.0.1:8000/auth/signup",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(data)
                }
            );


            // FastAPI 응답 JSON
            const result = await response.json();


            /* ---------------------------------------------
               회원가입 실패
            --------------------------------------------- */

            if (!response.ok) {

                alert(
                    result.detail ||
                    "회원가입에 실패했습니다."
                );

                return;
            }


            /* ---------------------------------------------
               회원가입 성공
            --------------------------------------------- */

            alert("회원가입이 완료되었습니다.");

            moveStep(4);


        } catch (error) {

            console.error("회원가입 오류:", error);

            alert(
                "서버와 연결할 수 없습니다.\n\n" +
                "FastAPI 서버가 실행 중인지 확인해주세요."
            );

        }

    }


    /* =====================================================
       Step 3 → 회원가입
    ====================================================== */

    document.getElementById("signupComplete").addEventListener("click", function () {

        signup();

    });


    /* =====================================================
       로그인 페이지 이동
    ====================================================== */

    document.getElementById("goLogin").addEventListener("click", function () {

        location.href = "login.html";

    });


    /* =====================================================
       메인 페이지 이동
    ====================================================== */

    document.getElementById("goMain").addEventListener("click", function () {

        location.href = "main.html";

    });

});


/* 로그인 */
const loginButton = document.getElementById("loginButton");

if (loginButton) {

    loginButton.addEventListener("click", async function () {

        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;


        if (!username) {

            alert("아이디를 입력해주세요.");

            document.getElementById("username").focus();

            return;
        }


        if (!password) {

            alert("비밀번호를 입력해주세요.");

            document.getElementById("password").focus();

            return;
        }


        try {

            const response = await fetch(
                "http://127.0.0.1:8000/auth/login",
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


            if (!response.ok) {

                alert(data.detail);

                return;
            }


            // JWT 저장
            localStorage.setItem(
                "access_token",
                data.access_token
            );


            // 로그인 사용자 정보 저장
            localStorage.setItem(
                "user",
                JSON.stringify({
                    user_id: data.user_id,
                    username: data.username,
                    nickname: data.nickname
                })
            );


            alert(
                data.nickname + "님, 로그인되었습니다."
            );


            // 메인 페이지 이동
            location.href = "main.html";

        } catch (error) {

            console.error(error);

            alert(
                "서버와 연결할 수 없습니다."
            );

        }

    });

}