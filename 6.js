(function () {
    'use strict';

    var SOURCE_NAME = 'My Collections';
    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';

    function getCsvUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var cache = null;

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
        var result = [];

        for (var i = 1; i < rows.length; i++) {
            var values = rows[i];
            if (values.length !== headers.length) continue;

            var obj = {};
            for (var j = 0; j < headers.length; j++) {
                obj[headers[j]] = (values[j] || '').trim();
            }

            result.push(obj);
        }

        return result;
    }

    function cleanTitle(title) {
        return (title || '')
            .split(/[\[\(\|]/)[0]
            .replace(/\s+/g, ' ')
            .trim();
    }

    function toItem(row) {
        var id = row['TMDB ID'];
        if (!/^\d+$/.test(id)) return null;

        var title = cleanTitle(row['Название']);
        if (!title) return null;

        var year = row['Год'];

        return {
            id: parseInt(id, 10),
            title: title,
            original_title: title,
            poster_path: row['Постер'] || '',
            release_date: /^\d{4}$/.test(year) ? year + '-01-01' : '',
            media_type: 'movie'
        };
    }

    function group(rows) {
        var g = {};
        rows.forEach(function (r) {
            var cat = r['Категория'] || 'Без категории';
            if (!g[cat]) g[cat] = [];
            g[cat].push(r);
        });
        return g;
    }

    function load(callback) {
        if (cache) {
            callback(cache);
            return;
        }

        Lampa.Reguest.silent(getCsvUrl(), function (res) {
            try {
                var rows = parseCSV(res);
                cache = group(rows);
                callback(cache);
            } catch (e) {
                console.log('CSV error', e);
                callback({});
            }
        }, function () {
            callback({});
        });
    }

    function Api() {
        var self = this;

        self.list = function (params, onComplete) {
            load(function (data) {
                var keys = Object.keys(data);
                var cat = params.url || keys[0];

                var items = (data[cat] || [])
                    .map(toItem)
                    .filter(Boolean);

                onComplete({
                    results: items,
                    total_results: items.length
                });
            });
        };

        self.category = function (params, onSuccess) {
            load(function (data) {
                var result = Object.keys(data).map(function (cat) {
                    return {
                        title: cat,
                        url: cat,
                        source: SOURCE_NAME,
                        results: data[cat].slice(0, 20).map(toItem).filter(Boolean)
                    };
                });

                onSuccess({ results: result });
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
                    source: SOURCE_NAME,
                    title: SOURCE_NAME
                });
            }, 0);
        };
    }

    function start() {
        if (window.gs_plugin) return;
        window.gs_plugin = true;

        var api = new Api();

        Lampa.Api.sources[SOURCE_NAME] = api;

        if (!$('.menu__item[data-action="gs"]').length) {
            var item = $('<li class="menu__item selector" data-action="gs">' +
                '<div class="menu__text">' + SOURCE_NAME + '</div></li>');

            $('.menu .menu__list').eq(0).append(item);

            item.on('hover:enter', function () {
                Lampa.Activity.push({
                    component: 'category',
                    source: SOURCE_NAME,
                    title: SOURCE_NAME
                });
            });
        }

        Lampa.Noty.show('Google Sheets подключен');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
