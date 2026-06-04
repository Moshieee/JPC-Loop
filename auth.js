// Firebase SDK imports for app setup, authentication, Firestore profiles, and Storage uploads.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
    createUserWithEmailAndPassword,
    deleteUser,
    getAdditionalUserInfo,
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
    doc,
    getFirestore,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getDownloadURL,
    getStorage,
    ref,
    uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-storage.js";

// Firebase project settings copied from the Firebase web app config.
const firebaseConfig = {
    apiKey: "AIzaSyBT6mGHTtYIrg3ZPRrr8r5hrjzSJwOeqY0",
    authDomain: "jpc-loop.firebaseapp.com",
    projectId: "jpc-loop",
    storageBucket: "jpc-loop.firebasestorage.app",
    messagingSenderId: "197134374651",
    appId: "1:197134374651:web:984217a43b8fe1ad70c25e",
    measurementId: "G-0P5XQ3B5GE"
};

// School accounts must use this email ending.
const SCHOOL_EMAIL_DOMAIN = "@jpc.school.nz";
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 20000;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Cached HTML elements so the rest of the script can update the page.
const elements = {
    authTitle: document.getElementById("auth-title"),
    message: document.getElementById("auth-message"),
    signinForm: document.getElementById("signin-form"),
    registerForm: document.getElementById("register-form"),
    authShell: document.getElementById("auth-shell"),
    googleButton: document.getElementById("google-button"),
    passwordToggles: document.querySelectorAll(".password-toggle"),
    signoutButton: document.getElementById("signout-button"),
    avatarImage: document.getElementById("avatar-image"),
    avatarFallback: document.getElementById("avatar-fallback"),
    avatarEditButton: document.getElementById("avatar-edit-button"),
    avatarInput: document.getElementById("avatar-input"),
    tabButtons: document.querySelectorAll(".tab-button"),
    userPanel: document.getElementById("user-panel"),
    userName: document.getElementById("user-name"),
    userEmail: document.getElementById("user-email")
};

// Friendly messages for common Firebase errors.
const messages = {
    "auth/email-already-in-use": "That email already has an account.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/missing-password": "Enter your password.",
    "auth/operation-not-allowed": "Enable this sign-in method in Firebase Authentication.",
    "auth/account-exists-with-different-credential": "This email already uses a different sign-in method.",
    "auth/cancelled-popup-request": "The Google sign-in popup was cancelled.",
    "auth/network-request-failed": "Check your internet connection and try again.",
    "auth/popup-blocked": "Your browser blocked the Google popup. Allow popups for this site and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/unauthorized-domain": "Add this website to Firebase Authentication authorized domains.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "storage/canceled": "The profile picture upload was cancelled.",
    "storage/retry-limit-exceeded": "The image upload took too long. Try a smaller image.",
    "storage/unauthorized": "Enable Firebase Storage and publish profile-picture rules.",
    "storage/unknown": "Firebase Storage did not respond. Check that Storage is enabled for this project."
};

let auth;
let db;
let storage;
let currentUser = null;
let isValidatingGoogleSignin = false;

// Checks that the Firebase config has real values before starting the page.
function firebaseConfigReady() {
    return Object.values(firebaseConfig).every((value) => value && !value.startsWith("PASTE_"));
}

function isSchoolEmail(email) {
    return String(email || "").trim().toLowerCase().endsWith(SCHOOL_EMAIL_DOMAIN);
}

function schoolEmailMessage() {
    return `Use your ${SCHOOL_EMAIL_DOMAIN} school email address.`;
}

// Stops long Firebase requests from leaving the UI stuck forever.
function withTimeout(promise, message) {
    return Promise.race([
        promise,
        new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error(message)), UPLOAD_TIMEOUT_MS);
        })
    ]);
}

// Uploads a file with progress updates instead of waiting silently.
function uploadProfileImage(avatarRef, file) {
    return new Promise((resolve, reject) => {
        const uploadTask = uploadBytesResumable(avatarRef, file, { contentType: file.type });

        uploadTask.on(
            "state_changed",
            (snapshot) => {
                const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setMessage(`Uploading profile picture... ${percent}%`, "info");
            },
            reject,
            () => resolve(uploadTask.snapshot)
        );
    });
}

// Writes feedback text under the forms.
function setMessage(text, type = "info") {
    elements.message.textContent = text;
    elements.message.className = `auth-message ${type}`;
}

function formatError(error) {
    console.error("Firebase error:", error);
    return messages[error.code] || error.message || `Something went wrong. Firebase said: ${error.code || "unknown error"}.`;
}

