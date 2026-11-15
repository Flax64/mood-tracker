(function () {
    'use strict';

    function popupTr(en, es) {
        if (window.DailyHubI18n && typeof window.DailyHubI18n.pick === 'function') {
            return window.DailyHubI18n.pick(en, es);
        }
        return en;
    }

    function showPopupToast(type, message) {
        const container = document.getElementById('popupToastContainer');
        if (!container || !message) return;
        const toast = document.createElement('div');
        toast.className = `app-toast app-toast-${type || 'info'}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }

    function sendDraftToMainHub(data) {
        if (!data) return;
        const payload = {
            type: 'pdh_translator_send_vocab',
            translation: data
        };
        try {
            localStorage.setItem('pdh_pending_translator_vocab', JSON.stringify(data));
        } catch (_) {}
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.postMessage(payload, window.location.origin);
                if (typeof window.opener.focus === 'function') window.opener.focus();
                showPopupToast('ok', popupTr(
                    'Sent to Glossary Study Form in your Main Hub tab!',
                    '¡Enviado al formulario de estudio en tu pestaña principal!'
                ));
                return;
            } catch (_) {}
        }
        showPopupToast('ok', popupTr(
            'Saved for Glossary! Open your Main Hub tab and it will load automatically.',
            '¡Guardado para el glosario! Abre tu pestaña principal y se cargará automáticamente.'
        ));
    }

    async function checkPopupAuth() {
        const notice = document.getElementById('popupAuthNotice');
        const badge = document.getElementById('popupStatusBadge');
        try {
            const res = await fetch('/api/auth/me', { cache: 'no-store' });
            if (res.ok) {
                const payload = await res.json();
                if (notice) notice.hidden = true;
                if (badge && payload && payload.user) {
                    badge.textContent = payload.user.rol === 'admin'
                        ? popupTr('Connected · Gemini + 0-RAM', 'Conectado · Gemini + 0-RAM')
                        : popupTr('Admin account required', 'Se requiere cuenta Admin');
                    if (payload.user.rol !== 'admin' && notice) notice.hidden = false;
                }
                return true;
            }
        } catch (_) {}
        if (notice) notice.hidden = false;
        if (badge) badge.textContent = popupTr('Sign in required', 'Inicia sesión');
        return false;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        try {
            localStorage.removeItem('mt_theme');
        } catch {
            // ignore
        }

        const btnRetryAuth = document.getElementById('btnPopupRetryAuth');
        if (btnRetryAuth) {
            btnRetryAuth.addEventListener('click', checkPopupAuth);
        }

        if (window.DailyHubI18n && typeof window.DailyHubI18n.onChange === 'function') {
            window.DailyHubI18n.onChange(() => {
                checkPopupAuth();
            });
        }

        const panel = document.getElementById('popupTranslatorPanel');
        const widgetApi = window.DailyHubTranslator;
        if (!widgetApi || !panel) return;

        const controller = widgetApi.mountTranslatorInstance({
            panel,
            dirPills: Array.from(panel.querySelectorAll('#popupDirPills [data-dir]')),
            dirSelect: document.getElementById('popupDirectionSelect'),
            engineSelect: document.getElementById('popupEngineSelect'),
            inputEl: document.getElementById('popupTranslatorInput'),
            contextEl: document.getElementById('popupContextInput'),
            btnRun: document.getElementById('btnRunPopupTranslator'),
            btnPaste: document.getElementById('btnPopupPaste'),
            btnClear: document.getElementById('btnPopupClear'),
            resultBox: document.getElementById('popupTranslatorResultBox'),
            onSendToStudyForm: sendDraftToMainHub,
            onToast: showPopupToast,
            onUnauthorized: () => {
                const notice = document.getElementById('popupAuthNotice');
                if (notice) notice.hidden = false;
            }
        });

        const params = new URLSearchParams(window.location.search);
        const initDir = params.get('dir');
        const initEngine = params.get('engine');
        const initText = params.get('text');
        const initCtx = params.get('context');

        if (controller) {
            if (initDir) controller.setDirection(initDir);
            if (initEngine) controller.setEngine(initEngine);
            if (initCtx) controller.setContextText(initCtx);
            if (initText) {
                controller.setInputText(initText);
                checkPopupAuth().then((authed) => {
                    if (authed) controller.triggerTranslate();
                });
            } else {
                checkPopupAuth();
            }
            controller.focusInput();
        }
    });
})();
