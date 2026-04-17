(function () {
    'use strict';

    // ===== НАСТРОЙКИ ПЛАГИНА =====
    var PLUGIN_NAME = 'Мои подборки';
    var PLUGIN_ID = 'google_sheets_plugin';
    
    // ID вашей таблицы Google Sheets
    var DEFAULT_SHEET_ID = '1A-0etV0D1RfyNFKgniHlEUTjub1MesLQyaane-xNz6Y';
    var SHEET_ID = Lampa.Storage.get(PLUGIN_ID + '_sheet_id', DEFAULT_SHEET_ID);
    
    var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
    
    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H5v-2h6v2zm0-4H5v-2h6v2zm0-4H5V7h6v2zm8 8h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V7h6v2z"/></svg>';

    // ===== НАСТРОЙКИ ВАЛИДАЦИИ =====
    var REQUIRED_FIELDS = ['TMDB ID', 'Название']; // Поля, без которых строка пропускается
    var DEBUG_MODE = false; // Показывать в консоли, почему строки пропускаются

    // ===== КЭШИРОВАНИЕ =====
    var cachedData = null;
    var cacheTime = 0;
    var CACHE_DURATION = 30 * 60 * 1000; // 30 минут
    var stats = { total: 0, valid: 0, skipped: 0, reasons: {} };

    // ===== ПАРСЕР CSV =====
    function parseCSV(text) {
        var lines = text.trim().split('\n').filter(function(line) { return line.trim(); });
        if (lines.length < 2) return [];
        
        var headers = parseCSVLine(lines[0]).map(function(h) { return h.trim(); });
        var result = [];
        
        for (var i = 1; i < lines.length; i++) {
            var values = parseCSVLine(lines[i]);
            if (values.length !== headers.length) continue;
            
            var item = {};
            for (var j = 0; j < headers.length; j++) {
                item[headers[j]] = values[j] ? values[j].trim() : '';
            }
            result.push(item);
        }
        return result;
    }
    
    function parseCSVLine(line) {
        var result = [], current = '', inQuotes = false;
        for (var i = 0; i < line.length; i++) {
            var char = line[i];
            if (char === '"') { inQuotes = !inQuotes; }
            else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
            else { current += char; }
        }
        result.push(current);
        return result;
    }

    // ===== ВАЛИДАЦИЯ СТРОКИ =====
    function isValidRow(row) {
        var reasons = [];
        
        // Проверка обязательных полей
        for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
            var field = REQUIRED_FIELDS[i];
            if (!row[field] || row[field].trim() === '') {
                reasons.push('Отсутствует: ' + field);
            }
        }
        
        // Проверка, что TMDB ID — это число
        if (row['TMDB ID'] && !/^\d+$/.test(row['TMDB ID'].trim())) {
            reasons.push('TMDB ID не является числом: "' + row['TMDB ID'] + '"');
        }
        
        // Проверка, что название не пустое после очистки
        var cleanTitle = cleanTitle(row['Название'] || '');
        if (!cleanTitle) {
            reasons.push('Название пустое или некорректное');
        }
        
        if (reasons.length > 0) {
            if (DEBUG_MODE) console.log('[GoogleSheets] Пропущена строка:', row, 'Причины:', reasons);
            return { valid: false, reasons: reasons };
        }
        return { valid: true };
    }

    // ===== ОЧИСТКА НАЗВАНИЯ ОТ ТОРРЕНТ-МУСОРА =====
    function cleanTitle(rawTitle) {
        if (!rawTitle) return '';
        
        var title = rawTitle
            // Убираем всё после [ или ( или |
            .split(/[\[\(\|]/)[0]
            // Убираем лишние пробелы и спецсимволы в конце
            .replace(/[\s\-_\.\,]+$/, '')
            // Убираем дублирующиеся пробелы
            .replace(/\s+/g, ' ')
            .trim();
        
        // Если после очистки осталось меньше 2 символов — невалидно
        return title.length >= 2 ? title : '';
    }

    // ===== ПРЕОБРАЗОВАНИЕ В ФОРМАТ LAMPA =====
    function toLampaFormat(sheetItem) {
        var tmdbId = parseInt(sheetItem['TMDB ID'].trim());
        var rawTitle = sheetItem['Название'] || '';
        var cleanTitleResult = cleanTitle(rawTitle);
        var poster = sheetItem['Постер'] || '';
        
        // Формируем poster_path
        var posterPath = '';
        if (poster && typeof poster === 'string') {
            poster = poster.trim();
            if (poster.startsWith('/')) {
                posterPath = poster;
            } else if (poster.startsWith('http')) {
                // Конвертируем полный URL в TMDB path
                var match = poster.match(/\/(t\/p\/[^?#\/]+\/[^?#]+)$/i);
                if (match) {
                    posterPath = '/' + match[1];
                } else {
                    // Оставляем как есть, если не TMDB URL
                    posterPath = poster;
                }
            }
        }
        
        // Определяем тип контента
        var isTV = /сериал|season|s\d+e\d+|\[\d+x\d+/i.test(rawTitle);
        
        // Извлекаем год из названия или берём из поля Год
        var year = sheetItem['Год'] || '';
        var yearMatch = rawTitle.match(/\((\d{4})\)/);
        if (yearMatch && (!year || year === '2020')) { // 2020 часто стоит по умолчанию
            year = yearMatch[1];
        }
        
        return {
            id: tmdbId,
            title: cleanTitleResult,
            original_title: cleanTitleResult,
            poster_path: posterPath,
            backdrop_path: sheetItem['Фон'] || '',
            overview: sheetItem['Описание'] || '',
            release_date: year && /^\d{4}$/.test(year) ? (year + '-01-01') : '',
            vote_average: 0,
            media_type: isTV ? 'tv' : 'movie',
            first_air_date: isTV && year ? (year + '-01-01') : undefined,
            number_of_seasons: isTV ? 1 : undefined,
            // Сохраняем исходные данные для отладки
            _source: {
                rawTitle: rawTitle,
                category: sheetItem['Категория']
            }
        };
    }

    // ===== ЗАГРУЗКА И ОБРАБОТКА ДАННЫХ =====
    function loadSheetsData(callback, onError) {
        var now = Date.now();
        
        // Возвращаем кэш если актуален
        if (cachedData && (now - cacheTime) < CACHE_DURATION) {
            callback(cachedData);
            return;
        }
        
        Lampa.Reguest.silent(CSV_URL, function(response) {
            if (!response || typeof response !== 'string') {
                var err = 'Не удалось загрузить данные из Google Sheets';
                Lampa.Noty.show(err);
                onError && onError(err);
                return;
            }
            
            var rows = parseCSV(response);
            stats = { total: rows.length, valid: 0, skipped: 0, reasons: {} };
            
            var validRows = [];
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var validation = isValidRow(row);
                
                if (validation.valid) {
                    validRows.push(row);
                    stats.valid++;
                } else {
                    stats.skipped++;
                    // Считаем причины пропуска
                    for (var j = 0; j < validation.reasons.length; j++) {
                        var reason = validation.reasons[j].split(':')[0];
                        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
                    }
                }
            }
            
            cachedData = groupByCategory(validRows);
            cacheTime = now;
            
            if (DEBUG_MODE || stats.skipped > 0) {
                console.log('[GoogleSheets] Загружено:', stats.total, 
                           '| Валидно:', stats.valid, 
                           '| Пропущено:', stats.skipped,
                           '| Причины:', stats.reasons);
            }
            
            callback(cachedData);
            
        }, function(error) {
            var msg = 'Ошибка загрузки: ' + (error.message || error || 'неизвестная ошибка');
            Lampa.Noty.show(msg);
            onError && onError(msg);
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
            // Делегируем TMDB для получения полной информации о фильме
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
                        source: PLUGIN_ID,
                        total: data[catName].length
                    });
                }
                
                // Показываем статистику один раз при загрузке
                if (!self._statsShown && stats.skipped > 0) {
                    Lampa.Noty.show('Загружено: ' + stats.valid + ' из ' + stats.total + 
                                   ' (пропущено: ' + stats.skipped + ')');
                    self._statsShown = true;
                }
                
                onSuccess({ results: results });
            }, onError);
        };
        
        self.main = function(params, onComplete) {
            self.category({}, onComplete);
        };
        
        // Метод для получения статистики (для отладки)
        self.getStats = function() {
            return stats;
        };
    }

    // ===== ИНИЦИАЛИЗАЦИЯ ПЛАГИНА =====
    function initPlugin() {
        if (window[PLUGIN_ID]) return;
        window[PLUGIN_ID] = true;
        
        // Регистрируем источник
        var apiService = new GoogleSheetsApiService();
        Lampa.Api.sources[PLUGIN_ID] = apiService;
        
        // ===== НАСТРОЙКИ ПЛАГИНА =====
        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID + '_settings',
            name: PLUGIN_NAME,
            icon: ICON
        });
        
        // Настройка ID таблицы
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID + '_settings',
            param: {
                name: PLUGIN_ID + '_sheet_id',
                type: 'input',
                placeholder: 'ID таблицы',
                default: DEFAULT_SHEET_ID
            },
            field: {
                name: 'ID Google таблицы',
                description: 'ID вашей опубликованной таблицы'
            },
            onChange: function(value) {
                SHEET_ID = value || DEFAULT_SHEET_ID;
                CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
                cachedData = null; // Сброс кэша
                Lampa.Noty.show('ID таблицы обновлён. Перезагрузите раздел.');
            }
        });
        
        // Настройка отладки
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID + '_settings',
            param: {
                name: PLUGIN_ID + '_debug',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Режим отладки',
                description: 'Показывать в консоли причины пропуска строк'
            },
            onChange: function(value) {
                DEBUG_MODE = (value === true || value === "true");
                Lampa.Noty.show('Режим отладки: ' + (DEBUG_MODE ? 'ВКЛ' : 'ВЫКЛ'));
            }
        });
        
        // Настройка обязательных полей (экспертная)
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID + '_settings',
            param: {
                name: PLUGIN_ID + '_required_fields',
                type: 'input',
                placeholder: 'TMDB ID,Название',
                default: REQUIRED_FIELDS.join(',')
            },
            field: {
                name: 'Обязательные поля',
                description: 'Поля через запятую, без которых строка пропускается'
            },
            onChange: function(value) {
                if (value && value.trim()) {
                    REQUIRED_FIELDS = value.split(',').map(function(f) { return f.trim(); });
                    cachedData = null;
                    Lampa.Noty.show('Настройки валидации обновлены');
                }
            }
        });
        
        // Кнопка сброса кэша
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID + '_settings',
            param: {
                name: PLUGIN_ID + '_clear_cache',
                type: 'button',
                action: function() {
                    cachedData = null;
                    stats = { total: 0, valid: 0, skipped: 0, reasons: {} };
                    apiService._statsShown = false;
                    Lampa.Noty.show('Кэш очищен. Данные перезагрузятся при следующем запросе.');
                }
            },
            field: {
                name: '🔄 Очистить кэш',
                description: 'Принудительно перезагрузить данные из таблицы'
            }
        });
        
        // ===== ДОБАВЛЕНИЕ В МЕНЮ LAMPA =====
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
        
        // Уведомление о загрузке
        Lampa.Noty.show(PLUGIN_NAME + ' — плагин активен');
        console.log('[GoogleSheets] Плагин загружен. Sheet ID:', SHEET_ID);
    }

    // ===== ЗАПУСК =====
    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function(event) {
            if (event.type === 'ready') initPlugin();
        });
    }
})();
