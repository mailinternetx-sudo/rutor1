<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>V10 2 — RuTor Netflix (обновлённые категории + улучшенный magnet)</title>
    <style>
        body { font-family: system-ui; background:#111; color:#fff; padding:20px; }
        pre { background:#1a1a1a; padding:20px; border-radius:12px; overflow:auto; font-size:14px; }
        .note { background:#221f1f; padding:15px; border-radius:8px; margin:15px 0; }
    </style>
</head>
<body>
    <h1>✅ V10 2 — RuTor Netflix • Обновлённые категории + улучшенный парсинг magnet</h1>
    <p><strong>Что изменилось:</strong></p>
    <ul>
        <li>Точно по твоему запросу: 6 категорий RuTor</li>
        <li>1. Топ торренты за последние 24 часа → https://rutor.info/top</li>
        <li>2. Зарубежные фильмы → https://rutor.info/browse/0/1/0/0</li>
        <li>3. Наши фильмы → https://rutor.info/browse/0/1/1/0</li>
        <li>4. Зарубежные сериалы → https://rutor.info/browse/0/5/0/0</li>
        <li>5. Наши сериалы → https://rutor.info/browse/0/5/1/0</li>
        <li>6. Телевизор → https://rutor.info/browse/0/6/0/0</li>
        <li>Улучшен парсинг magnet-ссылок (DOM + мощный regex fallback)</li>
        <li>Максимальная устойчивость к изменениям сайта</li>
    </ul>

<pre><code>(function () {
    'use strict';

    if (window.v10_2_rutor_netflix_final) return;
    window.v10_2_rutor_netflix_final = true;

    Lampa.Lang.add({
        v10_rutor: { ru: 'V10 2', en: 'V10 2' },
        v10_top: { ru: 'Топ RuTor', en: 'Top' },
        v10_new: { ru: 'Новинки', en: 'New' },
        v10_categories: { ru: 'Категории', en: 'Categories' },
        v10_search: { ru: 'Поиск по RuTor', en: 'Search RuTor' },
        v10_continue: { ru: 'Продолжить просмотр', en: 'Continue Watching' },
        v10_favorite: { ru: 'Избранное', en: 'Favorites' },
        v10_loading: { ru: 'Загрузка с RuTor...', en: 'Loading from RuTor...' },
        v10_error: { ru: 'Ошибка загрузки RuTor', en: 'RuTor load error' }
    });

    var network = new Lampa.Reguest();
    var CACHE_TTL = 20 * 60 * 1000;

    function getCache(key) {
        var d = Lampa.Storage.get('v10_rutor_nf_' + key);
        return d && Date.now() - d.time < CACHE_TTL ? d.data : null;
    }
    function setCache(key, data) {
        Lampa.Storage.set('v10_rutor_nf_' + key, {time: Date.now(), data: data});
    }

    // ==================== УЛУЧШЕННЫЙ ПАРСИНГ (с усиленным magnet) ====================
    function parseTorrentList(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var result = [];

        var rows = doc.querySelectorAll('tr[class^="g-"], tr.g-');
        if (rows.length < 5) {
            rows = Array.from(doc.querySelectorAll('tr')).filter(function(tr) {
                return tr.querySelector('a[href^="/torrent/"]');
            });
        }

        Array.from(rows).slice(0, 45).forEach(function(row) {
            var titleLink = row.querySelector('a[href^="/torrent/"]');
            if (!titleLink) return;

            var title = titleLink.textContent.trim();
            var url = 'https://rutor.info' + titleLink.getAttribute('href');

            // === УЛУЧШЕННЫЙ ПОИСК MAGNET ===
            var magnet = null;
            var magnetEl = row.querySelector('a[href^="magnet:"]');
            if (magnetEl) {
                magnet = magnetEl.getAttribute('href');
            } else {
                // Резервный regex — ищет magnet даже если он в onclick, data-атрибуте или просто в тексте
                var magnetMatch = row.innerHTML.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}[^"<&]*/i);
                if (magnetMatch) magnet = magnetMatch[0];
            }

            // Размер
            var size = '';
            var sizeCells = row.querySelectorAll('td');
            if (sizeCells.length >= 3) size = (sizeCells[2] || sizeCells[3]).textContent.trim();

            // Сиды / Пиры
            var seeds = 0, peers = 0;
            var peerCell = row.querySelector('td:last-child, td:nth-child(4)');
            if (peerCell) {
                var green = peerCell.querySelector('.green') || peerCell.textContent.match(/^(\d+)/);
                seeds = green ? parseInt(green.textContent || green[1]) || 0 : 0;
                var red = peerCell.querySelector('.red');
                peers = red ? parseInt(red.textContent) || 0 : 0;
            }

            // Год и чистое название
            var yearMatch = title.match(/\((\d{4})\)/);
            var year = yearMatch ? parseInt(yearMatch[1]) : null;
            var cleanTitle = title.replace(/\s*\(.*?\)\s*/g, '').trim();

            result.push({
                title: title,
                original_title: title,
                url: url,
                magnet: magnet,
                link: url,
                size: size,
                seeds: seeds,
                peers: peers,
                year: year,
                search_title: cleanTitle,
                poster: ''
            });
        });

        // Если DOM не справился — финальный regex
        if (result.length < 8) {
            var regex = /<a href="\/torrent\/[^"]+">([^<]+)<\/a>[\s\S]*?(magnet:\?xt=urn:btih:[^"&]+)?[\s\S]*?(\d+(?:\.\d+)?\s*[GT]B)/gi;
            var match;
            while ((match = regex.exec(html)) !== null) {
                result.push({
                    title: match[1].trim(),
                    original_title: match[1].trim(),
                    url: '',
                    magnet: match[2] || null,
                    size: match[3] || '',
                    seeds: 0,
                    peers: 0,
                    year: null,
                    search_title: match[1].replace(/\s*\(.*?\)\s*/g, '').trim()
                });
            }
        }

        return result;
    }

    function fetchRutor(url, cacheKey, success, error) {
        var cached = getCache(cacheKey);
        if (cached) return success(cached);

        network.silent(url, function(html) {
            var list = parseTorrentList(html);
            setCache(cacheKey, list);
            success(list);
        }, function(err) {
            console.warn('[V10 2 RuTor] Ошибка:', err);
            error && error(Lampa.Lang.translate('v10_error'));
        }, { timeout: 18000 });
    }

    function getTop(cb, err) { fetchRutor('https://rutor.info/top', 'top', cb, err); }
    function getNew(cb, err) { fetchRutor('https://rutor.info/new', 'new', cb, err); }

    // ==================== НОВЫЕ КАТЕГОРИИ ПО ТВОЕМУ СПИСКУ ====================
    var categories = [
        { title: 'Топ торренты за последние 24 часа', url: 'https://rutor.info/top' },
        { title: 'Зарубежные фильмы', url: 'https://rutor.info/browse/0/1/0/0' },
        { title: 'Наши фильмы', url: 'https://rutor.info/browse/0/1/1/0' },
        { title: 'Зарубежные сериалы', url: 'https://rutor.info/browse/0/5/0/0' },
        { title: 'Наши сериалы', url: 'https://rutor.info/browse/0/5/1/0' },
        { title: 'Телевизор', url: 'https://rutor.info/browse/0/6/0/0' }
    ];

    function getCategory(url, cb, err) { 
        fetchRutor(url, 'cat_' + btoa(url).slice(-15), cb, err); 
    }

    // ==================== КОМПОНЕНТ ====================
    function V10RutorNetflix(object) {
        var component = new Lampa.InteractionCategory(object);
        var scroll = null;
        var tabs = null;
        var currentTab = 'top';

        component.create = function () {
            tabs = new Lampa.Tabs({
                tabs: [
                    {title: Lampa.Lang.translate('v10_top'), value: 'top'},
                    {title: Lampa.Lang.translate('v10_new'), value: 'new'},
                    {title: Lampa.Lang.translate('v10_categories'), value: 'categories'},
                    {title: Lampa.Lang.translate('v10_search'), value: 'search'},
                    {title: Lampa.Lang.translate('v10_continue'), value: 'continue'},
                    {title: Lampa.Lang.translate('v10_favorite'), value: 'favorite'}
                ],
                onSelect: function(tab) {
                    currentTab = tab.value;
                    component.reload();
                }
            });
            component.html(tabs.render());

            scroll = new Lampa.Scroll({mask: true, over: true, step: 280});
            component.html(scroll.render());

            component.reload();
        };

        component.reload = function () {
            scroll.clear();
            var loader = Lampa.Template.get('loader', {text: Lampa.Lang.translate('v10_loading')});
            scroll.append(loader);

            var success = function(list) {
                loader.remove();
                list.forEach(function(item) {
                    var card = Lampa.Card.create(item, {large: true});
                    card.onEnter = function () {
                        Lampa.Activity.push({
                            component: 'movie',
                            title: item.search_title || item.title,
                            year: item.year,
                            url: item.magnet || item.url,
                            source: 'torrent'
                        });
                    };
                    scroll.append(card);
                });
                if (!list.length) scroll.append(Lampa.Template.get('empty'));
            };

            if (currentTab === 'top') getTop(success);
            else if (currentTab === 'new') getNew(success);
            else if (currentTab === 'categories') {
                loader.remove();
                categories.forEach(function(cat) {
                    var card = Lampa.Card.create({title: cat.title}, {large: true});
                    card.onEnter = function() { getCategory(cat.url, success); };
                    scroll.append(card);
                });
            }
            else if (currentTab === 'search') {
                loader.remove();
                Lampa.Search.open({
                    onSearch: function(query) {
                        var searchUrl = 'https://rutor.info/search/' + encodeURIComponent(query);
                        fetchRutor(searchUrl, 'search_' + query, success);
                    }
                });
            }
            else if (currentTab === 'continue') {
                loader.remove();
                var history = Lampa.Storage.get('history') || [];
                history.slice(0, 30).forEach(function(item) {
                    if (item.title) scroll.append(Lampa.Card.create(item, {large: true}));
                });
            }
            else if (currentTab === 'favorite') {
                loader.remove();
                var fav = Lampa.Favorite.get('movie') || [];
                fav.forEach(function(item) {
                    scroll.append(Lampa.Card.create(item, {large: true}));
                });
            }
        };

        component.destroy = function () {
            if (scroll) scroll.destroy();
            if (tabs) tabs.destroy();
            network.clear();
        };

        return component;
    }

    function addMenuButton() {
        var btn = $('<div class="menu__item menu__item--full">' +
            '<div class="menu__ico" style="color:#e50914">📺</div>' +
            '<div class="menu__text">V10 2</div>' +
        '</div>');

        btn.on('hover:enter', function() {
            Lampa.Activity.push({
                component: 'v10_rutor_netflix',
                title: 'V10 2 — RuTor',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        Lampa.Component.add('v10_rutor_netflix', V10RutorNetflix);
        addMenuButton();
        console.log('%c✅ V10 2 RuTor Netflix (новые категории + улучшенный magnet) загружен', 'color:#e50914;font-weight:bold');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') init(); });
})();
</code></pre>

    <div class="note">
        <strong>Как установить / обновить:</strong><br>
        1. Скопируй весь код выше<br>
        2. Сохрани как <strong>ru_tor_v10_2_netflix.js</strong><br>
        3. Замени старый плагин в Lampa (Настройки → Расширения)<br>
        4. Перезапусти приложение
    </div>

    <p>Готово! Теперь в разделе «Категории» ровно те 6 пунктов, которые ты просил, и magnet-ссылки парсятся максимально надёжно.</p>
</body>
</html>
