const toggleButton = document.getElementById('toggle-post-form');
const postFormPanel = document.getElementById('post-form-pannel');

toggleButton.addEventListener("click", () => {
    postFormPanel.classList.toggle("is-open");
});