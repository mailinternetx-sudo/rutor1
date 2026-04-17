(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'gs_collections_tmdb';

    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';

    function getUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;
    var metaCache = {};
    var CACHE_TIME = 10 * 60 * 1000;
    var lastLoad = 0;

    // ===== CSV ПАРСЕР =====
    function parseCSV(text) {
        var rows = [];
        var row = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            var next = text[i + 1];

            if (c === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            }
            else if (c === ',' && !inQuotes) {
                row.push(current);
                current = '';
            }
            else if ((c === '\n' || c === '\r') && !inQuotes) {
                if (current || row.length) {
                    row.push(current);
                    rows.push(row);
                    row = [];
                    current = '';
                }
            }
            else {
                current += c;
            }
        }

        if (current || row.length) {
            row.push(current);
            rows.push(row);
        }

        if (rows.length < 2) return [];

        var headers = rows[0].map(function (h) { return h.trim(); });

        return rows.slice(1).map(function (values) {
            if (values.length !== headers.length) return null;

            var obj = {};
            headers.forEach(function (h, i) {
                obj[h] = (values[i] || '').trim();
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
        var match = url.match(/\/t\/p\/([^?#]+)/);
        if (match) return '/t/p/' + match[1];
        return url;
    }

    // ===== ОПРЕДЕЛЕНИЕ ТИПА ЧЕРЕЗ TMDB =====
    function resolveType(id, callback) {
        if (metaCache[id]) {
            callback(metaCache[id]);
            return;
        }

        var done = false;

        // пробуем movie
        Lampa.Api.sources.tmdb.full({
            id: id,
            method: 'movie'
        }, function () {
            metaCache[id] = 'movie';
            if (!done) callback('movie');
            done = true;
        }, function () {

            // если не movie — пробуем tv
            Lampa.Api.sources.tmdb.full({
                id: id,
                method: 'tv'
            }, function () {
                metaCache[id] = 'tv';
                if (!done) callback('tv');
                done = true;
            }, function () {
                metaCache[id] = 'movie';
                if (!done) callback('movie');
                done = true;
            });

        });
    }

    function toItem(row, callback) {
        var id = row['TMDB ID'];
        if (!/^\d+$/.test(id)) return callback(null);

        var title = cleanTitle(row['Название']);
        if (!title) return callback(null);

        resolveType(id, function (type) {

            callback({
                id: parseInt(id, 10),
                title: title,
                original_title: title,
                poster_path: normalizePoster(row['Постер']),
                media_type: type
            });

        });
    }

    function groupByCategory(rows) {
        var map = {};
        rows.forEach(function (r) {
            var cat = r['Категория'] || 'Без категории';
            if (!map[cat]) map[cat] = [];
            map[cat].push(r);
        });
        return map;
    }

    function load(callback) {
        var now = Date.now();

        if (cache && (now - lastLoad < CACHE_TIME)) {
            callback(cache);
            return;
        }

        Lampa.Reguest.silent(getUrl(), function (res) {
            try {
                var rows = parseCSV(res);
                cache = groupByCategory(rows);
                lastLoad = now;
                callback(cache);
            } catch (e) {
                console.log('CSV error', e);
                callback({});
            }
        }, function () {
            callback({});
        });
    }

    function buildItems(rows, done) {
        var result = [];
        var index = 0;

        function next() {
            if (index >= rows.length) {
                done(result);
                return;
            }

            toItem(rows[index], function (item) {
                if (item) result.push(item);
                index++;
                next();
            });
        }

        next();
    }

    function Api() {
        var self = this;

        self.list = function (params, onComplete) {
            load(function (data) {
                var keys = Object.keys(data);
                var category = params.url || keys[0];

                if (!category) {
                    onComplete({ results: [] });
                    return;
                }

                buildItems(data[category], function (items) {
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
                var result = [];
                var index = 0;

                function next() {
                    if (index >= cats.length) {
                        onSuccess({ results: result });
                        return;
                    }

                    var cat = cats[index];

                    buildItems(data[cat].slice(0, 20), function (items) {
                        result.push({
                            title: cat,
                            url: cat,
                            source: PLUGIN_ID,
                            results: items,
                            more: data[cat].length > 20
                        });

                        index++;
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
        if (window.gs_tmdb_plugin) return;
        window.gs_tmdb_plugin = true;

        var api = new Api();
        Lampa.Api.sources[PLUGIN_ID] = api;

        if (!$('.menu__item[data-action="gs"]').length) {
            var item = $('<li class="menu__item selector" data-action="gs">' +
                '<div class="menu__text">' + PLUGIN_NAME + '</div></li>');

            $('.menu .menu__list').eq(0).append(item);

            item.on('hover:enter', function () {
                Lampa.Activity.push({
                    component: 'category',
                    source: PLUGIN_ID,
                    title: PLUGIN_NAME
                });
            });
        }

        Lampa.Noty.show('Google Sheets + TMDB активен');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
