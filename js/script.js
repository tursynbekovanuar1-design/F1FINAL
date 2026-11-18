/* ==========================================================================
   F1 PORTAL — script.js  (core UI)
   Assignment 4 (JS basics) · Assignment 5 (JS & DOM) · Assignment 6 (jQuery)
   · Final project (themes, search/filter + localStorage, validation)

   Loaded after js/i18n.js. js/auth.js and js/api.js add accounts and live data.
   Shared helpers live on the global F1 object.
   ========================================================================== */
window.F1 = window.F1 || {};

(function (F1, $) {
    "use strict";

    /* ======================================================================
       1. STORAGE (every access is wrapped: private windows may block it)
       ====================================================================== */
    const KEYS = {
        theme: "f1-theme",
        bg: "f1-bg",
        lang: "f1-lang",
        rating: "f1-rating",
        favs: "f1-favs",
        recents: "f1-recent-searches",
        galleryFilter: "f1-gallery-filter",
        raceCategory: "f1-race-category",
        userName: "f1-user-name"
    };
    F1.KEYS = KEYS;

    F1.store = {
        get: function (key, fallback) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? fallback : value;
            } catch (e) { return fallback; }
        },
        set: function (key, value) {
            try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
        },
        remove: function (key) {
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        },
        getJSON: function (key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) { return fallback; }
        },
        setJSON: function (key, value) {
            return F1.store.set(key, JSON.stringify(value));
        }
    };

    /* ======================================================================
       2. LANGUAGES (translations live in js/i18n.js)
       ====================================================================== */
    const LOCALES = { en: "en-US", ru: "ru-RU", kk: "kk-KZ" };
    let currentLang = F1.store.get(KEYS.lang, "en");
    if (!LOCALES[currentLang]) { currentLang = "en"; }

    const languageHooks = [];

    F1.lang = function () { return currentLang; };
    F1.locale = function () { return LOCALES[currentLang]; };
    F1.onLanguage = function (fn) { languageHooks.push(fn); };

    /** Translate a key; {name} placeholders are replaced from `vars`. */
    F1.t = function (key, vars) {
        const entry = (F1.I18N || {})[key];
        let text = entry ? (entry[currentLang] || entry.en) : key;
        if (vars) {
            Object.keys(vars).forEach(function (name) {
                text = text.split("{" + name + "}").join(vars[name]);
            });
        }
        return text;
    };
    const t = F1.t;

    /** Translate every data-i18n* attribute inside `root` (defaults to the whole page). */
    F1.translate = function (root) {
        const $root = root ? $(root) : $(document);
        $root.find("[data-i18n]").addBack("[data-i18n]").each(function () {
            $(this).text(t($(this).attr("data-i18n")));
        });
        $root.find("[data-i18n-placeholder]").each(function () {
            $(this).attr("placeholder", t($(this).attr("data-i18n-placeholder")));
        });
        $root.find("[data-i18n-aria]").each(function () {
            $(this).attr("aria-label", t($(this).attr("data-i18n-aria")));
        });
        $root.find("[data-i18n-title]").each(function () {
            $(this).attr("title", t($(this).attr("data-i18n-title")));
        });
    };

    F1.applyLanguage = function (lang) {
        switch (lang) {          // Assignment 5: switch statement
            case "ru":
            case "kk":
            case "en":
                currentLang = lang;
                break;
            default:
                currentLang = "en";
        }
        F1.store.set(KEYS.lang, currentLang);
        $("html").attr("lang", currentLang);
        $("#lang-select").val(currentLang);

        // Cached "original HTML" used by the search highlighter is stale after a text change.
        $(".highlightable").removeData("originalHtml");
        F1.translate();

        applyTheme(currentTheme(), false);
        languageHooks.forEach(function (fn) { fn(); });
        highlightText(currentQuery());
    };

    /* ======================================================================
       3. SOUND + TOASTS
       ====================================================================== */
    let audioCtx = null;

    F1.playSound = function (frequency) {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) { return; }
            if (!audioCtx) { audioCtx = new AC(); }
            if (audioCtx.state === "suspended") { audioCtx.resume(); }
            const oscillator = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency || 600, now);
            gain.gain.setValueAtTime(0.04, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            oscillator.connect(gain);
            gain.connect(audioCtx.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.1);
        } catch (e) { /* audio is blocked until the first interaction */ }
    };
    const playSound = F1.playSound;

    /** type: "success" | "error" | "info" */
    F1.toast = function (title, message, type) {
        const style = { success: "text-bg-success", error: "text-bg-danger", info: "text-bg-dark" }[type || "info"];
        const $toast = $(
            '<div class="toast align-items-center ' + style + ' border-0 show custom-toast" role="alert">' +
            '<div class="d-flex"><div class="toast-body"><strong></strong> <span class="toast-msg"></span></div>' +
            '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
            "</div></div>"
        );
        $toast.find("strong").text(title + ":");
        $toast.find(".toast-msg").text(message);
        $("#toast-container").append($toast);
        setTimeout(function () {
            $toast.fadeOut(400, function () { $(this).remove(); });
        }, 3800);
    };
    const showToast = F1.toast;

    /* ======================================================================
       4. THEME SWITCH (light / dark, saved in localStorage) + BACKGROUND COLOUR
       ====================================================================== */
    const BG_PALETTES = {
        dark: [null, "#12081f", "#04121f", "#1a0b0b", "#0a1a12"],
        light: [null, "#fde8e8", "#e0f2fe", "#ecfccb", "#fef3c7"]
    };
    let bgIndex = parseInt(F1.store.get(KEYS.bg, "0"), 10) || 0;

    function currentTheme() {
        return document.documentElement.getAttribute("data-bs-theme") === "light" ? "light" : "dark";
    }

    function applyBackground() {
        const palette = BG_PALETTES[currentTheme()];
        const color = palette[bgIndex % palette.length];
        if (color) { document.body.style.setProperty("--f1-bg", color); }
        else { document.body.style.removeProperty("--f1-bg"); }
    }

    function applyTheme(theme, animate) {
        document.documentElement.setAttribute("data-bs-theme", theme);
        $("#theme-switch").prop("checked", theme === "dark");
        $("#theme-icon").text(theme === "dark" ? "🌙" : "☀️");
        $("#theme-text").text(theme === "dark" ? t("theme.dark") : t("theme.light"));
        applyBackground();
        if (animate) {
            const icon = document.getElementById("theme-icon");
            if (icon) {
                icon.classList.remove("spin");
                void icon.offsetWidth;          // restart the CSS animation
                icon.classList.add("spin");
            }
        }
    }

    $(document).on("change", "#theme-switch", function () {
        const next = this.checked ? "dark" : "light";
        F1.store.set(KEYS.theme, next);
        applyTheme(next, true);
        playSound();
        showToast(t("toast.theme"), next === "dark" ? t("theme.toastDark") : t("theme.toastLight"), "info");
    });

    // Keep several open tabs in sync
    window.addEventListener("storage", function (e) {
        if (e.key === KEYS.theme && e.newValue) { applyTheme(e.newValue === "light" ? "light" : "dark", false); }
        if (e.key === KEYS.favs) { refreshFavUI(); }
        if (e.key === KEYS.recents) { renderRecents(); }
    });

    $(document).on("click", "#bg-color-btn", function (e) {
        e.preventDefault();
        playSound(520);
        bgIndex = (bgIndex + 1) % BG_PALETTES.dark.length;
        F1.store.set(KEYS.bg, String(bgIndex));
        applyBackground();
        showToast(t("toast.bg"), (bgIndex + 1) + " / " + BG_PALETTES.dark.length, "info");
    });

    $(document).on("change", "#lang-select", function () {
        playSound();
        F1.applyLanguage($(this).val());
    });

    /* ======================================================================
       5. FAVOURITE DRIVERS (localStorage) — shown in the sidebar on every page
       ====================================================================== */
    F1.favs = {
        all: function () {
            const list = F1.store.getJSON(KEYS.favs, []);
            return Array.isArray(list) ? list : [];
        },
        has: function (name) { return F1.favs.all().indexOf(name) !== -1; },
        /** Returns true when the driver is now a favourite. */
        toggle: function (name) {
            const list = F1.favs.all();
            const index = list.indexOf(name);
            if (index === -1) { list.push(name); } else { list.splice(index, 1); }
            F1.store.setJSON(KEYS.favs, list);
            refreshFavUI();
            return index === -1;
        }
    };

    /** Markup for a favourite star button (used by the driver lists). */
    F1.favButton = function (name) {
        return $('<button type="button" class="fav-btn"></button>').attr("data-name", name);
    };

    function refreshFavUI() {
        $(".fav-btn").each(function () {
            const name = $(this).attr("data-name");
            const on = F1.favs.has(name);
            $(this)
                .attr("aria-pressed", on ? "true" : "false")
                .attr("aria-label", t(on ? "fav.remove" : "fav.add", { name: name }))
                .text(on ? "★" : "☆");
        });
        renderFavList();
        if (typeof F1.favsChanged === "function") { F1.favsChanged(); }
    }
    F1.refreshFavUI = refreshFavUI;

    function renderFavList() {
        const $list = $("#fav-list");
        if (!$list.length) { return; }
        const favs = F1.favs.all();
        $list.empty();
        if (!favs.length) {
            $list.append($('<li class="small"></li>').text(t("side.fav.empty")));
            return;
        }
        favs.forEach(function (name) {
            const $li = $("<li></li>");
            $li.append($("<span></span>").text(name));
            $li.append(
                $('<button type="button" class="fav-btn fav-remove"></button>')
                    .attr("data-name", name)
                    .attr("aria-pressed", "true")
                    .attr("aria-label", t("fav.remove", { name: name }))
                    .text("★")
            );
            $list.append($li);
        });
    }

    $(document).on("click", ".fav-btn", function (e) {
        e.preventDefault();
        const name = $(this).attr("data-name");
        const added = F1.favs.toggle(name);
        playSound(added ? 700 : 480);
        $('.fav-btn[data-name="' + name.replace(/"/g, '\\"') + '"]').addClass("pop");
        setTimeout(function () { $(".fav-btn.pop").removeClass("pop"); }, 400);
        showToast(t("toast.fav"), t(added ? "fav.added" : "fav.removed", { name: name }), "info");
    });

    /* ======================================================================
       6. RECENT SEARCHES (localStorage)
       ====================================================================== */
    F1.recents = {
        all: function () {
            const list = F1.store.getJSON(KEYS.recents, []);
            return Array.isArray(list) ? list : [];
        },
        add: function (query) {
            const q = (query || "").trim();
            if (q.length < 2) { return; }
            const list = F1.recents.all().filter(function (item) { return item.toLowerCase() !== q.toLowerCase(); });
            list.unshift(q);
            F1.store.setJSON(KEYS.recents, list.slice(0, 6));
            renderRecents();
        },
        clear: function () {
            F1.store.remove(KEYS.recents);
            renderRecents();
        }
    };

    function renderRecents() {
        const $box = $("#recent-searches");
        if (!$box.length) { return; }
        const list = F1.recents.all();
        $box.empty();
        if (!list.length) {
            $box.append($('<span class="small"></span>').text(t("side.recent.empty")));
        }
        list.forEach(function (query) {
            $box.append($('<button type="button" class="recent-chip"></button>').attr("data-query", query).text(query));
        });
        $("#clear-recent").prop("hidden", !list.length);
    }

    $(document).on("click", ".recent-chip", function () {
        const query = $(this).attr("data-query");
        const $input = $("#global-search-input");
        playSound();
        if ($input.length) {
            $input.val(query).trigger("input").trigger("focus");
        } else {
            window.location.href = "races.html?q=" + encodeURIComponent(query);
        }
    });

    $(document).on("click", "#clear-recent", function () {
        playSound();
        F1.recents.clear();
    });

    /* ======================================================================
       7. DYNAMIC LISTS (arrays of objects, filter(), switch)
       ====================================================================== */
    const races = [
        { name: "Monaco Grand Prix", circuit: "Circuit de Monaco", category: "Classic" },
        { name: "Silverstone Grand Prix", circuit: "Silverstone Circuit", category: "Classic" },
        { name: "Monza Grand Prix", circuit: "Autodromo Nazionale Monza", category: "High Speed" },
        { name: "Las Vegas Grand Prix", circuit: "Las Vegas Street Track", category: "Street Track" }
    ];
    const CATEGORY_KEYS = { "Classic": "filter.classic", "High Speed": "filter.speed", "Street Track": "filter.street" };
    let raceCategory = F1.store.get(KEYS.raceCategory, "all");

    function getRacesByCategory(category) {
        switch (category) {
            case "Classic":
            case "High Speed":
            case "Street Track":
                return races.filter(function (race) { return race.category === category; });
            default:
                return races.slice();
        }
    }

    function renderRaces() {
        const $container = $("#dynamic-races-list");
        if (!$container.length) { return; }
        $container.empty();
        getRacesByCategory(raceCategory).forEach(function (r) {
            const $li = $('<li class="list-group-item d-flex justify-content-between align-items-center gap-2 searchable-item highlightable"></li>');
            const $left = $("<span></span>").append($("<strong></strong>").text(r.name), " - ", $("<em></em>").text(r.circuit));
            $li.append($left, $('<span class="badge"></span>').text(t(CATEGORY_KEYS[r.category])));
            $container.append($li);
        });
        $(".race-filter").each(function () {
            const active = $(this).attr("data-category") === raceCategory;
            $(this).toggleClass("active", active).attr("aria-pressed", active ? "true" : "false");
        });
        F1.refreshSearch();
    }

    $(document).on("click", ".race-filter", function (e) {
        e.preventDefault();
        playSound();
        raceCategory = $(this).attr("data-category");
        F1.store.set(KEYS.raceCategory, raceCategory);
        renderRaces();
    });

    const driverLegends = [
        { name: "Lewis Hamilton", titles: 7, status: "Multi-Champion" },
        { name: "Michael Schumacher", titles: 7, status: "Multi-Champion" },
        { name: "Max Verstappen", titles: 4, status: "Multi-Champion" },
        { name: "Charles Leclerc", titles: 0, status: "Active Driver" }
    ];
    let multiOnly = false;

    function renderLegends() {
        const $container = $("#dynamic-drivers-list");
        if (!$container.length) { return; }
        $container.empty();
        driverLegends
            .filter(function (d) { return !multiOnly || d.status === "Multi-Champion"; })
            .forEach(function (d) {
                const $li = $('<li class="list-group-item d-flex justify-content-between align-items-center gap-2 searchable-item highlightable"></li>');
                const label = d.titles ? t("legend.titles", { n: d.titles }) : t("legend.contender");
                const $left = $("<span></span>").append($("<strong></strong>").text(d.name), " - ", $("<em></em>").text(label));
                const $right = $('<span class="d-flex align-items-center gap-2"></span>').append(
                    $('<span class="badge"></span>').text(t(d.status === "Multi-Champion" ? "status.multi" : "status.active")),
                    F1.favButton(d.name)
                );
                $li.append($left, $right);
                $container.append($li);
            });
        refreshFavUI();
        F1.refreshSearch();
    }

    $(document).on("click", "#filter-multi", function (e) {
        e.preventDefault();
        playSound();
        multiOnly = true;
        renderLegends();
    });

    $(document).on("click", "#reset-drivers-filter", function (e) {
        e.preventDefault();
        playSound();
        multiOnly = false;
        renderLegends();
    });

    /* ======================================================================
       8. SEARCH: live filter + autocomplete + highlighting (Assignment 6, Part 1)
       ====================================================================== */
    const searchTerms = [
        "Monaco Grand Prix", "Silverstone Grand Prix", "Monza Grand Prix", "Las Vegas Grand Prix",
        "Lewis Hamilton", "Michael Schumacher", "Max Verstappen", "Charles Leclerc",
        "Red Bull Racing", "Ferrari", "McLaren", "Mercedes AMG", "Aston Martin"
    ];
    let activeSuggestion = -1;
    let saveSearchTimer = null;

    /** Pages with live data add names (drivers, circuits) to the autocomplete list. */
    F1.addSearchTerms = function (list) {
        list.forEach(function (term) {
            if (term && searchTerms.indexOf(term) === -1) { searchTerms.push(term); }
        });
    };

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function currentQuery() {
        const $input = $("#global-search-input");
        return $input.length ? $input.val().toLowerCase().trim() : "";
    }

    // Wrap matches inside TEXT nodes only, so HTML tags are never broken.
    function wrapMatches(element, regex) {
        $(element).contents().each(function () {
            if (this.nodeType === 3) {
                const parts = this.nodeValue.split(regex);
                if (parts.length < 2) { return; }
                const fragment = document.createDocumentFragment();
                parts.forEach(function (part, i) {
                    if (part === "") { return; }
                    if (i % 2 === 1) {
                        const mark = document.createElement("mark");
                        mark.className = "highlight-search";
                        mark.textContent = part;
                        fragment.appendChild(mark);
                    } else {
                        fragment.appendChild(document.createTextNode(part));
                    }
                });
                this.parentNode.replaceChild(fragment, this);
            } else if (this.nodeType === 1 && this.tagName !== "MARK") {
                wrapMatches(this, regex);
            }
        });
    }

    function highlightText(keyword) {
        const regex = keyword ? new RegExp("(" + escapeRegExp(keyword) + ")", "gi") : null;
        $(".highlightable").each(function () {
            const $el = $(this);
            if ($el.data("originalHtml") === undefined) { $el.data("originalHtml", $el.html()); }
            $el.html($el.data("originalHtml"));
            if (regex) { wrapMatches(this, regex); }
        });
    }

    function updateNoResults(query, visibleCount) {
        const $msg = $("#no-results");
        if (!$msg.length) { return; }
        if (query && visibleCount === 0) {
            $msg.text(t("search.none") + ' "' + query + '"').prop("hidden", false);
        } else {
            $msg.prop("hidden", true);
        }
    }

    function markActiveSuggestion($items) {
        $items.removeClass("active-suggest");
        if (activeSuggestion >= 0) { $items.eq(activeSuggestion).addClass("active-suggest"); }
    }

    function runSearch(rawQuery) {
        const query = rawQuery.toLowerCase().trim();
        const $suggestions = $("#autocomplete-list");
        let visibleCount = 0;
        activeSuggestion = -1;
        $suggestions.empty();

        // Task 1: live filter
        $(".searchable-item").each(function () {
            const matches = query === "" || $(this).text().toLowerCase().indexOf(query) !== -1;
            if (matches && !$(this).hasClass("cat-hidden")) { visibleCount++; }
            $(this).stop(true, true)[matches ? "fadeIn" : "fadeOut"](200);
        });
        updateNoResults(query, visibleCount);

        // Task 2: autocomplete suggestions
        if (query.length > 0) {
            const matches = searchTerms.filter(function (item) {
                return item.toLowerCase().indexOf(query) !== -1;
            }).slice(0, 6);
            matches.forEach(function (match) {
                $suggestions.append($('<li class="dropdown-item search-suggest-item"></li>').text(match));
            });
            $suggestions.toggle(matches.length > 0);
        } else {
            $suggestions.hide();
        }

        // Task 3: highlighting
        highlightText(query);
    }

    /** Re-apply the current query after a list was re-rendered (API data, filters). */
    F1.refreshSearch = function () {
        const $input = $("#global-search-input");
        if ($input.length && $input.val().trim() !== "") { runSearch($input.val()); }
    };

    $(document).on("input", "#global-search-input", function () {
        runSearch($(this).val());
        // Save the search a moment after the user stops typing
        clearTimeout(saveSearchTimer);
        const value = $(this).val();
        saveSearchTimer = setTimeout(function () { F1.recents.add(value); }, 1200);
    });

    $(document).on("keydown", "#global-search-input", function (e) {
        const $items = $("#autocomplete-list .search-suggest-item");
        switch (e.key) {
            case "ArrowDown":
                if ($items.length) {
                    e.preventDefault();
                    activeSuggestion = (activeSuggestion + 1) % $items.length;
                    markActiveSuggestion($items);
                }
                break;
            case "ArrowUp":
                if ($items.length) {
                    e.preventDefault();
                    activeSuggestion = (activeSuggestion - 1 + $items.length) % $items.length;
                    markActiveSuggestion($items);
                }
                break;
            case "Enter":
                e.preventDefault();
                if (activeSuggestion >= 0) { $items.eq(activeSuggestion).trigger("click"); }
                else { F1.recents.add($(this).val()); $("#autocomplete-list").hide(); }
                break;
            case "Escape":
                $("#autocomplete-list").hide();
                break;
            default:
                break;
        }
    });

    $(document).on("click", ".search-suggest-item", function () {
        const value = $(this).text();
        $("#global-search-input").val(value).trigger("input");
        F1.recents.add(value);
        $("#autocomplete-list").hide();
    });

    $(document).on("click", function (e) {
        if (!$(e.target).closest("#global-search-input, #autocomplete-list").length) {
            $("#autocomplete-list").hide();
        }
    });

    // Press "/" anywhere to jump to the search box
    $(document).on("keydown", function (e) {
        const tag = (e.target.tagName || "").toLowerCase();
        if (e.key === "/" && tag !== "input" && tag !== "textarea" && tag !== "select") {
            const $search = $("#global-search-input");
            if ($search.length) { e.preventDefault(); $search.trigger("focus"); }
        }
    });

    /* ======================================================================
       9. PHOTO GALLERY FILTER (category buttons, choice saved in localStorage)
       ====================================================================== */
    const GALLERY_CATEGORIES = ["all", "racing", "cars", "podium", "people"];

    function applyGalleryFilter(category, save) {
        if (GALLERY_CATEGORIES.indexOf(category) === -1) { category = "all"; }
        $(".gallery-filter").each(function () {
            const active = $(this).attr("data-category") === category;
            $(this).toggleClass("active", active).attr("aria-pressed", active ? "true" : "false");
        });
        let shown = 0;
        const $items = $(".gallery-item");
        $items.each(function () {
            const hide = category !== "all" && $(this).attr("data-category") !== category;
            $(this).toggleClass("cat-hidden", hide);
            if (!hide) { shown++; }
        });
        $("#gallery-count").text(t("gal.count", { n: shown, total: $items.length }));
        if (save) { F1.store.set(KEYS.galleryFilter, category); }
        F1.refreshSearch();
        lazyLoadImages();
    }

    $(document).on("click", ".gallery-filter", function () {
        playSound();
        applyGalleryFilter($(this).attr("data-category"), true);
    });

    /* ======================================================================
       10. ACCORDION, RATING, READ MORE
       ====================================================================== */
    function toggleAccordion($header) {
        playSound();
        $header.toggleClass("active");
        $header.attr("aria-expanded", $header.hasClass("active") ? "true" : "false");
        $header.next(".accordion-content-custom").slideToggle(300);
    }

    $(document).on("click", ".accordion-header-custom", function () { toggleAccordion($(this)); });
    $(document).on("keydown", ".accordion-header-custom", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion($(this)); }
    });

    let currentRating = parseInt(F1.store.get(KEYS.rating, "0"), 10) || 0;

    function paintStars(rating) {
        $("#rating-stars .star").each(function (index) {
            $(this).toggleClass("active", index < rating).attr("aria-checked", index === rating - 1 ? "true" : "false");
        });
    }

    function renderRatingFeedback() {
        const $feedback = $("#rating-feedback");
        if ($feedback.length) {
            $feedback.text(currentRating ? t("rate.thanks", { n: currentRating }) : t("rate.hint"));
        }
    }

    $(document).on("mouseenter focus", "#rating-stars .star", function () {
        const hoverIndex = $(this).index();
        $("#rating-stars .star").each(function (index) { $(this).toggleClass("hovered", index <= hoverIndex); });
    });

    $(document).on("mouseleave blur", "#rating-stars .star", function () {
        $("#rating-stars .star").removeClass("hovered");
    });

    $(document).on("click", "#rating-stars .star", function () {
        playSound();
        currentRating = $(this).index() + 1;
        F1.store.set(KEYS.rating, String(currentRating));
        paintStars(currentRating);
        renderRatingFeedback();
        showToast(t("toast.rating"), t("rate.toast", { n: currentRating }), "success");
    });

    // Assignment 5: toggle an element with style.display
    $(document).on("click", ".read-more-btn", function (e) {
        e.preventDefault();
        playSound();
        const content = this.parentNode.querySelector(".read-more-content");
        if (!content) { return; }
        const isHidden = content.style.display === "" || content.style.display === "none";
        content.style.display = isHidden ? "block" : "none";
        const key = isHidden ? "readmore.less" : "readmore.more";
        $(this).attr("data-i18n", key).attr("aria-expanded", isHidden ? "true" : "false").text(t(key));
    });

    /* ======================================================================
       11. POPUP (newsletter)
       ====================================================================== */
    function openPopup() {
        $("#popup-modal").css("display", "flex").attr("aria-hidden", "false");
        setTimeout(function () { $("#subscribe-email").trigger("focus"); }, 50);
    }

    function closePopup() {
        $("#popup-modal").css("display", "none").attr("aria-hidden", "true");
    }

    $(document).on("click", "#open-popup-btn", function (e) {
        e.preventDefault();
        playSound();
        openPopup();
    });
    $(document).on("click", "#close-popup-btn", closePopup);
    $(window).on("click", function (e) {
        if (e.target === $("#popup-modal")[0]) { closePopup(); }
    });

    /* ======================================================================
       12. FORM VALIDATION (pure JavaScript: no required / pattern / minlength /
           type="email"; every <form> has novalidate; messages appear on the page)
       ====================================================================== */
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    /** Returns the list of password requirements that are NOT met yet. */
    function passwordProblems(value) {
        const problems = [];
        if (value.length < 8) { problems.push("len"); }
        if (!/[A-Z]/.test(value)) { problems.push("upper"); }
        if (!/[a-z]/.test(value)) { problems.push("lower"); }
        if (!/\d/.test(value)) { problems.push("digit"); }
        return problems;
    }

    function phoneError(value) {
        const text = value.trim();
        if (!text) { return t("err.required"); }
        if (!/^\+?[\d\s\-().]+$/.test(text)) { return t("err.phone"); }
        const digits = text.replace(/\D/g, "");
        return digits.length >= 10 && digits.length <= 15 ? "" : t("err.phone");
    }

    const validators = {
        name: function (v) {
            const text = v.trim();
            if (!text) { return t("err.required"); }
            return text.length >= 2 && /^[\p{L}][\p{L}\s'.\-]*$/u.test(text) ? "" : t("err.name");
        },
        email: function (v) {
            const text = v.trim();
            if (!text) { return t("err.required"); }
            return EMAIL_RE.test(text) ? "" : t("err.email");
        },
        phone: phoneError,
        password: function (v) {
            if (!v) { return t("err.required"); }
            return passwordProblems(v).length ? t("err.password") : "";
        },
        confirm: function (v, $input) {
            if (!v) { return t("err.required"); }
            const original = $input.closest("form").find('[data-validate="password"]').val();
            return v === original ? "" : t("err.confirm");
        },
        message: function (v) {
            const text = v.trim();
            if (!text) { return t("err.required"); }
            return text.length >= 10 ? "" : t("err.message");
        },
        select: function (v) { return v ? "" : t("err.select"); },
        agree: function (v, $input) { return $input.is(":checked") ? "" : t("err.agree"); }
    };

    function setFieldState($input, message) {
        const $field = $input.closest(".form-field");
        const $error = $field.find(".field-error").first();
        if ($error.length && !$error.attr("id")) {
            $error.attr("id", "err-" + ($input.attr("id") || Math.random().toString(36).slice(2)));
        }
        $input.toggleClass("is-invalid", !!message)
            .toggleClass("is-valid", !message && $input.attr("type") !== "checkbox")
            .attr("aria-invalid", message ? "true" : "false");
        if ($error.length) {
            $input.attr("aria-describedby", $error.attr("id"));
            $error.text(message);
            $error.css("visibility", message ? "visible" : "hidden");
        }
    }

    function validateField($input) {
        const validator = validators[$input.attr("data-validate")];
        if (!validator) { return true; }
        const message = validator($input.val(), $input);
        setFieldState($input, message);
        return message === "";
    }

    function validateForm($form) {
        let valid = true;
        let $firstInvalid = null;
        $form.find("[data-validate]").each(function () {
            $(this).addClass("touched");
            if (!validateField($(this))) {
                valid = false;
                if (!$firstInvalid) { $firstInvalid = $(this); }
            }
        });
        if ($firstInvalid) { $firstInvalid.trigger("focus"); }
        return valid;
    }

    function clearValidation($form) {
        $form.find("[data-validate]").removeClass("is-valid is-invalid touched").removeAttr("aria-invalid");
        $form.find(".field-error").css("visibility", "hidden").text("");
        $form.find(".password-strength").attr("class", "password-strength mt-2");
        $form.find("#pw-rules li").removeClass("ok");
    }

    function updatePasswordUI($input) {
        const value = $input.val();
        const problems = passwordProblems(value);
        $input.closest("form").find("#pw-rules li").each(function () {
            $(this).toggleClass("ok", problems.indexOf($(this).attr("data-rule")) === -1);
        });
        let score = 0;
        if (value.length >= 8) { score++; }
        if (/[a-z]/.test(value) && /[A-Z]/.test(value)) { score++; }
        if (/\d/.test(value)) { score++; }
        if (/[^A-Za-z0-9]/.test(value) || value.length >= 12) { score++; }
        $input.closest("form").find(".password-strength")
            .attr("class", "password-strength mt-2 strength-" + (value ? score : 0));
    }

    $(document).on("blur change", "[data-validate]", function () {
        $(this).addClass("touched");
        validateField($(this));
    });

    $(document).on("input", "[data-validate]", function () {
        const $input = $(this);
        if ($input.hasClass("touched")) { validateField($input); }
        if ($input.attr("data-validate") === "password") {
            updatePasswordUI($input);
            const $confirm = $input.closest("form").find('[data-validate="confirm"]');
            if ($confirm.hasClass("touched")) { validateField($confirm); }
        }
    });

    // Show / hide password
    $(document).on("click", ".toggle-password", function () {
        const $input = $($(this).attr("data-target"));
        const show = $input.attr("type") === "password";
        $input.attr("type", show ? "text" : "password");
        $(this).attr("aria-label", t(show ? "form.hidePw" : "form.showPw")).text(show ? "🙈" : "👁");
    });

    function startSpinner($btn) {
        $btn.data("originalHtml", $btn.html());
        $btn.prop("disabled", true).html(
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>' + t("wait")
        );
    }

    function stopSpinner($btn) {
        $btn.prop("disabled", false).html($btn.data("originalHtml"));
    }

    /** type: "success" | "error" */
    function setStatus($el, type, message) {
        $el.removeClass("alert-success alert-danger")
            .addClass(type === "success" ? "alert-success" : "alert-danger")
            .text(message)
            .prop("hidden", false);
    }

    F1.forms = {
        validateForm: validateForm,
        validateField: validateField,
        clear: clearValidation,
        startSpinner: startSpinner,
        stopSpinner: stopSpinner,
        setStatus: setStatus,
        setFieldState: setFieldState,
        passwordProblems: passwordProblems,
        updatePasswordUI: updatePasswordUI
    };

    // Asynchronous POST with a callback (Assignment 5). The free JSONPlaceholder
    // test API pretends to accept the data and stores nothing.
    function sendFormData(url, payload, callback) {
        const minimumDelay = new Promise(function (resolve) { setTimeout(resolve, 900); });
        const request = fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify(payload)
        }).then(function (response) {
            if (!response.ok) { throw new Error("HTTP " + response.status); }
            return response.json();
        });
        Promise.all([request, minimumDelay])
            .then(function (results) { callback(null, results[0]); })
            .catch(function (error) { callback(error); });
    }

    // Contact form
    $(document).on("submit", "#contact-form", function (e) {
        e.preventDefault();
        const $form = $(this);
        const $status = $("#form-status").prop("hidden", true);
        if (!validateForm($form)) {
            showToast(t("toast.error"), t("toast.fix"), "error");
            return;
        }
        const $btn = $form.find('button[type="submit"]');
        startSpinner($btn);
        sendFormData("https://jsonplaceholder.typicode.com/posts", {
            name: $("#name").val().trim(),
            email: $("#email").val().trim(),
            phone: $("#phone").val().trim(),
            topic: $("#topic").val(),
            reply: $('input[name="reply"]:checked').val(),
            message: $("#message").val().trim()
        }, function (error) {
            stopSpinner($btn);
            if (error) {
                setStatus($status, "error", t("status.error"));
                showToast(t("toast.error"), t("status.error"), "error");
                return;
            }
            playSound(800);
            $form[0].reset();
            clearValidation($form);
            setStatus($status, "success", t("status.success"));
            showToast(t("toast.success"), t("status.success"), "success");
        });
    });

    // Newsletter popup
    $(document).on("submit", "#subscribe-form", function (e) {
        e.preventDefault();
        const $form = $(this);
        if (!validateForm($form)) { return; }
        const $btn = $form.find('button[type="submit"]');
        const email = $("#subscribe-email").val().trim();
        startSpinner($btn);
        setTimeout(function () {
            stopSpinner($btn);
            playSound(800);
            F1.store.set("f1-newsletter", email);
            $form[0].reset();
            clearValidation($form);
            closePopup();
            showToast(t("toast.subscribed"), t("popup.success"), "success");
        }, 1000);
    });

    /* ======================================================================
       13. GREETING (switch on the hour), CURRENT TIME, FACTS
       ====================================================================== */
    function getGreetingKey(hour) {
        switch (true) {
            case hour >= 5 && hour < 12: return "greet.morning";
            case hour >= 12 && hour < 18: return "greet.afternoon";
            case hour >= 18 && hour < 23: return "greet.evening";
            default: return "greet.night";
        }
    }

    function displayName() {
        const user = F1.auth && F1.auth.current();
        return user ? user.name.split(/\s+/)[0] : F1.store.get(KEYS.userName, "");
    }

    function renderGreeting() {
        const el = document.getElementById("greeting");
        if (!el) { return; }
        el.textContent = t(getGreetingKey(new Date().getHours())) + ", " + (displayName() || t("greet.default")) + "! 🏁";
    }
    F1.renderGreeting = renderGreeting;

    $(document).on("submit", "#greeting-form", function (e) {
        e.preventDefault();
        playSound();
        if (!validateForm($(this))) { return; }
        F1.store.set(KEYS.userName, $("#greeting-name").val().trim());
        renderGreeting();
    });

    $(document).on("click", "#time-btn", function (e) {
        e.preventDefault();
        playSound();
        document.getElementById("current-time-output").textContent = new Date().toLocaleTimeString(F1.locale());
    });

    let facts = [
        "The first Formula 1 World Championship race took place at Silverstone in 1950.",
        "A modern F1 pit stop can be completed in under 2.5 seconds.",
        "Monza is nicknamed the 'Temple of Speed'."
    ];
    let lastFactIndex = -1;

    function loadFacts(callback) {
        fetch("data/facts.json")
            .then(function (response) {
                if (!response.ok) { throw new Error("HTTP " + response.status); }
                return response.json();
            })
            .then(function (data) { if (Array.isArray(data) && data.length) { facts = data; } })
            .catch(function () { /* keep the built-in facts (for example when opened via file://) */ })
            .finally(callback);
    }

    function showRandomFact() {
        const $fact = $("#fact-text");
        if (!$fact.length) { return; }
        let index;
        do { index = Math.floor(Math.random() * facts.length); }
        while (facts.length > 1 && index === lastFactIndex);
        lastFactIndex = index;
        $fact.stop(true, true).fadeOut(150, function () { $(this).text(facts[index]).fadeIn(250); });
    }

    $(document).on("click", "#fact-btn", function (e) {
        e.preventDefault();
        playSound();
        showRandomFact();
    });

    /* ======================================================================
       14. KEYBOARD NAVIGATION for the menu (arrow keys, Home, End)
       ====================================================================== */
    $(document).on("keydown", ".nav-menu a, .nav-menu button", function (e) {
        const $items = $(".nav-menu").find("a, button").filter(":visible");
        const index = $items.index(this);
        const last = $items.length - 1;
        let next;
        switch (e.key) {
            case "ArrowRight": case "ArrowDown": next = index >= last ? 0 : index + 1; break;
            case "ArrowLeft": case "ArrowUp": next = index <= 0 ? last : index - 1; break;
            case "Home": next = 0; break;
            case "End": next = last; break;
            default: return;
        }
        e.preventDefault();
        $items.eq(next).trigger("focus");
    });

    /* ======================================================================
       15. IMAGE LIGHTBOX (click a photo to enlarge, browse its gallery)
       ====================================================================== */
    const lb = { group: [], index: 0, lastFocus: null, touchX: null };

    function lightboxIsOpen() { return $("#lightbox").hasClass("open"); }

    function captionFor($img) {
        const key = $img.attr("data-caption-key");
        return key ? t(key) : ($img.attr("alt") || "");
    }

    function showLightboxImage() {
        const img = lb.group[lb.index];
        if (!img) { return; }
        const $img = $(img);
        $("#lb-img").removeClass("lb-ready").attr({ src: $img.attr("data-full") || img.currentSrc || img.src, alt: $img.attr("alt") || "" });
        $("#lb-caption").text(captionFor($img) + (lb.group.length > 1 ? "  ·  " + (lb.index + 1) + " / " + lb.group.length : ""));
        $("#lightbox .lb-prev, #lightbox .lb-next").toggle(lb.group.length > 1);
        [1, -1].forEach(function (step) {       // preload neighbours
            const n = lb.group[(lb.index + step + lb.group.length) % lb.group.length];
            if (n) { new Image().src = $(n).attr("data-full") || n.src; }
        });
    }

    function stepLightbox(step) {
        if (lb.group.length < 2) { return; }
        lb.index = (lb.index + step + lb.group.length) % lb.group.length;
        playSound(500);
        showLightboxImage();
    }

    function setCarouselPaused(paused) {
        const el = document.getElementById("f1Carousel");
        if (el && window.bootstrap && window.bootstrap.Carousel) {
            const carousel = window.bootstrap.Carousel.getOrCreateInstance(el);
            if (paused) { carousel.pause(); } else { carousel.cycle(); }
        }
    }

    function openLightbox($img) {
        // Only photos that are not hidden by a filter belong to the viewer's group
        lb.group = $('img.zoomable[data-gallery="' + $img.attr("data-gallery") + '"]').filter(function () {
            return !$(this).closest(".cat-hidden").length && $(this).closest(".searchable-item").css("display") !== "none";
        }).toArray();
        lb.index = Math.max(0, lb.group.indexOf($img[0]));
        lb.lastFocus = document.activeElement;
        $("#lightbox .lb-close").attr("aria-label", t("lb.close"));
        $("#lightbox .lb-prev").attr("aria-label", t("lb.prev"));
        $("#lightbox .lb-next").attr("aria-label", t("lb.next"));
        showLightboxImage();
        $("#lightbox").addClass("open").attr("aria-hidden", "false");
        $("body").addClass("lb-open");
        setCarouselPaused(true);
        $("#lightbox .lb-close").trigger("focus");
    }

    function closeLightbox() {
        if (!lightboxIsOpen()) { return; }
        $("#lightbox").removeClass("open").attr("aria-hidden", "true");
        $("body").removeClass("lb-open");
        $("#lb-img").removeAttr("src");
        setCarouselPaused(false);
        if (lb.lastFocus && lb.lastFocus.focus) { lb.lastFocus.focus(); }
    }

    $(document).on("click", "img.zoomable", function (e) {
        e.preventDefault();
        playSound(520);
        openLightbox($(this));
    });
    $(document).on("keydown", "img.zoomable", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox($(this)); }
    });
    $(document).on("click", "#lightbox .lb-close", closeLightbox);
    $(document).on("click", "#lightbox .lb-prev", function () { stepLightbox(-1); });
    $(document).on("click", "#lightbox .lb-next", function () { stepLightbox(1); });
    $(document).on("click", "#lightbox", function (e) {
        if (e.target === this || $(e.target).hasClass("lb-figure")) { closeLightbox(); }
    });

    $(document).on("keydown", function (e) {
        if (e.key === "Escape") { closePopup(); }
        if (!lightboxIsOpen()) { return; }
        switch (e.key) {
            case "Escape": closeLightbox(); break;
            case "ArrowLeft": e.preventDefault(); stepLightbox(-1); break;
            case "ArrowRight": e.preventDefault(); stepLightbox(1); break;
            case "Tab": {
                const $focusable = $("#lightbox .lb-btn:visible");
                const first = $focusable.get(0);
                const last = $focusable.get($focusable.length - 1);
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                break;
            }
            default: break;
        }
    });

    $(document).on("touchstart", "#lightbox", function (e) { lb.touchX = e.originalEvent.touches[0].clientX; });
    $(document).on("touchend", "#lightbox", function (e) {
        if (lb.touchX === null) { return; }
        const dx = e.originalEvent.changedTouches[0].clientX - lb.touchX;
        lb.touchX = null;
        if (Math.abs(dx) > 50) { stepLightbox(dx < 0 ? 1 : -1); }
    });
    $("#lb-img").on("load", function () { $(this).addClass("lb-ready"); });

    /* ======================================================================
       16. COPY TO CLIPBOARD (Assignment 6, Task 8)
       ====================================================================== */
    let programmaticCopy = false;

    function fallbackCopy(text) {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.className = "offscreen-copy";
        document.body.appendChild(area);
        area.select();
        let ok = false;
        programmaticCopy = true;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        programmaticCopy = false;
        document.body.removeChild(area);
        return ok;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text)
                .then(function () { return true; })
                .catch(function () { return fallbackCopy(text); });
        }
        return Promise.resolve(fallbackCopy(text));
    }

    function markCopied($btn, text) {
        const $icon = $btn.find(".copy-icon");
        const $label = $btn.find(".copy-label");
        const originalKey = $label.attr("data-i18n");
        clearTimeout($btn.data("copyTimer"));
        $btn.find(".copy-tooltip").remove();
        $btn.addClass("copied");
        $icon.text("✓");
        $label.text(t("copy.done"));
        $btn.append($('<i class="copy-tooltip" role="status"></i>').text(t("copy.tooltip")));
        showToast(t("toast.clipboard"), '"' + text + '"', "success");
        $btn.data("copyTimer", setTimeout(function () {
            $btn.removeClass("copied");
            $icon.text("📋");
            $label.text(t(originalKey));
            $btn.find(".copy-tooltip").remove();
        }, 2300));
    }

    $(document).on("click", ".btn-copy", function (e) {
        e.preventDefault();
        playSound();
        const $btn = $(this);
        const text = $($btn.data("clipboard-target")).text().trim();
        copyToClipboard(text).then(function (ok) {
            if (ok) { markCopied($btn, text); }
            else { showToast(t("toast.error"), t("copy.failed"), "error"); }
        });
    });

    $(document).on("copy", ".copyable", function () {
        if (!programmaticCopy) { showToast(t("toast.clipboard"), t("copy.manual"), "info"); }
    });

    /* ======================================================================
       17. SCROLL EFFECTS: progress bar, reveal, lazy loading, counters, clock
       ====================================================================== */
    function updateProgress() {
        const winScroll = $(window).scrollTop();
        const height = $(document).height() - $(window).height();
        $("#scroll-progress").css("width", (height > 0 ? (winScroll / height) * 100 : 0) + "%");
    }

    function revealOnScroll() {
        const viewBottom = $(window).scrollTop() + $(window).height() - 40;
        $(".reveal:not(.visible)").each(function () {
            if ($(this).offset().top < viewBottom) { $(this).addClass("visible"); }
        });
    }

    // Assignment 6 Task 9: real lazy loading. Images keep a tiny placeholder src and get
    // their real src (data-src) only when they are about to enter the viewport.
    function lazyLoadImages() {
        const viewBottom = $(window).scrollTop() + $(window).height() + 150;
        $("img.lazy-load[data-src]").each(function () {
            const $img = $(this);
            // Images inside hidden carousel slides have no position of their own,
            // so measure the carousel instead (otherwise they would all load at once).
            const $ref = $img.closest(".carousel").length ? $img.closest(".carousel") : $img;
            if ($ref.offset().top < viewBottom) {
                const realSrc = $img.attr("data-src");
                $img.removeAttr("data-src")
                    .one("load", function () { $(this).addClass("lazy-loaded"); })
                    .one("error", function () { $(this).addClass("lazy-loaded lazy-error"); })
                    .attr("src", realSrc);
            }
        });
    }
    F1.lazyLoadImages = lazyLoadImages;

    let scrollTicking = false;
    $(window).on("scroll resize", function () {
        if (scrollTicking) { return; }
        scrollTicking = true;
        window.requestAnimationFrame(function () {
            updateProgress();
            lazyLoadImages();
            revealOnScroll();
            scrollTicking = false;
        });
    });

    function startCounters() {
        $(".counter-value").each(function () {
            const $counter = $(this);
            const target = parseInt($counter.attr("data-count"), 10) || 0;
            const suffix = $counter.attr("data-suffix") || "";
            $({ countNum: 0 }).animate({ countNum: target }, {
                duration: 2000,
                easing: "swing",
                step: function (now) { $counter.text(Math.floor(now) + suffix); },
                complete: function () { $counter.text(target + suffix); }
            });
        });
    }

    function updateClock() {
        const el = document.getElementById("live-clock");
        if (!el) { return; }
        const options = { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" };
        if (currentLang === "en") { options.hour12 = true; }
        el.textContent = new Date().toLocaleString(F1.locale(), options);
    }

    /* ======================================================================
       18. INITIALISE
       ====================================================================== */
    $(function () {
        console.log("jQuery is ready!");

        F1.addSearchTerms([]);
        renderRaces();
        renderLegends();
        paintStars(currentRating);
        $("#greeting-name").val(F1.store.get(KEYS.userName, ""));
        $(".card, .gallery-item, .stat-panel, .flex-card, .member-card").addClass("reveal");

        applyTheme(currentTheme(), false);
        F1.onLanguage(function () {
            renderRaces();
            renderLegends();
            renderGreeting();
            renderRatingFeedback();
            renderRecents();
            renderFavList();
            updateClock();
            if ($(".gallery-filter").length) {
                applyGalleryFilter($(".gallery-filter.active").attr("data-category") || "all", false);
            }
        });

        if ($(".gallery-filter").length) {
            applyGalleryFilter(F1.store.get(KEYS.galleryFilter, "all"), false);
        }
        F1.applyLanguage(currentLang);
        loadFacts(showRandomFact);

        // ?q=... pre-fills the search (used by the "Recent searches" chips)
        const preset = new URLSearchParams(window.location.search).get("q");
        const $search = $("#global-search-input");
        if (preset && $search.length) { $search.val(preset).trigger("input"); }

        startCounters();
        setInterval(updateClock, 1000);
        updateProgress();
        lazyLoadImages();
        revealOnScroll();
    });
})(window.F1, window.jQuery);
