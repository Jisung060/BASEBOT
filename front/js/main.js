/* ==================================================
   Header 불러오기
================================================== */

fetch("/components/header.html")
    .then(response => response.text())
    .then(data => {

        document.getElementById("header").innerHTML = data;

        updateHeader();
    })
    .catch(error => {

        console.error("Header 불러오기 실패:", error);

    });



/* ==================================================
   Footer 불러오기
================================================== */

fetch("/components/footer.html")
    .then(response => response.text())
    .then(data => {

        document.getElementById("footer").innerHTML = data;

    })
    .catch(error => {

        console.error("Footer 불러오기 실패:", error);

    });


/* ==================================================
   로그인 상태에 따른 Header 변경
================================================== */

function updateHeader() {

    // localStorage에 저장된 JWT 확인
    const accessToken =
        localStorage.getItem("access_token");


    // 로그인 링크
    const loginLink =
        document.getElementById("loginLink");

    // 회원가입 링크
    const signupLink =
        document.getElementById("signupArea");


    // 로그인하지 않은 상태
    if (!accessToken) {

        return;
    }


    // 로그인한 상태
    if (loginLink) {

        loginLink.textContent = "로그아웃";

        loginLink.href = "#";

        loginLink.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                logout();

            }
        );

    }


    // 회원가입 숨기기
    if (signupArea) {

        signupArea.style.display = "none";

    }

}


/* ==================================================
   로그아웃
================================================== */

function logout() {

    // JWT 삭제
    localStorage.removeItem("access_token");

    // 로그인 사용자 정보 삭제
    localStorage.removeItem("user");

    alert("로그아웃되었습니다.");

    // 메인 페이지로 이동
    location.href = "main.html";

}