// Temporarily disables a button while Firebase is working.
function setBusy(button, isBusy, busyText) {
    if (!button) {
        return;
    }

    if (isBusy) {
        button.dataset.defaultHtml = button.innerHTML;
        button.textContent = busyText;
        button.disabled = true;
        return;
    }

    button.innerHTML = button.dataset.defaultHtml || button.textContent;
    button.disabled = false;
}

function setAllControlsDisabled(isDisabled) {
    const controls = document.querySelectorAll("button, input");
    controls.forEach((control) => {
        control.disabled = isDisabled;
    });
}

// Shows either the sign-in form or the create-account form.
function showPanel(panelName) {
    const isSignin = panelName === "signin";

    elements.authTitle.textContent = isSignin ? "Sign in" : "Create account";
    elements.signinForm.classList.toggle("is-hidden", !isSignin);
    elements.registerForm.classList.toggle("is-hidden", isSignin);
    setMessage("");

    elements.tabButtons.forEach((button) => {
        const isActive = button.dataset.panel === panelName;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
    });
}

function getProviderId(user) {
    return user.providerData?.[0]?.providerId || "password";
}

// Chooses the nicest available display name for the signed-in card.
function getFriendlyName(user) {
    if (user.displayName) {
        return user.displayName;
    }

    if (user.email) {
        return user.email.split("@")[0];
    }

    return "JPC Loop user";
}

function updateAvatar(photoURL) {
    if (photoURL) {
        elements.avatarImage.src = photoURL;
        elements.avatarImage.hidden = false;
        elements.avatarFallback.hidden = true;
        return;
    }

    elements.avatarImage.removeAttribute("src");
    elements.avatarImage.hidden = true;
    elements.avatarFallback.hidden = false;
}

// Connects each eye button to its matching password input.
function setupPasswordToggles() {
    elements.passwordToggles.forEach((button) => {
        const input = document.getElementById(button.getAttribute("aria-controls"));

        button.addEventListener("click", () => {
            const isPassword = input.type === "password";
            input.type = isPassword ? "text" : "password";
            button.classList.toggle("is-visible", isPassword);
            button.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        });
    });
}

// Opens the hidden file input when the user clicks Edit photo.
function setupAvatarEditor() {
    elements.avatarEditButton.addEventListener("click", () => {
        elements.avatarInput.click();
    });

    elements.avatarInput.addEventListener("change", handleAvatarChange);
}

// Blocks non-school Google accounts and removes brand-new rejected accounts.
async function removeUnauthorizedGoogleUser(user, isNewUser) {
    try {
        if (isNewUser) {
            await deleteUser(user);
            return;
        }

        await signOut(auth);
    } catch (error) {
        console.error("Could not remove unauthorized Google user:", error);
        await signOut(auth);
    }
}

// Saves a profile document in Firestore so the app can store user details.
async function saveUserProfile(user, providerId, isNewUser = false, extraProfile = {}) {
    const profile = {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: extraProfile.photoURL || user.photoURL || "",
        providerId,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    if (isNewUser) {
        profile.createdAt = serverTimestamp();
    }

    try {
        await setDoc(doc(db, "users", user.uid), profile, { merge: true });
        return true;
    } catch (error) {
        console.error("Could not save Firestore user profile:", error);
        return false;
    }
}

// Updates the signed-in profile panel whenever Firebase auth state changes.
function updateUserPanel(user) {
    currentUser = user;

    if (!user) {
        elements.userPanel.hidden = true;
        elements.authShell.classList.add("auth-only");
        elements.userName.textContent = "Account";
        elements.userEmail.textContent = "";
        updateAvatar("");
        return;
    }

    elements.userPanel.hidden = false;
    elements.authShell.classList.remove("auth-only");
    elements.userName.textContent = getFriendlyName(user);
    elements.userEmail.textContent = user.email || "";
    updateAvatar(user.photoURL || "");
}

// Handles email/password sign-in.
async function handleSignin(event) {
    event.preventDefault();

    const button = elements.signinForm.querySelector(".primary-button");
    const formData = new FormData(elements.signinForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!isSchoolEmail(email)) {
        setMessage(schoolEmailMessage(), "error");
        return;
    }

    try {
        setBusy(button, true, "Signing in...");
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const profileSaved = await saveUserProfile(userCredential.user, "password");

        setMessage(
            profileSaved ? "Signed in successfully." : "Signed in. Check your Firestore rules to save profiles.",
            profileSaved ? "success" : "warning"
        );
    } catch (error) {
        setMessage(formatError(error), "error");
    } finally {
        setBusy(button, false);
    }
}

// Handles new email/password account creation.
async function handleRegister(event) {
    event.preventDefault();

    const button = elements.registerForm.querySelector(".primary-button");
    const formData = new FormData(elements.registerForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm-password") || "");

    if (!isSchoolEmail(email)) {
        setMessage(schoolEmailMessage(), "error");
        return;
    }

    if (password !== confirmPassword) {
        setMessage("Passwords do not match.", "error");
        return;
    }

    try {
        setBusy(button, true, "Creating...");
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        updateUserPanel(userCredential.user);
        const profileSaved = await saveUserProfile(userCredential.user, "password", true);

        elements.registerForm.reset();
        setMessage(
            profileSaved ? "Account created. You are signed in." : "Account created. Check your Firestore rules to save profiles.",
            profileSaved ? "success" : "warning"
        );
    } catch (error) {
        setMessage(formatError(error), "error");
    } finally {
        setBusy(button, false);
    }
}

// Handles Google sign-in and rejects non-JPC Google accounts.
async function handleGoogleSignin() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
        isValidatingGoogleSignin = true;
        setBusy(elements.googleButton, true, "Opening Google...");
        const userCredential = await signInWithPopup(auth, provider);
        const userInfo = getAdditionalUserInfo(userCredential);

        if (!isSchoolEmail(userCredential.user.email)) {
            await removeUnauthorizedGoogleUser(userCredential.user, Boolean(userInfo?.isNewUser));
            updateUserPanel(null);
            setMessage(schoolEmailMessage(), "error");
            return;
        }

        updateUserPanel(userCredential.user);
        const profileSaved = await saveUserProfile(
            userCredential.user,
            userInfo?.providerId || "google.com",
            Boolean(userInfo?.isNewUser)
        );

        setMessage(
            profileSaved ? "Signed in with Google." : "Signed in with Google. Check your Firestore rules to save profiles.",
            profileSaved ? "success" : "warning"
        );
    } catch (error) {
        setMessage(formatError(error), "error");
    } finally {
        isValidatingGoogleSignin = false;
        setBusy(elements.googleButton, false);
    }
}

