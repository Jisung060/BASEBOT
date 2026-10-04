/* ==================================================
   Header 불러오기
================================================== */

fetch("../components/header.html")
    .then(response => response.text())
    .then(data => {

        document.getElementById("header").innerHTML = data;

    })
    .catch(error => {

        console.error("Header 불러오기 실패:", error);

    });



/* ==================================================
   Footer 불러오기
================================================== */

fetch("../components/footer.html")
    .then(response => response.text())
    .then(data => {

        document.getElementById("footer").innerHTML = data;

    })
    .catch(error => {

        console.error("Footer 불러오기 실패:", error);

    });