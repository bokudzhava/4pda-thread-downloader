// ==UserScript==
// @name         4pda Thread Downloader
// @namespace    4PDA
// @homepage     https://github.com/bokudzhava/4pda-thread-downloader
// @version      1.0
// @description  Скачивает ветку 4PDA в формате TXT
// @author       bokudzhava
// @match        https://4pda.to/forum/*
// @match        https://4pda.ru/forum/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=4pda.to
// @downloadURL  https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.0.user.js
// @updateURL    https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.0.meta.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.0/jquery.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isDownloading = false;
    let processedPostIds = new Set();
    let globalPidToNumMap = new Map();
    let totalDetectedPages = 1;

    // --- Стили интерфейса (Компактный, в стиле Dark Mode) ---
    const uiStyle = `
        #dl-panel {
            position: fixed;
            bottom: 60px;
            right: 20px;
            z-index: 9999;
            background: #f7f7f7;
            border: 1px solid #aaa;
            padding: 8px;
            border-radius: 4px;
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #333;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            width: 200px;
            display: none;
        }
        #dl-toggle-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            width: 32px;
            height: 32px;
            background: #468ccf; /* Цвет кнопки 4pda */
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            font-weight: bold;
            font-size: 16px;
            line-height: 32px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            transition: background 0.2s;
        }
        #dl-toggle-btn:hover { background: #356aa0; }
        .dl-row { margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
        .dl-row label { margin-right: 5px; }
        .dl-input { width: 50px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; text-align: center; }
        .dl-btn {
            width: 100%; padding: 5px; background: #699c3c; color: white;
            border: none; border-radius: 3px; cursor: pointer; font-weight: bold; margin-top: 5px;
        }
        .dl-btn:hover { background: #558030; }
        .dl-btn.cancel { background: #af3228; margin-top: 5px; display: none;}
        #dl-status { margin-top: 8px; text-align: center; font-style: italic; color: #555; }

        /* Темная тема (если включена на сайте через класс .night или глобально) */
        .night #dl-panel { background: #22272B; border-color: #395179; color: #9e9e9e; }
        .night .dl-input { background: #31383e; border-color: #395179; color: #ddd; }
    `;

    function initUI() {
        const style = document.createElement('style');
        style.textContent = uiStyle;
        document.head.appendChild(style);

        // Кнопка открытия (круглешок)
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'dl-toggle-btn';
        toggleBtn.innerText = '⇓';
        toggleBtn.title = 'Скачать ветку (Настройки)';
        toggleBtn.onclick = togglePanel;
        document.body.appendChild(toggleBtn);

        // Панель настроек
        const panel = document.createElement('div');
        panel.id = 'dl-panel';
        panel.innerHTML = `
            <div class="dl-row">
                <label>С стр:</label>
                <input type="number" id="dl-start" class="dl-input" value="1" min="1">
            </div>
            <div class="dl-row">
                <label>По стр:</label>
                <input type="number" id="dl-end" class="dl-input" value="1" min="1">
            </div>
            <div class="dl-row">
                <label title="Задержка менее 1000мс может повлечь бан">Задержка:</label>
                <input type="number" id="dl-delay" class="dl-input" value="1200" step="100" min="500">
            </div>
            <button id="dl-go-btn" class="dl-btn">СКАЧАТЬ</button>
            <button id="dl-stop-btn" class="dl-btn cancel">СТОП</button>
            <div id="dl-status">Ожидание...</div>
        `;
        document.body.appendChild(panel);

        // Логика кнопок
        document.getElementById('dl-go-btn').onclick = startDownload;
        document.getElementById('dl-stop-btn').onclick = () => { isDownloading = false; };

        // Валидация ввода страниц
        detectTotalPages();
        const endInput = document.getElementById('dl-end');
        const startInput = document.getElementById('dl-start');

        endInput.value = totalDetectedPages;
        endInput.max = totalDetectedPages;

        [startInput, endInput].forEach(inp => {
            inp.onchange = function() {
                let v = parseInt(this.value);
                if (v < 1) this.value = 1;
                if (v > totalDetectedPages) this.value = totalDetectedPages;
            };
        });
    }

    function togglePanel() {
        const panel = document.getElementById('dl-panel');
        panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
    }

    function detectTotalPages() {
        try {
            const pageMenu = document.querySelector('.pagelink-menu');
            if (pageMenu) {
                const match = pageMenu.innerText.match(/(\d+)\s+страниц/);
                if (match) totalDetectedPages = parseInt(match[1], 10);
            }
        } catch (e) {}
    }

    async function startDownload() {
        if (isDownloading) return;

        const startPage = parseInt(document.getElementById('dl-start').value) || 1;
        const endPage = parseInt(document.getElementById('dl-end').value) || totalDetectedPages;
        const delay = parseInt(document.getElementById('dl-delay').value) || 1200;

        const statusEl = document.getElementById('dl-status');
        const goBtn = document.getElementById('dl-go-btn');
        const stopBtn = document.getElementById('dl-stop-btn');

        isDownloading = true;
        goBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        processedPostIds.clear();
        globalPidToNumMap.clear();

        let fullContent = "";
        let baseUrl = window.location.href.split(/[?&]st=/)[0];
        // Очистка URL от мусора
        if (baseUrl.includes('?')) {
             if(!baseUrl.includes('showtopic=')) {
                 // Если мы не в теме, а в поиске или еще где-то - предупредим
                 alert('Скрипт работает только внутри темы!');
                 isDownloading = false;
                 return;
             }
        }
        baseUrl = baseUrl.split('#')[0];

        // Коррекция диапазона
        let current = Math.min(startPage, endPage);
        let last = Math.max(startPage, endPage);

        for (let i = current; i <= last; i++) {
            if (!isDownloading) {
                statusEl.innerText = "Отменено пользователем";
                break;
            }

            statusEl.innerText = `Загрузка: ${i} из ${last}`;

            // Расчет смещения (st)
            const offset = (i - 1) * 20;
            // Формируем URL. Важно сохранить параметры темы
            let separator = baseUrl.includes('?') ? '&' : '?';
            const currentUrl = `${baseUrl}${separator}st=${offset}`;

            try {
                const pageHtml = await fetchPageText(currentUrl);
                const pageText = parsePostsFromHtml(pageHtml, i); // Передаем номер страницы для отладки
                fullContent += pageText;
            } catch (err) {
                console.error(`CRITICAL ERROR on page ${i}:`, err);
                fullContent += `\n!!! ОШИБКА ЗАГРУЗКИ СТРАНИЦЫ ${i} !!!\n(См. консоль браузера F12)\n\n`;
            }

            // Пауза
            if (i < last) await new Promise(r => setTimeout(r, delay));
        }

        if (isDownloading) {
            statusEl.innerText = "Сохранение...";
            downloadFile(fullContent);
            statusEl.innerText = "Готово!";
        }

        isDownloading = false;
        goBtn.style.display = 'block';
        stopBtn.style.display = 'none';
    }

    // --- ФУНКЦИЯ ЗАГРУЗКИ (ИСПРАВЛЕНА) ---
    async function fetchPageText(url) {
        // Добавляем заголовки, чтобы сервер не считал нас ботом
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Cache-Control': 'no-cache'
            },
            credentials: 'include' // Важно! Передает куки (авторизацию)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder("windows-1251");
        return decoder.decode(buffer);
    }

    // --- ПАРСЕР ---
    function parsePostsFromHtml(htmlString, pageNum) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");

        // Проверка: загрузилась ли страница корректно
        const postsElements = doc.querySelectorAll('table.ipbtable[data-post]');
        if (postsElements.length === 0) {
            // Если постов нет, возможно капча или ошибка доступа
            console.warn(`Страница ${pageNum}: посты не найдены. Возможно, конец темы или бан.`);
            // Пробуем найти текст ошибки на странице
            const errorBox = doc.querySelector('.globalmesswarnwrap') || doc.querySelector('.errorwrap');
            if (errorBox) return `\n[Ошибка сайта на стр ${pageNum}: ${errorBox.innerText.trim()}]\n\n`;
            return "";
        }

        // Проход 1: Индексация ID
        postsElements.forEach(post => {
            const pid = post.getAttribute('data-post');
            const numEl = post.querySelector('div[style="float:right"] a[onclick^="link_to_post"]');
            if (pid && numEl) {
                const postNum = numEl.innerText.trim();
                globalPidToNumMap.set(pid, postNum);
            }
        });

        let output = "";

        // Проход 2: Генерация
        postsElements.forEach(post => {
            const postIdAttribute = post.getAttribute('data-post');

            // Фильтр дублей (шапка)
            if (processedPostIds.has(postIdAttribute)) return;
            processedPostIds.add(postIdAttribute);

            try {
                let postNumber = globalPidToNumMap.get(postIdAttribute) || "#?";

                // Автор
                let author = "Unknown";
                const nickEl = post.querySelector('.normalname a');
                if (nickEl) author = nickEl.innerText.trim();
                else {
                    const normalName = post.querySelector('.normalname');
                    if(normalName) author = normalName.innerText.trim();
                }

                // Дата
                let date = "NoDate";
                const dateCell = post.querySelector('td[id^="ph-"][id$="-d2"]');
                if (dateCell) {
                    const rawDateText = dateCell.innerText;
                    const dateMatch = rawDateText.match(/(\d{2}\.\d{2}\.\d{2}|\w+),\s\d{2}:\d{2}/);
                    if (dateMatch) date = dateMatch[0];
                    else date = rawDateText.replace(/Сообщение\s*#\d+/, '').trim();
                }

                // Сообщение
                let message = "";
                const postBody = post.querySelector('.postcolor');
                if (postBody) {
                    const clone = postBody.cloneNode(true);

                    // Очистка мусора
                    clone.querySelectorAll('script, .edit, .post-edit-reason').forEach(el => el.remove());

                    // Цитаты
                    clone.querySelectorAll('.post-block.quote').forEach(quote => {
                        const title = quote.querySelector('.block-title');
                        const body = quote.querySelector('.block-body');

                        if (title) {
                            title.querySelectorAll('a[title="Перейти к сообщению"]').forEach(link => {
                                const href = link.href;
                                const pidMatch = href.match(/pid=(\d+)/);
                                if (pidMatch) {
                                    const targetPid = pidMatch[1];
                                    const targetNum = globalPidToNumMap.get(targetPid);
                                    const textLabel = targetNum ? ` [ ${targetNum} ]` : ` [ #${targetPid} ]`;
                                    link.replaceWith(document.createTextNode(textLabel));
                                } else {
                                     link.replaceWith(document.createTextNode(` [ ${href} ]`));
                                }
                            });
                            title.append(document.createTextNode('\n'));
                        }

                        if (body) {
                            // Удаляем висячие BR и пробелы в конце цитаты
                            let lastNode = body.lastChild;
                            while (lastNode) {
                                if (lastNode.tagName === 'BR' || (lastNode.nodeType === 3 && !lastNode.textContent.trim())) {
                                    const prev = lastNode.previousSibling;
                                    lastNode.remove();
                                    lastNode = prev;
                                } else {
                                    break;
                                }
                            }
                            body.prepend(document.createTextNode('«'));
                            body.append(document.createTextNode('»'));
                        }
                        quote.append(document.createTextNode('\n'));
                    });

                    // Ответы (стрелочки)
                    clone.querySelectorAll('a[title="Перейти к сообщению"]').forEach(link => {
                        const href = link.href;
                        const pidMatch = href.match(/pid=(\d+)/);
                        if (pidMatch) {
                            const targetPid = pidMatch[1];
                            const targetNum = globalPidToNumMap.get(targetPid);
                            const textLabel = targetNum ? `>> ${targetNum} ` : `>> #${targetPid} `;
                            link.replaceWith(document.createTextNode(textLabel));
                        } else {
                            link.remove();
                        }
                    });

                    // Обычные ссылки
                    clone.querySelectorAll('a').forEach(link => {
                        const href = link.href;
                        const text = link.innerText.trim();
                        if (href) {
                            if (text && text !== href) link.innerText = `${text} [ ${href} ]`;
                            else link.innerText = `[ ${href} ]`;
                        }
                    });

                    clone.querySelectorAll('li, .block-title').forEach(el => el.append(document.createTextNode('\n')));
                    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

                    message = clone.innerText.trim();
                    message = message.replace(/^\s*\d+%\s+оригинала.*$/gim, '');
                    message = message.replace(/^\s*\d+\s*x\s*\d+\s*\(.*\)\s*$/gim, '');
                    message = message.replace(/fix_linked_img_thumb\(.*\);/g, '');
                    message = message.replace(/\n{3,}/g, '\n\n');
                }

                output += `Время: ${date}\nАвтор: ${author}\nНомер: ${postNumber}\nСообщение:\n${message}\n\n` +
                          `--------------------------------------------------------------------------------\n\n`;

            } catch (err) {
                console.error("Parse Error:", err);
            }
        });

        return output;
    }

    function downloadFile(content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        let filename = document.title.replace(/[|&;$%@"<>()+,]/g, "").trim();
        filename = "THREAD_" + filename.substring(0, 50) + ".txt";
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    window.addEventListener('load', initUI);

})();
