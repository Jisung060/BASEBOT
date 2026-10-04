/* =========================================================
   인증 페이지 공통 사이드바
========================================================= */

fetch("../components/auth-sidebar.html")
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


        /* 아이디 */

        if (!validateUsername(username)) {

            alert(
                "아이디는 영문 소문자와 숫자를 조합하여\n" +
                "6~15자로 입력해주세요."
            );

            document.getElementById("username").focus();

            return;
        }


        /* 비밀번호 */

        if (!validatePassword(password)) {

            alert(
                "비밀번호 조건을 확인해주세요.\n\n" +
                "2종류 조합: 10~16자\n" +
                "3종류 이상 조합: 8~16자"
            );

            document.getElementById("password").focus();

            return;
        }


        /* 비밀번호 확인 */

        if (password !== passwordConfirm) {

            alert("비밀번호가 일치하지 않습니다.");

            document.getElementById("passwordConfirm").focus();

            return;
        }


        /* 닉네임 */

        if (nickname === "") {

            alert("닉네임을 입력해주세요.");

            document.getElementById("nickname").focus();

            return;
        }


        /* 이메일 */

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {

            alert("올바른 이메일 주소를 입력해주세요.");

            document.getElementById("email").focus();

            return;
        }


        /* 회원정보 확인 화면에 출력 */

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
       Step 3 → Step 2
    ====================================================== */

    document.getElementById("step2Prev").addEventListener("click", function () {

        moveStep(1);

    });


    document.getElementById("step3Prev").addEventListener("click", function () {

        moveStep(2);

    });


    /* =====================================================
       회원가입 완료
    ====================================================== */

    document.getElementById("signupComplete").addEventListener("click", function () {

        /*
         * 현재는 프론트엔드 테스트용.
         *
         * 나중에 FastAPI와 연결할 때
         * 여기에서 POST /users 같은 API를 호출하여
         * users 테이블에 INSERT하면 된다.
         */

        moveStep(4);

    });


    /* =====================================================
       로그인
    ====================================================== */

    document.getElementById("goLogin").addEventListener("click", function () {

        alert("로그인 페이지로 이동합니다.");

        // 나중에 실제 로그인 페이지 연결
        // location.href = "login.html";

    });


    /* =====================================================
       메인
    ====================================================== */

    document.getElementById("goMain").addEventListener("click", function () {

        location.href = "main.html";

    });

});