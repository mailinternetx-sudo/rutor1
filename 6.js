(function() {
    'use strict';

    if (window.rutori_plugin_installed) return;
    window.rutori_plugin_installed = true;

    console.log('%cRUTORI Plugin загружен ✅', 'color: #00ff00; font-weight: bold;');

    // ====================== КАТЕГОРИИ =========================
    var categories = [
        { id: 0, title: 'Топ торренты за последние 24 часа', url: 'https://rutor.info/browse/0/1/0/0' },
        { id: 1, title: 'Зарубежные фильмы',                  url: 'https://rutor.info/browse/5/1/0/0' },
        { id: 2, title: 'Наши фильмы',                       url: 'https://rutor.info/browse/1/1/0/0' },
        { id: 3, title: 'Зарубежные сериалы',                url: 'https://rutor.info/browse/4/1/0/0' },
        { id: 4, title: 'Наши сериалы',                      url: 'https://rutor.info/browse/2/1/0/0' },
        { id: 5, title: 'Телевизор',                         url: 'https://rutor.info/browse/7/1/0/0' }
    ];

    // ====================== КОМПОНЕНТ RUTORI =========================
    var RutoriComponent = function() {
        var self = this;
        var network = new Lampa.Network();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var tabs = new Lampa.Tabs();

        self.create = function() {
            self.render = $('<div></div>');

            // Табы категорий
            categories.forEach(function(cat) {
                tabs.add({ title: cat.title, id: cat.id });
            });

            tabs.onSelect = function(tab) {
                loadCategory(tab.id);
            };

            self.render.append(tabs.render());
            self.render.append(scroll.render());

            return self.render;
        };

        self.start = function() {
            tabs.active(0); // открываем первую категорию
        };

        self.destroy = function() {
            network.clear();
            scroll.destroy();
        };

        function loadCategory(id) {
            var cat = categories.find(function(c) { return c.id === id; });
            scroll.clear();
            scroll.append(Lampa.Template.get('loader', {})); // индикатор загрузки

            network.silent({
                url: cat.url,
                dataType: 'text',
                success: function(html) {
                    scroll.clear();
                    var items = parseRutor(html);
                    if (items.length === 0) {
                        scroll.append('<div class="empty">Ничего не найдено</div>');
                        return;
                    }

                    items.forEach(function(item) {
                        var card = createCard(item);
                        scroll.append(card);
                    });
                },
                error: function() {
                    scroll.clear();
                    scroll.append('<div class="empty">Ошибка загрузки rutor.info</div>');
                }
            });
        }

        // Парсинг списка раздач с rutor.info
        function parseRutor(html) {
            var items = [];
            var rows = html.match(/<tr class="(gai|tum)">[\s\S]*?<\/tr>/g) || [];

            rows.forEach(function(row) {
                var titleMatch = row.match(/<a href="\/torrent\/(\d+)"[^>]*>([^<]+)<\/a>/i);
                if (!titleMatch) return;

                var id = titleMatch[1];
                var title = titleMatch[2].trim().replace(/&nbsp;/g, ' ');

                // Прямая ссылка на .torrent (TorrServer её отлично принимает)
                var torrentUrl = 'https://rutor.info/download/' + id + '.torrent';

                // Размер и сиды (примерно)
                var sizeMatch = row.match(/<td align="right">([^<]+)<\/td>/i);
                var size = sizeMatch ? sizeMatch[1].trim() : '—';

                var seedsMatch = row.match(/<span class="green">(\d+)<\/span>/i);
                var seeds = seedsMatch ? seedsMatch[1] : '0';

                items.push({
                    title: title,
                    torrent_url: torrentUrl,
                    size: size,
                    seeds: seeds
                });
            });
            return items;
        }

        // Создание карточки
        function createCard(item) {
            var cardHtml = Lampa.Template.get('card', {
                title: item.title,
                poster: '', // у rutor нет постеров в списке
                quality: item.size,
                info: '<span class="green">↑' + item.seeds + '</span>'
            });

            var card = $(cardHtml);

            card.on('hover:enter', function() {
                playTorrent(item);
            });

            return card;
        }

        // Воспроизведение через TorrServer
        function playTorrent(item) {
            Lampa.Activity.push({
                component: 'player',
                url: item.torrent_url,           // .torrent файл
                title: item.title,
                poster: '',
                playlist: [{
                    url: item.torrent_url,
                    title: item.title,
                    subtitles: []
                }]
            });
        }

        return self;
    };

    // ====================== РЕГИСТРАЦИЯ КОМПОНЕНТА =========================
    Lampa.Component.add('rutori', RutoriComponent);

    // ====================== КНОПКА В ЛЕВОМ МЕНЮ =========================
    function addMenuButton(activityRender) {
        if (activityRender.find('.rutori-menu-btn').length > 0) return;

        var menuList = activityRender.find('.menu__list, .sidebar__list, .activity__menu, .main-menu__list');
        if (!menuList.length) menuList = activityRender.find('.activity__body'); // fallback

        var btn = $(
            '<div class="menu__item rutori-menu-btn">' +
                '<div class="menu__icon">📼</div>' +
                '<div class="menu__name">RUTORI</div>' +
            '</div>'
        );

        btn.on('hover:enter', function() {
            Lampa.Activity.push({
                url: '',
                title: 'RUTORI',
                component: 'rutori'
            });
        });

        menuList.append(btn);
    }

    // Следим за главным экраном и добавляем кнопку
    Lampa.Listener.follow('main', function(e) {
        if (e.type === 'complite') {
            addMenuButton(e.render || e.activity.render());
        }
    });

    // Дополнительно — если уже открыт главный экран
    try {
        if (Lampa.Activity.active().component === 'main') {
            addMenuButton(Lampa.Activity.active().activity.render());
        }
    } catch (e) {}

    console.log('%cRUTORI Plugin готов к работе! Кнопка появится в левом меню.', 'color: #00ff00;');
})();
