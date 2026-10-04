document.addEventListener("DOMContentLoaded", function () {

    // 사이드바 불러오기
    fetch("../components/auth-sidebar.html")
        .then(response => response.text())
        .then(data => {
            document.getElementById("auth-sidebar").innerHTML = data;

            // 현재 페이지 로그인 메뉴 활성화
            const menuItems = document.querySelectorAll(".auth-sidebar-menu a");

            menuItems.forEach(item => {
                item.classList.remove("active");

                if (item.textContent.trim() === "로그인") {
                    item.classList.add("active");
                }
            });
        })
        .catch(error => {
            console.error("Auth Sidebar 불러오기 실패:", error);
        });


    // 로그인 버튼
    const loginButton = document.getElementById("loginButton");

    loginButton.addEventListener("click", function () {

        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value.trim();

        if (username === "") {
            alert("아이디를 입력해주세요.");
            return;
        }

        if (password === "") {
            alert("비밀번호를 입력해주세요.");
            return;
        }

        alert("로그인 기능은 백엔드 연결 후 구현됩니다.");
    });

});