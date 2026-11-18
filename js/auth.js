/* ==========================================================================
   F1 PORTAL — auth.js
   Sign Up / Log In / Profile simulated with localStorage (no backend).

   Storage:
     f1-users    list of accounts: name, email, phone, salted password hash
     f1-session  who is logged in ("Keep me logged in" -> localStorage,
                 otherwise sessionStorage, which ends when the tab closes)

   NOTE: a real site must check passwords on a server. Here the password is
   at least hashed (SHA-256 + random salt) so it is never stored as plain text.
   ========================================================================== */
window.F1 = window.F1 || {};

(function (F1, $) {
    "use strict";

    const USERS_KEY = "f1-users";
    const SESSION_KEY = "f1-session";
    const t = function (key, vars) { return F1.t(key, vars); };

    /* ------------------------------------------------------------------ users */
    function getUsers() {
        const list = F1.store.getJSON(USERS_KEY, []);
        return Array.isArray(list) ? list : [];
    }

    function saveUsers(list) {
        return F1.store.setJSON(USERS_KEY, list);
    }

    function findUser(email) {
        const wanted = String(email || "").trim().toLowerCase();
        return getUsers().filter(function (user) { return user.email === wanted; })[0] || null;
    }

    /* --------------------------------------------------------------- password */
    function toHex(bytes) {
        return Array.prototype.map.call(bytes, function (b) {
            return ("0" + b.toString(16)).slice(-2);
        }).join("");
    }

    function randomSalt() {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return toHex(bytes);
    }

    /** SHA-256(salt:password). Falls back to a tiny hash on insecure origins (demo only). */
    function hashPassword(password, salt, algo) {
        const text = salt + ":" + password;
        if (algo !== "fnv1a" && window.crypto && window.crypto.subtle) {
            return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buffer) {
                return { algo: "sha256", hash: toHex(new Uint8Array(buffer)) };
            });
        }
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return Promise.resolve({ algo: "fnv1a", hash: h.toString(16) });
    }

    /* ---------------------------------------------------------------- session */
    function readSession() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function clearSession() {
        try {
            sessionStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* ignore */ }
    }

    function writeSession(email, remember) {
        clearSession();
        const value = JSON.stringify({ email: email, at: Date.now() });
        try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, value); } catch (e) { /* ignore */ }
    }

    F1.auth = {
        /** The logged-in user object, or null. */
        current: function () {
            const session = readSession();
            if (!session) { return null; }
            const user = findUser(session.email);
            if (!user) { clearSession(); }
            return user;
        },
        logout: function () { clearSession(); }
    };

    /* -------------------------------------------------------------- utilities */
    function firstName(name) { return String(name || "").trim().split(/\s+/)[0]; }

    function initials(name) {
        const parts = String(name || "?").trim().split(/\s+/);
        return ((parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
    }

    /** Only allow redirects to a plain local page name such as "profile.html". */
    function safeNext(value) {
        return /^[a-z0-9\-]+\.html$/i.test(value || "") ? value : "profile.html";
    }

    function queryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    const page = function () { return document.body.getAttribute("data-page"); };

    /* ------------------------------------------------------------- navigation */
    function renderNavAuth() {
        const $box = $("#nav-auth");
        if (!$box.length) { return; }
        const user = F1.auth.current();
        $box.empty();
        if (user) {
            $box.append(
                $('<a class="btn btn-outline-light btn-sm" href="profile.html"></a>').text("👤 " + firstName(user.name)),
                $('<button type="button" class="btn btn-danger btn-sm" id="nav-logout"></button>').text(t("nav.logout"))
            );
        } else {
            $box.append(
                $('<a class="btn btn-outline-light btn-sm" href="login.html"></a>').text(t("nav.login")),
                $('<a class="btn btn-danger btn-sm" href="signup.html"></a>').text(t("nav.signup"))
            );
        }
    }

    function logoutAndLeave() {
        F1.auth.logout();
        F1.playSound(480);
        if (page() === "profile") {
            window.location.href = "login.html?loggedout=1";
        } else {
            renderNavAuth();
            F1.renderGreeting();
            F1.toast(t("toast.account"), t("auth.loggedOut"), "info");
        }
    }

    $(document).on("click", "#nav-logout, #logout-btn", logoutAndLeave);

    /* ---------------------------------------------------------------- sign up */
    $(document).on("submit", "#signup-form", function (e) {
        e.preventDefault();
        const $form = $(this);
        const $status = $("#signup-status").prop("hidden", true);

        if (!F1.forms.validateForm($form)) {
            F1.toast(t("toast.error"), t("toast.fix"), "error");
            return;
        }

        const email = $("#su-email").val().trim().toLowerCase();
        if (findUser(email)) {
            F1.forms.setFieldState($("#su-email"), t("auth.exists"));
            F1.forms.setStatus($status, "error", t("auth.exists"));
            return;
        }

        const $btn = $form.find('button[type="submit"]');
        F1.forms.startSpinner($btn);
        const salt = randomSalt();

        hashPassword($("#su-password").val(), salt).then(function (result) {
            const users = getUsers();
            users.push({
                id: Date.now().toString(36),
                name: $("#su-name").val().trim(),
                email: email,
                phone: $("#su-phone").val().trim(),
                salt: salt,
                algo: result.algo,
                hash: result.hash,
                createdAt: new Date().toISOString()
            });
            if (!saveUsers(users)) { throw new Error("storage"); }
            F1.playSound(800);
            F1.forms.setStatus($status, "success", t("auth.created"));
            setTimeout(function () { window.location.href = "login.html?registered=1"; }, 900);
        }).catch(function () {
            F1.forms.stopSpinner($btn);
            F1.forms.setStatus($status, "error", t("auth.storageError"));
        });
    });

    /* ----------------------------------------------------------------- log in */
    $(document).on("submit", "#login-form", function (e) {
        e.preventDefault();
        const $form = $(this);
        const $status = $("#login-status").prop("hidden", true);

        if (!F1.forms.validateForm($form)) {
            F1.toast(t("toast.error"), t("toast.fix"), "error");
            return;
        }

        const email = $("#li-email").val().trim().toLowerCase();
        const password = $("#li-password").val();
        const user = findUser(email);
        const $btn = $form.find('button[type="submit"]');
        F1.forms.startSpinner($btn);

        const fail = function () {
            F1.forms.stopSpinner($btn);
            F1.forms.setStatus($status, "error", t("auth.badLogin"));
        };

        if (!user) { setTimeout(fail, 500); return; }

        hashPassword(password, user.salt, user.algo).then(function (result) {
            if (result.hash !== user.hash) { setTimeout(fail, 500); return; }
            writeSession(user.email, $("#li-remember").is(":checked"));
            F1.playSound(800);
            F1.forms.setStatus($status, "success", t("auth.welcome", { name: firstName(user.name) }));
            setTimeout(function () { window.location.href = safeNext(queryParam("next")); }, 600);
        }).catch(fail);
    });

    function showLoginNotices() {
        const $notice = $("#login-notice");
        if (!$notice.length) { return; }
        let key = "";
        if (queryParam("registered")) { key = "auth.registered"; }
        else if (queryParam("loggedout")) { key = "auth.loggedOut"; }
        else if (queryParam("reason") === "auth") { key = "auth.needLogin"; }
        $notice.text(key ? t(key) : "").prop("hidden", !key);
    }

    /* ---------------------------------------------------------------- profile */
    function renderProfile() {
        const $card = $("#profile-card");
        if (!$card.length) { return; }
        const user = F1.auth.current();
        if (!user) { return; }

        $("#profile-avatar").text(initials(user.name));
        $("#profile-name").text(user.name);
        $("#profile-since").text(t("profile.since", {
            date: new Date(user.createdAt).toLocaleDateString(F1.locale(), { year: "numeric", month: "long", day: "numeric" })
        }));
        $("#pd-name").text(user.name);
        $("#pd-email").text(user.email);
        $("#pd-phone").text(user.phone || "—");
        const favs = F1.favs.all();
        $("#pd-favs").text(favs.length ? favs.join(", ") : t("profile.none"));
        if (!$("#pf-name").is(":focus") && !$("#pf-name").data("filled")) {
            $("#pf-name").val(user.name).data("filled", true);
            $("#pf-phone").val(user.phone || "");
        }
    }

    $(document).on("submit", "#profile-form", function (e) {
        e.preventDefault();
        const $form = $(this);
        if (!F1.forms.validateForm($form)) { return; }
        const user = F1.auth.current();
        if (!user) { return; }
        const users = getUsers().map(function (u) {
            if (u.email !== user.email) { return u; }
            return Object.assign({}, u, { name: $("#pf-name").val().trim(), phone: $("#pf-phone").val().trim() });
        });
        saveUsers(users);
        F1.playSound(800);
        F1.toast(t("toast.account"), t("profile.saved"), "success");
        renderNavAuth();
        renderProfile();
        F1.renderGreeting();
    });

    // Two-step delete: the first click asks for confirmation, the second one deletes.
    let deleteTimer = null;
    $(document).on("click", "#delete-account-btn", function () {
        const $btn = $(this);
        if (!$btn.data("armed")) {
            $btn.data("armed", true).removeClass("btn-outline-secondary").addClass("btn-danger").text(t("profile.confirmDelete"));
            deleteTimer = setTimeout(function () {
                $btn.data("armed", false).removeClass("btn-danger").addClass("btn-outline-secondary").text(t("profile.delete"));
            }, 5000);
            return;
        }
        clearTimeout(deleteTimer);
        const user = F1.auth.current();
        if (user) { saveUsers(getUsers().filter(function (u) { return u.email !== user.email; })); }
        F1.auth.logout();
        window.location.href = "index.html";
    });

    /* ------------------------------------------------------------- page setup */
    $(function () {
        const user = F1.auth.current();
        renderNavAuth();

        switch (page()) {
            case "profile":
                if (!user) {
                    $("#profile-guard").text(t("auth.needLogin")).prop("hidden", false);
                    window.location.replace("login.html?reason=auth&next=profile.html");
                    return;
                }
                $("#profile-card").prop("hidden", false);
                renderProfile();
                break;
            case "login":
            case "signup":
                if (user) { window.location.replace("profile.html"); return; }
                showLoginNotices();
                break;
            case "contact":
                if (user) {
                    if (!$("#name").val()) { $("#name").val(user.name); }
                    if (!$("#email").val()) { $("#email").val(user.email); }
                    if (!$("#phone").val()) { $("#phone").val(user.phone || ""); }
                }
                break;
            default:
                break;
        }

        F1.renderGreeting();
        F1.onLanguage(function () {
            renderNavAuth();
            renderProfile();
            showLoginNotices();
        });
        F1.favsChanged = renderProfile;
    });
})(window.F1, window.jQuery);
