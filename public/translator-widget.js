(function (global) {
    'use strict';

    /**
     * Reusable Bilingual Translator Controller shared by:
     * 1) Inline Language Studio card (#languageTranslatorPanel)
     * 2) Global Extension Floating Drawer (#floatingTranslatorModal)
     * 3) Standalone Extension Popup Window (/translator-popup.html)
     */

    function copyTextFallback(text) {
        const str = String(text || '');
        if (!str) return Promise.resolve(false);
        if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(str).then(() => true).catch(() => copyExecFallback(str));
        }
        return Promise.resolve(copyExecFallback(str));
    }

    function copyExecFallback(str) {
        try {
            const ta = document.createElement('textarea');
            ta.value = str;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return Boolean(ok);
        } catch (_) {
            return false;
        }
    }

    function defaultResilientFetch(url, fetchOpts, { timeoutMs = 26000, externalSignal = null } = {}) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timedOut = false;
        const timer = controller && timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs)
            : null;

        const onExternalAbort = () => {
            if (controller) controller.abort();
        };
        if (externalSignal && typeof externalSignal.addEventListener === 'function') {
            if (externalSignal.aborted) controller && controller.abort();
            else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        return fetch(url, {
            ...fetchOpts,
            signal: controller ? controller.signal : externalSignal || undefined
        })
            .then(async (res) => {
                const rawText = await res.text();
                if (!res.ok) {
                    return {
                        ok: false,
                        aborted: false,
                        status: res.status,
                        data: null,
                        isNetworkIssue: res.status >= 500 || res.status === 0,
                        errorMessage: rawText && rawText.length < 220 && !/<[a-z][\s\S]*>/i.test(rawText)
                            ? rawText
                            : `Error del servidor (HTTP ${res.status}). Reintenta.`
                    };
                }
                try {
                    const parsed = rawText ? JSON.parse(rawText) : {};
                    return { ok: true, aborted: false, status: res.status, data: parsed, isNetworkIssue: false, errorMessage: '' };
                } catch (_) {
                    return {
                        ok: false,
                        aborted: false,
                        status: res.status,
                        data: null,
                        isNetworkIssue: true,
                        errorMessage: 'Respuesta incompleta del servidor por posible corte de red.'
                    };
                }
            })
            .catch((err) => {
                if (err && err.name === 'AbortError' && !timedOut && externalSignal && externalSignal.aborted) {
                    return { ok: false, aborted: true, status: 0, data: null, isNetworkIssue: false, errorMessage: '' };
                }
                if (timedOut) {
                    return {
                        ok: false,
                        aborted: false,
                        status: 0,
                        data: null,
                        isNetworkIssue: true,
                        errorMessage: 'Tiempo de espera agotado (red lenta o corte temporal). Reintenta.'
                    };
                }
                return {
                    ok: false,
                    aborted: false,
                    status: 0,
                    data: null,
                    isNetworkIssue: true,
                    errorMessage: 'Sin conexión estable con el servidor. Revisa tu Wi-Fi o datos móviles e intenta de nuevo.'
                };
            })
            .finally(() => {
                if (timer) clearTimeout(timer);
                if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
                    externalSignal.removeEventListener('abort', onExternalAbort);
                }
            });
    }

    function defaultLoadingNode(message) {
        const wrap = document.createElement('div');
        wrap.className = 'loading-banner';
        const sp = document.createElement('span');
        sp.className = 'spinner-circle';
        const txt = document.createElement('span');
        txt.textContent = message || 'Traduciendo...';
        wrap.append(sp, txt);
        return wrap;
    }

    function defaultFallbackCard(container, { title, message, onRetry }) {
        if (!container) return;
        const box = document.createElement('div');
        box.className = 'ai-network-fallback';

        const h = document.createElement('strong');
        h.textContent = `⚠️ ${title || 'Error temporal de conexión'}`;
        const p = document.createElement('small');
        p.textContent = message || 'No se pudo completar la traducción.';

        const actions = document.createElement('div');
        actions.className = 'ai-network-fallback-actions';
        if (typeof onRetry === 'function') {
            const btnRetry = document.createElement('button');
            btnRetry.type = 'button';
            btnRetry.className = 'btn-primary btn-small';
            btnRetry.textContent = '🔄 Reintentar';
            btnRetry.addEventListener('click', onRetry);
            actions.appendChild(btnRetry);
        }
        box.append(h, p, actions);
        container.replaceChildren(box);
        container.hidden = false;
    }

    function defaultButtonLock(btn, fn, { loadingText = 'Translating...' } = {}) {
        if (!btn) return Promise.resolve().then(fn);
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = loadingText;
        return Promise.resolve()
            .then(fn)
            .finally(() => {
                btn.disabled = false;
                btn.textContent = origText;
            });
    }

    function openPopupWindow({ text = '', dir = 'en_es', engine = 'auto', context = '' } = {}) {
        const params = new URLSearchParams();
        if (dir) params.set('dir', dir);
        if (engine) params.set('engine', engine);
        if (text) params.set('text', String(text).slice(0, 1200));
        if (context) params.set('context', String(context).slice(0, 250));
        const qs = params.toString();
        const url = qs ? `/translator-popup.html?${qs}` : '/translator-popup.html';
        const win = window.open(
            url,
            'pdhTranslatorExtensionWindow',
            'width=450,height=680,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
        );
        if (win && typeof win.focus === 'function') {
            win.focus();
        }
        return Boolean(win);
    }

    function renderTranslationCard(resultBox, data, { onSendToStudyForm, onToast } = {}) {
        if (!resultBox || !data) return;
        resultBox.replaceChildren();
        resultBox.hidden = false;

        const notify = typeof onToast === 'function' ? onToast : () => {};

        const headRow = document.createElement('div');
        headRow.className = 'lang-translator-footer';

        const dirBadge = document.createElement('span');
        dirBadge.className = 'lang-ai-badge';
        dirBadge.textContent = `${data.directionLabel || data.direction || 'Translation'}`;

        const engBadge = document.createElement('span');
        engBadge.className = 'lang-ai-badge';
        engBadge.textContent = data.engine === 'gemini'
            ? `🤖 Gemini (${data.model || 'gemini-2.5-flash'})`
            : '⚡ Instant Local Dictionary (0 MB RAM)';

        headRow.append(dirBadge, engBadge);
        resultBox.appendChild(headRow);

        const grid = document.createElement('div');
        grid.className = 'lang-translator-result-grid';

        const mainCard = document.createElement('div');
        mainCard.className = 'lang-translator-card';
        const mainLbl = document.createElement('small');
        mainLbl.className = 'muted-text';
        mainLbl.textContent = data.partOfSpeech ? `Translation (${data.partOfSpeech})` : 'Translation';
        const mainVal = document.createElement('div');
        mainVal.className = 'lang-translator-main-value';
        mainVal.textContent = data.translatedText || '';
        mainCard.append(mainLbl, mainVal);
        if (data.romanization) {
            const rom = document.createElement('div');
            rom.className = 'lang-translator-rom';
            rom.textContent = `Pronunciación / Romanization: ${data.romanization}`;
            mainCard.appendChild(rom);
        }
        grid.appendChild(mainCard);

        if (data.spanishMeaning || data.explanationEs || data.englishBridge) {
            const esCard = document.createElement('div');
            esCard.className = 'lang-translator-card';
            const esLbl = document.createElement('small');
            esLbl.className = 'muted-text';
            esLbl.textContent = 'Significado y explicación en Español';
            const esVal = document.createElement('div');
            esVal.className = 'lang-translator-main-value';
            esVal.textContent = data.spanishMeaning || data.translatedText || '';
            esCard.append(esLbl, esVal);

            if (data.englishBridge && data.direction !== 'ko_en') {
                const bridge = document.createElement('small');
                bridge.textContent = `English bridge: ${data.englishBridge}`;
                esCard.appendChild(bridge);
            }
            if (data.explanationEs) {
                const exp = document.createElement('small');
                exp.className = 'muted-text';
                exp.textContent = data.explanationEs;
                esCard.appendChild(exp);
            }
            grid.appendChild(esCard);
        }

        resultBox.appendChild(grid);

        if (data.literalMeaning) {
            const lit = document.createElement('small');
            lit.className = 'muted-text';
            lit.textContent = `Literal: ${data.literalMeaning}`;
            resultBox.appendChild(lit);
        }

        if (Array.isArray(data.alternatives) && data.alternatives.length) {
            const alts = document.createElement('small');
            alts.textContent = `Otras formas / matices: ${data.alternatives.join(' · ')}`;
            resultBox.appendChild(alts);
        }

        if (Array.isArray(data.examples) && data.examples.length) {
            const ex = document.createElement('small');
            ex.className = 'muted-text';
            ex.textContent = `Ejemplo: ${data.examples[0]}`;
            resultBox.appendChild(ex);
        }

        if (data.fallbackReason) {
            const warn = document.createElement('small');
            warn.className = 'muted-text';
            warn.textContent = data.fallbackReason;
            resultBox.appendChild(warn);
        }

        const footer = document.createElement('div');
        footer.className = 'lang-translator-footer';

        if (typeof onSendToStudyForm === 'function') {
            const sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.className = 'btn-secondary btn-small';
            sendBtn.textContent = '📝 Send to Vocabulary Study Form';
            sendBtn.addEventListener('click', () => onSendToStudyForm(data));
            footer.appendChild(sendBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn-secondary btn-small';
        copyBtn.textContent = '📋 Copy Translation';
        copyBtn.addEventListener('click', async () => {
            const txt = data.translatedText || '';
            const ok = await copyTextFallback(txt);
            notify(ok ? 'ok' : 'info', ok ? 'Translation copied to clipboard.' : `Translation: ${txt}`);
        });
        footer.appendChild(copyBtn);

        if (data.romanization) {
            const copyRomBtn = document.createElement('button');
            copyRomBtn.type = 'button';
            copyRomBtn.className = 'btn-secondary btn-small';
            copyRomBtn.textContent = '🔤 Copy Romanization';
            copyRomBtn.addEventListener('click', async () => {
                const ok = await copyTextFallback(data.romanization);
                notify(ok ? 'ok' : 'info', ok ? 'Romanization copied.' : data.romanization);
            });
            footer.appendChild(copyRomBtn);
        }

        resultBox.appendChild(footer);
    }

    function mountTranslatorInstance(config) {
        const {
            panel,
            dirPills = [],
            dirSelect,
            engineSelect,
            inputEl,
            contextEl,
            btnRun,
            btnPaste,
            btnClear,
            btnPopout,
            resultBox,
            fetchJsonFn = defaultResilientFetch,
            buttonLockFn = defaultButtonLock,
            renderFallbackFn = defaultFallbackCard,
            createLoadingFn = defaultLoadingNode,
            onMemoryUpdate,
            onSendToStudyForm,
            onToast,
            onUnauthorized
        } = config || {};

        if (!panel || panel.dataset.wired === 'true') return null;
        panel.dataset.wired = 'true';

        const notify = typeof onToast === 'function' ? onToast : () => {};
        let lastTranslation = null;
        let seqCounter = 0;
        let activeController = null;

        const setDirection = (dir) => {
            const chosen = String(dir || 'en_es');
            if (dirSelect) dirSelect.value = chosen;
            dirPills.forEach(p => {
                p.classList.toggle('active', p.getAttribute('data-dir') === chosen);
            });
        };

        dirPills.forEach(pill => {
            pill.addEventListener('click', () => {
                setDirection(pill.getAttribute('data-dir'));
                if (inputEl && !inputEl.value.trim()) inputEl.focus();
            });
        });

        if (dirSelect) {
            dirSelect.addEventListener('change', () => setDirection(dirSelect.value));
        }

        const triggerTranslate = () => {
            if (!btnRun) return;
            const text = (inputEl && inputEl.value ? inputEl.value : '').trim();
            if (!text) {
                notify('err', 'Type a word, phrase, or lyric line to translate.');
                if (inputEl) inputEl.focus();
                return;
            }
            const direction = (dirSelect && dirSelect.value) || 'en_es';
            const mode = (engineSelect && engineSelect.value) || 'auto';
            const context = (contextEl && contextEl.value ? contextEl.value : '').trim();

            const mySeq = ++seqCounter;
            if (activeController) activeController.abort();
            activeController = typeof AbortController === 'function' ? new AbortController() : null;

            if (resultBox) {
                resultBox.hidden = false;
                resultBox.replaceChildren(createLoadingFn('Traduciendo...', 'sm'));
            }

            buttonLockFn(btnRun, async () => {
                const resp = await fetchJsonFn('/api/language/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, direction, mode, context })
                }, { timeoutMs: 26000, externalSignal: activeController ? activeController.signal : null });

                if (resp.aborted || mySeq !== seqCounter) return;

                if (resp.status === 401 || resp.status === 403) {
                    if (typeof onUnauthorized === 'function') onUnauthorized(resp);
                    notify('err', resp.errorMessage || 'Session required. Sign in on Daily Hub.');
                    return;
                }

                if (!resp.ok || !resp.data) {
                    renderFallbackFn(resultBox, {
                        title: 'No se pudo completar la traducción por red',
                        message: resp.errorMessage,
                        sampleText: text,
                        onRetry: triggerTranslate
                    });
                    notify('err', resp.errorMessage);
                    return;
                }

                const data = resp.data;
                lastTranslation = data;
                if (data.languageMemory && typeof onMemoryUpdate === 'function') {
                    onMemoryUpdate(data.languageMemory);
                }
                renderTranslationCard(resultBox, data, {
                    onSendToStudyForm: onSendToStudyForm ? () => onSendToStudyForm(lastTranslation) : null,
                    onToast: notify
                });
            }, { loadingText: 'Translating...' });
        };

        if (btnRun) btnRun.addEventListener('click', triggerTranslate);

        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    triggerTranslate();
                }
            });
        }
        if (contextEl) {
            contextEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.isComposing) {
                    e.preventDefault();
                    triggerTranslate();
                }
            });
        }

        if (btnPaste) {
            btnPaste.addEventListener('click', async () => {
                if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
                    notify('info', 'Presiona Ctrl+V en el cuadro de texto para pegar (HTTP restringe lectura automática del portapapeles).');
                    if (inputEl) inputEl.focus();
                    return;
                }
                try {
                    const clip = await navigator.clipboard.readText();
                    if (clip && clip.trim() && inputEl) {
                        inputEl.value = clip.trim().slice(0, 4000);
                        triggerTranslate();
                    } else {
                        notify('info', 'Clipboard is empty — paste with Ctrl+V.');
                        if (inputEl) inputEl.focus();
                    }
                } catch (_) {
                    notify('info', 'Browser denied clipboard read — paste with Ctrl+V here.');
                    if (inputEl) inputEl.focus();
                }
            });
        }

        if (btnClear) {
            btnClear.addEventListener('click', () => {
                if (inputEl) inputEl.value = '';
                if (contextEl) contextEl.value = '';
                if (resultBox) {
                    resultBox.hidden = true;
                    resultBox.replaceChildren();
                }
                lastTranslation = null;
                if (inputEl) inputEl.focus();
            });
        }

        if (btnPopout) {
            btnPopout.addEventListener('click', () => {
                const opened = openPopupWindow({
                    text: inputEl ? inputEl.value.trim() : '',
                    dir: dirSelect ? dirSelect.value : 'en_es',
                    engine: engineSelect ? engineSelect.value : 'auto',
                    context: contextEl ? contextEl.value.trim() : ''
                });
                if (!opened) {
                    notify('err', 'Tu navegador bloqueó la ventana emergente. Permite popups para este sitio.');
                }
            });
        }

        return {
            triggerTranslate,
            setDirection,
            setEngine(engine) {
                if (engineSelect && engine) engineSelect.value = engine;
            },
            setInputText(txt) {
                if (inputEl && typeof txt === 'string') inputEl.value = txt;
            },
            setContextText(txt) {
                if (contextEl && typeof txt === 'string') contextEl.value = txt;
            },
            focusInput() {
                if (inputEl) inputEl.focus();
            },
            getLastTranslation() {
                return lastTranslation;
            }
        };
    }

    global.DailyHubTranslator = {
        mountTranslatorInstance,
        renderTranslationCard,
        openPopupWindow,
        copyTextFallback
    };
})(window);
