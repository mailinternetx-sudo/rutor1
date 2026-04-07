(function() {
    // === КОНФИГУРАЦИЯ ===
    // Адрес вашего TorrServer. Lampa обычно берет его из настроек, но можно указать явно.
    // Оставим пустым, чтобы брать активный сервер из настроек Lampa.
    var TORR_SERVER_URL = ''; 

    // ID компонентов для избежания конфликтов
    var PLUGIN_ID = 'rutor_plugin';
    var MENU_ITEM_ID = 'rutor_menu_item';

    // Категории (как запрашивал пользователь)
    var CATEGORIES = [
        { id: 'top',   title: 'Топ торренты (24ч)',  url: '/top/24' },
        { id: 'foreign_movies', title: 'Зарубежные фильмы', url: '/0/0/100/0/0' }, // Примерные пути
        { id: 'russian_movies', title: 'Наши фильмы',      url: '/0/10/100/0/0' },
        { id: 'foreign_series', title: 'Зарубежные сериалы', url: '/0/0/201/0/0' },
        { id: 'russian_series', title: 'Наши сериалы',      url: '/0/10/201/0/0' },
        { id: 'tv',             title: 'Телевизор',         url: '/0/0/3/0/0' }
    ];

    // === ИНИЦИАЛИЗАЦИЯ ===
    function init() {
        if (!window.Lampa) {
            console.error('Lampa not found');
            return;
        }

        console.log('Rutor Plugin: Initializing...');

        // Регистрируем пункт в меню
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                addMenuItem();
            }
        });
    }

    // === ДОБАВЛЕНИЕ КНОПКИ В МЕНЮ ===
    function addMenuItem() {
        var menu_item = $('<div class="menu__item selector" id="' + MENU_ITEM_ID + '">')
            .append($('<div class="menu__item-icon">').html('<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#FF4700"/><path d="M18 8V28M8 18H28" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>'))
            .append($('<div class="menu__item-text">').text('RuTor TorrServe'));

        // Обработчик нажатия
        menu_item.on('hover:enter', function() {
            showCategoriesScreen();
        });

        // Вставляем в левое меню (обычно это .menu .menu__list)
        var menuList = $('.menu .menu__list');
        if (menuList.length) {
            menuList.append(menu_item);
        } else {
            console.error('Rutor Plugin: Menu container not found');
        }
    }

    // === ЭКРАН ВЫБОРА КАТЕГОРИИ ===
    function showCategoriesScreen() {
        var items = CATEGORIES.map(function(cat) {
            return {
                title: cat.title,
                id: cat.id,
                url: cat.url,
                plugin: true
            };
        });

        Lampa.Activity.push({
            url: '',
            title: 'RuTor Категории',
            component: 'catalog_full',
            page: 1,
            items: items,
            onSelect: function(item) {
                showTorrentList(item);
            }
        });
    }

    // === ЗАГРУЗКА СПИСКА ТОРРЕНТОВ ===
    function showTorrentList(categoryItem) {
        Lampa.Controller.enabled().content = false;
        Lampa.Activity.push({
            url: '',
            title: categoryItem.title,
            component: 'catalog_full',
            page: 1,
            items: [], // Пусто, пока грузим
            onCreate: function(bind) {
                bind.html.append('<div class="broadcast__scan"><div></div></div>'); // Индикатор загрузки
                loadRutorPage(categoryItem.url, bind);
            }
        });
    }

    // === ПАРСИНГ rutor.info ===
    function loadRutorPage(relativePath, bind) {
        // Определяем базовый URL rutor
        var baseUrl = 'http://rutor.info'; 
        var targetUrl = baseUrl + relativePath;

        // Пробуем получить активный TorrServer из настроек Lampa
        var tsUrl = Lampa.Storage.get('torrserver_url') || 'http://localhost:8090';
        
        // ХАК ДЛЯ CORS: Пробуем запросить через TorrServer (многие сборки проксируют запросы)
        // Если TorrServer поддерживает проксирование (например /proxy/http://...)
        // В противном случае запрос будет заблокирован браузером, если нет расширения или специальной сборки.
        var requestUrl = targetUrl; 
        
        // Раскомментируйте строку ниже, если у вас TorrServer настроен как прокси или используется модуль Lampa Proxy
        // requestUrl = tsUrl + '/proxy/' + targetUrl.replace('://', '/');

        console.log('Rutor Plugin: Fetching ' + requestUrl);

        fetch(requestUrl)
            .then(function(response) {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.text();
            })
            .then(function(html) {
                var parsedMovies = parseHtml(html);
                renderMovies(parsedMovies, bind);
            })
            .catch(function(error) {
                console.error('Rutor Plugin: Error loading page', error);
                Lampa.Noty.show('Ошибка загрузки RuTor. Проверьте интернет или CORS.');
                bind.render(); // Очистить лоадер
            });
    }

    // === HTML ПАРСЕР ===
    function parseHtml(html) {
        var movies = [];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var rows = doc.querySelectorAll('#index tr.gai, tr.tum'); // Селекторы таблиц rutor (обычно .gai для деталей)

        // rutor использует таблицы. Строки с torrent-файлами.
        // Селектор может меняться, но обычно это строки в таблице #index
        var tableRows = doc.querySelectorAll('#index tr');

        tableRows.forEach(function(tr) {
            // Пропускаем заголовки
            if (tr.querySelector('th')) return;

            // Ищем ссылку на детальную страницу (2-я колонка обычно)
            var linkCol = tr.querySelector('td:nth-child(2)');
            if (!linkCol) return;

            var link = linkCol.querySelector('a');
            if (!link) return;

            var title = link.innerText.trim();
            var detailPage = link.getAttribute('href');
            
            // Считываем размер
            var sizeCol = tr.querySelector('td:nth-child(4) span');
            var size = sizeCol ? sizeCol.innerText : '';

            // Считываем сиды/пиры (для сортировки или инфо)
            var seedsCol = tr.querySelector('td:nth-child(5)');
            var seeds = seedsCol ? parseInt(seedsCol.innerText) : 0;

            // Формируем Magnet. 
            // ВАЖНО: На странице списка нет magnet-ссылки. Есть только ID детальной страницы.
            // Magnet на rutor обычно выглядит как: magnet:?xt=urn:btih:HASH...
            // Нам нужно либо парсить детальную страницу (долго), либо конструировать ссылку, если знаем ID.
            // rutor использует ID в конце URL детальной страницы, например /torrent/123456
            // Но magnet хеша там нет.
            // Хитрость: Lampa + TorrServer умеют принимать ссылку на страницу торрента, 
            // если TorrServer поддерживает функцию поиска magnet по ссылке, но чаще нужен именно Magnet.
            // 
            // УПРОЩЕНИЕ: Мы будем возвращать ссылку на страницу. 
            // При нажатии "Смотреть" попытаемся найти magnet на детальной странице 
            // (но это удвоит запросы). 
            // Для надежности в "рабочем" плагине обычно используется кеш или API.
            // Здесь мы передаем detailUrl. В методе play нам нужно будет добыть magnet.

            if (title && detailPage) {
                movies.push({
                    title: title,
                    url: 'http://rutor.info' + detailPage,
                    size: size,
                    seeds: seeds,
                    quality: 'DVDRip', // Заглушка, так как в списке нет качества
                    original_title: title,
                    img: 'http://rutor.info' + (tr.querySelector('img') ? tr.querySelector('img').src : '') // Постер часто отсутствует в списке
                });
            }
        });

        return movies;
    }

    // === ОТРИСОВКА РЕЗУЛЬТАТОВ ===
    function renderMovies(movies, bind) {
        var scroll = bind.scroll.minus();
        var html = $('<div class="broadcast-list"></div>');
        var body = $('<div class="broadcast-list__body"></div>');

        if (movies.length === 0) {
            body.append('<div class="broadcast__empty">Нет данных</div>');
        } else {
            movies.forEach(function(movie) {
                var item = $('<div class="broadcast-item selector">')
                    .append($('<div class="broadcast-item__img">').css('backgroundImage', 'url(' + (movie.img || '') + ')'))
                    .append($('<div class="broadcast-item__details">')
                        .append($('<div class="broadcast-item__title">').text(movie.title))
                        .append($('<div class="broadcast-item__meta">').text(movie.size + ' | ' + movie.seeds + ' сидов'))
                    );

                item.on('hover:enter', function() {
                    playMovie(movie);
                });

                body.append(item);
            });
        }

        html.append(body);
        bind.render().find('.broadcast__scan').remove();
        bind.append(html);
        
        // Восстанавливаем скролл
        Lampa.Controller.collection.append(scroll.render());
        scroll.render().addClass('layer--wheight').data('mheight', bind.render());
    }

    // === ВОСПРОИЗВЕДЕНИЕ ===
    function playMovie(movie) {
        Lampa.Modal.open({
            title: movie.title,
            html: $('<div style="padding:20px; text-align:center;">Загрузка magnet ссылки...</div>'),
            onBack: function() {
                Lampa.Modal.close();
                return false;
            }
        });

        // Шаг 1: Получаем HTML детальной страницы
        var detailUrl = movie.url;
        
        // Пробуем через прокси, если нужно
        var tsUrl = Lampa.Storage.get('torrserver_url') || 'http://localhost:8090';
        // var requestUrl = tsUrl + '/proxy/' + detailUrl.replace('://', '/'); // Раскомментировать для прокси
        var requestUrl = detailUrl;

        fetch(requestUrl)
            .then(r => r.text())
            .then(function(html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                
                // Ищем magnet ссылку на странице. Обычно она в теге <a> с href начинающимся на magnet:
                var magnetLink = doc.querySelector('a[href^="magnet:"]');
                
                if (magnetLink) {
                    var magnet = magnetLink.getAttribute('href');
                    startTorrStream(magnet, movie.title);
                } else {
                    Lampa.Noty.show('Не удалось найти Magnet ссылку на странице.');
                    Lampa.Modal.close();
                }
            })
            .catch(function(e) {
                console.error(e);
                Lampa.Noty.show('Ошибка открытия детальной страницы (CORS?).');
                Lampa.Modal.close();
            });
    }

    function startTorrStream(magnet, title) {
        Lampa.Modal.close();
        
        // Формируем URL для TorrServer
        // Стандартный API: /streams?url={magnet}
        var tsUrl = Lampa.Storage.get('torrserver_url') || 'http://localhost:8090';
        // Удаляем слеш в конце если есть
        tsUrl = tsUrl.replace(/\/$/, '');
        
        var streamUrl = tsUrl + '/streams?url=' + encodeURIComponent(magnet) + '&title=' + encodeURIComponent(title) + &save_to_db=true&download_cached=false;
        
        console.log('TorrServer URL:', streamUrl);

        // Создаем объект видео для Lampa
        var video = {
            title: title,
            url: streamUrl,
            timeline: [], // Пустой таймлайн
            movie: {
                id: 'rutor_' + Date.now(),
                title: title,
                source: 'rutor'
            }
        };

        // Запускаем плеер
        Lampa.Player.play(video);
        Lampa.Player.playlist([video]); // Плейлист из одного файла
    }

    // Запуск
    init();

})();
