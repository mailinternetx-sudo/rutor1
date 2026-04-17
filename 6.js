(function () {
    'use strict';

    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'google_sheets_plugin';

    var DEFAULT_SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var SHEET_ID = Lampa.Storage.get(PLUGIN_ID + '_sheet_id', DEFAULT_SHEET_ID);

    function getCsvUrl() {
        return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    }

    var REQUIRED_FIELDS = ['TMDB ID', 'Название'];
    var DEBUG_MODE = false;

    var cachedData = null;
    var cacheTime = 0;
    var CACHE_DURATION = 30 * 60 * 1000;

    // ===== НАДЁЖНЫЙ CSV ПАРСЕР =====
    function parseCSV(text) {
        var rows = [];
        var row = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var char = text[i];
            var next = text[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            }
            else if (char === ',' && !inQuotes) {
                row.push(current);
                current = '';
            }
            else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (current || row.length) {
                    row.push(current);
                    rows.push(row);
                    row = [];
                    current = '';
                }
            }
            else {
                current += char;
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
        if (!title) return '';
        return title
            .split(/[\[\(\|]/)[0]
            .replace(/[\s\-_\.\,]+$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isValidRow(row) {
        for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
            var f = REQUIRED_FIELDS[i];
            if (!row[f] || !row[f].trim()) return false;
        }

        var id = row['TMDB ID'].trim();
        if (!/^\d+$/.test(id)) return false;

        if (!cleanTitle(row['Название'])) return false;

        return true;
    }

    function toLampaFormat(row) {
        var idStr = row['TMDB ID'].trim();
        if (!/^\d+$/.test(idStr)) return null;

        var tmdbId = parseInt(idStr, 10);
        var rawTitle = row['Название'];
        var title = cleanTitle(rawTitle);

        if (!title) return null;

        var isTV = /(сериал|season|series|s\d+e\d+|\d+\s*сезон|\[\d+x\d+)/i.test(rawTitle);

        var year = row['Год'] || '';
        var match = rawTitle.match(/\((\d{4})\)/);
        if (match && !/^\d{4}$/.test(year)) year = match[1];

        return {
            id: tmdbId,
            title: title,
            original_title: title,
            poster_path: row['Постер'] || '',
            backdrop_path: row['Фон'] || '',
            overview: row['Описание'] || '',
            release_date: /^\d{4}$/.test(year) ? year + '-01-01' : '',
            first_air_date: isTV && year ? year + '-01-01' : undefined,
            media_type: isTV ? 'tv' : 'movie',
            vote_average: 0
        };
    }

    function groupByCategory(rows) {
        var grouped = {};
        rows.forEach(function (r) {
            var cat = r['Категория'] || 'Без категории';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(r);
        });
        return grouped;
    }

    function loadData(cb, err) {
        var now = Date.now();

        if (cachedData && now - cacheTime < CACHE_DURATION) {
            cb(cachedData);
            return;
        }

        Lampa.Reguest.silent(getCsvUrl(), function (res) {
            try {
                var rows = parseCSV(res);
                var valid = rows.filter(isValidRow);

                cachedData = groupByCategory(valid);
                cacheTime = now;

                cb(cachedData);
            } catch (e) {
                err && err('Ошибка обработки CSV');
            }
        }, function (e) {
            err && err('Ошибка загрузки');
        });
    }

    function Api() {
        var self = this;

        self.list = function (params, onComplete, onError) {
            loadData(function (data) {
                var keys = Object.keys(data || {});
                var category = params.url || keys[0];

                if (!category) {
                    onComplete({ results: [] });
                    return;
                }

                var items = (data[category] || [])
                    .map(toLampaFormat)
                    .filter(Boolean);

                onComplete({
                    results: items,
                    total_results: items.length
                });
            }, onError);
        };

        self.category = function (params, onSuccess, onError) {
            loadData(function (data) {
                var results = Object.keys(data).map(function (cat) {
                    return {
                        title: cat,
                        url: cat,
                        results: data[cat].slice(0, 20).map(toLampaFormat).filter(Boolean),
                        source: PLUGIN_ID
                    };
                });

                onSuccess({ results: results });
            }, onError);
        };

        self.full = function (params, onSuccess, onError) {
            Lampa.Api.sources.tmdb.full(params, onSuccess, onError);
        };

        self.main = function (params, onComplete) {
            self.category({}, onComplete);
        };
    }

    function init() {
        if (window[PLUGIN_ID]) return;
        window[PLUGIN_ID] = true;

        Lampa.Api.sources[PLUGIN_ID] = new Api();

        var item = $('<li class="menu__item selector">\
            <div class="menu__text">' + PLUGIN_NAME + '</div>\
        </li>');

        $('.menu .menu__list').eq(0).append(item);

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                title: PLUGIN_NAME,
                component: 'category',
                source: PLUGIN_ID
            });
        });

        Lampa.Noty.show(PLUGIN_NAME + ' активен');
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

})();
