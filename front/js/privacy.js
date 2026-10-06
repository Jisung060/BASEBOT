document.addEventListener("DOMContentLoaded", function () {

    // 사이드바 불러오기
    fetch("/components/auth-sidebar.html")
        .then(response => response.text())
        .then(data => {

            document.getElementById("auth-sidebar").innerHTML = data;

            // 개인정보 처리방침 메뉴 활성화
            const menuItems =
                document.querySelectorAll(".auth-sidebar-menu a");

            menuItems.forEach(item => {

                item.classList.remove("active");

                if (item.textContent.trim() === "개인정보 처리방침") {
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

});