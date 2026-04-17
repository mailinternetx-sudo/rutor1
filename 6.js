(function () {
    'use strict';

    var PLUGIN_ID = 'gs_lampa_fix_pro';
    var NAME = 'Google Sheets PRO FIX';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var TMDB_API_KEY = 'f348b4586d1791a40d99edd92164cb86';

    function url() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var cacheTime = 0;

    // ===== SAFE CSV PARSER =====
    function parseCSV(text) {
        var lines = text.split('\n').filter(Boolean);

        var headers = lines[0]
            .split(',')
            .map(h => h.replace(/"/g, '').trim());

        var out = [];

        for (var i = 1; i < lines.length; i++) {

            var row = lines[i].split(',');

            var obj = {};

            headers.forEach(function (h, j) {
                obj[h] = (row[j] || '').replace(/"/g, '').trim();
            });

            if (obj['TMDB ID']) {
                out.push(obj);
            }
        }

        return out;
    }

    function group(rows) {
        var m = {};

        rows.forEach(function (r) {
            var c = r['Категория'] || 'Без категории';
            if (!m[c]) m[c] = [];
            m[c].push(r);
        });

        return m;
    }

    function load(cb) {

        var now = Date.now();

        if (cache && now - cacheTime < 10 * 60 * 1000) {
            return cb(cache);
        }

        Lampa.Reguest.silent(url(), function (res) {

            if (!res || typeof res !== 'string') {
                console.log('[GS] EMPTY CSV');
                return cb({});
            }

            cache = group(parseCSV(res));
            cacheTime = now;

            console.log('[GS] LOADED:', Object.keys(cache));

            cb(cache);

        }, function (e) {
            console.log('[GS ERROR]', e);
            cb({});
        });
    }

    // ===== TMDB SAFE =====
    function tmdb(id, cb) {

        var movie = 'https://api.themoviedb.org/3/movie/' + id +
            '?api_key=' + TMDB_API_KEY + '&language=ru';

        Lampa.Reguest.silent(movie, function (m) {

            if (m && m.id) return cb({ type: 'movie', data: m });

            var tv = 'https://api.themoviedb.org/3/tv/' + id +
                '?api_key=' + TMDB_API_KEY + '&language=ru';

            Lampa.Reguest.silent(tv, function (t) {

                if (t && t.id) return cb({ type: 'tv', data: t });

                cb(null);

            }, function () { cb(null); });

        }, function () { cb(null); });
    }

    function build(rows, cb) {

        var results = [];
        var i = 0;

        function next() {

            if (i >= rows.length) return cb(results);

            var id = rows[i++]['TMDB ID'];

            if (!id) return next();

            tmdb(id, function (m) {

                if (m) {
                    var d = m.data;

                    results.push({
                        id: d.id,
                        title: d.title || d.name,
                        original_title: d.original_title || d.original_name,
                        poster_path: d.poster_path,
                        backdrop_path: d.backdrop_path,
                        overview: d.overview,
                        vote_average: d.vote_average,
                        media_type: m.type
                    });
                }

                setTimeout(next, 30);
            });
        }

        next();
    }

    function Api() {
        var self = this;

        self.list = function (p, cb) {

            load(function (data) {

                var keys = Object.keys(data);

                if (!keys.length) {
                    console.log('[GS] NO CATEGORIES');
                    return cb({ results: [] });
                }

                var cat = p.url || keys[0];

                if (!data[cat]) {
                    console.log('[GS] BAD CATEGORY:', cat);
                    cat = keys[0];
                }

                build(data[cat], function (items) {
                    cb({ results: items });
                });
            });
        };

        self.category = function (p, cb) {

            load(function (data) {

                var keys = Object.keys(data);
                var out = [];
                var i = 0;

                function next() {

                    if (i >= keys.length) {
                        return cb({ results: out });
                    }

                    var c = keys[i++];

                    build(data[c].slice(0, 15), function (items) {

                        out.push({
                            title: c,
                            url: c,
                            source: PLUGIN_ID,
                            results: items,
                            more: data[c].length > 15
                        });

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
                    title: NAME
                });
            }, 0);
        };
    }

    function start() {

        if (window.gs_fix_ready) return;
        window.gs_fix_ready = true;

        var api = new Api();
        Lampa.Api.sources[PLUGIN_ID] = api;

        var item = $('<li class="menu__item selector"><div class="menu__text">' + NAME + '</div></li>');

        $('.menu .menu__list').eq(0).append(item);

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                component: 'category',
                source: PLUGIN_ID,
                title: NAME
            });
        });

        Lampa.Noty.show('GS FIX PRO активен');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
