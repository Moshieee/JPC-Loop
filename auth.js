// Firebase SDK imports for app setup, authentication, and Firestore profiles.
// These imports come from Firebase's browser CDN so the site can stay as simple HTML/CSS/JS.
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

// Firebase project settings copied from the Firebase web app config.
// This connects the page to your Firebase project named "jpc-loop".
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
// This is checked before email sign-in, before account creation, and after Google sign-in.
const SCHOOL_EMAIL_DOMAIN = "@jpc.school.nz";

// Local fallback image used for email/password users or Google users with no profile photo.
// This file lives in the images folder and does not require Firebase Storage.
const DEFAULT_PROFILE_IMAGE = "images/DefaultPFP.png";

// Cached HTML elements so the rest of the script can update the page.
// Storing them here means we only need to call document.getElementById once.
const elements = {
    authTitle: document.getElementById("auth-title"),
    message: document.getElementById("auth-message"),
    signinForm: document.getElementById("signin-form"),
    registerForm: document.getElementById("register-form"),
    signinPanel: document.querySelector(".login"),
    registerPanel: document.querySelector(".signup-container"),
    authShell: document.getElementById("auth-shell"),
    googleButtons: document.querySelectorAll(".google-button"),
    passwordToggles: document.querySelectorAll(".password-toggle"),
    signoutButton: document.getElementById("signout-button"),
    avatarImage: document.getElementById("avatar-image"),
    tabButtons: document.querySelectorAll("[data-panel]"),
    userPanel: document.getElementById("user-panel"),
    userName: document.getElementById("user-name"),
    userEmail: document.getElementById("user-email")
};

// Friendly messages for common Firebase errors.
// Firebase returns short error codes; this object turns them into messages a user can understand.
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
    "auth/weak-password": "Use a password with at least 6 characters."
};

let auth;
let db;
let currentUser = null;

// This flag prevents onAuthStateChanged from fighting the Google sign-in handler while Google is still being checked.
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
// Example: the sign-in button changes to "Signing in..." while the request is running.
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
// The two forms both exist in the HTML; this function hides one and shows the other.
function showPanel(panelName) {
    const isSignin = panelName === "signin";

    elements.authTitle.textContent = isSignin ? "Sign in" : "Create account";
    elements.signinPanel.classList.toggle("is-hidden", !isSignin);
    elements.registerPanel.classList.toggle("is-hidden", isSignin);
    elements.signinForm.classList.toggle("is-hidden", !isSignin);
    elements.registerForm.classList.toggle("is-hidden", isSignin);
    setMessage("");

    elements.tabButtons.forEach((button) => {
        const isActive = button.dataset.panel === panelName;
        button.classList.toggle("active", isActive);
    });
}

function getProviderId(user) {
    return user.providerData?.[0]?.providerId || "password";
}

// Chooses the nicest available display name for the signed-in card.
// Google accounts usually have displayName. Email accounts may only have an email address.
function getFriendlyName(user) {
    if (user.displayName) {
        return user.displayName;
    }

    if (user.email) {
        return user.email.split("@")[0];
    }

    return "JPC Loop user";
}

// Finds a Google profile photo if Firebase has one.
// Some accounts store it on user.photoURL; others store it inside providerData.
function getGoogleProviderPhoto(user) {
    // providerData is an array because one account can have multiple sign-in methods.
    // We search for the Google entry and use its photo if Firebase has saved one.
    const googleProvider = user?.providerData?.find((provider) => provider.providerId === "google.com");
    return googleProvider?.photoURL || "";
}

// Adds a size parameter to Google profile images so they load crisply in the avatar circle.
function normalizeGooglePhotoURL(photoURL) {
    // Non-Google image URLs should be left untouched.
    if (!photoURL || !photoURL.includes("googleusercontent.com")) {
        return photoURL || "";
    }

    // Google images often end with a size such as =s96-c. We request a larger square version.
    return photoURL.replace(/=s\d+(-c)?$/, "=s192-c");
}

