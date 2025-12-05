// ==UserScript==
// @name         4pda Thread Downloader
// @namespace    4PDA
// @homepage     https://github.com/bokudzhava/4pda-thread-downloader
// @version      1.3
// @description  Скачивает ветку 4PDA в формате TXT
// @author       bokudzhava
// @match        https://4pda.to/forum/*
// @match        https://4pda.ru/forum/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=4pda.to
// @downloadURL  https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.3.user.js
// @updateURL    https://github.com/bokudzhava/raw/main/4pda-thread-downloader-1.3.meta.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.0/jquery.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- КОНФИГУРАЦИЯ И СОСТОЯНИЕ ---
    const STATE = {
        isDownloading: false,
        saveOnStop: false, // Флаг для сохранения при остановке
        processedPostIds: new Set(),
        globalPidToNumMap: new Map(),
        totalDetectedPages: 1
    };

    const BC = new BroadcastChannel('4pda_downloader_channel');

    // Предкомпилированные регулярки
    const REGEX = {
        cleanImgs: /fix_linked_img_thumb\(.*\);/g,
        imgExt: /\.(jpg|jpeg|png|gif|webp|bmp)$/i,
        resolutionInfo: /^\s*\d+%\s+оригинала.*$/gim,
        sizeInfo: /^\s*\d+\s*x\s*\d+\s*\(.*\)\s*$/gim,
        multiNewlines: /\n{3,}/g,
        multiSpaces: /\s+/g,
        multiSemi: /(\s*;\s*){2,}/g,
        protocols: /^https?:\/\/(www\.)?/i,
        topicLinks: /(showtopic=|act=findpost|view=findpost)/,
        pidFromLink: /pid=(\d+)/,
        pagesCount: /(\d+)\s+страниц/
    };

    // --- UI ---
    const UI = {
        style: `
            #dl-panel { position: fixed; bottom: 60px; right: 20px; z-index: 9999; background: #f7f7f7; border: 1px solid #aaa; padding: 10px; border-radius: 4px; font-family: Arial, sans-serif; font-size: 12px; color: #333; box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 220px; display: none; }
            #dl-toggle-btn { position: fixed; bottom: 20px; right: 20px; z-index: 9999; width: 32px; height: 32px; background: #468ccf; color: white; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; line-height: 32px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.3); transition: background 0.2s; }
            #dl-toggle-btn:hover { background: #356aa0; }
            .dl-row { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
            .dl-input { width: 50px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; text-align: center; }

            .dl-btn { width: 100%; padding: 6px; background: #699c3c; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; margin-top: 5px; }
            .dl-btn:hover { background: #558030; }

            .dl-btn-group { display: flex; gap: 5px; margin-top: 5px; display: none; }
            .dl-btn.save-stop { background: #e67e22; margin-top: 0; }
            .dl-btn.save-stop:hover { background: #d35400; }
            .dl-btn.cancel { background: #af3228; margin-top: 0; }
            .dl-btn.cancel:hover { background: #8e1c1c; }

            #dl-status { margin-top: 8px; text-align: center; font-style: italic; color: #555; }
            .dl-checkbox-wrapper { display: flex; align-items: center; background: #e0e0e0; padding: 3px 6px; border-radius: 4px; width: 100%; box-sizing: border-box; justify-content: space-between; margin-bottom: 4px;}
            .dl-checkbox { cursor: pointer; margin: 0; }
            .dl-broadcast-label { color: #d32f2f; font-weight: bold; }

            .night #dl-panel { background: #22272B; border-color: #395179; color: #9e9e9e; }
            .night .dl-input { background: #31383e; border-color: #395179; color: #ddd; }
            .night .dl-checkbox-wrapper { background: #31383e; }
        `,

        init() {
            const style = document.createElement('style');
            style.textContent = this.style;
            document.head.appendChild(style);

            const toggleBtn = document.createElement('div');
            toggleBtn.id = 'dl-toggle-btn';
            toggleBtn.innerText = '⇓';
            toggleBtn.title = 'Скачать ветку';
            toggleBtn.onclick = this.togglePanel;
            document.body.appendChild(toggleBtn);

            const panel = document.createElement('div');
            panel.id = 'dl-panel';
            panel.innerHTML = `
                <div class="dl-row"><label>С стр:</label><input type="number" id="dl-start" class="dl-input" value="1" min="1"></div>
                <div class="dl-row"><label>По стр:</label><input type="number" id="dl-end" class="dl-input" value="1" min="1"></div>

                <div class="dl-row" title="Одновременных запросов"><label>Потоков:</label><input type="number" id="dl-threads" class="dl-input" value="3" min="1" max="10"></div>
                <div class="dl-row" title="Задержка менее 1с может повлечь за собой бан"><label>Задержка, мс:</label><input type="number" id="dl-delay" class="dl-input" value="2000" step="100" min="500"></div>

                <div class="dl-checkbox-wrapper" title="Сжатый лог"><label for="dl-ai-mode" style="font-weight:bold; color:#468ccf;">Для ИИ</label><input type="checkbox" id="dl-ai-mode" class="dl-checkbox"></div>
                <div class="dl-checkbox-wrapper" title="Скачивание всех открытых вкладок, настройки синхронизируются"><label for="dl-broadcast" class="dl-broadcast-label">Скачать все вкладки</label><input type="checkbox" id="dl-broadcast" class="dl-checkbox"></div>

                <button id="dl-go-btn" class="dl-btn">СКАЧАТЬ</button>

                <div id="dl-controls" class="dl-btn-group">
                    <button id="dl-save-stop-btn" class="dl-btn save-stop">СТОП+СОХР</button>
                    <button id="dl-cancel-btn" class="dl-btn cancel">ОТМЕНА</button>
                </div>

                <div id="dl-status">Ожидание...</div>
            `;
            document.body.appendChild(panel);

            document.getElementById('dl-go-btn').onclick = () => Engine.handleStartClick(false);

            // Обработчики кнопок остановки
            document.getElementById('dl-save-stop-btn').onclick = () => {
                STATE.saveOnStop = true;
                STATE.isDownloading = false;
            };
            document.getElementById('dl-cancel-btn').onclick = () => {
                STATE.saveOnStop = false;
                STATE.isDownloading = false;
            };

            this.detectPages();
            const endInput = document.getElementById('dl-end');
            endInput.value = STATE.totalDetectedPages;

            [document.getElementById('dl-start'), endInput].forEach(inp => {
                inp.onchange = function() {
                    let v = parseInt(this.value);
                    if (v < 1) this.value = 1;
                    if (v > STATE.totalDetectedPages && !document.getElementById('dl-broadcast').checked) {
                        this.value = STATE.totalDetectedPages;
                    }
                };
            });
        },

        togglePanel() {
            const panel = document.getElementById('dl-panel');
            panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
        },

        detectPages() {
            try {
                const pageMenu = document.querySelector('.pagelink-menu');
                if (pageMenu) {
                    const match = pageMenu.innerText.match(REGEX.pagesCount);
                    if (match) STATE.totalDetectedPages = parseInt(match[1], 10);
                }
            } catch (e) {}
        },

        setStatus(text) {
            document.getElementById('dl-status').innerText = text;
        },

        setControlsState(downloading) {
            document.getElementById('dl-go-btn').style.display = downloading ? 'none' : 'block';
            document.getElementById('dl-controls').style.display = downloading ? 'flex' : 'none';
        }
    };

    // --- PARSER ---
    const Parser = {
        domParser: new DOMParser(),

        parseHtml(htmlString, pageNum, isAiMode) {
            const doc = this.domParser.parseFromString(htmlString, "text/html");
            const postsElements = doc.querySelectorAll('table.ipbtable[data-post]');

            if (postsElements.length === 0) {
                const err = doc.querySelector('.errorwrap, .globalmesswarnwrap');
                if (err) return `\n!!! ОШИБКА СТР ${pageNum}: ${err.innerText.trim()} !!!\n`;
                return `\n!!! ПУСТАЯ СТРАНИЦА ${pageNum} !!!\n`;
            }

            postsElements.forEach(post => {
                const pid = post.getAttribute('data-post');
                const numEl = post.querySelector('div[style="float:right"] a[onclick^="link_to_post"]');
                if (pid && numEl) STATE.globalPidToNumMap.set(pid, numEl.innerText.trim());
            });

            let pageResult = [];

            postsElements.forEach(post => {
                const pid = post.getAttribute('data-post');
                if (STATE.processedPostIds.has(pid)) return;
                STATE.processedPostIds.add(pid);

                try {
                    const postNumber = STATE.globalPidToNumMap.get(pid) || "#?";

                    let author = "Unknown";
                    const nickEl = post.querySelector('.normalname a') || post.querySelector('.normalname');
                    if (nickEl) author = nickEl.innerText.trim();

                    let date = "";
                    if (!isAiMode) {
                        const dateCell = post.querySelector('td[id^="ph-"][id$="-d2"]');
                        if (dateCell) {
                            const dateMatch = dateCell.innerText.match(/(\d{2}\.\d{2}\.\d{2}|\w+),\s\d{2}:\d{2}/);
                            date = dateMatch ? dateMatch[0] : "NoDate";
                        }
                    }

                    let message = "";
                    const postBody = post.querySelector('.postcolor');
                    if (postBody) {
                        const clone = postBody.cloneNode(true);
                        this.cleanNode(clone, isAiMode);
                        message = clone.innerText.trim();
                        message = this.cleanText(message, isAiMode);
                    }

                    if (isAiMode) {
                        pageResult.push(`${postNumber} ${author}: ${message}\n`);
                    } else {
                        pageResult.push(`Время: ${date}\nАвтор: ${author}\nНомер: ${postNumber}\nСообщение:\n${message}\n\n` +
                                      `--------------------------------------------------------------------------------\n\n`);
                    }

                } catch (err) {
                    console.error("Parse error:", err);
                }
            });

            return pageResult.join('');
        },

        cleanNode(node, isAiMode) {
            node.querySelectorAll('script, .edit, .post-edit-reason').forEach(el => el.remove());

            if (isAiMode) {
                node.querySelectorAll('img').forEach(img => img.replaceWith(document.createTextNode('[IMG]')));
                node.querySelectorAll('a').forEach(a => {
                    if (REGEX.imgExt.test(a.href)) a.replaceWith(document.createTextNode('[IMG]'));
                });

                node.querySelectorAll('.post-block.quote').forEach(quote => {
                    const title = quote.querySelector('.block-title');
                    let ref = ">Цитата";
                    if (title) {
                        const link = title.querySelector('a[title="Перейти к сообщению"]');
                        if (link) {
                            const match = link.href.match(REGEX.pidFromLink);
                            if (match) {
                                const num = STATE.globalPidToNumMap.get(match[1]);
                                ref = num ? `>${num}` : `>#${match[1]}`;
                            }
                        }
                        if (ref === ">Цитата") {
                            const nick = title.innerText.split('@')[0].trim();
                            if (nick) ref = `>${nick}`;
                        }
                    }
                    quote.replaceWith(document.createTextNode(` ${ref} `));
                });
            } else {
                node.querySelectorAll('.post-block.quote').forEach(quote => {
                    const title = quote.querySelector('.block-title');
                    const body = quote.querySelector('.block-body');
                    if (title) {
                        const link = title.querySelector('a[title="Перейти к сообщению"]');
                        if(link) {
                            const match = link.href.match(REGEX.pidFromLink);
                            if(match) {
                                const num = STATE.globalPidToNumMap.get(match[1]);
                                link.replaceWith(document.createTextNode(num ? ` [ ${num} ]` : ` [ #${match[1]} ]`));
                            } else link.replaceWith(document.createTextNode(` [ ${link.href} ]`));
                        }
                        title.append(document.createTextNode('\n'));
                    }
                    if (body) {
                        let last = body.lastChild;
                        while(last && (last.tagName === 'BR' || (last.nodeType === 3 && !last.textContent.trim()))) {
                            const prev = last.previousSibling; last.remove(); last = prev;
                        }
                        body.prepend(document.createTextNode('«'));
                        body.append(document.createTextNode('»'));
                    }
                    quote.append(document.createTextNode('\n'));
                });
            }

            node.querySelectorAll('a[title="Перейти к сообщению"]').forEach(link => {
                const match = link.href.match(REGEX.pidFromLink);
                if (match) {
                    const num = STATE.globalPidToNumMap.get(match[1]);
                    const txt = isAiMode
                        ? (num ? `>${num} ` : `>#${match[1]} `)
                        : (num ? `>> ${num} ` : `>> #${match[1]} `);

                    if (isAiMode) {
                        let next = link.nextSibling;
                        while (next && next.nodeType === 3 && !next.textContent.trim()) {
                            let rm = next; next = next.nextSibling; rm.remove();
                        }
                        if (next && next.tagName === 'B') {
                            let rm = next; next = next.nextSibling; rm.remove();
                        }
                        if (next && next.nodeType === 3) {
                            next.textContent = next.textContent.replace(/^[\s,]+/, '');
                        }
                    }
                    link.replaceWith(document.createTextNode(txt));
                } else link.remove();
            });

            node.querySelectorAll('a').forEach(link => {
                const href = link.href;
                const text = link.innerText.trim();
                if (!href) return;

                if (isAiMode) {
                    if (REGEX.topicLinks.test(href)) {
                        if (text === href || text.toLowerCase() === 'ссылка' || text.toLowerCase() === 'здесь') {
                            link.replaceWith(document.createTextNode('[LINK]'));
                        } else {
                            link.innerText = `${text} [LINK]`;
                        }
                    } else {
                        const shortUrl = href.replace(REGEX.protocols, '');
                        if (text && text !== href && text !== shortUrl) link.innerText = `${text} [ ${shortUrl} ]`;
                        else link.innerText = `[ ${shortUrl} ]`;
                    }
                } else {
                    if (text && text !== href) link.innerText = `${text} [ ${href} ]`;
                    else link.innerText = `[ ${href} ]`;
                }
            });

            const listSep = isAiMode ? '; ' : '\n';
            node.querySelectorAll('li, .block-title').forEach(el => el.append(document.createTextNode(listSep)));

            const brRep = isAiMode ? ' ' : '\n';
            node.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode(brRep)));
        },

        cleanText(text, isAiMode) {
            text = text.replace(REGEX.resolutionInfo, '').replace(REGEX.sizeInfo, '').replace(REGEX.cleanImgs, '');
            if (isAiMode) {
                return text.replace(REGEX.multiSpaces, ' ').replace(REGEX.multiSemi, '; ').trim();
            } else {
                return text.replace(REGEX.multiNewlines, '\n\n');
            }
        }
    };

    // --- ENGINE ---
    const Engine = {
        async run(start, end, delay, threads, isAiMode) {
            if (STATE.isDownloading) return;

            const baseUrlMatch = window.location.href.split(/[?&]st=/)[0];
            if (baseUrlMatch.includes('?') && !baseUrlMatch.includes('showtopic=')) {
                alert('Скрипт работает только в теме!');
                return;
            }
            const baseUrl = baseUrlMatch.split('#')[0];

            STATE.isDownloading = true;
            STATE.saveOnStop = false; // Сброс флага сохранения
            UI.setControlsState(true);
            STATE.processedPostIds.clear();
            STATE.globalPidToNumMap.clear();

            let pagesContent = new Array(end - start + 1);

            for (let i = start; i <= end; i += threads) {
                // ПРОВЕРКА НА ОСТАНОВКУ
                if (!STATE.isDownloading) {
                    UI.setStatus("Остановка...");
                    break;
                }

                const batchPromises = [];
                const batchIndices = [];

                for (let t = 0; t < threads; t++) {
                    const pageNum = i + t;
                    if (pageNum > end) break;

                    batchIndices.push(pageNum);

                    const offset = (pageNum - 1) * 20;
                    const sep = baseUrl.includes('?') ? '&' : '?';
                    const url = `${baseUrl}${sep}st=${offset}`;

                    batchPromises.push(this.fetchPage(url).catch(err => {
                        console.error(`Err page ${pageNum}`, err);
                        return null;
                    }));
                }

                UI.setStatus(`Группа: ${batchIndices[0]}-${batchIndices[batchIndices.length-1]} / ${end}`);

                const results = await Promise.all(batchPromises);

                results.forEach((html, index) => {
                    const pageNum = batchIndices[index];
                    const arrayIndex = pageNum - start;

                    if (html) {
                        const parsed = Parser.parseHtml(html, pageNum, isAiMode);
                        pagesContent[arrayIndex] = parsed;
                    } else {
                        pagesContent[arrayIndex] = `\n[ОШИБКА ЗАГРУЗКИ СТР. ${pageNum}]\n`;
                    }
                });

                if (i + threads <= end) {
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            // ЛОГИКА ЗАВЕРШЕНИЯ
            if (STATE.isDownloading || STATE.saveOnStop) {
                UI.setStatus("Сборка файла...");
                // Фильтруем пустые элементы, если остановили на середине
                const finalString = pagesContent.filter(el => el !== undefined).join('');

                if (finalString.length > 0) {
                    this.saveFile(finalString, isAiMode);
                    UI.setStatus("Готово!");
                } else {
                    UI.setStatus("Ничего не скачано.");
                }
            } else {
                UI.setStatus("Отменено.");
            }

            STATE.isDownloading = false;
            UI.setControlsState(false);
        },

        async fetchPage(url) {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache' },
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            return new TextDecoder("windows-1251").decode(buffer);
        },

        saveFile(content, isAiMode) {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const link = document.createElement('a');
            const title = document.title.replace(/[|&;$%@"<>()+,]/g, "").trim();
            const prefix = isAiMode ? "AI_" : "THREAD_";
            link.href = URL.createObjectURL(blob);
            link.download = prefix + title.substring(0, 50) + ".txt";
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();
        },

        handleStartClick(isRemote) {
            const start = parseInt(document.getElementById('dl-start').value) || 1;
            const end = parseInt(document.getElementById('dl-end').value) || 99999;
            const threads = parseInt(document.getElementById('dl-threads').value) || 3;
            const delay = parseInt(document.getElementById('dl-delay').value) || 2000;
            const aiMode = document.getElementById('dl-ai-mode').checked;
            const broadcast = document.getElementById('dl-broadcast').checked;

            if (!isRemote && broadcast) {
                BC.postMessage({ type: 'START', start, end, delay, threads, aiMode });
            }

            const localEnd = Math.min(end, STATE.totalDetectedPages);
            this.run(start, localEnd, delay, threads, aiMode);
        }
    };

    BC.onmessage = (ev) => {
        if (ev.data.type === 'START' && !STATE.isDownloading) {
            const { start, end, delay, threads, aiMode } = ev.data;
            document.getElementById('dl-start').value = start;
            document.getElementById('dl-end').value = Math.min(end, STATE.totalDetectedPages);
            document.getElementById('dl-delay').value = delay;
            document.getElementById('dl-threads').value = threads;
            document.getElementById('dl-ai-mode').checked = aiMode;

            document.getElementById('dl-panel').style.display = 'block';
            setTimeout(() => Engine.handleStartClick(true), Math.random() * 2000);
        }
    };

    window.addEventListener('load', () => UI.init());

})();