// Uploads a chosen profile image to Storage and saves its URL on the user profile.
async function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
        return;
    }

    if (!currentUser) {
        setMessage("Sign in before changing your profile picture.", "error");
        return;
    }

    if (!PROFILE_IMAGE_TYPES.includes(file.type)) {
        setMessage("Choose a JPG, PNG, or WebP image.", "error");
        return;
    }

    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
        setMessage("Choose an image smaller than 2 MB.", "error");
        return;
    }

    try {
        setBusy(elements.avatarEditButton, true, "Uploading...");
        const extension = file.type.replace("image/", "").replace("jpeg", "jpg");
        const avatarRef = ref(storage, `profile-pictures/${currentUser.uid}/avatar.${extension}`);

        setMessage("Uploading profile picture...", "info");
        await withTimeout(
            uploadProfileImage(avatarRef, file),
            "Upload timed out. Check Firebase Storage rules and try a smaller image."
        );

        setMessage("Getting uploaded image link...", "info");
        const photoURL = await withTimeout(
            getDownloadURL(avatarRef),
            "Could not get the uploaded image link. Check Firebase Storage rules."
        );

        setMessage("Saving profile picture...", "info");
        await withTimeout(
            updateProfile(currentUser, { photoURL }),
            "Could not save the image to your account. Try signing in again."
        );
        await saveUserProfile(currentUser, getProviderId(currentUser), false, { photoURL });
        updateAvatar(photoURL);
        setMessage("Profile picture updated.", "success");
    } catch (error) {
        setMessage(formatError(error), "error");
    } finally {
        setBusy(elements.avatarEditButton, false);
    }
}

// Starts Firebase and connects all page event listeners.
function startAuth() {
    if (!firebaseConfigReady()) {
        setMessage("Add your Firebase web app config in auth.js.", "error");
        setAllControlsDisabled(true);
        return;
    }

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);

    elements.tabButtons.forEach((button) => {
        button.addEventListener("click", () => showPanel(button.dataset.panel));
    });

    setupPasswordToggles();
    setupAvatarEditor();

    elements.signinForm.addEventListener("submit", handleSignin);
    elements.registerForm.addEventListener("submit", handleRegister);
    elements.googleButton.addEventListener("click", handleGoogleSignin);
    elements.signoutButton.addEventListener("click", async () => {
        await signOut(auth);
        setMessage("Signed out.", "info");
    });

    onAuthStateChanged(auth, async (user) => {
        if (isValidatingGoogleSignin) {
            return;
        }

        if (user && !isSchoolEmail(user.email)) {
            updateUserPanel(null);
            await signOut(auth);
            setMessage(schoolEmailMessage(), "error");
            return;
        }

        updateUserPanel(user);
    });
}

startAuth();
