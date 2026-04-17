(function () {
    'use strict';

    // ===== НАСТРОЙКИ =====
    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'google_sheets_plugin';
    var SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y'; // Замените на ваш ID
    var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    
    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H5v-2h6v2zm0-4H5v-2h6v2zm0-4H5V7h6v2zm8 8h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V7h6v2z"/></svg>';

    // ===== КЭШИРОВАНИЕ =====
    var cachedData = null;
    var cacheTime = 0;
    var CACHE_DURATION = 30 * 60 * 1000; // 30 минут

    // ===== ПАРСЕР CSV =====
    function parseCSV(text) {
        var lines = text.trim().split('\n');
        if (lines.length < 2) return [];
        
        var headers = parseCSVLine(lines[0]);
        var result = [];
        
        for (var i = 1; i < lines.length; i++) {
            var values = parseCSVLine(lines[i]);
            if (values.length !== headers.length) continue;
            
            var item = {};
            for (var j = 0; j < headers.length; j++) {
                item[headers[j].trim()] = values[j] ? values[j].trim() : '';
            }
            result.push(item);
        }
        return result;
    }
    
    function parseCSVLine(line) {
        var result = [];
        var current = '';
        var inQuotes = false;
        
        for (var i = 0; i < line.length; i++) {
            var char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    // ===== ЗАГРУЗКА ДАННЫХ =====
    function loadSheetsData(callback, onError) {
        var now = Date.now();
        
        // Возвращаем кэш если он актуален
        if (cachedData && (now - cacheTime) < CACHE_DURATION) {
            callback(cachedData);
            return;
        }
        
        Lampa.Reguest.silent(CSV_URL, function(response) {
            if (!response || typeof response !== 'string') {
                onError && onError('Не удалось загрузить данные');
                return;
            }
            
            var rows = parseCSV(response);
            cachedData = groupByCategory(rows);
            cacheTime = now;
            callback(cachedData);
            
        }, function(error) {
            Lampa.Noty.show('Ошибка загрузки: ' + (error.message || error));
            onError && onError(error);
        });
    }

    function groupByCategory(rows) {
        var grouped = {};
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var category = row['Категория'] || 'Без категории';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(row);
        }
        return grouped;
    }

    // ===== ПРЕОБРАЗОВАНИЕ В ФОРМАТ LAMPA =====
    function toLampaFormat(sheetItem) {
        var tmdbId = parseInt(sheetItem['TMDB ID'] || sheetItem['tmdb_id'] || 0);
        var poster = sheetItem['Постер'] || sheetItem['poster'] || '';
        
        // Формируем poster_path для Lampa
        var posterPath = '';
        if (poster) {
            if (poster.startsWith('/')) {
                posterPath = poster;
            } else if (poster.startsWith('http')) {
                // Конвертируем URL в TMDB path
                var match = poster.match(/\/(t\/p\/[^?#]+)/);
                posterPath = match ? '/' + match[1] : '';
            }
        }
        
        return {
            id: tmdbId,
            title: sheetItem['Название'] || sheetItem['title'] || 'Без названия',
            original_title: sheetItem['Оригинальное название'] || '',
            poster_path: posterPath,
            backdrop_path: sheetItem['Фон'] || '',
            overview: sheetItem['Описание'] || sheetItem['overview'] || '',
            release_date: sheetItem['Год'] ? (sheetItem['Год'] + '-01-01') : '',
            vote_average: parseFloat(sheetItem['Рейтинг'] || 0),
            media_type: sheetItem['Тип'] === 'сериал' ? 'tv' : 'movie',
            first_air_date: sheetItem['Тип'] === 'сериал' ? (sheetItem['Год'] + '-01-01') : undefined,
            number_of_seasons: sheetItem['Тип'] === 'сериал' ? 1 : undefined
        };
    }

    // ===== API СЕРВИС ДЛЯ LAMPA =====
    function GoogleSheetsApiService() {
        var self = this;
        
        self.getCategory = function(categoryName, page, callback, onError) {
            loadSheetsData(function(data) {
                var items = data[categoryName] || [];
                var perPage = 20;
                var start = (page - 1) * perPage;
                var end = start + perPage;
                
                var results = items.slice(start, end).map(toLampaFormat);
                
                callback({
                    results: results,
                    page: page,
                    total_pages: Math.ceil(items.length / perPage),
                    total_results: items.length
                });
            }, onError);
        };
        
        self.list = function(params, onComplete, onError) {
            var category = params.url || Object.keys(cachedData || {})[0];
            var page = params.page || 1;
            
            self.getCategory(category, page, onComplete, onError);
        };
        
        self.full = function(params, onSuccess, onError) {
            // Делегируем TMDB для получения полной информации
            Lampa.Api.sources.tmdb.full(params, onSuccess, onError);
        };
        
        self.category = function(params, onSuccess, onError) {
            loadSheetsData(function(data) {
                var categories = Object.keys(data);
                var results = [];
                
                for (var i = 0; i < categories.length; i++) {
                    var catName = categories[i];
                    var items = data[catName].slice(0, 20).map(toLampaFormat);
                    
                    results.push({
                        title: catName,
                        url: catName,
                        results: items,
                        more: data[catName].length > 20,
                        source: PLUGIN_ID
                    });
                }
                
                onSuccess({ results: results });
            }, onError);
        };
        
        self.main = function(params, onComplete) {
            self.category({}, onComplete);
        };
    }

    // ===== ИНИЦИАЛИЗАЦИЯ ПЛАГИНА =====
    function initPlugin() {
        if (window[PLUGIN_ID]) return;
        window[PLUGIN_ID] = true;
        
        // Регистрируем источник
        var apiService = new GoogleSheetsApiService();
        Lampa.Api.sources[PLUGIN_ID] = apiService;
        
        // Добавляем в настройки
        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID + '_settings',
            name: PLUGIN_NAME,
            icon: ICON
        });
        
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID + '_settings',
            param: {
                name: PLUGIN_ID + '_sheet_id',
                type: 'input',
                placeholder: 'ID таблицы Google Sheets',
                default: SHEET_ID
            },
            field: {
                name: 'ID таблицы',
                description: 'ID вашей публичной таблицы'
            },
            onChange: function(value) {
                SHEET_ID = value;
                CSV_URL = 'https://docs.google.com/spreadsheets/d/' + value + '/export?format=csv&gid=0';
                cachedData = null; // Сброс кэша
            }
        });
        
        // Добавляем пункт в меню
        var menuItem = $('<li data-action="' + PLUGIN_ID + '" class="menu__item selector">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">' + PLUGIN_NAME + '</div></li>');
        
        $('.menu .menu__list').eq(0).append(menuItem);
        
        menuItem.on('hover:enter', function() {
            Lampa.Activity.push({
                title: PLUGIN_NAME,
                component: 'category',
                source: PLUGIN_ID,
                page: 1
            });
        });
        
        Lampa.Noty.show(PLUGIN_NAME + ' — плагин загружен');
    }

    // Запуск после готовности Lampa
    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function(event) {
            if (event.type === 'ready') initPlugin();
        });
    }
})();
