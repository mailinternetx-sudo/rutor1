(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'gs_tmdb_ultra';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var TMDB_API_KEY = 'f348b4586d1791a40d99edd92164cb86';

    function getSheetUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var metaCache = {};
    var CACHE_TIME = 10 * 60 * 1000;
    var lastLoad = 0;

    // ===== CSV =====
    function parseCSV(text) {
        var rows = text.split('\n').map(function (r) {
            return r.split(',');
        });

        if (rows.length < 2) return [];

        var headers = rows[0].map(function (h) { return h.trim(); });

        return rows.slice(1).map(function (vals) {
            var obj = {};
            headers.forEach(function (h, i) {
                obj[h] = (vals[i] || '').trim();
            });
            return obj;
        });
    }

    function group(rows) {
        var map = {};
        rows.forEach(function (r) {
            var cat = r['Категория'] || 'Без категории';
            if (!map[cat]) map[cat] = [];
            map[cat].push(r);
        });
        return map;
    }

    function loadSheet(cb) {
        var now = Date.now();

        if (cache && now - lastLoad < CACHE_TIME) {
            cb(cache);
            return;
        }

        Lampa.Reguest.silent(getSheetUrl(), function (res) {
            try {
                cache = group(parseCSV(res));
                lastLoad = now;
                cb(cache);
            } catch (e) {
                cb({});
            }
        }, function () {
            cb({});
        });
    }

    // ===== TMDB =====
    function fetchTMDB(id, callback) {
        if (metaCache[id]) {
            callback(metaCache[id]);
            return;
        }

        var movieUrl = 'https://api.themoviedb.org/3/movie/' + id + '?api_key=' + TMDB_API_KEY + '&language=ru';
        var tvUrl = 'https://api.themoviedb.org/3/tv/' + id + '?api_key=' + TMDB_API_KEY + '&language=ru';

        Lampa.Reguest.silent(movieUrl, function (movie) {

            if (movie && movie.id) {
                metaCache[id] = {
                    type: 'movie',
                    data: movie
                };
                callback(metaCache[id]);
            }

        }, function () {

            Lampa.Reguest.silent(tvUrl, function (tv) {

                if (tv && tv.id) {
                    metaCache[id] = {
                        type: 'tv',
                        data: tv
                    };
                    callback(metaCache[id]);
                }

            }, function () {
                callback(null);
            });

        });
    }

    function toLampa(item, meta) {
        var d = meta.data;

        return {
            id: d.id,
            title: d.title || d.name,
            original_title: d.original_title || d.original_name,
            overview: d.overview,
            poster_path: d.poster_path,
            backdrop_path: d.backdrop_path,
            vote_average: d.vote_average,
            release_date: d.release_date,
            first_air_date: d.first_air_date,
            media_type: meta.type
        };
    }

    function build(rows, done) {
        var results = [];
        var i = 0;

        function next() {
            if (i >= rows.length) return done(results);

            var id = rows[i]['TMDB ID'];

            if (!/^\d+$/.test(id)) {
                i++;
                return next();
            }

            fetchTMDB(id, function (meta) {
                if (meta) {
                    results.push(toLampa(rows[i], meta));
                }
                i++;
                next();
            });
        }

        next();
    }

    function Api() {
        var self = this;

        self.list = function (params, onComplete) {
            loadSheet(function (data) {
                var cat = params.url || Object.keys(data)[0];
                if (!cat) return onComplete({ results: [] });

                build(data[cat], function (items) {
                    onComplete({
                        results: items,
                        total_results: items.length
                    });
                });
            });
        };

        self.category = function (params, onSuccess) {
            loadSheet(function (data) {
                var cats = Object.keys(data);
                var res = [];
                var i = 0;

                function next() {
                    if (i >= cats.length) return onSuccess({ results: res });

                    var cat = cats[i];

                    build(data[cat].slice(0, 20), function (items) {
                        res.push({
                            title: cat,
                            url: cat,
                            source: PLUGIN_ID,
                            results: items,
                            more: data[cat].length > 20
                        });
                        i++;
                        next();
                    });
                }

                next();
            });
        };

        self.full = function (params, onSuccess, onError) {
            Lampa.Api.sources.tmdb.full(params, onSuccess, onError);
        };

        self.main = function (params, onComplete) {
            onComplete([]);

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
        if (window.gs_ultra) return;
        window.gs_ultra = true;

        var api = new Api();
        Lampa.Api.sources[PLUGIN_ID] = api;

        var item = $('<li class="menu__item selector">' +
            '<div class="menu__text">' + PLUGIN_NAME + '</div></li>');

        $('.menu .menu__list').eq(0).append(item);

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                component: 'category',
                source: PLUGIN_ID,
                title: PLUGIN_NAME
            });
        });

        Lampa.Noty.show('ULTRA TMDB плагин активен 🚀');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
