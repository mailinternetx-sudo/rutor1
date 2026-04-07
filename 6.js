(function () {
    'use strict';

    const PLUGIN_NAME = 'RutorTorr';
    const PLUGIN_VERSION = '1.3.0';
    const DEBUG = true;

    const CATEGORIES = {
        top24: { id: 0, name: 'Топ торренты за 24 часа', url: '/' },
        foreign_movies: { id: 4, name: 'Зарубежные фильмы', url: '/browse/4' },
        our_movies: { id: 3, name: 'Наши фильмы', url: '/browse/3' },
        foreign_series: { id: 2, name: 'Зарубежные сериалы', url: '/browse/2' },
        our_series: { id: 1, name: 'Наши сериалы', url: '/browse/1' },
        tv: { id: 5, name: 'Телевизор', url: '/browse/5' }
    };

    let settings = {
        enabled: true,
        torrServerUrl: 'http://217.25.229.57:8090',
        useProxy: true
    };
    const STORAGE_KEY = 'rutor_torr_settings';

    function log(...args) { if (DEBUG) console.log(`[${PLUGIN_NAME}]`, ...args); }
    function errorLog(...args) { console.error(`[${PLUGIN_NAME}]`, ...args); }

    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) Object.assign(settings, JSON.parse(saved));
        } catch (e) { errorLog('Ошибка загрузки настроек:', e); }
    }
    function saveSettings() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function getProxiedUrl(url) {
        if (settings.useProxy && settings.torrServerUrl) {
            return `${settings.torrServerUrl}/proxy?url=${encodeURIComponent(url)}`;
        }
        return url;
    }

    // ========== УЛУЧШЕННЫЙ ПАРСИНГ ==========
    function parseRutorPage(html, categoryName) {
        const items = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Ищем все таблицы
            const tables = doc.querySelectorAll('table');
            log(`Найдено таблиц: ${tables.length}`);

            for (const table of tables) {
                const rows = table.querySelectorAll('tbody tr, tr');
                
                for (const row of rows) {
                    try {
                        const cells = row.querySelectorAll('td');
                        if (cells.length < 5) continue;

                        // Ищем magnet-ссылку
                        const magnetEl = row.querySelector('a[href^="magnet:"]');
                        if (!magnetEl) continue;
                        
                        const magnet = magnetEl.getAttribute('href');
                        if (!magnet) continue;

                        // Ищем название торрента
                        const titleEl = row.querySelector('a[href*="/torrent/"]');
                        if (!titleEl) continue;
                        
                        let title = titleEl.textContent.trim().replace(/\s+/g, ' ');
                        if (!title || title.length < 2) continue;

                        // Извлекаем данные из ячеек
                        // Формат руотра: [дата] [название] [раздел] [размер] [сиды] [личи]
                        let date = cells[0]?.textContent.trim() || '';
                        let size = 'N/A';
                        let seeds = '0';
                        let leech = '0';

                        // Ищем ячейку с размером (обычно содержит цифры и буквы типа "GB", "MB")
                        for (let i = cells.length - 4; i < cells.length; i++) {
                            if (i >= 0) {
                                const text = cells[i]?.textContent.trim() || '';
                                // Размер файла
                                if (/\d+\s*[KMGT]?B/i.test(text) && size === 'N/A') {
                                    size = text;
                                }
                                // Сиды (обычно перед личами)
                                if (/^\d+$/.test(text) && seeds === '0') {
                                    seeds = text;
                                }
                                // Личи (последняя цифра)
                                if (/^\d+$/.test(text) && seeds !== '0') {
                                    leech = text;
                                }
                            }
                        }

                        items.push({
                            title,
                            magnet,
                            size: size || 'N/A',
                            seeds: seeds || '0',
                            leech: leech || '0',
                            date: date || 'N/A',
                            category: categoryName
                        });

                    } catch (rowErr) {
                        // Пропускаем проблемные строки
                        continue;
                    }
                }

                if (items.length > 0) {
                    log(`✓ Категория "${categoryName}": распаршено ${items.length} раздач`);
                    return items;
                }
            }

            if (items.length === 0) {
                errorLog(`✗ Торренты не найдены в ${categoryName}`);
            }
            
        } catch (e) {
            errorLog('Ошибка парсинга:', e);
        }

        return items;
    }

    // ========== ЗАГРУЗКА СТРАНИЦЫ ==========
    async function loadRutorPage(categoryKey) {
        const cat = CATEGORIES[categoryKey];
        if (!cat) {
            errorLog('Неизвестная категория:', categoryKey);
            return [];
        }

        const url = `https://rutor.info${cat.url}`;
        const proxiedUrl = getProxiedUrl(url);
        log(`📥 Загрузка: ${url}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(proxiedUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9',
                    'Cache-Control': 'no-cache'
                }
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            
            if (!html || html.length < 500) {
                throw new Error('Получен пустой ответ');
            }

            log(`📊 Получено ${html.length} символов HTML`);
            return parseRutorPage(html, cat.name);

        } catch (e) {
            errorLog('❌ Ошибка загрузки:', e.message);
            
            let errorMsg = 'Ошибка загрузки!';
            if (e.name === 'AbortError') {
                errorMsg = 'Таймаут! Проверьте сеть и TorrServer';
            } else if (!settings.useProxy) {
                errorMsg = 'В��лючите прокси TorrServer в настройках!';
            }
            
            Lampa.Notification.show(errorMsg, 5000);
            return [];
        }
    }

    // ========== TORRSERVER ==========
    async function addMagnetToTorrServer(magnet) {
        const tsUrl = settings.torrServerUrl.replace(/\/$/, '');
        
        try {
            log(`🔗 Добавляю магнет: ${magnet.substring(0, 60)}...`);
            
            const addResp = await fetch(`${tsUrl}/torrents/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `magnet=${encodeURIComponent(magnet)}`,
                timeout: 10000
            });

            if (!addResp.ok) {
                throw new Error(`TorrServer ошибка: ${addResp.status}`);
            }

            const data = await addResp.json();
            const hash = data.hash || data.info_hash;
            
            if (!hash) {
                throw new Error('Не получен хэш торрента');
            }

            log(`✓ Хэш получен: ${hash}`);

            // Ждем загрузки файлов
            await new Promise(r => setTimeout(r, 1000));

            const filesResp = await fetch(`${tsUrl}/torrents/${hash}/files`);
            const files = await filesResp.json();

            if (!files || !Array.isArray(files) || files.length === 0) {
                throw new Error('Файлы не найдены в торренте');
            }

            // Ищем видеофайл
            let videoFile = files.find(f => /\.(mkv|mp4|avi|webm)$/i.test(f.name)) || files[0];
            
            const streamUrl = `${tsUrl}/stream/${hash}/${videoFile.id}`;
            log(`▶️ Stream URL: ${streamUrl}`);
            
            return streamUrl;

        } catch (e) {
            errorLog('🔴 TorrServer ошибка:', e);
            Lampa.Notification.show('TorrServer: ' + e.message, 4000);
            return null;
        }
    }

    async function playMovie(item) {
        if (!item.magnet) {
            Lampa.Notification.show('Нет magnet-ссылки', 3000);
            return;
        }
        
        Lampa.Controller.enabled().status = false;
        Lampa.Utils.putProgressUrl('⏳ Подключение к TorrServer...');
        
        try {
            const streamUrl = await addMagnetToTorrServer(item.magnet);
            Lampa.Utils.putProgressUrl('');
            Lampa.Controller.enabled().status = true;

            if (streamUrl) {
                Lampa.Player.play(streamUrl, { 
                    title: item.title,
                    subtitles: []
                });
            }
        } catch (e) {
            Lampa.Utils.putProgressUrl('');
            Lampa.Controller.enabled().status = true;
            errorLog('Ошибка воспроизведения:', e);
        }
    }

    // ========== ОТОБРАЖЕНИЕ СПИСКА (ИСПРАВЛЕННЫЙ КОД) ==========
    function showTorrentList(items, categoryName) {
        if (!items.length) {
            Lampa.Notification.show('Список пуст или ошибка парсинга', 4000);
            return;
        }

        log(`📺 Показываю ${items.length} торрентов для "${categoryName}"`);

        Lampa.Activity.push({
            url: '',
            title: categoryName,
            component: 'rutor_list',
            page: 1,
            onBack: () => Lampa.Activity.back(),
            onCreate: function (activity) {
                let scroll = new Lampa.Scroll({ mask: true });
                let controller = Lampa.Controller();
                let html_items = [];

                activity.render().append(scroll.render());
                scroll.clear();

                // Создаем элементы списка
                items.forEach((item, idx) => {
                    let elem = document.createElement('div');
                    elem.className = 'torrent-item selector';
                    elem.dataset.index = idx;
                    
                    elem.style.cssText = `
                        padding: 15px 20px;
                        border-bottom: 1px solid rgba(255,255,255,0.08);
                        cursor: pointer;
                        transition: all 0.2s ease;
                        background: transparent;
                    `;
                    
                    elem.innerHTML = `
                        <div style="color: #fff; font-size: 14px; line-height: 1.4; margin-bottom: 8px; font-weight: 500;">
                            ${item.title.substring(0, 80)}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-size: 12px; color: rgba(255,255,255,0.6);">
                            <span>📦 ${item.size}</span>
                            <span style="color: #4caf50;">👥 ${item.seeds}</span>
                            <span>📥 ${item.leech}</span>
                            <span>📅 ${item.date}</span>
                        </div>
                    `;

                    // Фокус с пульта
                    elem.addEventListener('focus', () => {
                        elem.style.background = 'rgba(255,255,255,0.12)';
                        elem.style.borderLeft = '3px solid #4caf50';
                        elem.style.paddingLeft = '17px';
                    });

                    elem.addEventListener('blur', () => {
                        elem.style.background = 'transparent';
                        elem.style.borderLeft = 'none';
                        elem.style.paddingLeft = '20px';
                    });

                    // Клик/ОК на пульте
                    elem.addEventListener('click', () => playMovie(item));
                    elem.onenter = () => playMovie(item);

                    scroll.append(elem);
                    html_items.push(elem);
                });

                // Управление пультом
                controller.add('rutor_content', {
                    toggle: () => {
                        controller.collectionSet(html_items);
                        if (html_items.length > 0) {
                            controller.collectionFocus(0, html_items[0]);
                        }
                    },
                    up: () => controller.move('up'),
                    down: () => controller.move('down'),
                    left: () => Lampa.Activity.back(),
                    right: () => {},
                    back: () => Lampa.Activity.back(),
                    enter: () => {
                        let focused = document.activeElement;
                        if (focused && focused.classList.contains('torrent-item')) {
                            focused.click();
                        }
                    }
                });

                controller.toggle('rutor_content');
            },
            onDestroy: function () {
                Lampa.Controller.remove('rutor_content');
            }
        });
    }

    // ========== КАТЕГОРИИ ==========
    async function onCategorySelect(categoryKey) {
        Lampa.Notification.show('⏳ Загрузка списка...', 2000);
        const items = await loadRutorPage(categoryKey);
        showTorrentList(items, CATEGORIES[categoryKey].name);
    }

    function showCategoriesModal() {
        let $container = $('<div style="display:flex; flex-wrap:wrap; justify-content:center; padding:20px; gap:10px;"></div>');
        let btns = [];

        for (const [key, cat] of Object.entries(CATEGORIES)) {
            let $btn = $(`
                <div class="simple-button selector" style="
                    background: linear-gradient(135deg, #2a2a3a, #1e1e2f);
                    border-radius: 10px; padding: 16px 18px;
                    min-width: 180px; text-align: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    transition: all 0.2s;
                ">
                    <div style="font-size: 14px; font-weight: 600; color: #fff;">${cat.name}</div>
                </div>
            `);
            
            $btn.on('hover:enter', function () {
                Lampa.Modal.close();
                Lampa.Controller.remove('rutor_modal');
                onCategorySelect(key);
            });
            
            $container.append($btn);
            btns.push($btn);
        }

        // Кнопка настроек
        let $settingsBtn = $(`
            <div class="simple-button selector" style="
                background: linear-gradient(135deg, #3a2a1a, #2a1a1a);
                border-radius: 10px; padding: 16px 18px;
                min-width: 180px; text-align: center;
            ">
                <div style="font-size: 14px; font-weight: 600; color: #ffaa00;">⚙️ Настройки</div>
            </div>
        `);
        
        $settingsBtn.on('hover:enter', () => {
            Lampa.Modal.close();
            Lampa.Controller.remove('rutor_modal');
            Lampa.SettingsApi.open('rutor_torr');
        });
        
        $container.append($settingsBtn);
        btns.push($settingsBtn);

        Lampa.Modal.open({
            title: '🔥 Rutor.info',
            html: $container,
            size: 'full',
            onBack: () => {
                Lampa.Modal.close();
                Lampa.Controller.remove('rutor_modal');
                Lampa.Controller.toggle('menu');
            }
        });

        setTimeout(() => {
            Lampa.Controller.add('rutor_modal', {
                toggle: () => {
                    Lampa.Controller.collectionSet(btns);
                    Lampa.Controller.collectionFocus(0, btns[0]);
                },
                up: () => Lampa.Controller.move('up'),
                down: () => Lampa.Controller.move('down'),
                left: () => {},
                right: () => {},
                back: () => {
                    Lampa.Modal.close();
                    Lampa.Controller.remove('rutor_modal');
                    Lampa.Controller.toggle('menu');
                }
            });
            Lampa.Controller.toggle('rutor_modal');
        }, 100);
    }

    // ========== МЕНЮ ==========
    function addMenuButton() {
        let $menu = $('.menu .menu__list').first();
        if (!$menu.length) return setTimeout(addMenuButton, 500);
        if ($('.menu__item.rutor-torr-btn').length) return;

        let $btn = $(`
            <li class="menu__item selector rutor-torr-btn">
                <div class="menu__ico">
                    🔥
                </div>
                <div class="menu__text">Rutor торренты</div>
            </li>
        `);
        
        $btn.on('hover:enter', showCategoriesModal);
        $menu.append($btn);
        log('✅ Кнопка в меню добавлена');
    }

    // ========== НАСТРОЙКИ ==========
    function addSettingsComponent() {
        Lampa.SettingsApi.addComponent({
            component: 'rutor_torr',
            name: 'Rutor + TorrServer',
            icon: '🔥'
        });
        
        Lampa.SettingsApi.addParam({
            component: 'rutor_torr',
            param: { name: 'torrServerUrl', type: 'input', default: settings.torrServerUrl },
            field: { name: 'URL TorrServer', description: 'http://192.168.1.100:8090' },
            onChange: (val) => { settings.torrServerUrl = val; saveSettings(); }
        });
        
        Lampa.SettingsApi.addParam({
            component: 'rutor_torr',
            param: { name: 'useProxy', type: 'trigger', default: settings.useProxy },
            field: { name: 'Использовать прокси TorrServer', description: '✓ ОБЯЗАТЕЛЬНО' },
            onChange: (val) => { settings.useProxy = val; saveSettings(); }
        });
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        loadSettings();
        addSettingsComponent();
        
        if (window.Lampa && Lampa.App && Lampa.App.ready) {
            addMenuButton();
        } else {
            Lampa.Listener.follow('app', (e) => { 
                if (e.type === 'ready') addMenuButton(); 
            });
        }
        
        log(`✅ Плагин v${PLUGIN_VERSION} инициализирован`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
