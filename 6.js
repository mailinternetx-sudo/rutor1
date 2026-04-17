(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'gs_tmdb_ultra_fix';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var TMDB_API_KEY = 'f348b4586d1791a40d99edd92164cb86';

    function sheetUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var last = 0;
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
        if (cache && now - last < CACHE_TIME) return cb(cache);

        Lampa.Reguest.silent(sheetUrl(), function (res) {
            cache = group(parseCSV(res));
            last = now;
            cb(cache);
        }, function () {
            cb({});
        });
    }

    // ===== TMDB SAFE FETCH =====
    function fetch(id, cb) {

        var movie = 'https://api.themoviedb.org/3/movie/' + id + '?api_key=' + TMDB_API_KEY + '&language=ru';
        var tv = 'https://api.themoviedb.org/3/tv/' + id + '?api_key=' + TMDB_API_KEY + '&language=ru';

        Lampa.Reguest.silent(movie, function (m) {

            if (m && m.id) {
                return cb({
                    type: 'movie',
                    data: m
                });
            }

        }, function () {

            Lampa.Reguest.silent(tv, function (t) {

                if (t && t.id) {
                    return cb({
                        type: 'tv',
                        data: t
                    });
                }

                cb(null);

            }, function () {
                cb(null);
            });

        });
    }

    // ===== PARALLEL BUILDER =====
    function build(rows, done) {

        rows = rows.filter(r => r['TMDB ID'])
                   .filter((v, i, a) =>
                        a.findIndex(x => x['TMDB ID'] === v['TMDB ID']) === i
                   );

        var results = [];
        var left = rows.length;

        if (!left) return done([]);

        rows.forEach(function (row) {

            fetch(row['TMDB ID'], function (meta) {

                if (meta && meta.data) {

                    var d = meta.data;

                    results.push({
                        id: d.id,
                        title: d.title || d.name,
                        original_title: d.original_title || d.original_name,
                        poster_path: d.poster_path,
                        backdrop_path: d.backdrop_path,
                        overview: d.overview,
                        vote_average: d.vote_average,
                        media_type: meta.type
                    });
                }

                left--;

                if (left === 0) {
                    done(results);
                }
            });
        });
    }

    function Api() {
        var self = this;

        self.list = function (p, cb) {

            load(function (data) {
                var cat = p.url || Object.keys(data)[0];
                if (!cat) return cb({ results: [] });

                build(data[cat], function (items) {
                    cb({ results: items });
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

                    build(data[c].slice(0, 20), function (items) {

                        out.push({
                            title: c,
                            url: c,
                            source: PLUGIN_ID,
                            results: items,
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
        if (window.gs_fixed) return;
        window.gs_fixed = true;

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

        Lampa.Noty.show('ULTRA FIX версия активна');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
