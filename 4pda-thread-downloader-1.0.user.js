// ==UserScript==
// @name         4pda Thread Downloader
// @namespace    4PDA
// @homepage     https://github.com/bokudzhava/4pda-thread-downloader
// @version      1.1
// @description  Скачивает ветку 4PDA в формате TXT
// @author       bokudzhava
// @match        https://4pda.to/forum/*
// @match        https://4pda.ru/forum/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=4pda.to
// @downloadURL  https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.1.user.js
// @updateURL    https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.1.meta.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.0/jquery.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isDownloading = false;
    let processedPostIds = new Set();
    let globalPidToNumMap = new Map();
    let totalDetectedPages = 1;

    // --- Стили интерфейса ---
    const uiStyle = `
        #dl-panel {
            position: fixed; bottom: 60px; right: 20px; z-index: 9999;
            background: #f7f7f7; border: 1px solid #aaa; padding: 10px;
            border-radius: 4px; font-family: Arial, sans-serif; font-size: 12px;
            color: #333; box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 210px; display: none;
        }
        #dl-toggle-btn {
            position: fixed; bottom: 20px; right: 20px; z-index: 9999;
            width: 32px; height: 32px; background: #468ccf; color: white;
            border: none; border-radius: 50%; cursor: pointer; font-weight: bold;
            font-size: 16px; line-height: 32px; text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3); transition: background 0.2s;
        }
        #dl-toggle-btn:hover { background: #356aa0; }
        .dl-row { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .dl-row label { margin-right: 5px; cursor: pointer; }
        .dl-input { width: 50px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; text-align: center; }
        .dl-btn {
            width: 100%; padding: 6px; background: #699c3c; color: white;
            border: none; border-radius: 3px; cursor: pointer; font-weight: bold; margin-top: 5px;
        }
        .dl-btn:hover { background: #558030; }
        .dl-btn.cancel { background: #af3228; margin-top: 5px; display: none;}
        #dl-status { margin-top: 8px; text-align: center; font-style: italic; color: #555; }
        .dl-checkbox-wrapper { display: flex; align-items: center; background: #e0e0e0; padding: 3px 6px; border-radius: 4px; width: 100%; box-sizing: border-box; justify-content: space-between;}
        .dl-checkbox { cursor: pointer; margin: 0; }
        .night #dl-panel { background: #22272B; border-color: #395179; color: #9e9e9e; }
        .night .dl-input { background: #31383e; border-color: #395179; color: #ddd; }
        .night .dl-checkbox-wrapper { background: #31383e; }
    `;

    function initUI() {
        const style = document.createElement('style');
        style.textContent = uiStyle;
        document.head.appendChild(style);

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'dl-toggle-btn';
        toggleBtn.innerText = '⇓';
        toggleBtn.title = 'Скачать ветку';
        toggleBtn.onclick = togglePanel;
        document.body.appendChild(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'dl-panel';
        panel.innerHTML = `
            <div class="dl-row">
                <label>С стр:</label><input type="number" id="dl-start" class="dl-input" value="1" min="1">
            </div>
            <div class="dl-row">
                <label>По стр:</label><input type="number" id="dl-end" class="dl-input" value="1" min="1">
            </div>
            <div class="dl-row">
                <label title="Задержка менее 1с может повлечь за собой бан">Задержка, мс:</label><input type="number" id="dl-delay" class="dl-input" value="1200" step="100" min="500">
            </div>
            <div class="dl-row">
                <div class="dl-checkbox-wrapper" title="Упрощённый формат для экономии токенов">
                    <label for="dl-ai-mode" style="font-weight:bold; color:#468ccf;">Для ИИ</label>
                    <input type="checkbox" id="dl-ai-mode" class="dl-checkbox">
                </div>
            </div>
            <button id="dl-go-btn" class="dl-btn">СКАЧАТЬ</button>
            <button id="dl-stop-btn" class="dl-btn cancel">СТОП</button>
            <div id="dl-status">Ожидание...</div>
        `;
        document.body.appendChild(panel);

        document.getElementById('dl-go-btn').onclick = startDownload;
        document.getElementById('dl-stop-btn').onclick = () => { isDownloading = false; };

        detectTotalPages();
        const endInput = document.getElementById('dl-end');
        endInput.value = totalDetectedPages;
        endInput.max = totalDetectedPages;

        [document.getElementById('dl-start'), endInput].forEach(inp => {
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
        const isAiMode = document.getElementById('dl-ai-mode').checked;

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
        if (baseUrl.includes('?') && !baseUrl.includes('showtopic=')) {
             alert('Скрипт работает только внутри темы!');
             isDownloading = false;
             return;
        }
        baseUrl = baseUrl.split('#')[0];

        let current = Math.min(startPage, endPage);
        let last = Math.max(startPage, endPage);

        for (let i = current; i <= last; i++) {
            if (!isDownloading) {
                statusEl.innerText = "Отменено";
                break;
            }

            statusEl.innerText = `Загрузка: ${i} из ${last}`;
            const offset = (i - 1) * 20;
            let separator = baseUrl.includes('?') ? '&' : '?';
            const currentUrl = `${baseUrl}${separator}st=${offset}`;

            try {
                const pageHtml = await fetchPageText(currentUrl);
                const pageText = parsePostsFromHtml(pageHtml, i, isAiMode);
                fullContent += pageText;
            } catch (err) {
                console.error(`ERROR page ${i}:`, err);
                fullContent += `\n[ОШИБКА СТРАНИЦЫ ${i}]\n`;
            }

            if (i < last) await new Promise(r => setTimeout(r, delay));
        }

        if (isDownloading) {
            statusEl.innerText = "Сохранение...";
            downloadFile(fullContent, isAiMode);
            statusEl.innerText = "Готово!";
        }

        isDownloading = false;
        goBtn.style.display = 'block';
        stopBtn.style.display = 'none';
    }

    async function fetchPageText(url) {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Cache-Control': 'no-cache'
            },
            credentials: 'include'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder("windows-1251");
        return decoder.decode(buffer);
    }

    function parsePostsFromHtml(htmlString, pageNum, isAiMode) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");
        const postsElements = doc.querySelectorAll('table.ipbtable[data-post]');

        if (postsElements.length === 0) return "";

        postsElements.forEach(post => {
            const pid = post.getAttribute('data-post');
            const numEl = post.querySelector('div[style="float:right"] a[onclick^="link_to_post"]');
            if (pid && numEl) globalPidToNumMap.set(pid, numEl.innerText.trim());
        });

        let output = "";

        postsElements.forEach(post => {
            const postIdAttribute = post.getAttribute('data-post');
            if (processedPostIds.has(postIdAttribute)) return;
            processedPostIds.add(postIdAttribute);

            try {
                let postNumber = globalPidToNumMap.get(postIdAttribute) || "#?";
                let author = "Unknown";
                const nickEl = post.querySelector('.normalname a') || post.querySelector('.normalname');
                if (nickEl) author = nickEl.innerText.trim();

                let date = "";
                if (!isAiMode) {
                    const dateCell = post.querySelector('td[id^="ph-"][id$="-d2"]');
                    if (dateCell) {
                        const rawDateText = dateCell.innerText;
                        const dateMatch = rawDateText.match(/(\d{2}\.\d{2}\.\d{2}|\w+),\s\d{2}:\d{2}/);
                        date = dateMatch ? dateMatch[0] : rawDateText.replace(/Сообщение\s*#\d+/, '').trim();
                    }
                }

                let message = "";
                const postBody = post.querySelector('.postcolor');
                if (postBody) {
                    const clone = postBody.cloneNode(true);

                    clone.querySelectorAll('script, .edit, .post-edit-reason').forEach(el => el.remove());

                    if (isAiMode) {
                        clone.querySelectorAll('img').forEach(img => img.replaceWith(document.createTextNode('[IMG]')));
                        clone.querySelectorAll('a').forEach(a => {
                            if (/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(a.href)) {
                                a.replaceWith(document.createTextNode('[IMG]'));
                            }
                        });

                        // ЦИТАТЫ: Сжатие
                        clone.querySelectorAll('.post-block.quote').forEach(quote => {
                            const title = quote.querySelector('.block-title');
                            let refText = "";
                            const link = title ? title.querySelector('a[title="Перейти к сообщению"]') : null;
                            if (link) {
                                const pidMatch = link.href.match(/pid=(\d+)/);
                                if (pidMatch) {
                                    const tNum = globalPidToNumMap.get(pidMatch[1]);
                                    refText = tNum ? `>${tNum}` : `>#${pidMatch[1]}`;
                                }
                            }
                            if (!refText && title) {
                                const nickMatch = title.innerText.trim().split('@')[0].trim();
                                if (nickMatch) refText = `>${nickMatch}`;
                            }
                            if (!refText) refText = ">Цитата";
                            quote.replaceWith(document.createTextNode(` ${refText} `));
                        });
                    } else {
                        // ЦИТАТЫ: Стандарт
                        clone.querySelectorAll('.post-block.quote').forEach(quote => {
                            const title = quote.querySelector('.block-title');
                            const body = quote.querySelector('.block-body');
                            if (title) {
                                title.querySelectorAll('a[title="Перейти к сообщению"]').forEach(link => {
                                    const href = link.href;
                                    const pidMatch = href.match(/pid=(\d+)/);
                                    if (pidMatch) {
                                        const tNum = globalPidToNumMap.get(pidMatch[1]);
                                        link.replaceWith(document.createTextNode(tNum ? ` [ ${tNum} ]` : ` [ #${pidMatch[1]} ]`));
                                    } else link.replaceWith(document.createTextNode(` [ ${href} ]`));
                                });
                                title.append(document.createTextNode('\n'));
                            }
                            if (body) {
                                let lastNode = body.lastChild;
                                while(lastNode && (lastNode.tagName === 'BR' || (lastNode.nodeType === 3 && !lastNode.textContent.trim()))) {
                                    const p = lastNode.previousSibling; lastNode.remove(); lastNode = p;
                                }
                                body.prepend(document.createTextNode('«'));
                                body.append(document.createTextNode('»'));
                            }
                            quote.append(document.createTextNode('\n'));
                        });
                    }

                    // ОТВЕТЫ (SNAPBACK): >#Номер и очистка ника
                    clone.querySelectorAll('a[title="Перейти к сообщению"]').forEach(link => {
                        const pidMatch = link.href.match(/pid=(\d+)/);
                        if (pidMatch) {
                            const tNum = globalPidToNumMap.get(pidMatch[1]);
                            const txt = isAiMode
                                ? (tNum ? `>${tNum} ` : `>#${pidMatch[1]} `)
                                : (tNum ? `>> ${tNum} ` : `>> #${pidMatch[1]} `);

                            // === ЧИСТКА НИКОВ В РЕЖИМЕ ИИ ===
                            if (isAiMode) {
                                // 1. Удаляем пробелы между стрелкой и ником
                                let next = link.nextSibling;
                                while (next && next.nodeType === 3 && !next.textContent.trim()) {
                                    let toRemove = next;
                                    next = next.nextSibling;
                                    toRemove.remove();
                                }
                                // 2. Удаляем жирный ник <b>User</b>
                                if (next && next.tagName === 'B') {
                                    let boldNode = next;
                                    next = next.nextSibling;
                                    boldNode.remove();
                                }
                                // 3. Удаляем запятую после ника
                                if (next && next.nodeType === 3) {
                                    next.textContent = next.textContent.replace(/^[\s,]+/, '');
                                }
                            }
                            // =================================

                            link.replaceWith(document.createTextNode(txt));
                        } else link.remove();
                    });

                    // ССЫЛКИ
                    clone.querySelectorAll('a').forEach(link => {
                        const href = link.href;
                        let text = link.innerText.trim();

                        if (href) {
                            if (isAiMode) {
                                if (href.includes('showtopic=') || href.includes('act=findpost') || href.includes('view=findpost')) {
                                    if (text === href || text.toLowerCase() === 'ссылка' || text.toLowerCase() === 'здесь') {
                                        link.replaceWith(document.createTextNode('[LINK]'));
                                    } else {
                                        link.innerText = `${text} [LINK]`;
                                    }
                                } else {
                                    let displayUrl = href.replace(/^https?:\/\/(www\.)?/i, '');
                                    if (text && text !== href && text !== displayUrl) {
                                        link.innerText = `${text} [ ${displayUrl} ]`;
                                    } else {
                                        link.innerText = `[ ${displayUrl} ]`;
                                    }
                                }
                            } else {
                                if (text && text !== href) link.innerText = `${text} [ ${href} ]`;
                                else link.innerText = `[ ${href} ]`;
                            }
                        }
                    });

                    if (!isAiMode) {
                        clone.querySelectorAll('li, .block-title').forEach(el => el.append(document.createTextNode('\n')));
                    } else {
                        clone.querySelectorAll('li').forEach(el => el.append(document.createTextNode('; ')));
                    }

                    clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode(isAiMode ? ' ' : '\n')));

                    message = clone.innerText.trim();

                    message = message.replace(/^\s*\d+%\s+оригинала.*$/gim, '');
                    message = message.replace(/^\s*\d+\s*x\s*\d+\s*\(.*\)\s*$/gim, '');
                    message = message.replace(/fix_linked_img_thumb\(.*\);/g, '');

                    if (isAiMode) {
                        message = message.replace(/\s+/g, ' ');
                        message = message.replace(/(\s*;\s*){2,}/g, '; ');
                        message = message.trim();
                    } else {
                        message = message.replace(/\n{3,}/g, '\n\n');
                    }
                }

                if (isAiMode) {
                    output += `${postNumber} ${author}: ${message}\n`;
                } else {
                    output += `Время: ${date}\nАвтор: ${author}\nНомер: ${postNumber}\nСообщение:\n${message}\n\n` +
                              `--------------------------------------------------------------------------------\n\n`;
                }

            } catch (err) {
                console.error("Parse Error:", err);
            }
        });

        return output;
    }

    function downloadFile(content, isAiMode) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        let title = document.title.replace(/[|&;$%@"<>()+,]/g, "").trim();
        let prefix = isAiMode ? "dataset_" : "thread_";
        let filename = prefix + title.substring(0, 40) + ".txt";
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    window.addEventListener('load', initUI);

})();
