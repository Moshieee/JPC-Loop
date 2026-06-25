const passwordToggles = document.querySelectorAll(".password-toggle");

passwordToggles.forEach((button) => {
    const inputId = button.getAttribute("aria-controls");
    const input = document.getElementById(inputId);

    if (!input) {
        return;
    }

    button.addEventListener("click", () => {
        const passwordIsHidden = input.type === "password";

        input.type = passwordIsHidden ? "text" : "password";
        button.classList.toggle("is-visible", passwordIsHidden);
        button.setAttribute(
            "aria-label",
            passwordIsHidden ? "Hide password" : "Show password"
        );
    });
});
