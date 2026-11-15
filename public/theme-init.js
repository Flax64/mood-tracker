(function () {
    try {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
        localStorage.removeItem('mt_theme');
    } catch (_) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    try {
        var savedLang = localStorage.getItem('pdh_ui_lang_v1');
        var lang = savedLang === 'es' ? 'es' : 'en';
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('data-lang', lang);
    } catch (_) {
        document.documentElement.setAttribute('lang', 'en');
        document.documentElement.setAttribute('data-lang', 'en');
    }
})();
