/* ==========================================================================
   F1 PORTAL — api.js
   Live data from the public Jolpica F1 API (Ergast-compatible, no API key):
   https://api.jolpi.ca/ergast/f1

   Used for: next race (sidebar, every page), race calendar + latest result
   (races.html), driver standings (drivers.html), constructor standings (teams.html).

   Every request shows a loading state, handles errors with a Retry button and
   caches the answer in sessionStorage for 10 minutes.
   ========================================================================== */
window.F1 = window.F1 || {};

(function (F1, $) {
    "use strict";

    const BASE = "https://api.jolpi.ca/ergast/f1";
    const CACHE_MS = 10 * 60 * 1000;
    const TIMEOUT_MS = 12000;
    const t = function (key, vars) { return F1.t(key, vars); };

    /* ------------------------------------------------------------- fetch core */
    function cacheRead(url) {
        try {
            const raw = sessionStorage.getItem("f1-api:" + url);
            if (!raw) { return null; }
            const entry = JSON.parse(raw);
            return Date.now() - entry.at < CACHE_MS ? entry.data : null;
        } catch (e) { return null; }
    }

    function cacheWrite(url, data) {
        try { sessionStorage.setItem("f1-api:" + url, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* ignore */ }
    }

    /** GET a JSON document from the API. Rejects on network errors, timeouts and HTTP errors. */
    F1.api = {
        get: function (path) {
            const url = BASE + path;
            const cached = cacheRead(url);
            if (cached) { return Promise.resolve(cached); }

            const controller = new AbortController();
            const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
            return fetch(url, { signal: controller.signal })
                .then(function (response) {
                    if (!response.ok) { throw new Error("HTTP " + response.status); }
                    return response.json();
                })
                .then(function (data) {
                    cacheWrite(url, data);
                    return data;
                })
                .finally(function () { clearTimeout(timer); });
        }
    };

    /* --------------------------------------------------------- state helpers */
    function showLoading($box, lines) {
        $box.attr("aria-busy", "true").empty();
        const $loading = $('<div class="api-loading"></div>')
            .append('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>')
            .append($("<span></span>").text(t("api.loading")));
        $box.append($loading);
        for (let i = 0; i < (lines || 0); i++) { $box.append('<div class="skeleton" aria-hidden="true"></div>'); }
    }

    function showError($box, retry) {
        $box.attr("aria-busy", "false").empty();
        const $error = $('<div class="api-error" role="alert"></div>');
        $error.append($("<p class='mb-2'></p>").text(t("api.error")));
        $error.append(
            $('<button type="button" class="btn btn-outline-danger btn-sm"></button>')
                .text(t("api.retry"))
                .on("click", retry)
        );
        $box.append($error);
    }

    function showEmpty($box, key) {
        $box.attr("aria-busy", "false").empty().append($('<p class="mb-0"></p>').text(t(key)));
    }

    /** Runs `load` (returns a Promise); shows loading, then `render(data)` or an error with Retry. */
    function loadInto($box, load, render) {
        if (!$box.length) { return; }
        showLoading($box, 3);
        load().then(function (data) {
            $box.attr("aria-busy", "false");
            render(data);
            F1.refreshSearch();
        }).catch(function () {
            showError($box, function () { loadInto($box, load, render); });
        });
    }

    /* -------------------------------------------------------------- formatting */
    function formatDate(dateString) {
        const date = new Date(dateString + "T12:00:00Z");
        return isNaN(date) ? dateString : date.toLocaleDateString(F1.locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function fullName(driver) {
        return ((driver.givenName || "") + " " + (driver.familyName || "")).trim();
    }

    function racesFrom(data) {
        return (((data || {}).MRData || {}).RaceTable || {}).Races || [];
    }

    function standingsFrom(data, listKey) {
        const lists = (((data || {}).MRData || {}).StandingsTable || {}).StandingsLists || [];
        return lists.length ? (lists[0][listKey] || []) : [];
    }

    function cell(text, className) {
        return $("<td></td>").addClass(className || "").text(text);
    }

    /* ------------------------------------------------------- 1. next race card */
    let seasonRaces = null;       // current-season calendar, shared by the sidebar and the calendar page

    function loadCurrentSeason() {
        return F1.api.get("/current.json?limit=100").then(function (data) {
            seasonRaces = racesFrom(data);
            return seasonRaces;
        });
    }

    function pickNextRace(races) {
        const today = todayIso();
        const upcoming = races.filter(function (race) { return race.date >= today; });
        return upcoming.length ? upcoming[0] : null;
    }

    function renderNextRace(races) {
        const $box = $("#next-race");
        const next = pickNextRace(races);
        const race = next || races[races.length - 1];
        if (!race) { showEmpty($box, "api.empty"); return; }
        const location = race.Circuit && race.Circuit.Location ? race.Circuit.Location.locality + ", " + race.Circuit.Location.country : "";
        $box.empty()
            .append($('<span class="status-badge ' + (next ? "next" : "done") + ' mb-2"></span>').text(t(next ? "races.nextBadge" : "races.seasonOver")))
            .append($('<div class="next-race-name"></div>').text(race.raceName))
            .append($("<div></div>").text(location))
            .append($("<div></div>").text("📅 " + formatDate(race.date)))
            .append($("<div></div>").text("🏁 " + t("races.round") + " " + race.round));
    }

    function initNextRace() {
        const $box = $("#next-race");
        if (!$box.length) { return; }
        loadInto($box, loadCurrentSeason, renderNextRace);
        F1.onLanguage(function () { if (seasonRaces && !$box.find(".api-loading, .api-error").length) { renderNextRace(seasonRaces); } });
    }

    /* ------------------------------------------------- 2. race calendar page */
    const SEASONS = ["current", "2025", "2024", "2023", "2022", "2021", "2020", "2019"];
    let calendarRaces = [];
    let statusFilter = F1.store.get("f1-race-status", "all");

    function renderCalendar() {
        const $box = $("#race-calendar");
        if (!calendarRaces.length) { showEmpty($box, "api.empty"); return; }
        const today = todayIso();
        const next = pickNextRace(calendarRaces);
        const $table = $('<table class="table f1-table align-middle mb-0"></table>');
        $table.append(
            $("<thead></thead>").append($("<tr></tr>").append(
                $('<th scope="col"></th>').text(t("races.round")),
                $('<th scope="col"></th>').text(t("races.grandPrix")),
                $('<th scope="col"></th>').text(t("races.circuit")),
                $('<th scope="col"></th>').text(t("races.date")),
                $('<th scope="col"></th>').text(t("races.status"))
            ))
        );
        const $body = $("<tbody></tbody>");
        let shown = 0;
        calendarRaces.forEach(function (race) {
            const done = race.date < today;
            if ((statusFilter === "done" && !done) || (statusFilter === "upcoming" && done)) { return; }
            shown++;
            const isNext = next && next.round === race.round && next.season === race.season;
            const place = race.Circuit && race.Circuit.Location ? race.Circuit.Location.locality + ", " + race.Circuit.Location.country : "";
            const $badge = $('<span class="status-badge"></span>')
                .addClass(isNext ? "next" : (done ? "done" : "upcoming"))
                .text(t(isNext ? "races.nextBadge" : (done ? "races.completed" : "races.upcoming")));
            $body.append(
                $('<tr class="searchable-item"></tr>').append(
                    cell(race.round, "num"),
                    $('<td class="highlightable"></td>').append($("<strong></strong>").text(race.raceName)),
                    $('<td class="highlightable"></td>').text((race.Circuit ? race.Circuit.circuitName : "") + " — " + place),
                    cell(formatDate(race.date)),
                    $("<td></td>").append($badge)
                )
            );
        });
        if (!shown) { showEmpty($box, "races.noneInFilter"); return; }
        $box.empty().append($('<div class="table-responsive"></div>').append($table.append($body)));
        F1.refreshSearch();
    }

    function updateStatusButtons() {
        $(".status-filter").each(function () {
            const active = $(this).attr("data-status") === statusFilter;
            $(this).toggleClass("active", active).attr("aria-pressed", active ? "true" : "false");
        });
    }

    function loadCalendar(season) {
        const $box = $("#race-calendar");
        const path = "/" + season + ".json?limit=100";
        loadInto($box, function () {
            return F1.api.get(path).then(function (data) { calendarRaces = racesFrom(data); return calendarRaces; });
        }, function () {
            F1.addSearchTerms(calendarRaces.map(function (r) { return r.raceName; }));
            renderCalendar();
        });
    }

    function renderLastResult(race) {
        const $box = $("#last-result");
        if (!race || !race.Results) { showEmpty($box, "api.empty"); return; }
        const $table = $('<table class="table f1-table align-middle mb-0"></table>');
        $table.append(
            $("<thead></thead>").append($("<tr></tr>").append(
                $('<th scope="col"></th>').text("#"),
                $('<th scope="col"></th>').text(t("live.driver")),
                $('<th scope="col"></th>').text(t("live.team")),
                $('<th scope="col"></th>').text(t("live.time")),
                $('<th scope="col" class="num"></th>').text(t("live.points"))
            ))
        );
        const $body = $("<tbody></tbody>");
        race.Results.slice(0, 10).forEach(function (result) {
            const time = result.Time ? result.Time.time : (result.status || "");
            $body.append($("<tr></tr>").append(
                cell(result.position, "num"),
                cell(fullName(result.Driver)),
                cell(result.Constructor ? result.Constructor.name : ""),
                cell(time),
                cell(result.points, "num")
            ));
        });
        $box.empty()
            .append($('<p class="mb-2"></p>').append($("<strong></strong>").text(race.raceName + " · " + formatDate(race.date))))
            .append($('<div class="table-responsive"></div>').append($table.append($body)));
    }

    function initRacesPage() {
        const $select = $("#season-select");
        if (!$select.length) { return; }

        let season = F1.store.get("f1-season", "current");
        if (SEASONS.indexOf(season) === -1) { season = "current"; }
        function fillSeasons() {
            $select.empty();
            SEASONS.forEach(function (value) {
                $select.append($("<option></option>").val(value).text(value === "current" ? t("races.current") : value));
            });
            $select.val(season);
        }
        fillSeasons();
        F1.onLanguage(function () { fillSeasons(); renderCalendar(); });

        $select.on("change", function () {
            season = $(this).val();
            F1.store.set("f1-season", season);
            loadCalendar(season);
        });

        $(document).on("click", ".status-filter", function () {
            statusFilter = $(this).attr("data-status");
            F1.store.set("f1-race-status", statusFilter);
            F1.playSound();
            updateStatusButtons();
            if (calendarRaces.length) { renderCalendar(); }
        });

        updateStatusButtons();
        loadCalendar(season);
        loadInto($("#last-result"), function () {
            return F1.api.get("/current/last/results.json").then(function (data) { return racesFrom(data)[0]; });
        }, renderLastResult);
    }

    /* ----------------------------------------------- 3. driver standings */
    function renderDriverStandings(rows) {
        const $box = $("#driver-standings");
        if (!rows.length) { showEmpty($box, "api.empty"); return; }
        const $table = $('<table class="table f1-table align-middle mb-0"></table>');
        $table.append(
            $("<thead></thead>").append($("<tr></tr>").append(
                $('<th scope="col"></th>').text("#"),
                $('<th scope="col"></th>').text(t("live.driver")),
                $('<th scope="col"></th>').text(t("live.team")),
                $('<th scope="col" class="num"></th>').text(t("live.wins")),
                $('<th scope="col" class="num"></th>').text(t("live.points")),
                $('<th scope="col"></th>').append($('<span class="visually-hidden"></span>').text(t("side.fav")))
            ))
        );
        const $body = $("<tbody></tbody>");
        rows.slice(0, 10).forEach(function (row) {
            const name = fullName(row.Driver);
            const team = row.Constructors && row.Constructors.length ? row.Constructors[row.Constructors.length - 1].name : "";
            $body.append(
                $('<tr class="searchable-item"></tr>').append(
                    cell(row.position || row.positionText, "num"),
                    $('<td class="highlightable"></td>').append($("<strong></strong>").text(name)),
                    $('<td class="highlightable"></td>').text(team),
                    cell(row.wins, "num"),
                    cell(row.points, "num"),
                    $("<td></td>").append(F1.favButton(name))
                )
            );
        });
        $box.empty().append($('<div class="table-responsive"></div>').append($table.append($body)));
        $box.append($('<p class="api-note mb-0"></p>').text(t("api.credit")));
        F1.addSearchTerms(rows.map(function (row) { return fullName(row.Driver); }));
        F1.refreshFavUI();
    }

    let driverRows = [];

    function initDriverStandings() {
        const $box = $("#driver-standings");
        if (!$box.length) { return; }
        loadInto($box, function () {
            return F1.api.get("/current/driverstandings.json").then(function (data) {
                driverRows = standingsFrom(data, "DriverStandings");
                return driverRows;
            });
        }, renderDriverStandings);
        F1.onLanguage(function () { if (driverRows.length) { renderDriverStandings(driverRows); } });
    }

    /* --------------------------------------------- 4. constructor standings */
    let constructorRows = [];

    function renderConstructorStandings(rows) {
        const $box = $("#constructor-standings");
        if (!rows.length) { showEmpty($box, "api.empty"); return; }
        const $table = $('<table class="table f1-table align-middle mb-0"></table>');
        $table.append(
            $("<thead></thead>").append($("<tr></tr>").append(
                $('<th scope="col"></th>').text("#"),
                $('<th scope="col"></th>').text(t("th.team")),
                $('<th scope="col"></th>').text(t("live.nationality")),
                $('<th scope="col" class="num"></th>').text(t("live.wins")),
                $('<th scope="col" class="num"></th>').text(t("live.points"))
            ))
        );
        const $body = $("<tbody></tbody>");
        rows.forEach(function (row) {
            $body.append(
                $('<tr class="searchable-item"></tr>').append(
                    cell(row.position || row.positionText, "num"),
                    $('<td class="highlightable"></td>').append($("<strong></strong>").text(row.Constructor.name)),
                    $('<td class="highlightable"></td>').text(row.Constructor.nationality),
                    cell(row.wins, "num"),
                    cell(row.points, "num")
                )
            );
        });
        $box.empty().append($('<div class="table-responsive"></div>').append($table.append($body)));
        $box.append($('<p class="api-note mb-0"></p>').text(t("api.credit")));
    }

    function initConstructorStandings() {
        const $box = $("#constructor-standings");
        if (!$box.length) { return; }
        loadInto($box, function () {
            return F1.api.get("/current/constructorstandings.json").then(function (data) {
                constructorRows = standingsFrom(data, "ConstructorStandings");
                return constructorRows;
            });
        }, renderConstructorStandings);
        F1.onLanguage(function () { if (constructorRows.length) { renderConstructorStandings(constructorRows); } });
    }

    /* ------------------------------------------------------------------- init */
    $(function () {
        initNextRace();
        initRacesPage();
        initDriverStandings();
        initConstructorStandings();
    });
})(window.F1, window.jQuery);
