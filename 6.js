(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки PRO';
    var PLUGIN_ID = 'gs_tmdb_pro_ui';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var TMDB_API_KEY = 'f348b4586d1791a40d99edd92164cb86';

    function sheetUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var tmdbCache = {};
    var lastLoad = 0;
    var CACHE_TIME = 10 * 60 * 1000;

    // ===== CSV =====
    function parseCSV(text) {
        var rows = text.split('\n').map(r => r.split(','));
        var headers = rows[0];

        return rows.slice(1).map(function (r) {
            var o = {};
            headers.forEach(function (h, i) {
                o[h.trim()] = (r[i] || '').trim();
            });
            return o;
        });
    }

    function group(rows) {
        var map = {};
        rows.forEach(function (r) {
            var c = r['Категория'] || 'Без категории';
            if (!map[c]) map[c] = [];
            map[c].push(r);
        });
        return map;
    }

    function load(cb) {
        var now = Date.now();
        if (cache && now - lastLoad < CACHE_TIME) return cb(cache);

        Lampa.Reguest.silent(sheetUrl(), function (res) {
            cache = group(parseCSV(res));
            lastLoad = now;
            cb(cache);
        }, function () {
            cb({});
        });
    }

    // ===== TMDB PRO CACHE =====
    function getTMDB(id, cb) {
        if (tmdbCache[id]) return cb(tmdbCache[id]);

        var url = 'https://api.themoviedb.org/3/movie/' + id +
            '?api_key=' + TMDB_API_KEY + '&language=ru';

        Lampa.Reguest.silent(url, function (m) {

            if (m && m.id) {
                tmdbCache[id] = {
                    type: 'movie',
                    data: m
                };
                return cb(tmdbCache[id]);
            }

            var url2 = 'https://api.themoviedb.org/3/tv/' + id +
                '?api_key=' + TMDB_API_KEY + '&language=ru';

            Lampa.Reguest.silent(url2, function (t) {

                if (t && t.id) {
                    tmdbCache[id] = {
                        type: 'tv',
                        data: t
                    };
                    return cb(tmdbCache[id]);
                }

                cb(null);

            }, function () {
                cb(null);
            });

        }, function () {
            cb(null);
        });
    }

    function buildPro(rows, onCard, done) {

        var i = 0;

        function next() {
            if (i >= rows.length) return done();

            var id = rows[i]['TMDB ID'];
            i++;

            if (!id) return next();

            getTMDB(id, function (meta) {

                if (meta) {
                    var d = meta.data;

                    // 🔥 PRO CARD (максимально полные данные)
                    onCard({
                        id: d.id,
                        title: d.title || d.name,
                        original_title: d.original_title || d.original_name,
                        overview: d.overview,
                        poster_path: d.poster_path,
                        backdrop_path: d.backdrop_path,
                        vote_average: d.vote_average,
                        media_type: meta.type
                    });
                }

                // ⚡ маленькая задержка = плавный UI как Netflix/NUMParser
                setTimeout(next, 20);
            });
        }

        next();
    }

    function Api() {
        var self = this;

        self.list = function (p, cb) {

            load(function (data) {
                var cat = p.url || Object.keys(data)[0];
                if (!cat) return cb({ results: [] });

                var results = [];

                buildPro(data[cat], function (item) {
                    results.push(item);

                    // 🔥 мгновенный UI update (PRO FEEL)
                    cb({
                        results: results.slice(),
                        partial: true
                    });

                }, function () {
                    cb({
                        results: results,
                        partial: false
                    });
                });
            });
        };

        self.category = function (p, cb) {

            load(function (data) {

                var cats = Object.keys(data);
                var out = [];
                var i = 0;

                function next() {
                    if (i >= cats.length) return cb({ results: out });

                    var c = cats[i];

                    buildPro(data[c].slice(0, 20), function () {}, function () {

                        out.push({
                            title: c,
                            url: c,
                            source: PLUGIN_ID,
                            results: [], // быстро, а внутри list уже PRO поток
                            more: data[c].length > 20
                        });

                        i++;
                        next();
                    });
                }

                next();
            });
        };

        self.full = function (p, s, e) {
            Lampa.Api.sources.tmdb.full(p, s, e);
        };

        self.main = function (p, cb) {
            cb([]);

            setTimeout(function () {
                Lampa.Activity.replace({
                    component: 'category',
                    source: PLUGIN_ID,
                    title: PLUGIN_NAME
                });
            }, 0);
        };
    }

    function start() {
        if (window.gs_pro_ui) return;
        window.gs_pro_ui = true;

        var api = new Api();
        Lampa.Api.sources[PLUGIN_ID] = api;

        var item = $('<li class="menu__item selector"><div class="menu__text">' + PLUGIN_NAME + '</div></li>');

        $('.menu .menu__list').eq(0).append(item);

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                component: 'category',
                source: PLUGIN_ID,
                title: PLUGIN_NAME
            });
        });

        Lampa.Noty.show('PRO UI включён 🚀');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
