(function () {
    try {
        var saved = localStorage.getItem('mt_theme');
        var resolved = saved === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', resolved);
    } catch (_) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();