// Chooses which profile image should appear in the signed-in card.
// Order: Firebase profile photo, Google provider photo, then the local default image.
function getProfileImage(user) {
    return normalizeGooglePhotoURL(user?.photoURL || getGoogleProviderPhoto(user)) || DEFAULT_PROFILE_IMAGE;
}

// Updates the avatar image and makes sure broken external images fall back to the local default.
function updateAvatar(user) {
    const profileImage = getProfileImage(user);

    elements.avatarImage.onerror = () => {
        elements.avatarImage.onerror = null;
        elements.avatarImage.src = DEFAULT_PROFILE_IMAGE;
    };

    elements.avatarImage.src = profileImage;
    elements.avatarImage.hidden = false;
}

// Connects each eye button to its matching password input.
// The button uses aria-controls in HTML to say which input it controls.
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

// Blocks non-school Google accounts and removes brand-new rejected accounts.
// Google creates/signs-in the user before our code can inspect the email, so we clean it up after.
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
// merge: true keeps old fields if more profile settings are added later.
async function saveUserProfile(user, providerId, isNewUser = false, extraProfile = {}) {
    const profile = {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: extraProfile.photoURL || getProfileImage(user),
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
// Firebase calls this after sign-in, sign-out, and page refreshes with an existing session.
function updateUserPanel(user) {
    currentUser = user;

    if (!user) {
        elements.userPanel.hidden = true;
        elements.authShell.classList.add("auth-only");
        elements.userName.textContent = "Account";
        elements.userEmail.textContent = "";
        updateAvatar(null);
        return;
    }

    elements.userPanel.hidden = false;
    elements.authShell.classList.remove("auth-only");
    elements.userName.textContent = getFriendlyName(user);
    elements.userEmail.textContent = user.email || "";
    updateAvatar(user);
}

// Handles email/password sign-in.
// It first checks the school email rule, then asks Firebase to sign the user in.
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
// It stores the user's name on their Firebase Auth profile and writes a Firestore profile document.
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
// Accepted Google users keep their Google profile picture automatically.
async function handleGoogleSignin(event) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const button = event.currentTarget;

    try {
        isValidatingGoogleSignin = true;
        setBusy(button, true, "Opening Google...");
        const userCredential = await signInWithPopup(auth, provider);
        const userInfo = getAdditionalUserInfo(userCredential);

        if (!isSchoolEmail(userCredential.user.email)) {
            await removeUnauthorizedGoogleUser(userCredential.user, Boolean(userInfo?.isNewUser));
            updateUserPanel(null);
            setMessage(schoolEmailMessage(), "error");
            return;
        }

        // If the Auth profile has an old/default photo, replace it with the Google provider photo.
        const googlePhotoURL = normalizeGooglePhotoURL(getGoogleProviderPhoto(userCredential.user));
        if (googlePhotoURL && userCredential.user.photoURL !== googlePhotoURL) {
            await updateProfile(userCredential.user, { photoURL: googlePhotoURL });
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
        setBusy(button, false);
    }
}

// Starts Firebase and connects all page event listeners.
// This is the main setup function that runs once when auth.js loads.
function startAuth() {
    if (!firebaseConfigReady()) {
        setMessage("Add your Firebase web app config in auth.js.", "error");
        setAllControlsDisabled(true);
        return;
    }

    const app = initializeApp(firebaseConfig);

    // Auth handles sign-in/sign-out. Firestore stores extra profile data.
    auth = getAuth(app);
    db = getFirestore(app);

    // Wire up the tab buttons.
    elements.tabButtons.forEach((button) => {
        button.addEventListener("click", () => showPanel(button.dataset.panel));
    });

    // Wire up password visibility buttons.
    setupPasswordToggles();

    // Wire up form submissions and auth buttons.
    elements.signinForm.addEventListener("submit", handleSignin);
    elements.registerForm.addEventListener("submit", handleRegister);
    elements.googleButtons.forEach((button) => {
        button.addEventListener("click", handleGoogleSignin);
    });
    elements.signoutButton.addEventListener("click", async () => {
        await signOut(auth);
        setMessage("Signed out.", "info");
    });

    // Keep the UI synced with Firebase's current signed-in user.
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
