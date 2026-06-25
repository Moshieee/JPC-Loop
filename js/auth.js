import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
    createUserWithEmailAndPassword,
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBT6mGHTtYIrg3ZPRrr8r5hrjzSJwOeqY0",
    authDomain: "jpc-loop.firebaseapp.com",
    projectId: "jpc-loop",
    storageBucket: "jpc-loop.firebasestorage.app",
    messagingSenderId: "197134374651",
    appId: "1:197134374651:web:984217a43b8fe1ad70c25e",
    measurementId: "G-0P5XQ3B5GE"
};

const auth = getAuth(initializeApp(firebaseConfig));
const schoolEmailEnding = "@jpc.school.nz";

const authPanel = document.getElementById("auth-panel");
const authTitle = document.getElementById("auth-title");
const message = document.getElementById("auth-message");
const signinForm = document.getElementById("signin-form");
const registerForm = document.getElementById("register-form");
const signinSection = document.querySelector(".login");
const registerSection = document.querySelector(".signup-container");
const userPanel = document.getElementById("user-panel");
const userName = document.getElementById("user-name");
const signoutButton = document.getElementById("signout-button");
const panelButtons = document.querySelectorAll("[data-panel]");
const googleButtons = document.querySelectorAll(".google-button");

function isSchoolEmail(email) {
    return email.toLowerCase().endsWith(schoolEmailEnding);
}

function showMessage(text, type = "error") {
    message.textContent = text;
    message.className = `auth-message ${type}`;
}

function showForm(panelName) {
    const showSignin = panelName === "signin";

    signinSection.classList.toggle("is-hidden", !showSignin);
    signinForm.classList.toggle("is-hidden", !showSignin);
    registerSection.classList.toggle("is-hidden", showSignin);
    registerForm.classList.toggle("is-hidden", showSignin);
    authTitle.textContent = showSignin ? "Sign in" : "Create account";
    showMessage("", "info");
}

function showUser(user) {
    const isSignedIn = Boolean(user);

    authPanel.hidden = isSignedIn;
    userPanel.hidden = !isSignedIn;

    if (user) {
        userName.textContent = user.displayName || user.email.split("@")[0];
    }
}

panelButtons.forEach((button) => {
    button.addEventListener("click", () => {
        showForm(button.dataset.panel);
    });
});

signinForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(signinForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!isSchoolEmail(email)) {
        showMessage(`Use your ${schoolEmailEnding} school email address.`);
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showMessage("Email or password is incorrect.");
        console.error(error);
    }
});

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm-password") || "");

    if (!isSchoolEmail(email)) {
        showMessage(`Use your ${schoolEmailEnding} school email address.`);
        return;
    }

    if (password !== confirmPassword) {
        showMessage("Passwords do not match.");
        return;
    }

    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name });
        showUser(result.user);
    } catch (error) {
        showMessage(error.message);
        console.error(error);
    }
});

googleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
        try {
            const result = await signInWithPopup(auth, new GoogleAuthProvider());

            if (!isSchoolEmail(result.user.email || "")) {
                await signOut(auth);
                showMessage(`Use your ${schoolEmailEnding} school Google account.`);
            }
        } catch (error) {
            showMessage(error.message);
            console.error(error);
        }
    });
});

signoutButton.addEventListener("click", async () => {
    await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
    if (user && !isSchoolEmail(user.email || "")) {
        signOut(auth);
        return;
    }

    showUser(user);
});
