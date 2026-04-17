(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'gs_tmdb_fast';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var TMDB_API_KEY = 'f348b4586d1791a40d99edd92164cb86';

    function getUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var metaCache = {};
    var lastLoad = 0;
    var CACHE_TIME = 10 * 60 * 1000;

    // ===== CSV =====
    function parseCSV(text) {
        var rows = [];
        var row = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var c = text[i], next = text[i + 1];

            if (c === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    i++;
                } else inQuotes = !inQuotes;
            }
            else if (c === ',' && !inQuotes) {
                row.push(current); current = '';
            }
            else if ((c === '\n' || c === '\r') && !inQuotes) {
                if (current || row.length) {
                    row.push(current);
                    rows.push(row);
                    row = []; current = '';
                }
            }
            else current += c;
        }

        if (current || row.length) {
            row.push(current);
            rows.push(row);
        }

        if (rows.length < 2) return [];

        var headers = rows[0].map(function (h) { return h.trim(); });

        return rows.slice(1).map(function (vals) {
            if (vals.length !== headers.length) return null;
            var obj = {};
            headers.forEach(function (h, i) {
                obj[h] = (vals[i] || '').trim();
            });
            return obj;
        }).filter(Boolean);
    }

    function cleanTitle(t) {
        return (t || '')
            .split(/[\[\(\|]/)[0]
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizePoster(url) {
        if (!url) return '';
        var m = url.match(/\/t\/p\/([^?#]+)/);
        return m ? '/t/p/' + m[1] : url;
    }

    // ===== БЫСТРОЕ ОПРЕДЕЛЕНИЕ ТИПА =====
    function detectType(id, title, callback) {
        if (metaCache[id]) {
            callback(metaCache[id]);
            return;
        }

        var url = 'https://api.themoviedb.org/3/search/multi?api_key=' +
            TMDB_API_KEY +
            '&query=' + encodeURIComponent(title);

        Lampa.Reguest.silent(url, function (json) {
            var type = 'movie';

            if (json && json.results && json.results.length) {
                var match = json.results.find(function (r) {
                    return r.id == id;
                });

                if (match && match.media_type) {
                    type = match.media_type;
                }
            }

            metaCache[id] = type;
            callback(type);

        }, function () {
            callback('movie');
        });
    }

    function toItem(row, cb) {
        var id = row['TMDB ID'];
        if (!/^\d+$/.test(id)) return cb(null);

        var title = cleanTitle(row['Название']);
        if (!title) return cb(null);

        detectType(id, title, function (type) {
            cb({
                id: parseInt(id, 10),
                title: title,
                original_title: title,
                poster_path: normalizePoster(row['Постер']),
                media_type: type
            });
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

    function load(cb) {
        var now = Date.now();

        if (cache && (now - lastLoad < CACHE_TIME)) {
            cb(cache);
            return;
        }

        Lampa.Reguest.silent(getUrl(), function (res) {
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

    function build(rows, done) {
        var result = [];
        var i = 0;

        function next() {
            if (i >= rows.length) return done(result);

            toItem(rows[i], function (item) {
                if (item) result.push(item);
                i++;
                next();
            });
        }

        next();
    }

    function Api() {
        var self = this;

        self.list = function (params, onComplete) {
            load(function (data) {
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
            load(function (data) {
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
        if (window.gs_fast_plugin) return;
        window.gs_fast_plugin = true;

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

        Lampa.Noty.show('GS + TMDB FAST запущен');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
