/* ==========================================================================
   public/i18n.js — Full Bilingual Engine (English <-> Español)
   Synchronizes UI language across index.html, translator-popup.html,
   dynamic JS renderers, widgets, and server/AI feedback while keeping
   database keys & user-entered notes 100% untouched.
   ========================================================================== */
(function (root) {
    'use strict';

    var STORAGE_KEY = 'pdh_ui_lang_v1';

    function normalizeLang(raw) {
        return String(raw || '').trim().toLowerCase() === 'es' ? 'es' : 'en';
    }

    var currentLang = 'en';
    try {
        currentLang = normalizeLang(root.localStorage ? root.localStorage.getItem(STORAGE_KEY) : 'en');
    } catch (_) {
        currentLang = 'en';
    }

    var listeners = new Set();
    var nodeOriginals = typeof WeakMap === 'function' ? new WeakMap() : null;
    var attrPrefix = 'i18nOrig_';
    var isApplyingDom = false;
    var pendingRoots = new Set();
    var rafScheduled = false;
    var observerStarted = false;

    function normKey(str) {
        return String(str || '').replace(/\s+/g, ' ').trim();
    }

    /* ------------------------------------------------------------------
       Canonical [English, Español] Dictionary Pairs
       Every entry is bidirectional and normalizes legacy mixed-language
       strings cleanly in both directions.
       ------------------------------------------------------------------ */
    var PAIRS = [
        // --- App Title, Auth, Boot & Security Pills ---
        ['Personal Daily Hub', 'Personal Daily Hub'],
        ['Checking session...', 'Verificando sesión...'],
        ['🔐 Wire Tunnel: Connecting...', '🔐 Privacidad: Conectando...'],
        ['🔐 Privacidad: Conectando...', '🔐 Privacidad: Conectando...'],
        ['Sign in to access your workspace', 'Inicia sesión para acceder a tu espacio'],
        ['Sign in to continue', 'Inicia sesión para continuar'],
        ['Verified account registration', 'Registro de cuenta verificada'],
        ['Email address:', 'Correo electrónico:'],
        ['Password:', 'Contraseña:'],
        ['Sign In', 'Iniciar Sesión'],
        ['Forgot your password?', '¿Olvidaste tu contraseña?'],
        ['First-time registration', 'Registro por primera vez'],
        ['First-time registration and verification', 'Registro y verificación por primera vez'],
        ['Full name:', 'Nombre completo:'],
        ['Create password (8–128 chars, letters & numbers):', 'Crea una contraseña (8–128 caracteres, letras y números):'],
        ['Identity verification (owner):', 'Verificación de identidad (propietario):'],
        ['📧 Send code to owner email', '📧 Enviar código al correo del propietario'],
        ['Verify & Create Account', 'Verificar y Crear Cuenta'],
        ['⬅ Back to Sign In', '⬅ Volver a Iniciar Sesión'],
        ['Your registered email:', 'Tu correo registrado:'],
        ['Email password recovery', 'Recuperación de contraseña por correo'],
        ['We will email you a password reset link', 'Te enviaremos un enlace de restablecimiento a tu correo'],
        ['We will send a secure link valid for 30 minutes to reset your password.', 'Enviaremos un enlace seguro válido por 30 minutos para restablecer tu contraseña.'],
        ['Send reset link to my email', 'Enviar enlace a mi correo'],
        ['Email:', 'Correo:'],
        ['New password (8–128 chars, letters & numbers):', 'Nueva contraseña (8–128 caracteres, letras y números):'],
        ['Confirm new password:', 'Confirmar nueva contraseña:'],
        ['Save New Password', 'Guardar Nueva Contraseña'],
        ['⬅ Cancel', '⬅ Cancelar'],
        ['Two-step email verification', 'Verificación en dos pasos por correo'],
        ['your email', 'tu correo'],
        ['Enter the 6-digit security code valid for 10 minutes.', 'Ingresa el código de seguridad de 6 dígitos (válido 10 minutos).'],
        ['Verify & Sign In', 'Verificar e Iniciar Sesión'],
        ['Signing out...', 'Cerrando sesión...'],

        // --- Placeholders & ARIA (Auth) ---
        ['example@email.com', 'ejemplo@correo.com'],
        ['Your password', 'Tu contraseña'],
        ['Show password', 'Mostrar contraseña'],
        ['Hide password', 'Ocultar contraseña'],
        ['e.g. Flavio / Dr. Smith', 'ej. Flavio / Dr. García'],
        ['email@gmail.com', 'correo@gmail.com'],
        ['At least 8 characters with letters and numbers', 'Al menos 8 caracteres con letras y números'],
        ['6-digit email code or your personal secret key', 'Código de 6 dígitos o tu clave secreta personal'],
        ['your_email@gmail.com', 'tu_correo@gmail.com'],
        ['New password', 'Nueva contraseña'],
        ['Repeat password', 'Repetir contraseña'],
        ['6-digit code', 'Código de 6 dígitos'],
        ['Show code', 'Mostrar código'],
        ['Simulated HTTPS X25519 + AES-256-CTR + HMAC-SHA256', 'Conexión segura y cifrada de extremo a extremo'],
        ['Simulated HTTPS: X25519 + AES-256-CTR + HMAC-SHA256', 'Protección de privacidad y cifrado de extremo a extremo'],
        ['Open menu', 'Abrir menú'],
        ['Close menu', 'Cerrar menú'],
        ['Main menu', 'Menú principal'],
        ['Collapse or expand sidebar', 'Colapsar o expandir barra lateral'],
        ['View Encrypted HTTP Transport Diagnostics', 'Ver estado de seguridad y conexión'],
        ['Switch UI language (English / Español)', 'Cambiar idioma de interfaz (English / Español)'],

        // --- Sidebar & Navigation ---
        ['Home', 'Inicio'],
        ['🔐 E2E', '🔐 E2E'],
        ['Daily Hub', 'Daily Hub'],
        ['Personal Control', 'Control Personal'],
        ['Personal Control Hub', 'Centro de Control Personal'],
        ['Daily Logs', 'Registros Diarios'],
        ['Mood Tracker', 'Estado de Ánimo'],
        ['Crisis Log', 'Bitácora de Crisis'],
        ['Sleep Tracker', 'Registro de Sueño'],
        ['Journal Notes', 'Notas de Diario'],
        ['English Notebook', 'Cuaderno de Idiomas'],
        ['Language Studio', 'Estudio de Idiomas'],
        ['Quick Translator', 'Traductor Rápido'],
        ['Floating Translator Extension (Alt+T)', 'Extensión de Traductor Flotante (Alt+T)'],
        ['Open Quick Bilingual Translator (Alt+T)', 'Abrir Traductor Bilingüe Rápido (Alt+T)'],
        ['Open translator', 'Abrir traductor'],
        ['Planning & Reports', 'Agenda y Reportes'],
        ['Weekly Agenda', 'Agenda Semanal'],
        ['ITS, Residencias & Work', 'ITS, Residencias y Trabajo'],
        ['Weekly Summary', 'Resumen Semanal'],
        ['Psychiatrist Access', 'Acceso Psiquiatra'],
        ['Settings', 'Ajustes'],
        ['Settings & Reminders', 'Ajustes y Recordatorios'],
        ['Visual Guide', 'Guía Visual'],
        ['📖 Visual Guide', '📖 Guía Visual'],
        ['Visual User Guide — Personal Daily Hub', 'Guía Visual de Usuario — Personal Daily Hub'],
        ['User', 'Usuario'],
        ['Moment: --', 'Momento: --'],
        ['Wire: Connecting...', 'Cifrado: Conectando...'],
        ['Cifrado: Conectando...', 'Cifrado: Conectando...'],
        ['Sign Out', 'Cerrar Sesión'],
        ['Owner (Admin)', 'Propietario (Admin)'],
        ['Psychiatrist Mode (Read-Only)', 'Modo Psiquiatra (Solo Lectura)'],
        ['Admin / Owner', 'Admin / Propietario'],
        ['Psychiatrist (read-only)', 'Psiquiatra (solo lectura)'],

        // --- Home View ---
        ['Current moment', 'Momento actual'],
        ['Welcome!', '¡Bienvenido!'],
        ['+ Log Mood', '+ Registrar Ánimo'],
        ['🗓️ View Agenda', '🗓️ Ver Agenda'],
        ['⚙️ Settings', '⚙️ Ajustes'],
        ["Today's Summary", 'Resumen de Hoy'],
        ["Loading today's records...", 'Cargando registros de hoy...'],
        ['Go to Mood Tracker →', 'Ir a Estado de Ánimo →'],
        ['Sleep', 'Sueño'],
        ["Loading today's sleep log...", 'Cargando registro de sueño de hoy...'],
        ['Go to Sleep Tracker →', 'Ir a Registro de Sueño →'],
        ["Today's Agenda", 'Agenda de Hoy'],
        ["Loading today's activities...", 'Cargando actividades de hoy...'],
        ['Go to Weekly Agenda →', 'Ir a Agenda Semanal →'],
        ['All Features', 'Todas las Funciones'],
        ['Log how you feel at each time of day (including late night).', 'Registra cómo te sientes en cada bloque del día (incluida la madrugada).'],
        ['Record stress, anger, or panic episodes with time & Spanish reason for your psychiatrist.', 'Registra episodios de estrés, ira o pánico con hora exacta y motivo en español para tu psiquiatra.'],
        ['Calculate your sleep duration and rest quality upon waking.', 'Calcula tu duración de sueño y calidad de descanso al despertar.'],
        ['Send your E2EE encrypted thoughts directly to Word on your PC.', 'Envía tus pensamientos cifrados E2EE directo al documento Word en tu PC.'],
        ['Save new vocabulary, grammar notes, and phrasal verbs to your Word notebook.', 'Guarda vocabulario, gramática, phrasal verbs y análisis de canciones en tu Word.'],
        ['Manage University & Personal events and Jira-style tasks (To Do, In Progress, Done).', 'Administra eventos de Universidad y Personales y tareas por estado (Por hacer, En progreso, Hecho).'],
        ['Manage University & Personal events, recurring routines, and tasks (To Do, In Progress, Done).', 'Administra eventos de Universidad y Personales, rutinas repetitivas y tareas (Por hacer, En progreso, Hecho).'],
        ['ITS Schedule, Residencias & Work', 'Horario ITS, Residencias y Trabajo'],
        ['Track Tec de Saltillo semesters, classrooms (R02, R11, N21), vacations, residencias, work shifts, and Maps traffic alerts.', 'Gestiona semestres del Tec de Saltillo, salones (R02, R11, N21), vacaciones, residencias, turnos de trabajo y alertas de tráfico en Maps.'],
        ['View your weekly mood color grid and sleep overview.', 'Consulta tu matriz semanal de emociones, sueño y crisis.'],
        ['Manage read-only accounts for your doctor or clinician.', 'Administra cuentas de solo lectura para tu médico o psicóloga.'],
        ['Configure phone notifications, automatic reminders, English study alerts, and theme.', 'Configura notificaciones al celular, recordatorios, estudio de idiomas y preferencias (modo oscuro permanente).'],
        ['Configure phone notifications, automatic reminders, English study alerts, and language.', 'Configura notificaciones al celular, recordatorios automáticos, alertas de estudio e idioma.'],

        // --- Mood Tracker ---
        ['My Mood Tracker', 'Mi Estado de Ánimo'],
        ["Pick your time block and current emotion. You can update today's current entry while its edit window stays open.", 'Elige el bloque del día y tu emoción actual. Puedes actualizar el registro actual mientras siga abierta su ventana de edición.'],
        ['📈 Weekly Summary', '📈 Resumen Semanal'],
        ['Date:', 'Fecha:'],
        ['Time of day:', 'Momento del día:'],
        ['Select a time of day...', 'Selecciona un momento del día...'],
        ['Late Night (00:00 - 05:59)', 'Madrugada (00:00 - 05:59)'],
        ['Morning (06:00 - 11:59)', 'Mañana (06:00 - 11:59)'],
        ['Noon (12:00 - 13:59)', 'Mediodía (12:00 - 13:59)'],
        ['Afternoon (14:00 - 19:59)', 'Tarde (14:00 - 19:59)'],
        ['Night (20:00 - 23:59)', 'Noche (20:00 - 23:59)'],
        ['How are you feeling right now? *', '¿Cómo te sientes en este momento? *'],
        ['No mood selected yet', 'Aún no seleccionas una emoción'],
        ['Happy', 'Feliz'],
        ['Calm', 'Tranquilo/a'],
        ['Excited', 'Emocionado/a'],
        ['Tired', 'Cansado/a'],
        ['Sad', 'Triste'],
        ['Angry', 'Enojado/a'],
        ['Worried', 'Preocupado/a'],
        ['Scared', 'Asustado/a'],
        ['Focused', 'Concentrado/a'],
        ['Motivated', 'Motivado/a'],
        ['Stressed', 'Estresado/a'],
        ['Frustrated', 'Frustrado/a'],
        ['Bored', 'Aburrido/a'],
        ['Anxious', 'Ansioso/a'],
        ['Distracted', 'Distraído/a'],
        ['Desperate', 'Desesperado/a'],
        ['HAPPY', 'FELIZ'],
        ['CALM', 'TRANQUILO/A'],
        ['EXCITED', 'EMOCIONADO/A'],
        ['TIRED', 'CANSADO/A'],
        ['SAD', 'TRISTE'],
        ['ANGRY', 'ENOJADO/A'],
        ['WORRIED', 'PREOCUPADO/A'],
        ['SCARED', 'ASUSTADO/A'],
        ['FOCUSED', 'CONCENTRADO/A'],
        ['MOTIVATED', 'MOTIVADO/A'],
        ['STRESSED', 'ESTRESADO/A'],
        ['FRUSTRATED', 'FRUSTRADO/A'],
        ['BORED', 'ABURRIDO/A'],
        ['ANXIOUS', 'ANSIOSO/A'],
        ['DISTRACTED', 'DISTRAÍDO/A'],
        ['DESPERATE', 'DESESPERADO/A'],
        ['Save Mood Entry', 'Guardar Estado de Ánimo'],
        ["Today's Check-ins", 'Registros de Hoy'],
        ['Tap any block below to select that time of day in the form.', 'Toca cualquier bloque abajo para seleccionarlo en el formulario.'],
        ["Loading today's mood entries...", 'Cargando registros de ánimo de hoy...'],
        ['Not logged', 'Sin registrar'],

        // --- Crisis Log ---
        ['Crisis & Episode Log (Clinical Journal)', 'Bitácora de Crisis y Episodios'],
        ['Crisis & Episode Log (Bitácora Clínica)', 'Bitácora de Crisis y Episodios (Clínica)'],
        ['Log date, exact time, intensity, and trigger context if you experienced stress, anger, rage, or anxiety. Your psychiatrist or psychologist can review it in read-only mode.', 'Registra fecha, hora exacta y motivo en español si tuviste una crisis de estrés, ira, rabia o ansiedad. Tu psiquiatra o psicóloga podrá consultarlo en modo solo lectura en el Resumen Semanal.'],
        ['Registra fecha, hora exacta y motivo en español si tuviste una crisis de estrés, ira, rabia o ansiedad. Tu psiquiatra o psicóloga podrá consultarlo en modo solo lectura en el Resumen Semanal.', 'Registra fecha, hora exacta y motivo en español si tuviste una crisis de estrés, ira, rabia o ansiedad. Tu psiquiatra o psicóloga podrá consultarlo en modo solo lectura en el Resumen Semanal.'],
        ['📈 Weekly Clinician View', '📈 Vista Semanal Clínica'],
        ['Date (Fecha):', 'Fecha:'],
        ['Exact Time:', 'Hora exacta:'],
        ['Time (Hora exacta):', 'Hora exacta:'],
        ['⏱️ Now', '⏱️ Ahora'],
        ['Episode Type:', 'Tipo de episodio:'],
        ['Crisis Type (Tipo de episodio):', 'Tipo de episodio:'],
        ['Tipo de crisis', 'Tipo de episodio'],
        ['Intensidad de crisis', 'Intensidad de la crisis'],
        ['😣 Stress', '😣 Estrés'],
        ['😣 Estrés', '😣 Estrés'],
        ['😠 Anger / Rage', '😠 Ira / Rabia'],
        ['😠 Ira / Rabia', '😠 Ira / Rabia'],
        ['😰 Anxiety', '😰 Ansiedad'],
        ['😰 Ansiedad', '😰 Ansiedad'],
        ['🫨 Panic', '🫨 Pánico'],
        ['🫨 Pánico', '🫨 Pánico'],
        ['😢 Crying / Overload', '😢 Llanto / Sobrecarga'],
        ['😢 Llanto / Sobrecarga', '😢 Llanto / Sobrecarga'],
        ['🧱 Shutdown / Overwhelmed', '🧱 Bloqueo / Saturación'],
        ['🧱 Bloqueo / Saturación', '🧱 Bloqueo / Saturación'],
        ['🌘 Insomnia / Restlessness', '🌘 Insomnio / Agitación'],
        ['🌘 Insomnio / Agitación', '🌘 Insomnio / Agitación'],
        ['📝 Other', '📝 Otro'],
        ['📝 Otro', '📝 Otro'],
        ['Intensity Level (1–5):', 'Nivel de intensidad (1–5):'],
        ['Intensity Level (Nivel de intensidad 1–5):', 'Nivel de intensidad (1–5):'],
        ['1 · Mild', '1 · Leve'],
        ['1 · Leve', '1 · Leve'],
        ['2 · Moderate', '2 · Moderada'],
        ['2 · Moderada', '2 · Moderada'],
        ['3 · Strong', '3 · Fuerte'],
        ['3 · Fuerte', '3 · Fuerte'],
        ['4 · Very Strong', '4 · Muy Fuerte'],
        ['4 · Muy Fuerte', '4 · Muy Fuerte'],
        ['5 · Severe', '5 · Severa'],
        ['5 · Severa', '5 · Severa'],
        ['Reason & Trigger Context:', 'Motivo y detonante (en español):'],
        ['Reason / Context in Spanish (Motivo y detonante):', 'Motivo y detonante (en español):'],
        ['Describe what triggered the episode, how it felt, and anything that helped calm it (Ctrl + Enter to save)...', 'Describe en español qué detonó la crisis, cómo se sintió y si algo ayudó a calmarla (Ctrl + Enter para guardar)...'],
        ['Describe en español qué detonó la crisis, cómo se sintió y si algo ayudó a calmarla (Ctrl + Enter para guardar)...', 'Describe en español qué detonó la crisis, cómo se sintió y si algo ayudó a calmarla (Ctrl + Enter para guardar)...'],
        ['Save Crisis Entry', 'Guardar Crisis'],
        ['Recent Crisis Log', 'Registros Recientes de Crisis'],
        ['Entries appear automatically in Weekly Summary for your psychiatrist/psychologist in read-only mode.', 'Los registros aparecen automáticamente en el Resumen Semanal para tu psiquiatra/psicóloga en modo solo lectura.'],
        ['Loading recent crisis logs...', 'Cargando registros recientes de crisis...'],

        // --- Sleep & Desvelo Tracker ---
        ['Sleep & Desvelo Tracker', 'Registro de Sueño y Desvelos'],
        ['Log bedtime, wake-up time, late-night bedtimes (e.g. 3:00 AM), or all-nighters (Desvelo). Late-night patterns and notes are shared with your psychiatrist.', 'Registra hora de dormir, despertar, desvelos de madrugada (ej. 3:00 AM) o noches sin dormir. Los patrones de desvelo se comparten con tu psiquiatra.'],
        ['Entry Type:', 'Tipo de registro:'],
        ['Sleep or desvelo entry type', 'Tipo de registro de sueño o desvelo'],
        ['🌙 Sleep Session', '🌙 Sesión de Sueño'],
        ['🦉 Desvelo / Late Bedtime (e.g. 3 AM)', '🦉 Desvelo / Dormido tarde (ej. 3 AM)'],
        ['⚡ All-Nighter / No Sleep (0 hrs)', '⚡ Desvelo Total / Sin dormir (0 hrs)'],
        ['Date of rest / wake-up:', 'Fecha de descanso / despertar:'],
        ['Yesterday', 'Ayer'],
        ['Today', 'Hoy'],
        ['Fell asleep at:', 'Me dormí a las:'],
        ['Stayed awake / Desvelo time (optional):', 'Hora aproximada de desvelo (opcional):'],
        ['Use current time', 'Usar hora actual'],
        ['Woke up at:', 'Desperté a las:'],
        ['⏳ Going to sleep just now (e.g. 3:00 AM) — log bedtime immediately and add wake-up time later', '⏳ Me voy durmiendo ahorita (ej. 3:00 AM) — guardar hora de dormir y completar al despertar'],
        ['Calculated sleep duration', 'Duración total de sueño'],
        ['Total hours of sleep', 'Horas totales de sueño'],
        ['-- hrs -- min', '-- hrs -- min'],
        ['How did this rest feel? *', '¿Cómo se sintió el descanso? *'],
        ['Sleep quality quick choices', 'Calidad del descanso'],
        ['🟢 Restorative', '🟢 Reparador'],
        ['🟡 Fair / Light', '🟡 Regular / Ligero'],
        ['🔴 Poor / Heavy', '🔴 Malo / Pesado'],
        ['Select an option...', 'Selecciona una opción...'],
        ['🟢 Good / Restorative', '🟢 Bueno / Reparador'],
        ['Desvelo Note / Reason (optional · visible to psychiatrist):', 'Motivo / Nota del desvelo (opcional · visible para el psiquiatra):'],
        ['Motivo / Nota del desvelo (opcional · visible para el psiquiatra):', 'Motivo / Nota del desvelo (opcional · visible para el psiquiatra):'],
        ['e.g. Fell asleep at 3:00 AM due to insomnia, anxiety, or project work; or stayed awake all night...', 'Ej: Me dormí hasta las 3:00 AM por insomnio, ansiedad o proyecto; o pasé la noche en vela...'],
        ['Ej: Me dormí hasta las 3:00 AM por insomnio, ansiedad o proyecto; o pasé la noche en vela...', 'Ej: Me dormí hasta las 3:00 AM por insomnio, ansiedad o proyecto; o pasé la noche en vela...'],
        ['Log Sleep Session', 'Guardar Sesión de Sueño'],
        ['Log Sleep & Desvelo', 'Guardar Sueño / Desvelo'],
        ['Save Late Bedtime Now', 'Guardar Desvelo Ahora'],
        ['Log All-Nighter (0 hrs Desvelo)', 'Registrar Desvelo Total (0 hrs)'],
        ['Complete Sleep Wake-Up', 'Completar Hora de Despertar'],
        ["Today's Sleep Summary", 'Resumen de Sueño de Hoy'],
        ['Desvelo & Intermittent', 'Desvelos e Intermitente'],

        // --- Journal Notes ---
        ['Write freely in English. Your note is encrypted end-to-end (E2EE) in this browser before queuing for Word on your PC.', 'Escribe libremente en inglés. Tu nota se cifra de extremo a extremo (E2EE) en el navegador antes de enviarse a Word en tu PC.'],
        ['🔑 E2EE Key', '🔑 Llave E2EE'],
        ['0 words · 0 chars', '0 palabras · 0 caracteres'],
        ['Clear draft', 'Limpiar borrador'],
        ['Title / Label (optional):', 'Título / Etiqueta (opcional):'],
        ['Daily Reflection', 'Reflexión Diaria'],
        ['ITS University', 'Universidad ITS'],
        ['Residencias', 'Residencias'],
        ['Work Log', 'Bitácora de Trabajo'],
        ['e.g. Daily Reflection, ITS Project Progress, Work Notes...', 'ej. Reflexión diaria, Avance proyecto ITS, Notas de trabajo...'],
        ['Description / Journal Entry (English):', 'Descripción / Entrada de Diario (Inglés):'],
        ['Write your thoughts here in English... Your unfinished draft stays safe in this browser until you send it.', 'Escribe tus pensamientos aquí en inglés... Tu borrador permanece guardado localmente en este navegador hasta enviarlo.'],
        ['✓ English Spelling & Grammar: Ready', '✓ Ortografía y Gramática en Inglés: Listo'],
        ['✨ Apply All Fixes', '✨ Aplicar Correcciones'],
        ['Encrypt E2EE & Send to Word (PC)', 'Cifrar E2EE y Enviar a Word (PC)'],

        // --- Language & Music Studio ---
        ['Language Learning Studio (EN · 한국어 · K-Pop)', 'Estudio de Idiomas (EN · 한국어 · K-Pop)'],
        ['Study English, Korean (Hangul + Romanization), or mixed K-Pop lyrics with AI breakdowns, and sync notes E2EE to your local Word notebook (', 'Estudia inglés, coreano (Hangul + Romanización) o letras K-Pop con análisis IA, y sincroniza tus notas cifradas E2EE a tu Word local ('],
        ['Study Language:', 'Idioma de estudio:'],
        ['Select target language', 'Seleccionar idioma de estudio'],
        ['Notebook section', 'Sección del cuaderno'],
        ['English + Korean (Auto Hangul Romanization & K-Pop Code-Switching)', 'Inglés + Coreano (Romanización Hangul automática y K-Pop)'],
        ['🇺🇸 English', '🇺🇸 Inglés'],
        ['🇺🇸 English Only', '🇺🇸 Solo Inglés'],
        ['🇰🇷 Korean (한국어)', '🇰🇷 Coreano (한국어)'],
        ['🇰🇷 Korean', '🇰🇷 Coreano'],
        ['🇰🇷 Korean (한국어 + Romanization)', '🇰🇷 Coreano (한국어 + Romanización)'],
        ['🎵 K-Pop (EN + KR)', '🎵 K-Pop (EN + KR)'],
        ['🎵 K-Pop (EN + 한국어)', '🎵 K-Pop (EN + 한국어)'],
        ['🎵 K-Pop (EN+KR)', '🎵 K-Pop (EN+KR)'],
        ['🎵 English + Korean (K-Pop)', '🎵 Inglés + Coreano (K-Pop)'],
        ['🌐 Other', '🌐 Otro'],
        ['📖 Glossary / New Word', '📖 Glosario / Nueva Palabra'],
        ['✍️ Grammar & Usage Note', '✍️ Nota de Gramática y Uso'],
        ['🔗 Phrasal Verbs & Expressions', '🔗 Phrasal Verbs y Expresiones'],
        ['🎵 Learn with Music + AI', '🎵 Aprender con Música + IA'],
        ['Word / Expression (EN or 한국어) *', 'Palabra / Expresión (EN o 한국어) *'],
        ['e.g. Resilience / 마음 (maeum)', 'ej. Resilience / 마음 (maeum)'],
        ['Part of speech (optional)', 'Categoría gramatical (opcional)'],
        ['Optional...', 'Opcional...'],
        ['Noun (명사)', 'Sustantivo (명사)'],
        ['Verb (동사)', 'Verbo (동사)'],
        ['Adjective (형용사)', 'Adjetivo (형용사)'],
        ['Adverb (부사)', 'Adverbio (부사)'],
        ['Particle / Ending (조사/어미)', 'Partícula / Terminación (조사/어미)'],
        ['Expression / K-Pop Hook', 'Expresión / Estribillo K-Pop'],
        ['Idiom / Slang', 'Modismo / Jerga'],
        ['Connector / Preposition', 'Conector / Preposición'],
        ['Korean Romanization / Pronunciation Guide (auto-generated for Hangul)', 'Romanización coreana / Guía de pronunciación (auto-generada para Hangul)'],
        ['Auto-fills when you type Hangul (e.g. 사랑해 -> saranghae)', 'Se completa al escribir Hangul (ej. 사랑해 -> saranghae)'],
        ['Meaning / Translation (ES / EN) *', 'Significado / Traducción (ES / EN) *'],
        ['e.g. Resiliencia / Te quiero / Corazón y sentimientos', 'ej. Resiliencia / Te quiero / Corazón y sentimientos'],
        ['Example sentence (optional)', 'Oración de ejemplo (opcional)'],
        ['e.g. She showed great resilience during the project.', 'ej. She showed great resilience during the project.'],
        ['Context / Usage notes (optional)', 'Contexto / Notas de uso (opcional)'],
        ["e.g. Often used with 'build resilience' or 'show resilience'.", "ej. Se usa seguido con 'build resilience' o 'show resilience'."],
        ['Topic / Rule Title *', 'Tema / Título de Regla *'],
        ["e.g. When to use 'Make' vs 'Do'", "ej. Cuándo usar 'Make' vs 'Do'"],
        ['Grammar / Usage Notes *', 'Notas de Gramática / Uso *'],
        ['Explain the rule, when to use certain words, or nuances...', 'Explica la regla, cuándo usar ciertas palabras o matices...'],
        ['Examples (optional)', 'Ejemplos (opcional)'],
        ['e.g. Make a decision / Do homework / Make progress', 'ej. Make a decision / Do homework / Make progress'],
        ['Phrasal Verb *', 'Verbo Compuesto (Phrasal Verb) *'],
        ['e.g. work out', 'ej. work out'],
        ['Grammar pattern (optional)', 'Patrón gramatical (opcional)'],
        ['Separable (work it out)', 'Separable (ej. work it out)'],
        ['Inseparable', 'Inseparable'],
        ['Intransitive (no object)', 'Intransitivo (sin objeto)'],
        ['Three-part (e.g. look forward to)', 'Tres partes (ej. look forward to)'],
        ['Spanish Meaning *', 'Significado en Español *'],
        ['e.g. Hacer ejercicio / resolver un problema / salir bien', 'ej. Hacer ejercicio / resolver un problema / salir bien'],
        ['English Explanation (optional)', 'Explicación en Inglés (opcional)'],
        ['e.g. To exercise, find a solution, or turn out well', 'ej. To exercise, find a solution, or turn out well'],
        ["e.g. Don't worry, everything will work out in the end.", "ej. Don't worry, everything will work out in the end."],
        ['Additional notes (optional)', 'Notas adicionales (opcional)'],
        ['e.g. Has multiple meanings depending on context.', 'ej. Tiene múltiples significados según el contexto.'],
        ['Encrypt E2EE & Save to Word Notebook (PC)', 'Cifrar E2EE y Guardar en Cuaderno Word (PC)'],
        ['✨ AI Language Tutor & Lyrics Breakdown', '✨ Tutor de Idiomas IA y Desglose de Letras'],
        ['AI Language Tutor', 'Tutor de Idiomas IA'],
        ['Uses Google Gemini (0 MB server RAM) or built-in instant Korean Romanization & EN/KR analyzer when offline, with persistent learning memory.', 'Usa Google Gemini o el analizador instantáneo local de Romanización Coreana y EN/KR con memoria continua.'],
        ['🎵 Repertoire: 0 songs', '🎵 Repertorio: 0 canciones'],
        ['🧠 Memory: 0 learned', '🧠 Memoria: 0 aprendidos'],
        ['AI automatically reads your registered Artists, Albums, and Songs', 'Tu asistente conoce tus Artistas, Álbumes y Canciones guardadas'],
        ['Persistent vocabulary & grammar memory stored in your account', 'Memoria continua de vocabulario y gramática en tu cuenta'],
        ['Auto Engine', 'Modo Automático'],
        ['AI Engine mode', 'Modo de análisis'],
        ['View words, Korean phrases, and grammar rules your AI remembers', 'Ver palabras, frases en coreano y reglas gramaticales aprendidas'],
        ['Ask about a phrase, lyric meaning, grammar particle, or K-Pop expression (or ask about any song in your repertoire):', 'Pregunta por una frase, significado de letra, partícula gramatical o expresión K-Pop (o cualquier canción de tu repertorio):'],
        ['Auto (Gemini if configured, else Instant Local)', 'Automático (Gemini IA o Local)'],
        ['Google Gemini API', 'Google Gemini IA'],
        ['Instant Local Engine (Hangul + EN, 0 RAM)', 'Modo Instantáneo Local (Sin conexión)'],
        ['✨ Explain & Romanize', '✨ Explicar y Pronunciar'],
        ['🧠 Memory Bank', '🧠 Vocabulario Aprendido'],
        ['↘ Fill Study Form', '↘ Pasar al Formulario'],
        ['☁️ Auto-save AI responses to PC Word (stays E2EE encrypted in EC2 RAM if offline)', '☁️ Guardar explicaciones automáticamente en tu documento Word'],
        ['☁️ Registrar respuestas IA automáticamente en Word PC (si está offline queda cifrado E2EE en RAM EC2)', '☁️ Guardar explicaciones automáticamente en tu documento Word'],
        ['Sent in this session', 'Enviado en esta sesión'],
        ['No entries queued in this session yet.', 'Aún no hay entradas enviadas en esta sesión.'],
        ['Playback Platform:', 'Plataforma de reproducción:'],
        ['Preferred YouTube platform', 'Plataforma preferida de YouTube'],
        ['Detecting device...', 'Detectando dispositivo...'],
        ['🛡️ Playlist-Safe (Read-Only Single Links)', '🛡️ Seguro para Playlists (Solo enlaces individuales)'],
        ['Auto (PC / Mobile)', 'Auto (PC / Celular)'],
        ['📺 YouTube (PC)', '📺 YouTube (PC)'],
        ['🎵 YT Music (Mobile)', '🎵 YT Music (Celular)'],
        ['Song Finder (Auto: Standard YouTube / YT Music)', 'Buscador de Canciones (Auto: YouTube / YT Music)'],
        ['Search cleanly in a new tab without altering your account playlists, then paste the track link below to auto-fill title and artist.', 'Busca limpiamente en una pestaña nueva sin modificar tus playlists, luego pega abajo el enlace para autocompletar título y artista.'],
        ['Open YouTube Home', 'Abrir Inicio de YouTube'],
        ['My YT Music Library', 'Mi Biblioteca YT Music'],
        ['Find Song', 'Buscar Canción'],
        ['Find on YouTube', 'Buscar en YouTube'],
        ['Find on YT Music', 'Buscar en YT Music'],
        ['Register or Link Song', 'Registrar o Vincular Canción'],
        ['Cancel Edit', 'Cancelar Edición'],
        ['YouTube Music / YouTube URL or 11-char ID (optional)', 'URL de YouTube / YouTube Music o ID de 11 caracteres (opcional)'],
        ['Auto-fill', 'Autocompletar'],
        ['Song Title *', 'Título de la Canción *'],
        ['Track #', 'Pista #'],
        ['Language', 'Idioma'],
        ['Main Artist / Group *', 'Artista Principal / Grupo *'],
        ['Artist Format', 'Formato del Artista'],
        ['Group', 'Grupo'],
        ['Solo Artist', 'Solista'],
        ['Duo', 'Dúo'],
        ['Collab Unit', 'Unidad / Subunidad'],
        ['Collaborators / Featured Artists (optional)', 'Colaboradores / Artistas Invitados (opcional)'],
        ['Songs appear under every collaborating artist too.', 'Las canciones también aparecen bajo cada artista colaborador.'],
        ['Album / Mini Album Title (optional)', 'Título del Álbum / Mini Álbum (opcional)'],
        ['+ New Album', '+ Nuevo Álbum'],
        ['Release Type', 'Tipo de Lanzamiento'],
        ['Album', 'Álbum'],
        ['Mini Album', 'Mini Álbum'],
        ['Full Album', 'Álbum Completo'],
        ['Single', 'Sencillo'],
        ['Collab Single', 'Sencillo Colaborativo'],
        ['OST / Soundtrack', 'OST / Banda Sonora'],
        ['Year', 'Año'],
        ['Study Progress', 'Progreso de Estudio'],
        ['To Study', 'Por Estudiar'],
        ['In Progress', 'En Progreso'],
        ['Mastered', 'Dominada'],
        ['Short Study Focus (max 255 chars, no lyrics)', 'Enfoque corto de estudio (máx. 255 caracteres, sin letra)'],
        ['Save Song Metadata', 'Guardar Metadatos de Canción'],
        ['Artists, Collaborations & Albums', 'Artistas, Colaboraciones y Álbumes'],
        ['Interactive Artist, Album and Song Selector', 'Selector interactivo de Artistas, Álbumes y Canciones'],
        ['💿 + New Album / Mini Album', '💿 + Nuevo Álbum / Mini Álbum'],
        ['Refresh', 'Actualizar'],
        ['Filter song, album, or artist...', 'Filtrar canción, álbum o artista...'],
        ['All Artists', 'Todos los Artistas'],
        ['All Releases', 'Todos los Álbumes'],
        ['All Languages', 'Todos los Idiomas'],
        ['All Statuses', 'Todos los Estados'],
        ['Filter by artist', 'Filtrar por artista'],
        ['Filter by release type', 'Filtrar por tipo de lanzamiento'],
        ['Filter by language', 'Filtrar por idioma'],
        ['Filter by status', 'Filtrar por estado'],
        ['🎤 Artists', '🎤 Artistas'],
        ['Artists', 'Artistas'],
        ['💿 Albums / Releases', '💿 Álbumes / Lanzamientos'],
        ['Albums', 'Álbumes'],
        ['🎵 Songs (Click to Study / Ask AI)', '🎵 Canciones (Clic para Estudiar / IA)'],
        ['Songs', 'Canciones'],
        ['Loading music catalog...', 'Cargando catálogo musical...'],
        ['Song Study Notes -> Encrypted Word (PC)', 'Notas de Canción -> Word Cifrado (PC)'],
        ['Select a song from the catalog (or fill song details above) to record meanings, expressions, and pronunciation privately in Word.', 'Selecciona una canción del catálogo (o llena sus datos arriba) para registrar significados, expresiones y pronunciación en tu Word privado.'],
        ['✏️ Edit Song / Link', '✏️ Editar Canción / Link'],
        ['Open in YT Music', 'Abrir en YT Music'],
        ['Open on YouTube (PC)', 'Abrir en YouTube'],
        ['Open in YT Music (Mobile)', 'Abrir en YouTube Music'],
        ['Open on YouTube', 'Abrir en YouTube'],
        ['Play on PC', 'Reproducir en PC'],
        ['Mini Player', 'Reproductor'],
        ['Hide Mini Player', 'Ocultar Reproductor'],
        ['Cuaderno Word', 'Cuaderno Word'],
        ['⚪ Checking PC...', '⚪ Verificando computadora...'],
        ['⚪ Verificando PC...', '⚪ Verificando computadora...'],
        ['🟢 PC online · Word sync', '🟢 Computadora en línea · Sincronización activa'],
        ['📄 Extraer letra', '📄 Extraer letra'],
        ['Extract Lyrics', 'Extraer letra'],
        ['✨ Analizar Estrofas', '✨ Analizar Estrofas'],
        ['Analyze Stanzas', 'Analizar Estrofas'],
        ['🌐 Traducir Selección', '🌐 Traducir Selección'],
        ['Translate Selection', 'Traducir Selección'],
        ['🇪🇸 Traducir a Español', '🇪🇸 Traducir a Español'],
        ['Translate Lyrics to Spanish', 'Traducir a Español'],
        ['Translating lyrics to Spanish...', 'Traduciendo letra a español...'],
        ['🇰🇷🇺🇸 Inglés-Coreano (Mixto K-Pop)', '🇰🇷🇺🇸 Inglés-Coreano (Mixto K-Pop)'],
        ['Standalone Singles & Tracks', 'Sencillos y Pistas Sueltas'],

        // --- Weekly Agenda ---
        ['Loading activities...', 'Cargando actividades...'],
        ['Loading agenda...', 'Cargando agenda...'],
        ['🎓 ITS Schedule & Commute', '🎓 Horario ITS y Traslados'],
        ['+ New Activity', '+ Nueva Actividad'],
        ['Previous week', 'Semana anterior'],
        ['Next week', 'Semana siguiente'],
        ['Category filter', 'Filtro de categoría'],
        ['Type filter', 'Filtro de tipo'],
        ['Mon - Fri Only', 'Solo Lun - Vie'],
        ['Show Mon - Sun', 'Mostrar Lun - Dom'],
        ['Day View', 'Vista por Día'],
        ['Grid View', 'Vista Cuadrícula'],
        ['All', 'Todo'],
        ['🎓 University', '🎓 Universidad'],
        ['🎓 Uni', '🎓 Univ'],
        ['👤 Personal', '👤 Personal'],
        ['Events & Tasks', 'Eventos y Tareas'],
        ['📌 Events', '📌 Eventos'],
        ['☑ Tasks', '☑ Tareas'],
        ['Block / Day', 'Bloque / Día'],
        ['+ Add', '+ Agregar'],
        ['New Activity', 'Nueva Actividad'],
        ['Edit Activity', 'Editar Actividad'],
        ['Edit activity', 'Editar actividad'],
        ['Activity type:', 'Tipo de actividad:'],
        ['📌 Event (Class / Appointment / Meeting)', '📌 Evento (Clase / Cita / Reunión)'],
        ['☑ Task (To Do / In Progress / Done)', '☑ Tarea (Por hacer / En progreso / Completado)'],
        ['Category:', 'Categoría:'],
        ['Time:', 'Hora:'],
        ['Time block (part of day):', 'Bloque del día:'],
        ['⚡ Auto-selected from Time', '⚡ Seleccionado automáticamente por hora'],
        ['☕ Morning', '☕ Mañana'],
        ['🎓 School / University', '🎓 Escuela / Universidad'],
        ['☀️ Afternoon', '☀️ Tarde'],
        ['🌙 Night', '🌙 Noche'],
        ['At School / Classes', 'En Escuela / Clases'],
        ['Estado de avance:', 'Estado de avance:'],
        ['Por hacer', 'Por hacer'],
        ['En progreso', 'En progreso'],
        ['Completado', 'Completado'],
        ['To Do', 'Por hacer'],
        ['Done', 'Hecho'],
        ['Phone reminder timing:', 'Aviso previo al celular:'],
        ['Use Settings default', 'Usar predeterminado de Ajustes'],
        ['At scheduled time (0 min before)', 'A la hora programada (0 min antes)'],
        ['5 minutes before', '5 minutos antes'],
        ['15 minutes before', '15 minutos antes'],
        ['30 minutes before', '30 minutos antes'],
        ['1 hour before', '1 hora antes'],
        ['No reminder for this item', 'Sin recordatorio para esta actividad'],
        ['Title / Label *', 'Título / Actividad *'],
        ['University Class', 'Clase de Universidad'],
        ['Complete Assignment', 'Entregar Tarea'],
        ['Study for Exam', 'Estudiar para Examen'],
        ['Work Shift', 'Turno de Trabajo'],
        ['Description / Classroom / Details (optional):', 'Descripción / Salón / Detalles (opcional):'],
        ['Cancel', 'Cancelar'],
        ['Save Activity', 'Guardar Actividad'],
        ['Class filter', 'Filtro de clase'],
        ['Filter by current class', 'Filtrar por clase actual'],
        ['🎓 All Classes', '🎓 Todas las clases'],
        ['📌 General University (no class)', '📌 Universidad general (sin clase)'],
        ['Linked university class (active semester):', 'Clase universitaria vinculada (semestre activo):'],
        ['🎓 Manage classes', '🎓 Gestionar clases'],
        ['General University (no specific class)', 'Universidad general (sin clase específica)'],
        ['Links university tasks to a current class so the card badge shows the class name.', 'Vincula tareas universitarias a una clase actual para que la etiqueta muestre el nombre de la clase.'],
        ['Delete activity', 'Eliminar actividad'],
        ['Selected class was not found in your semester schedule.', 'La clase seleccionada no se encontró en tu horario semestral.'],

        // --- ITS Schedule, Residencias, Work & Commute ---
        ['Tec de Saltillo (ITS) · Residencias · Work & Maps Commute', 'Tec de Saltillo (ITS) · Residencias · Trabajo y Tráfico Maps'],
        ['Manage your semester class schedule by classroom (R02, R11, N21, etc.), vacation breaks, Residencias Profesionales, full/part-time work shifts, and smart traffic notifications.', 'Administra tu horario semestral por salón (R02, R11, N21, etc.), periodos vacacionales, Residencias Profesionales, turnos de trabajo y notificaciones inteligentes de tráfico.'],
        ['📍 Update My GPS', '📍 Actualizar mi GPS'],
        ['🗓️ Sync Week to Agenda', '🗓️ Sincronizar Semana a Agenda'],
        ['Academic and Work Planner Tabs', 'Pestañas de Horario Académico y Trabajo'],
        ['🎓 ITS Semester & Croquis', '🎓 Semestre ITS y Croquis'],
        ['🏖️ Vacations & Breaks', '🏖️ Vacaciones y Descansos'],
        ['🏢 Residencias Profesionales', '🏢 Residencias Profesionales'],
        ['💼 Work (Full / Part-Time)', '💼 Trabajo (Tiempo Completo / Medio)'],
        ['📍 Maps, GPS & Traffic Alerts', '📍 Maps, GPS y Alertas de Tráfico'],
        ['Active Semester Control (Instituto Tecnológico de Saltillo)', 'Control de Semestre Activo (Instituto Tecnológico de Saltillo)'],
        ['Track courses per semester. Class alerts pause automatically outside semester dates or during registered vacations.', 'Controla tus materias por semestre. Las alertas de clase se pausan automáticamente fuera del semestre o en vacaciones registradas.'],
        ['+ Add Semester', '+ Agregar Semestre'],
        ['⚡ Load MindBox 9th Sem Preset', '⚡ Cargar Plantilla MindBox 9no Sem'],
        ['Selected Semester:', 'Semestre seleccionado:'],
        ['Semester Name:', 'Nombre del semestre:'],
        ['Term Code:', 'Clave del periodo:'],
        ['Semester Start:', 'Inicio de semestre:'],
        ['Semester End:', 'Fin de semestre:'],
        ['Add / Edit ITS Class', 'Agregar / Editar Clase ITS'],
        ['Subject Key (MindBox):', 'Clave de materia (MindBox):'],
        ['Group:', 'Grupo:'],
        ['Subject / Course Name *', 'Materia / Curso *'],
        ['Professor / Teacher:', 'Docente / Profesor:'],
        ['ITS Classroom (Salón) *', 'Salón ITS *'],
        ['Type a room (R02, R11, N21, A10, S15) to detect ITS Campus & Croquis building.', 'Escribe un salón (R02, R11, N21, A10, S15) para detectar el Campus y edificio en el Croquis ITS.'],
        ['ITS Campus (Croquis):', 'Campus ITS (Croquis):'],
        ['Campus Boillot (CTO-004 · Sistemas R1-R14 / Mecatrónica S13-S20)', 'Campus Boillot (CTO-004 · Sistemas R1-R14 / Mecatrónica S13-S20)'],
        ['Campus Miravalle (CTO-003 · Aulas N1-N42 / Labs Eléctrica/Cómputo)', 'Campus Miravalle (CTO-003 · Aulas N1-N42 / Labs Eléctrica/Cómputo)'],
        ['Campus Principal (CTO-002 · Aulas A, B, C, CR, AM, TM)', 'Campus Principal (CTO-002 · Aulas A, B, C, CR, AM, TM)'],
        ['Start Time *', 'Hora de inicio *'],
        ['End Time *', 'Hora de fin *'],
        ['Class Days:', 'Días de clase:'],
        ['Mon', 'Lun'],
        ['Tue', 'Mar'],
        ['Wed', 'Mié'],
        ['Thu', 'Jue'],
        ['Fri', 'Vie'],
        ['Sat', 'Sáb'],
        ['Sun', 'Dom'],
        ['Save Class to Semester', 'Guardar Clase al Semestre'],
        ['Registered Classes & ITS Croquis Guide', 'Clases Registradas y Guía de Croquis ITS'],
        ['0 classes', '0 clases'],
        ['🗺️ Official Tec de Saltillo Croquis (CTO-001 to CTO-004)', '🗺️ Croquis Oficial Tec de Saltillo (CTO-001 a CTO-004)'],
        ['🗺️ Croquis Oficial Tec de Saltillo (CTO-001 a CTO-004)', '🗺️ Croquis Oficial Tec de Saltillo (CTO-001 a CTO-004)'],
        ['Add Vacation / Academic Break', 'Agregar Vacaciones / Periodo Sin Clases'],
        ['During these dates, automatic class notifications are paused and Agenda sync skips class generation.', 'Durante estas fechas, se pausan las alertas de clases y la sincronización con Agenda omite esas fechas.'],
        ['Period Name *', 'Nombre del periodo *'],
        ['Start Date *', 'Fecha de inicio *'],
        ['End Date *', 'Fecha de fin *'],
        ['Add Vacation Period', 'Agregar Periodo Vacacional'],
        ['Registered Vacation Periods', 'Periodos Vacacionales Registrados'],
        ['🏢 Residencias Profesionales (TecNM · 500 Hours Tracker & Commute)', '🏢 Residencias Profesionales (TecNM · Control de 500 Horas y Ruta)'],
        ['Configure your professional residency project, company location on Google Maps, schedule, and accumulated hours. Commute notifications calculate driving time with traffic automatically.', 'Configura tu proyecto de residencias profesionales, ubicación de la empresa en Google Maps, horario y horas acumuladas. Las alertas calculan automáticamente el trayecto en auto con tráfico.'],
        ['Enable Residencias Profesionales schedule & commute notifications', 'Activar horario y alertas de traslado para Residencias Profesionales'],
        ['Project Name:', 'Nombre del proyecto:'],
        ['Company / Institution:', 'Empresa / Institución:'],
        ['Internal / External Advisor:', 'Asesor Interno / Externo:'],
        ['Modality:', 'Modalidad:'],
        ['In-Person (Car commute + traffic alert)', 'Presencial (Trayecto en auto + tráfico)'],
        ['Presencial (Car commute + traffic alert)', 'Presencial (Trayecto en auto + tráfico)'],
        ['Hybrid (Car commute + traffic alert)', 'Híbrido (Trayecto en auto + tráfico)'],
        ['Híbrido (Car commute + traffic alert)', 'Híbrido (Trayecto en auto + tráfico)'],
        ['Remote (10 min before login alert)', 'Remoto (Aviso 10 min antes)'],
        ['Remoto (10 min before login alert)', 'Remoto (Aviso 10 min antes)'],
        ['Logged Hours:', 'Horas registradas:'],
        ['Target Hours Goal (TecNM):', 'Meta de horas (TecNM):'],
        ['Progress: 0 / 500 hrs (0%)', 'Progreso: 0 / 500 hrs (0%)'],
        ['Entry Time:', 'Hora de entrada:'],
        ['Exit Time:', 'Hora de salida:'],
        ['Attendance Days:', 'Días de asistencia:'],
        ['📍 Company Location (Google Maps / Coordinates for Driving Traffic Route)', '📍 Ubicación de la Empresa (Google Maps / Coordenadas para Tráfico)'],
        ['Address / Zone:', 'Dirección / Zona:'],
        ['Google Maps Link (paste URL or coordinates):', 'Enlace de Google Maps (pega URL o coordenadas):'],
        ['Latitude:', 'Latitud:'],
        ['Longitude:', 'Longitud:'],
        ['📍 Set Company Location from My Current GPS', '📍 Fijar Ubicación de Empresa desde mi GPS Actual'],
        ['💼 Work Schedule (Full-Time / Part-Time) & Car Commute Alerts', '💼 Horario Laboral (Tiempo Completo / Medio) y Alertas de Traslado'],
        ['Register your work shifts and workplace location. You will receive phone notifications before your shift based on driving time and traffic.', 'Registra tus turnos de trabajo y la ubicación laboral. Recibirás alertas al celular antes de tu turno según tiempo de manejo y tráfico.'],
        ['Enable Work Schedule & driving commute notifications', 'Activar horario laboral y alertas de manejo con tráfico'],
        ['Employment / Shift Type:', 'Tipo de turno / empleo:'],
        ['Part-Time', 'Medio Tiempo (Part-Time)'],
        ['Medio Tiempo (Part-Time)', 'Medio Tiempo (Part-Time)'],
        ['Full-Time', 'Tiempo Completo (Full-Time)'],
        ['Tiempo Completo (Full-Time)', 'Tiempo Completo (Full-Time)'],
        ['Shift-Based / Flexible', 'Por Turnos / Flexible'],
        ['Por Turnos / Flexible', 'Por Turnos / Flexible'],
        ['Remote / Home Office (10 min before)', 'Remoto / Home Office (10 min antes)'],
        ['Remoto / Home Office (10 min before)', 'Remoto / Home Office (10 min antes)'],
        ['Company / Organization:', 'Empresa / Organización:'],
        ['Role / Position:', 'Puesto / Rol:'],
        ['Shift Start Time:', 'Hora de entrada:'],
        ['Shift End Time:', 'Hora de salida:'],
        ['Work Days:', 'Días laborales:'],
        ['📍 Workplace Location (Google Maps / Coordinates for Driving Traffic Route)', '📍 Ubicación del Trabajo (Google Maps / Coordenadas para Tráfico)'],
        ['Workplace Address:', 'Dirección del trabajo:'],
        ['📍 Set Workplace from My Current GPS', '📍 Fijar Ubicación Laboral desde mi GPS Actual'],
        ['📍 Saved Locations & Commute Notification Rules', '📍 Ubicaciones Guardadas y Reglas de Aviso de Traslado'],
        ['Enable smart class commute notifications on my phone', 'Activar alertas inteligentes de traslado a clases en mi celular'],
        ['Minimum alert when far / at Home (min):', 'Aviso mínimo cuando estás lejos / en Casa (min):'],
        ['Minimum 30 min; increases automatically if driving + traffic takes longer.', 'Mínimo 30 min; aumenta automáticamente si el trayecto + tráfico tarda más.'],
        ['Alert when inside / near ITS campus (min):', 'Aviso dentro / cerca del campus ITS (min):'],
        ['Default 10 min before class when already on campus.', 'Predeterminado: 10 min antes de clase si ya estás en el campus.'],
        ['Parking & walking buffer (min):', 'Margen de estacionamiento y caminata (min):'],
        ['Campus proximity radius (km):', 'Radio de cercanía al campus (km):'],
        ['🏠 Home / Base Location (for 1st Class & Morning Commute)', '🏠 Casa / Ubicación Base (para 1ra Clase y Mañana)'],
        ['Home Label:', 'Etiqueta de Casa:'],
        ['Street Address / Neighborhood (auto-locates in Saltillo):', 'Calle, Número y Colonia (ubica automáticamente en Saltillo):'],
        ['Google Maps Link or Coordinates (optional — auto-fills Lat/Lng):', 'Enlace de Google Maps o Coordenadas (opcional — autocompleta Lat/Lng):'],
        ['Home Latitude:', 'Latitud de Casa:'],
        ['Home Longitude:', 'Longitud de Casa:'],
        ['💾 Save & 🔍 Find Home Location', '💾 Guardar y 🔍 Ubicar Casa'],
        ['📍 Set Home from Phone/GPS', '📍 Fijar Casa desde GPS/Celular'],
        ['🗺️ Verify Home in Maps', '🗺️ Verificar Casa en Maps'],
        ['🎓 University Main Location (Instituto Tecnológico de Saltillo)', '🎓 Ubicación Principal Universidad (Instituto Tecnológico de Saltillo)'],
        ['ITS Main Latitude (Croquis CTO-001):', 'Latitud Principal ITS (Croquis CTO-001):'],
        ['ITS Main Longitude (Croquis CTO-001):', 'Longitud Principal ITS (Croquis CTO-001):'],
        ['🚗 Live Route, Distance & Traffic Estimator', '🚗 Estimador de Ruta en Vivo, Distancia y Tráfico'],
        ['📍 Refresh GPS', '📍 Actualizar GPS'],
        ['📲 Ping Phone GPS (ntfy)', '📲 Pedir GPS al Celular (ntfy)'],
        ['🏠 Use Saved Home', '🏠 Usar Casa Guardada'],
        ['Origin: Detecting your saved Home or live GPS location...', 'Origen: Detectando tu Casa guardada o ubicación GPS en vivo...'],
        ['🤖 Automatic Phone GPS over Plain HTTP (no HTTPS / domain needed)', '🤖 GPS Automático del Celular sobre HTTP (sin dominio / HTTPS)'],
        ['🔑 Show Phone HTTP Webhook', '🔑 Ver Webhook HTTP del Celular'],
        ['🔄 Rotate Token', '🔄 Rotar Token'],
        ['Android HTTP GET / POST Webhook URL (keep secret):', 'URL Webhook HTTP GET / POST Android (mantener secreta):'],
        ['📋 Copy URL', '📋 Copiar URL'],
        ['💾 Save All ITS Schedule, Residencias, Work & Locations', '💾 Guardar Todo: Horario ITS, Residencias, Trabajo y Ubicaciones'],

        // --- Weekly Summary & Psychiatrist ---
        ['Weekly Mood & Sleep Summary', 'Resumen Semanal de Ánimo y Sueño'],
        ['Review emotional patterns across all five daily time blocks alongside restorative sleep metrics.', 'Revisa patrones emocionales en los cinco bloques diarios junto con métricas de descanso, desvelos y crisis.'],
        ['⬅ Back to Home', '⬅ Volver al Inicio'],
        ['Select a week:', 'Selecciona una semana:'],
        ['Sunday', 'Domingo'],
        ['Monday', 'Lunes'],
        ['Tuesday', 'Martes'],
        ['Wednesday', 'Miércoles'],
        ['Thursday', 'Jueves'],
        ['Friday', 'Viernes'],
        ['Saturday', 'Sábado'],
        ['Late Night', 'Madrugada'],
        ['Morning', 'Mañana'],
        ['Noon', 'Mediodía'],
        ['Afternoon', 'Tarde'],
        ['Night', 'Noche'],
        ['MY MOOD STATES', 'MIS ESTADOS DE ÁNIMO'],
        ['🌙 Sleep & Desvelo Summary', '🌙 Resumen de Sueño y Desvelos'],
        ['🦉 Bedtimes, Desvelos & Late-Night Details (Visible to Patient & Psychiatrist Read-Only)', '🦉 Horarios de Sueño y Desvelos (Visible para Paciente y Psiquiatra Solo Lectura)'],
        ['Loading sleep & desvelo details for this week...', 'Cargando detalles de sueño y desvelos de esta semana...'],
        ['⚠️ Crisis & Episode Log (Visible to Patient & Psychiatrist Read-Only)', '⚠️ Bitácora de Crisis y Episodios (Visible para Paciente y Psiquiatra Solo Lectura)'],
        ['Loading crisis records for this week...', 'Cargando registros de crisis de esta semana...'],
        ["Doctor's name:", 'Nombre del médico / especialista:'],
        ["Doctor's email address:", 'Correo del médico / especialista:'],
        ['Assigned password (8–128 chars, letters & numbers):', 'Contraseña asignada (8–128 caracteres, letras y números):'],
        ['Save Psychiatrist Account', 'Guardar Cuenta de Psiquiatra'],
        ['Psychiatrist accounts', 'Cuentas de Psiquiatra'],
        ['Loading...', 'Cargando...'],

        // --- Settings & Security ---
        ['Manage mobile notification bar alerts, automated reminders, workspace defaults, YouTube playback mode, appearance, and your local E2EE key.', 'Configura alertas a la barra de notificaciones de tu celular, recordatorios, estudio de idiomas, modo YouTube, idioma y tu llave E2EE local (modo oscuro permanente).'],
        ['Manage mobile notification bar alerts, automated reminders, workspace defaults, YouTube playback mode, language (Always Dark), and your local E2EE key.', 'Configura alertas en la barra de tu celular, recordatorios automáticos, modo YouTube, idioma (Modo Oscuro Permanente) y tu llave E2EE local.'],
        ['📱 Phone Notification Bar (ntfy)', '📱 Barra de Notificaciones del Celular (ntfy)'],
        ['Receive reminders directly in your phone\'s Android / iOS notification shade even when the browser is closed (desktop alerts stay off by default).', 'Recibe recordatorios directo en las notificaciones de tu celular Android / iOS incluso con el navegador cerrado.'],
        ['Quick Setup (OPPO A79 / Android / iOS):', 'Configuración Rápida (OPPO A79 / Android / iOS):'],
        ['Enable notifications on my phone\'s notification bar', 'Activar notificaciones en la barra de notificaciones del celular'],
        ['Private phone topic (min. 8 characters):', 'Tema (topic) privado del celular (mín. 8 caracteres):'],
        ['Generate', 'Generar'],
        ['Copy', 'Copiar'],
        ['Push server (HTTPS):', 'Servidor Push (HTTPS):'],
        ['Phone alert priority:', 'Prioridad de alerta en celular:'],
        ['5 — Urgent', '5 — Urgente'],
        ['4 — High (Pop-up + sound)', '4 — Alta (Pop-up + sonido)'],
        ['3 — Normal', '3 — Normal'],
        ['2 — Low (Silent tray)', '2 — Baja (Silenciosa)'],
        ['Public server URL (for Open / Snooze phone buttons):', 'URL pública del servidor (para botones Abrir / Posponer en celular):'],
        ['Also show desktop browser notifications', 'Mostrar también notificaciones en el navegador de PC'],
        ["(Optional — off by default since PC alerts aren't needed)", '(Opcional — desactivado por defecto si usas alertas en celular)'],
        ['🔔 Send Test to Phone', '🔔 Enviar Prueba al Celular'],
        ['🔔 Reminder Schedule & Rules', '🔔 Horarios y Reglas de Recordatorios'],
        ["Notifies automatically at Morning (09:00), Noon (13:00), Afternoon (17:00), and Night (22:00) only if you haven't logged that block yet.", 'Notifica automáticamente en Mañana (09:00), Mediodía (13:00), Tarde (17:00) y Noche (22:00) solo si aún no registras ese bloque.'],
        ['Also notify if an earlier Mood block today is still pending', 'Notificar también si un bloque anterior de Ánimo de hoy sigue pendiente'],
        ['Optional: include Late Night reminder (03:00 AM)', 'Opcional: incluir recordatorio de Madrugada (03:00 AM)'],
        ['Morning sleep reminder time', 'Hora recordatorio sueño matutino'],
        ['Word check reminder time', 'Hora revisión Word al final del día'],
        ['English study reminder time', 'Hora recordatorio estudio de idiomas'],
        ['English study days', 'Días de estudio de idiomas'],
        ['Events', 'Eventos'],
        ['Tasks', 'Tareas'],
        ['Pending / Overdue Tasks', 'Tareas Pendientes / Vencidas'],
        ['Remind', 'Avisar'],
        ['At start time', 'A la hora de inicio'],
        ['5 min before', '5 min antes'],
        ['10 min before', '10 min antes'],
        ['15 min before', '15 min antes'],
        ['30 min before', '30 min antes'],
        ['60 min before', '60 min antes'],
        ['English Study Reminder', 'Recordatorio de Estudio de Idiomas'],
        ['(Configurable — off by default)', '(Configurable — desactivado por defecto)'],
        ['🤖 Language AI & Multilingual Study (English · 한국어 · K-Pop)', '🤖 IA de Idiomas y Estudio Multilingüe (English · 한국어 · K-Pop)'],
        ['Default Study Language:', 'Idioma de estudio predeterminado:'],
        ['Gemini Model Preset:', 'Modelo Gemini preseleccionado:'],
        ['gemini-2.5-flash (Recommended · Fast & Optimal)', 'gemini-2.5-flash (Recomendado · Rápido y Óptimo)'],
        ['gemini-3-flash-preview (Latest Flash · Active on New Keys)', 'gemini-3-flash-preview (Último Flash · Activo en llaves nuevas)'],
        ['gemini-flash-latest (Always Latest Flash)', 'gemini-flash-latest (Siempre último Flash)'],
        ['gemini-2.5-flash-lite (Ultra Fast · High Free Quota)', 'gemini-2.5-flash-lite (Ultra rápido · Alta cuota gratuita)'],
        ['gemini-2.5-pro (Deep Grammar & Lyrics Poetry)', 'gemini-2.5-pro (Gramática profunda y poesía en letras)'],
        ['gemini-3.1-pro-preview (Gemini 3.1 Pro Preview)', 'gemini-3.1-pro-preview (Gemini 3.1 Pro Preview)'],
        ['🧪 Test AI Connection', '🧪 Probar Conexión IA'],
        ['Clear Key', 'Borrar Clave'],
        ['Checking Gemini key status...', 'Verificando estado de clave Gemini...'],
        ['🔐 Privacidad y Protección de Conexión', '🔐 Privacidad y Protección de Conexión'],
        ['🔄 Renovar Llave de Sesión', '🔄 Renovar Llave de Sesión'],
        ['⚡ Probar Velocidad de Cifrado', '⚡ Probar Velocidad de Cifrado'],
        ['🔍 Verificar Datos Cifrados', '🔍 Verificar Datos Cifrados'],
        ['🎛️ Workspace Defaults & Security', '🎛️ Preferencias del Espacio y Seguridad'],
        ['Interface Language (English / Español):', 'Idioma de la Interfaz (English / Español):'],
        ['Default Agenda Category:', 'Categoría predeterminada de Agenda:'],
        ['All (University + Personal)', 'Todo (Universidad + Personal)'],
        ['🎓 University Only', '🎓 Solo Universidad'],
        ['👤 Personal Only', '👤 Solo Personal'],
        ['Default Agenda View:', 'Vista predeterminada de Agenda:'],
        ['Auto (Grid PC / Day Mobile)', 'Auto (Cuadrícula PC / Día Celular)'],
        ['Weekly Grid View', 'Vista Cuadrícula Semanal'],
        ['Day Focus View', 'Vista Enfocada por Día'],
        ['Learn with Music YouTube Platform:', 'Plataforma YouTube para Aprender con Música:'],
        ['Auto (YouTube on PC · YT Music on Mobile)', 'Auto (YouTube en PC · YT Music en Celular)'],
        ['Always Standard YouTube (youtube.com)', 'Siempre YouTube Estándar (youtube.com)'],
        ['Always YouTube Music (music.youtube.com)', 'Siempre YouTube Music (music.youtube.com)'],
        ['Auto keeps normal YouTube on PC and read-only single-track YouTube Music on mobile without altering playlists.', 'Auto mantiene YouTube normal en PC y YouTube Music individual en celular sin alterar tus playlists.'],
        ['Timezone (IANA):', 'Zona horaria (IANA):'],
        ['Include Saturday & Sunday in Weekly Agenda by default', 'Incluir Sábado y Domingo en Agenda Semanal por defecto'],
        ['Local E2EE Secret Key (Journal & English Word):', 'Llave Secreta E2EE Local (Diario y Word de Idiomas):'],
        ['Checking...', 'Verificando...'],
        ['Update 32-char Key', 'Actualizar Llave de 32 caracteres'],
        ['Clear from Browser', 'Borrar del Navegador'],
        ['💾 Save All Settings', '💾 Guardar Todos los Ajustes'],

        // --- Settings Placeholders & Hints ---
        ['Leave blank to keep existing key or paste AQ.A... / AIzaSy...', 'Dejar vacío para conservar la llave actual o pegar AQ.A... / AIzaSy...'],
        ['e.g. Review 5 phrasal verbs and practice speaking', 'ej. Repasar 5 phrasal verbs y practicar pronunciación'],
        ['Exact 32 characters matching your PC sync key', 'Exactamente 32 caracteres igual que tu llave de sincronización en PC'],
        ['e.g. Margarita Maza de Juárez 924, Saltillo  OR  https://maps.app.goo.gl/...  OR  25.4437, -100.9938', 'ej. Margarita Maza de Juárez 924, Saltillo  O  https://maps.app.goo.gl/...  O  25.4437, -100.9938'],
        ['Verification code sent to', 'Código de verificación enviado a'],
        ['Late-night bedtime detected (', 'Horario de desvelo detectado ('],
        ["automatically marked as Desvelo for your psychiatrist's weekly report.", 'marcado automáticamente como Desvelo para el reporte semanal de tu psiquiatra.'],

        // --- Modals ---
        ['🔐 Local E2EE Secret Key', '🔐 Llave Secreta E2EE Local'],
        ['32-character secret key:', 'Llave secreta de 32 caracteres:'],
        ['Save Key', 'Guardar Llave'],
        ['Confirm Action', 'Confirmar Acción'],
        ['Are you sure you want to proceed?', '¿Estás seguro de que deseas continuar?'],
        ['Confirm', 'Confirmar'],
        ['💿 Create Album / Mini Album', '💿 Crear Álbum / Mini Álbum'],
        ['Release Format', 'Formato de Lanzamiento'],
        ['Album / Mini Album Title *', 'Título del Álbum / Mini Álbum *'],
        ['Release Year (optional)', 'Año de Lanzamiento (opcional)'],
        ['Release Year', 'Año de Lanzamiento'],
        ['Short Notes (optional)', 'Notas Cortas (opcional)'],
        ['Save Album Only', 'Solo Guardar Álbum'],
        ['Save & Add Song', 'Guardar y Agregar Canción'],
        ['Edit Artist', 'Editar Artista'],
        ['Artist / Group Name *', 'Nombre del Artista / Grupo *'],
        ['Delete Album', 'Eliminar Álbum'],
        ['Save Changes', 'Guardar Cambios'],
        ['📍 Set Location & Recalculate Commute', '📍 Fijar Ubicación y Recalcular Traslado'],
        ['1-Tap Quick Locations & Phone Actions:', 'Ubicaciones Rápidas en 1 Toque y Acciones del Celular:'],
        ['📲 Ping My Phone for GPS (ntfy)', '📲 Pedir GPS al Celular (ntfy)'],
        ['🏠 Use Saved Home as Origin', '🏠 Usar Casa Guardada como Origen'],
        ['Or paste street address, Google Maps link, or coordinates (lat, lng):', 'O pega una dirección, enlace de Google Maps o coordenadas (lat, lng):'],
        ['In Google Maps (OPPO A79): tap blue dot / place → Share → Copy link → paste here, OR type your Saltillo street address.', 'En Google Maps (OPPO A79): toca el punto azul / lugar → Compartir → Copiar vínculo → pega aquí, o escribe tu dirección en Saltillo.'],
        ['🗺️ Open Google Maps', '🗺️ Abrir Google Maps'],
        ['Apply Location', 'Aplicar Ubicación'],
        ['⚙️ Enable 1-Tap Phone Hardware GPS on Chrome (OPPO A79) / Edge HTTP', '⚙️ Activar GPS de Hardware en 1 Toque en Chrome (OPPO A79) / Edge HTTP'],
        ['📋 Copy', '📋 Copiar'],
        ['🛰️ Retry Phone / Browser Hardware GPS', '🛰️ Reintentar GPS de Hardware del Celular / Navegador'],
        ['Close', 'Cerrar'],
        ['Close modal', 'Cerrar ventana'],
        ['Close dialog', 'Cerrar diálogo'],
        ['Show key', 'Mostrar llave'],

        // --- Floating Translator & Standalone Popup ---
        ['Translator', 'Traductor'],
        ['Quick Extension Translator', 'Extensión de Traductor Rápido'],
        ['Floating Extension Translator', 'Extensión de Traductor Flotante'],
        ['Drag Header · Alt+T', 'Arrastra Barra · Alt+T'],
        ['Drag to move window', 'Arrastra para mover ventana'],
        ['Reset window position to bottom-right', 'Restablecer posición abajo a la derecha'],
        ['Open in separate mini browser window alongside YouTube / PDFs', 'Abrir en mini ventana separada junto a YouTube / PDFs'],
        ['Open Quick Translator anywhere (Alt+T)', 'Abrir Traductor Rápido donde sea (Alt+T)'],
        ['Open Quick Translator', 'Abrir Traductor Rápido'],
        ['Close translator', 'Cerrar traductor'],
        ['🪟 Window', '🪟 Ventana'],
        ['Quick Translation Direction', 'Dirección rápida de traducción'],
        ['Quick translation direction', 'Dirección rápida de traducción'],
        ['Quick translator engine', 'Motor del traductor rápido'],
        ['Translation Direction', 'Dirección de traducción'],
        ['Translation direction', 'Dirección de traducción'],
        ['Translator engine', 'Motor traductor'],
        ['🇺🇸 → 🇪🇸 EN → ES', '🇺🇸 → 🇪🇸 EN → ES'],
        ['🇰🇷 → 🇺🇸 KO → EN', '🇰🇷 → 🇺🇸 KO → EN'],
        ['🇰🇷 → 🇪🇸 KO → ES', '🇰🇷 → 🇪🇸 KO → ES'],
        ['🌐 Auto', '🌐 Auto'],
        ['🇪🇸 → 🇺🇸 ES → EN', '🇪🇸 → 🇺🇸 ES → EN'],
        ['🇪🇸 → 🇰🇷 ES → KO', '🇪🇸 → 🇰🇷 ES → KO'],
        ['English → Spanish', 'Inglés → Español'],
        ['English → Español', 'Inglés → Español'],
        ['Korean → English', 'Coreano → Inglés'],
        ['Coreano → English', 'Coreano → Inglés'],
        ['Korean → Spanish', 'Coreano → Español'],
        ['Coreano → Español', 'Coreano → Español'],
        ['Auto Detect (EN/KO)', 'Detección Auto (EN/KO)'],
        ['Spanish → English', 'Español → Inglés'],
        ['Español → English', 'Español → Inglés'],
        ['Spanish → Korean', 'Español → Coreano'],
        ['Español → Coreano', 'Español → Coreano'],
        ['Auto (Gemini / Local)', 'Auto (Gemini / Motor Local)'],
        ['Google Gemini AI', 'Google Gemini IA'],
        ['Instant Local Mode', 'Modo Instantáneo Local'],
        ['📋 Paste & Translate', '📋 Pegar y Traducir'],
        ['🧹 Clear', '🧹 Limpiar'],
        ['Translate', 'Traducir'],
        ['Translating...', 'Traduciendo...'],
        ['Traduciendo...', 'Traduciendo...'],
        ['Type or select text + Alt+T... Enter to translate (Shift+Enter for new line)', 'Escribe o selecciona texto + Alt+T... Enter para traducir (Shift+Enter nueva línea)'],
        ['Type or paste any word, phrase, or lyric (Enter to translate · Shift+Enter for new line)...', 'Escribe o pega cualquier palabra, frase o letra (Enter para traducir · Shift+Enter nueva línea)...'],
        ['Optional context (song, PDF, sentence)...', 'Contexto opcional (canción, PDF, oración)...'],
        ['Daily Hub Translator (Mini Window)', 'Traductor Daily Hub (Mini Ventana)'],
        ['Daily Hub Translator', 'Traductor Daily Hub'],
        ['🏠 Main Hub', '🏠 Hub Principal'],
        ['Session not started or expired', 'Sesión no iniciada o expirada'],
        ['🔒 Session not started or expired', '🔒 Sesión no iniciada o expirada'],
        ['🔒 Sesión no iniciada o expirada', '🔒 Sesión no iniciada o expirada'],
        ['Sign in on the main Personal Daily Hub tab first to enable Gemini and your smart dictionary.', 'Inicia sesión primero en la pestaña principal de Personal Daily Hub para habilitar Gemini y tu diccionario inteligente.'],
        ['Inicia sesión primero en la pestaña principal de Personal Daily Hub para habilitar Gemini y tu diccionario inteligente.', 'Inicia sesión primero en la pestaña principal de Personal Daily Hub para habilitar Gemini y tu diccionario inteligente.'],
        ['Open Daily Hub to sign in', 'Abrir Daily Hub para iniciar sesión'],
        ['Abrir Daily Hub para iniciar sesión', 'Abrir Daily Hub para iniciar sesión'],
        ['🔄 Check session', '🔄 Verificar sesión'],
        ['🔄 Verificar sesión', '🔄 Verificar sesión'],
        ['Instant Ready', 'Listo al Instante'],
        ['Connected · Gemini + Instant', 'Conectado · Gemini + Local'],
        ['Admin account required', 'Requiere cuenta Admin'],
        ['Sign in required', 'Requiere iniciar sesión'],

        // --- Translator Result Card & Widget ---
        ['⚡ Instant Local Dictionary', '⚡ Diccionario Local Instantáneo'],
        ['Meaning & Explanation', 'Significado y Explicación'],
        ['Meaning & Spanish Explanation', 'Significado y explicación en Español'],
        ['Significado y explicación en Español', 'Significado y explicación en Español'],
        ['⚙️ Configure / Test AI in Settings', '⚙️ Configurar / Probar IA en Ajustes'],
        ['⚙️ Configurar / Probar IA en Settings', '⚙️ Configurar / Probar IA en Ajustes'],
        ['📝 Send to Vocabulary Study Form', '📝 Enviar al Formulario de Estudio'],
        ['📋 Copy Translation', '📋 Copiar Traducción'],
        ['Translation copied to clipboard.', 'Traducción copiada al portapapeles.'],
        ['🔤 Copy Romanization', '🔤 Copiar Romanización'],
        ['Romanization copied.', 'Romanización copiada.'],
        ['🔄 Retry', '🔄 Reintentar'],
        ['🔄 Reintentar', '🔄 Reintentar'],
        ['Could not complete translation.', 'No se pudo completar la traducción.'],
        ['No se pudo completar la traducción.', 'No se pudo completar la traducción.'],
        ['Temporary connection error', 'Error temporal de conexión'],
        ['Error temporal de conexión', 'Error temporal de conexión'],
        ['Type a word, phrase, or lyric line to translate.', 'Escribe una palabra, frase o verso para traducir.'],
        ['Session required. Sign in on Daily Hub.', 'Se requiere sesión. Inicia sesión en Daily Hub.'],
        ['No unstable connection to complete translation.', 'Sin conexión estable para completar la traducción.'],
        ['No se pudo completar la traducción por red', 'No se pudo completar la traducción por red'],
        ['Clipboard is empty — paste with Ctrl+V.', 'Portapapeles vacío — pega manualmente con Ctrl+V.'],
        ['Browser denied clipboard read — paste with Ctrl+V here.', 'El navegador denegó leer el portapapeles — pega con Ctrl+V aquí.'],
        ['Press Ctrl+V in the text box to paste (plain HTTP blocks automatic clipboard reads).', 'Presiona Ctrl+V en el cuadro de texto para pegar (HTTP restringe lectura automática del portapapeles).'],
        ['Presiona Ctrl+V en el cuadro de texto para pegar (HTTP restringe lectura automática del portapapeles).', 'Presiona Ctrl+V en el cuadro de texto para pegar (HTTP restringe lectura automática del portapapeles).'],
        ['Your browser blocked the popup window. Please allow popups for this site.', 'Tu navegador bloqueó la ventana emergente. Permite popups para este sitio.'],
        ['Tu navegador bloqueó la ventana emergente. Permite popups para este sitio.', 'Tu navegador bloqueó la ventana emergente. Permite popups para este sitio.'],
        ['Sent to Glossary Study Form in your Main Hub tab!', '¡Enviado al formulario de estudio en tu pestaña principal de Daily Hub!'],
        ['Saved for Glossary! Open your Main Hub tab and it will load automatically.', '¡Guardado para Glosario! Abre tu pestaña principal de Daily Hub y se cargará automáticamente.'],

        // --- Music & Lyrics Additional Dynamic Strings ---
        ['▶️ Open on YouTube', '▶️ Abrir en YouTube'],
        ['▶️ Abrir en YouTube', '▶️ Abrir en YouTube'],
        ['🎵 Open in YouTube Music', '🎵 Abrir en YouTube Music'],
        ['🎵 Abrir en YouTube Music', '🎵 Abrir en YouTube Music'],
        ['💻 Play on PC', '💻 Reproducir en PC'],
        ['💻 Reproducir en PC', '💻 Reproducir en PC'],
        ['📺 Floating Window', '📺 Ventana flotante'],
        ['📺 Ventana flotante', '📺 Ventana flotante'],
        ['🔄 Try alternative player', '🔄 Probar reproductor alternativo'],
        ['🔄 Probar reproductor alternativo', '🔄 Probar reproductor alternativo'],
        ['This video cannot be embedded by the copyright owner.', 'El propietario restringió la reproducción incrustada en este sitio.'],
        ['Este video no está disponible.', 'Este video no está disponible.'],
        ['Add Song to Album', 'Agregar Canción al Álbum'],
        ['Edit', 'Editar'],
        ['Delete', 'Eliminar'],
        ['Study -> Word', 'Estudiar -> Word'],
        ['Word Notes Queued', 'Notas Enviadas a Word'],

        // --- Server Common Responses ---
        ['Session not started or expired.', 'Sesión no iniciada o expirada.'],
        ['Your session has expired. Please sign in again.', 'Tu sesión expiró. Por favor inicia sesión de nuevo.'],
        ['Signed in successfully.', 'Sesión iniciada correctamente.'],
        ['Signed out successfully.', 'Sesión cerrada correctamente.'],
        ['Signed out.', 'Sesión cerrada.'],
        ['Settings saved successfully.', 'Ajustes guardados correctamente.'],
        ['Password updated successfully. You can now sign in.', 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.'],
        ['Account verified and created successfully.', 'Cuenta verificada y creada correctamente.'],
        ['Enter the 6-digit verification code sent to your email.', 'Ingresa el código de verificación de 6 dígitos enviado a tu correo.'],
        ['Psychiatrist account (read-only) saved successfully.', 'Cuenta de psiquiatra (solo lectura) guardada correctamente.'],
        ['Psychiatrist account status updated.', 'Estado de cuenta de psiquiatra actualizado.'],
        ['Psychiatrist access revoked successfully.', 'Acceso de psiquiatra revocado correctamente.'],
        ['Sleep session updated successfully.', 'Sesión de sueño actualizada correctamente.'],
        ['Sleep record removed.', 'Registro de sueño eliminado.'],
        ['Activity saved successfully.', 'Actividad guardada correctamente.'],
        ['Activity updated successfully.', 'Actividad actualizada correctamente.'],
        ['Status updated.', 'Estado actualizado.'],
        ['Activity deleted successfully.', 'Actividad eliminada correctamente.'],
        ['Agenda item marked as Done.', 'Actividad marcada como Hecha.'],
        ['Academic, Residencias & Work schedule saved.', 'Horario académico, Residencias y Trabajo guardados.'],
        ['Live GPS cleared. Commutes now use your Saved Home as origin.', 'GPS en vivo limpiado. Los traslados ahora usan tu Casa guardada como origen.'],
        ['Phone GPS webhook token rotated. Previous token revoked.', 'Token de webhook GPS del celular rotado. El anterior fue revocado.'],
        ['Test notification sent to your phone notification channel.', 'Notificación de prueba enviada a tu canal del celular.'],
        ['Song registered in your English Music catalog.', 'Canción registrada en tu catálogo musical.'],
        ['Song metadata updated.', 'Metadatos de canción actualizados.'],
        ['Song study state updated.', 'Estado de estudio de la canción actualizado.'],
        ['Song deleted from music catalog.', 'Canción eliminada del catálogo musical.'],
        ['Artist updated successfully.', 'Artista actualizado correctamente.'],
        ['Album updated successfully.', 'Álbum actualizado correctamente.'],
        ['Album / Mini Album saved to catalog.', 'Álbum / Mini Álbum guardado en el catálogo.'],
        ['Album deleted successfully (its songs were preserved as standalone tracks).', 'Álbum eliminado correctamente (sus canciones se conservaron como sencillos).'],
        ['AI Learning Memory updated.', 'Memoria de aprendizaje de IA actualizada.'],
        ['Incorrect email or password.', 'Correo o contraseña incorrectos.'],
        ['Not authenticated', 'No autenticado'],
        ['Standard route', 'Ruta estándar'],
        ['Ruta estándar', 'Ruta estándar'],
        ['Light traffic', 'Tráfico despejado'],
        ['Moderate traffic', 'Tráfico moderado'],
        ['Heavy traffic', 'Tráfico pesado'],

        // --- Automatic SemVer 2.0.0 Version History UI ---
        ['Version', 'Versión'],
        ['View version history & SemVer 2.0.0 changelog', 'Ver historial de versiones y cambios SemVer 2.0.0'],
        ['Application Version & Release History (SemVer 2.0.0):', 'Versión de la Aplicación e Historial (SemVer 2.0.0):'],
        ['v1.0.0 · Checking deployment history...', 'v1.0.0 · Verificando historial de despliegues...'],
        ['📜 View Version History', '📜 Ver Historial de Versiones'],
        ['🏷️ Version History', '🏷️ Historial de Versiones'],
        ['Automatic deployment releases using Semantic Versioning (SemVer 2.0.0) & Conventional Commits.', 'Versiones generadas automáticamente en cada despliegue con Versionado Semántico (SemVer 2.0.0) y Conventional Commits.'],
        ['MAJOR +1.0.0', 'MAYOR +1.0.0'],
        ['MINOR +0.1.0', 'MENOR +0.1.0'],
        ['PATCH +0.0.1', 'PARCHE +0.0.1'],
        ['Loading version history...', 'Cargando historial de versiones...'],
        ['Quick visual cards, shortcuts, and step-by-step diagrams with minimal text.', 'Tarjetas visuales rápidas, atajos y diagramas paso a paso sin saturación de texto.'],
        ['Save All Settings', 'Guardar Todos los Ajustes'],
        ['Generate or enter a private topic below and subscribe to that same topic inside the phone app.', 'Genera o escribe un tema privado abajo y suscríbete a ese mismo tema dentro de la app del celular.'],
        ['🏢 Professional Internships', '🏢 Residencias Profesionales'],
        ['10 minutes before', '10 minutos antes'],
        ['Auto-detected from current address', 'Auto-detectado desde tu dirección actual'],
        ['BREAKING CHANGE / !:', 'CAMBIO INCOMPATIBLE / !:'],
        ['Context, cultural references, or things to review next time...', 'Contexto, referencias culturales o puntos a repasar después...'],
        ["Paste English, Korean (한국어), or mixed K-Pop lyrics here (or import .srt/.vtt/.lrc from yt-dlp) -> click 'Explain Lyrics & Romanize (AI)' (encrypted E2EE before leaving your browser)...", "Pega letras en inglés, coreano (한국어) o K-Pop mixto aquí (o importa .srt/.vtt/.lrc de yt-dlp) -> clic en 'Explicar Letra y Romanizar (IA)' (cifrado E2EE antes de salir de tu navegador)..."],
        ['Paste Google Maps link (maps.app.goo.gl / google.com/maps) or 25.43..., -100.99...', 'Pega un enlace de Google Maps (maps.app.goo.gl / google.com/maps) o 25.43..., -100.99...'],
        // --- Complete Server Validation, Rate Limits, Reminders & UI Feedback ---
        ['E2EE secret key saved in this browser.', 'Llave secreta E2EE guardada en este navegador.'],
        ['Local E2EE key removed from this browser.', 'Llave E2EE local eliminada de este navegador.'],
        ['Unlock & Save to Word', 'Desbloquear y guardar en Word'],
        ['Sleep log removed.', 'Registro de sueño eliminado.'],
        ['Could not delete sleep log.', 'No se pudo eliminar el registro de sueño.'],
        ['All-nighter / No sleep logged', 'Desvelo total / Sin horas de sueño'],
        ['Pending wake-up (Bedtime saved)', 'Pendiente despertar (hora de dormir guardada)'],
        ['Draft saved locally', 'Borrador guardado localmente'],
        ['Restored unsent draft', 'Se restauró tu borrador pendiente'],
        ['English note queued for Word (PC) & saved to AI Memory!', '¡Nota de idiomas encolada para Word (PC) y guardada en Memoria IA!'],
        ['Key Vocabulary, Particles & Expressions:', 'Vocabulario Clave, Partículas y Expresiones:'],
        ['Your AI memory bank will populate automatically as you analyze lyrics/phrases or save entries to your Word notebook.', 'Tu banco de memoria IA se llenará automáticamente cuando analices letras/frases o guardes entradas en tu Word.'],
        ['Type a phrase, Korean lyric, or question for the AI tutor.', 'Escribe una frase, letra en coreano o pregunta para el tutor IA.'],
        ['Filled Glossary study form from AI breakdown!', '¡Formulario de Glosario completado desde el análisis de la IA!'],
        ['Extract or paste the song lyrics first (above in yt-dlp Lyrics or in Lyrics Breakdown).', 'Extrae o pega primero la letra de la canción (arriba en Letra yt-dlp o en Lyrics Breakdown).'],
        ['Local romanization added to your pronunciation notes.', 'Romanización local agregada a tus notas de pronunciación.'],
        ['Added Romanization, Vocabulary & AI Notes below—ready to encrypt & save to Word!', '¡Romanización, Vocabulario y Notas IA agregadas abajo — listas para cifrar y guardar en Word!'],
        ['Copied translation into Glossary Study Form!', '¡Traducción copiada al formulario de estudio del Glosario!'],
        ['Translator window position reset.', 'Posición de la ventana del traductor restablecida.'],
        ['Select any registered song from the catalog (or fill Song Title + Main Artist above) to save private notes encrypted into Word.', 'Selecciona cualquier canción del catálogo (o llena Título + Artista arriba) para guardar notas privadas cifradas en Word.'],
        ['Update Song Metadata', 'Actualizar Metadatos de Canción'],
        ['Type a song or artist name first (e.g. BABYMONSTER DRIP).', 'Escribe primero el nombre de una canción o artista (ej. BABYMONSTER DRIP).'],
        ['Select Song', 'Seleccionar Canción'],
        ['Select a song from the catalog first ("Study -> Word").', 'Selecciona primero una canción del catálogo ("Study -> Word").'],
        ['Select a song from the catalog first.', 'Selecciona primero una canción del catálogo.'],
        ['Session viewer cleared (0 KB in DB; Word untouched).', 'Visor en sesión limpiado (0 KB en BD; Word intacto).'],
        ['Extract or paste the lyrics above first.', 'Primero extrae o pega la letra arriba.'],
        ['Lyrics copied to Breakdown / AI. Now you can explain/romanize or save to Word.', 'Letra copiada a Breakdown / IA. Ahora puedes explicar/romanizar o guardar a Word.'],
        ['Lyrics breakdown ready in your Word notebook.', 'Desglose de letra guardado en tu cuaderno de Word.'],
        ['Could not save study notes right now.', 'No se pudieron guardar las notas en este momento.'],
        ['Select "Copy" on the highlighted topic field.', 'Selecciona "Copiar" en el campo del tema resaltado.'],
        ['Test notification sent to your phone!', '¡Notificación de prueba enviada a tu celular!'],
        ['New Gemini key entered — click "🧪 Test AI Connection" or "Save All Settings" to save it.', 'Nueva clave Gemini ingresada — clic en "🧪 Probar Conexión IA" o "Guardar Todos los Ajustes" para guardarla.'],
        ['Key marked for removal—click "Save All Settings" to confirm.', 'Clave marcada para eliminarse — clic en "Guardar Todos los Ajustes" para confirmar.'],
        ['Testing Google Gemini API connection & verifying live models...', 'Probando conexión con Google Gemini API y verificando modelos disponibles...'],
        ['Key verified live — click "Save All Settings" below to store it encrypted.', 'Clave verificada en vivo — haz clic en "Guardar Todos los Ajustes" abajo para guardarla cifrada.'],
        ['Too many requests to the server. Please wait a moment and try again.', 'Demasiadas peticiones al servidor. Espera un momento e intenta de nuevo.'],
        ['Too many login attempts from this IP. Please wait 15 minutes.', 'Demasiados intentos de inicio de sesión desde esta IP. Espera 15 minutos.'],
        ['Too many failed attempts. Please wait 15 minutes.', 'Demasiados intentos fallidos. Espera 15 minutos.'],
        ['Too many verification code requests. Please wait a few minutes.', 'Demasiadas solicitudes de código de verificación. Espera unos minutos.'],
        ['Too many registration attempts. Please wait 15 minutes.', 'Demasiados intentos de registro. Espera 15 minutos.'],
        ['Too many password recovery requests. Please wait 15 minutes.', 'Demasiadas solicitudes de recuperación. Espera 15 minutos.'],
        ['Too many password reset attempts. Please wait 15 minutes.', 'Demasiados intentos de restablecimiento. Espera 15 minutos.'],
        ['Too many verification attempts. Please wait 15 minutes.', 'Demasiados intentos de verificación. Espera 15 minutos.'],
        ['Too many read requests. Please slow down briefly.', 'Demasiadas consultas seguidas. Reduce el ritmo brevemente.'],
        ['Too many write requests. Please slow down briefly.', 'Demasiados envíos seguidos. Reduce el ritmo brevemente.'],
        ['Too many PC sync enqueue requests. Please wait a moment.', 'Demasiados envíos hacia Word PC seguidos. Espera un momento.'],
        ['Too many PC sync polling requests. Please wait a moment.', 'Demasiadas consultas de sincronización PC. Espera un momento.'],
        ['Too many reminder actions. Please wait a moment.', 'Demasiadas acciones de recordatorio. Espera un momento.'],
        ['Too many transport handshake attempts. Please wait a moment.', 'Demasiados handshakes de cifrado seguidos. Espera un momento.'],
        ['Verification code sent to the owner email configured on the server.', 'Código de verificación enviado al correo del propietario configurado en el servidor.'],
        ['Class ID cannot exceed 60 characters.', 'El ID de la clase no puede exceder 60 caracteres.'],
        ['Class name cannot exceed 120 characters.', 'El nombre de la clase no puede exceder 120 caracteres.'],
        ['Notification server URL must be a valid HTTPS URL (e.g. https://ntfy.sh).', 'La URL del servidor de notificaciones debe ser HTTPS válido (ej. https://ntfy.sh).'],
        ['Notification server URL must use HTTPS.', 'La URL del servidor de notificaciones debe usar HTTPS.'],
        ['Notification server URL cannot include credentials, query strings, or fragments.', 'La URL de notificaciones no puede contener credenciales, query strings ni fragmentos.'],
        ['Private or local network hosts are not allowed for notification relays.', 'No se permiten hosts locales o de red privada para notificaciones.'],
        ['Invalid default agenda category.', 'Categoría predeterminada de agenda inválida.'],
        ['Invalid default agenda layout.', 'Diseño predeterminado de agenda inválido.'],
        ['Invalid YouTube platform mode.', 'Modo de plataforma YouTube inválido.'],
        ['Invalid IANA timezone (e.g. America/Monterrey).', 'Zona horaria IANA inválida (ej. America/Monterrey).'],
        ['App public URL must look like http://host:3000 or https://example.com.', 'La URL pública de la app debe tener formato http://host:3000 o https://ejemplo.com.'],
        ['Phone notification topic must be 8–80 characters (letters, numbers, "_" or "-").', 'El tema de notificaciones móvil debe medir 8–80 caracteres (letras, números, "_" o "-").'],
        ['Enter or generate a private ntfy topic before enabling phone notifications.', 'Ingresa o genera primero un tema privado ntfy antes de activar avisos en tu celular.'],
        ['Notification priority must be an integer between 1 and 5.', 'La prioridad de notificación debe ser un entero entre 1 y 5.'],
        ['Agenda lead minutes must be between 0 and 120.', 'Los minutos de anticipación de agenda deben estar entre 0 y 120.'],
        ['English study days must be an array of weekday numbers (0-6).', 'Los días de estudio deben enviarse como arreglo numérico (0-6).'],
        ['English study days must contain integers from 0 (Sun) to 6 (Sat).', 'Los días de estudio deben contener enteros de 0 (Dom) a 6 (Sáb).'],
        ['English study reminder note cannot exceed 200 characters.', 'La nota del recordatorio de idiomas no puede exceder 200 caracteres.'],
        ['Gemini API key exceeds maximum allowed length (180 characters).', 'La clave Gemini API excede el límite permitido (180 caracteres).'],
        ['Finish Morning Sleep Log', 'Completar Registro de Sueño Matutino'],
        ['Remember to log last night’s bedtime, wake-up time, and rest quality. You can snooze if needed.', 'Recuerda registrar a qué hora te dormiste anoche, cuándo despertaste y cómo descansaste. Puedes posponer si lo necesitas.'],
        ["Remember to log last night's bedtime, wake-up time, and rest quality. You can snooze if needed.", 'Recuerda registrar a qué hora te dormiste anoche, cuándo despertaste y cómo descansaste. Puedes posponer si lo necesitas.'],
        ['Test alert delivered! Reminders for Mood, Sleep, Agenda, Word Notes, and English Study will appear here.', '¡Alerta de prueba enviada! Aquí aparecerán los recordatorios de Ánimo, Sueño, Agenda, Notas Word y Estudio de Idiomas.'],
        ['Phone GPS location updated over HTTP webhook.', 'Ubicación GPS del teléfono actualizada por webhook HTTP.'],
        ['Tap to capture your OPPO A79 location (or paste a Maps link) and update campus commute times.', 'Toca para capturar la ubicación de tu OPPO A79 (o pega un link de Maps) y actualizar tiempos de traslado.'],
        ['GPS request sent to your phone via ntfy! Tap the notification on your phone to send its location.', '¡Solicitud GPS enviada a tu celular vía ntfy! Toca la notificación en tu teléfono para mandar su ubicación.'],
        ['Invalid YouTube / YouTube Music URL.', 'URL de YouTube / YouTube Music inválida.'],
        ['YouTube Music URL must use HTTPS.', 'La URL de YouTube Music debe usar HTTPS.'],
        ['URLs cannot contain embedded credentials.', 'Las URLs no pueden contener credenciales incrustadas.'],
        ['Only youtube.com, music.youtube.com, or youtu.be URLs are allowed.', 'Solo se permiten URLs de youtube.com, music.youtube.com o youtu.be.'],
        ['Could not extract a valid YouTube Music track, video, or playlist link.', 'No se pudo extraer un enlace válido de canción, video o playlist de YouTube Music.'],
        ['Song title is required (max 180 characters).', 'El título de la canción es obligatorio (máx. 180 caracteres).'],
        ['Main artist or group name is required (max 140 characters).', 'El artista o grupo principal es obligatorio (máx. 140 caracteres).'],
        ['Short study focus must be <= 255 chars. Keep long lyrics & translations encrypted to Word on your PC.', 'El enfoque corto debe medir <= 255 caracteres. Deja letras largas cifradas hacia tu Word PC.'],
        ['Album / Mini Album title must be <= 180 characters.', 'El título del Álbum / Mini Álbum debe medir <= 180 caracteres.'],
        ['Album release year must be between 1900 and 2100.', 'El año del álbum debe estar entre 1900 y 2100.'],
        ['Track number must be between 1 and 999.', 'El número de pista debe estar entre 1 y 999.'],
        ['Upstream media stream rejected playback or returned no body.', 'El stream multimedia externo rechazó la reproducción o no devolvió contenido.'],
        ['Failed to stream track through server.', 'No se pudo transmitir la canción desde el servidor.']
    ];

    var EN_FROM_KEY = new Map();
    var ES_FROM_KEY = new Map();

    PAIRS.forEach(function (pair) {
        var en = pair[0];
        var es = pair[1];
        var nkEn = normKey(en);
        var nkEs = normKey(es);
        if (!EN_FROM_KEY.has(nkEn)) EN_FROM_KEY.set(nkEn, en);
        if (!ES_FROM_KEY.has(nkEn)) ES_FROM_KEY.set(nkEn, es);
        if (!EN_FROM_KEY.has(nkEs)) EN_FROM_KEY.set(nkEs, en);
        if (!ES_FROM_KEY.has(nkEs)) ES_FROM_KEY.set(nkEs, es);
    });

    /* ------------------------------------------------------------------
       Trusted Static Compound HTML Blocks (data-i18n-html="key")
       Strictly static curated fragments (never fed with user data).
       ------------------------------------------------------------------ */
    var HTML_BLOCKS = {
        auth_admin_hint: {
            en: 'The email configured as owner (<strong>ADMIN_EMAIL</strong>) gets full access. Any other authorized email is registered as <strong>Psychiatrist (read-only)</strong>.',
            es: 'El correo configurado como propietario (<strong>ADMIN_EMAIL</strong>) obtiene acceso completo. Cualquier otro correo autorizado se registra como <strong>Psiquiatra (solo lectura)</strong>.'
        },
        auth_verify_hint: {
            en: 'Enter the code sent to your owner email (<strong>ADMIN_EMAIL</strong>) or your personal secret key (<strong>ADMIN_SECRET</strong> / Word key).',
            es: 'Ingresa el código enviado al correo del propietario (<strong>ADMIN_EMAIL</strong>) o tu clave secreta personal (<strong>ADMIN_SECRET</strong> / clave Word).'
        },
        crisis_ctrl_enter_hint: {
            en: 'Tip: Press <code>Ctrl + Enter</code> inside this box to save right away.',
            es: 'Tip: Presiona <code>Ctrl + Enter</code> dentro de este cuadro para guardar al instante.'
        },
        music_privacy_callout: {
            en: '<strong>Private Study &amp; Copyright:</strong> Only artist names, albums, and official YouTube study links are stored here. Your lyrics, notes, and practices remain private inside your Word notebook on your PC.',
            es: '<strong>Uso Privado y Derechos de Autor:</strong> Aquí solo guardas nombres de artistas, álbumes y enlaces oficiales de YouTube para estudiar. Tus letras, notas y prácticas viven únicamente dentro de tu cuaderno privado de Word en tu computadora.'
        },
        sleep_desvelo_checkbox_label: {
            en: '🦉 Mark as <strong>Desvelo / Late Bedtime</strong> (highlighted in Psychiatrist Weekly Summary)',
            es: '🦉 Marcar como <strong>Desvelo / Dormido tarde</strong> (se resalta en Resumen Semanal para el psiquiatra)'
        },
        sleep_side_tip: {
            en: '<strong>Tip:</strong> Bedtimes between <strong>1:00 AM and 5:59 AM</strong> (like 3:00 AM) are automatically flagged as <strong>Desvelo</strong> for your psychiatrist. If you are just going to bed at 3:00 AM, check <em>"Going to sleep just now"</em> to save your bedtime right away and complete your wake-up time in the morning!',
            es: '<strong>Tip:</strong> Horarios de dormir entre <strong>1:00 AM y 5:59 AM</strong> (como 3:00 AM) se marcan automáticamente como <strong>Desvelo</strong> para tu psiquiatra. Si te vas durmiendo a esa hora, marca <em>"Me voy durmiendo ahorita"</em> para guardar la hora al instante y completar al despertar.'
        },
        yt_platform_safety_hint: {
            en: 'Auto mode uses <strong>standard YouTube</strong> on PC and <strong>YouTube Music</strong> on mobile, opening individual tracks without altering your personal playlists.',
            es: 'El modo Auto usa <strong>YouTube estándar</strong> en PC y <strong>YouTube Music</strong> en celular, abriendo pistas individuales sin alterar jamás tus playlists personales.'
        },
        commute_rules_hint: {
            en: 'If you are at Home or far from the Tec (or it is your first class of the day), Daily Hub notifies you <strong>at least 30 minutes before</strong> (or earlier if driving + traffic takes longer). If you are already at or near the Tec, it notifies you <strong>10 minutes before</strong> with walking time between buildings.',
            es: 'Si estás en Casa o lejos del Tec (o es tu primera clase del día), Daily Hub te avisa <strong>al menos 30 minutos antes</strong> (o más temprano si el tráfico tarda más). Si ya estás dentro o cerca del Tec, te avisa <strong>10 minutos antes</strong> considerando la caminata entre edificios.'
        },
        home_loc_hint: {
            en: 'Enter your Saltillo street address or paste a Google Maps link, then click <strong>Save &amp; Find Home Location</strong>.',
            es: 'Ingresa tu dirección en Saltillo o pega un enlace de Google Maps, luego presiona <strong>💾 Guardar y 🔍 Ubicar Casa</strong>.'
        },
        phone_gps_http_hint: {
            en: 'Because this server uses plain <code>http://</code> without a domain, Chrome/OPPO A79 blocks silent background browser GPS unless you either: (1) tap <strong>📲 Ping Phone GPS (ntfy)</strong>, (2) whitelist this HTTP origin once in Chrome flags, or (3) paste this signed webhook URL into Android <strong>MacroDroid / Automate</strong> to send real phone GPS automatically.',
            es: 'Como este servidor usa <code>http://</code> sin dominio, Chrome/OPPO A79 bloquea el GPS silencioso del navegador a menos que: (1) toques <strong>📲 Pedir GPS al Celular (ntfy)</strong>, (2) habilites este origen HTTP una vez en Chrome flags, o (3) pegues esta URL webhook firmada en Android <strong>MacroDroid / Automate</strong> para enviar GPS real automáticamente.'
        },
        phone_webhook_syntax: {
            en: 'Send <code>GET</code> with <code>&amp;lat=25.44&amp;lng=-100.99</code> OR <code>POST JSON</code>:',
            es: 'Envía <code>GET</code> con <code>&amp;lat=25.44&amp;lng=-100.99</code> O <code>POST JSON</code>:'
        },
        chrome_flags_step1: {
            en: '1. On your phone Chrome open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> (Edge PC: <code>edge://flags/#unsafely-treat-insecure-origin-as-secure</code>).',
            es: '1. En Chrome de tu celular abre <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> (en Edge PC: <code>edge://flags/#unsafely-treat-insecure-origin-as-secure</code>).'
        },
        chrome_flags_step2_pre: {
            en: '2. Add ',
            es: '2. Agrega '
        },
        chrome_flags_step2_post: {
            en: ', select <strong>Enabled</strong>, tap <strong>Relaunch</strong>.',
            es: ', selecciona <strong>Enabled</strong> y presiona <strong>Relaunch</strong>.'
        },
        medico_readonly_banner: {
            en: '🩺 <strong>Clinical View (Read-Only):</strong> Authorized view of Mood Tracker, Sleep &amp; Desvelo Log &amp; Crisis Log.',
            es: '🩺 <strong>Vista Clínica (Solo Lectura):</strong> Acceso autorizado al historial semanal de Ánimo, Sueño, Desvelos y Crisis.'
        },
        psychiatrist_privacy_hint: {
            en: 'Create or manage a <strong>read-only</strong> clinician account. Doctors can view Weekly Mood, Sleep &amp; Crisis Summary only — never personal journal notes, agenda, or editing.',
            es: 'Crea o administra una cuenta médica de <strong>solo lectura</strong>. Los médicos únicamente pueden ver Resumen Semanal de Ánimo, Sueño y Crisis — nunca notas del diario, agenda ni edición.'
        },
        ntfy_step_1: {
            en: 'Install the free <strong>ntfy</strong> app on your phone.',
            es: 'Instala la app gratuita <strong>ntfy</strong> en tu celular.'
        },
        ntfy_step_3: {
            en: 'Save Settings and click <strong>Send Test Notification</strong> below.',
            es: 'Guarda los ajustes y presiona <strong>Enviar Prueba al Celular</strong> abajo.'
        },
        rem_mood_title: {
            en: '<strong>Mood Tracker</strong> — Automatic mid-window check-ins',
            es: '<strong>Estado de Ánimo</strong> — Recordatorios automáticos a mitad de bloque'
        },
        rem_sleep_title: {
            en: '<strong>Morning Sleep Log</strong> (supports Snooze / Postpone)',
            es: '<strong>Registro Matutino de Sueño</strong> (con opción Posponer / Snooze)'
        },
        rem_agenda_title: {
            en: '<strong>Weekly Agenda</strong> — Events &amp; Tasks alerts',
            es: '<strong>Agenda Semanal</strong> — Alertas de Eventos y Tareas'
        },
        rem_word_title: {
            en: '<strong>End-of-Day Word Notes Check</strong> (Journal &amp; English .docx)',
            es: '<strong>Revisión Nocturna de Notas Word</strong> (Diario e Idiomas .docx)'
        },
        gemini_perf_desc: {
            en: 'Connect your <strong>Google Gemini</strong> API key for contextual explanations, stanza-by-stanza song study, and interactive lessons (only active verified models appear in your selector), alongside an instant local pronunciation mode.',
            es: 'Conecta tu clave de <strong>Google Gemini</strong> para explicaciones contextuales, análisis por estrofas y lecciones interactivas (solo verás aquí los modelos activos disponibles en tu clave), junto con un modo local instantáneo de pronunciación.'
        },
        gemini_step_1: {
            en: 'Create a free key in <strong>Google AI Studio</strong> (<code>https://aistudio.google.com/apikey</code> → <em>Create API key</em>).',
            es: 'Obtén tu clave gratuita en <strong>Google AI Studio</strong> (<code>https://aistudio.google.com/apikey</code> → <em>Create API key</em>).'
        },
        gemini_step_2: {
            en: 'Paste it below and click <strong>🧪 Test AI Connection</strong> to detect your active available models automatically.',
            es: 'Pégala abajo y presiona <strong>🧪 Probar Conexión IA</strong> para detectar automáticamente los modelos activos autorizados en tu cuenta.'
        },
        gemini_step_3: {
            en: 'Click <strong>Save All Settings</strong> at the bottom to store it securely encrypted.',
            es: 'Presiona <strong>Guardar Todos los Ajustes</strong> al final de la página para guardarla de forma cifrada.'
        },
        x25519_desc: {
            en: 'All information traveling between your phone, computer, and account is protected with end-to-end encryption to safeguard your private notes.',
            es: 'Toda la información entre tu teléfono, tu computadora y tu cuenta viaja cifrada para proteger tus notas y datos personales.'
        },
        e2ee_modal_subtitle: {
            en: 'Your Journal and English Notebook entries are encrypted in your browser before leaving this device. Enter your exact <strong>32-character AES key</strong> (stored only in this browser, never sent to the server).',
            es: 'Tus notas de Diario y Cuaderno de Idiomas se cifran en tu navegador antes de salir de este dispositivo. Ingresa exactamente tu <strong>llave AES de 32 caracteres</strong> (guardada solo localmente, nunca se envía al servidor).'
        },
        quick_loc_http_notice: {
            en: '<strong>📱 Phone GPS over Plain HTTP (No Domain Needed):</strong> Browsers (Chrome on OPPO A79, Edge on PC) block <code>navigator.geolocation</code> on plain <code>http://</code> unless enabled in flags below. Use <strong>📲 Ping My Phone (ntfy)</strong>, pick <strong>Saved Home / 1-Tap Presets</strong>, or paste your <strong>street address or Google Maps Share link</strong>:',
            es: '<strong>📱 GPS del Celular sobre HTTP (Sin Dominio):</strong> Los navegadores (Chrome en OPPO A79, Edge en PC) bloquean <code>navigator.geolocation</code> en <code>http://</code> a menos que lo actives abajo. Usa <strong>📲 Pedir GPS al Celular (ntfy)</strong>, elige <strong>Casa Guardada / Atajos en 1 Toque</strong> o pega tu <strong>dirección o enlace de Google Maps</strong>:'
        },
        popup_chrome_tip: {
            en: '💡 Chrome / Edge Tip: open menu <strong>⋮ → Save and share → Create shortcut (Open as window)</strong> to pin this translator to your Windows taskbar like a standalone extension.',
            es: '💡 Tip Chrome / Edge: abre el menú <strong>⋮ → Guardar y compartir → Crear acceso directo (Abrir como ventana)</strong> para fijar este traductor en tu barra de Windows como si fuera una app/extensión propia.'
        }
    };

    /* ------------------------------------------------------------------
       Domain Enum & Label Translators (Preserves MySQL keys!)
       ------------------------------------------------------------------ */
    var MOMENT_NAMES = {
        Madrugada: { en: 'Late Night', es: 'Madrugada' },
        Morning: { en: 'Morning', es: 'Mañana' },
        Noon: { en: 'Noon', es: 'Mediodía' },
        Afternoon: { en: 'Afternoon', es: 'Tarde' },
        Night: { en: 'Night', es: 'Noche' }
    };

    var MOOD_NAMES = {
        Happy: { en: 'Happy', es: 'Feliz' },
        Calm: { en: 'Calm', es: 'Tranquilo/a' },
        Excited: { en: 'Excited', es: 'Emocionado/a' },
        Tired: { en: 'Tired', es: 'Cansado/a' },
        Sad: { en: 'Sad', es: 'Triste' },
        Angry: { en: 'Angry', es: 'Enojado/a' },
        Worried: { en: 'Worried', es: 'Preocupado/a' },
        Scared: { en: 'Scared', es: 'Asustado/a' },
        Focused: { en: 'Focused', es: 'Concentrado/a' },
        Motivated: { en: 'Motivated', es: 'Motivado/a' },
        Stressed: { en: 'Stressed', es: 'Estresado/a' },
        Frustrated: { en: 'Frustrated', es: 'Frustrado/a' },
        Bored: { en: 'Bored', es: 'Aburrido/a' },
        Anxious: { en: 'Anxious', es: 'Ansioso/a' },
        Distracted: { en: 'Distracted', es: 'Distraído/a' },
        Desperate: { en: 'Desperate', es: 'Desesperado/a' }
    };

    var DAY_NAMES = {
        dom: { en: 'Sunday', es: 'Domingo', shortEn: 'Sun', shortEs: 'Dom' },
        lun: { en: 'Monday', es: 'Lunes', shortEn: 'Mon', shortEs: 'Lun' },
        mar: { en: 'Tuesday', es: 'Martes', shortEn: 'Tue', shortEs: 'Mar' },
        mie: { en: 'Wednesday', es: 'Miércoles', shortEn: 'Wed', shortEs: 'Mié' },
        jue: { en: 'Thursday', es: 'Jueves', shortEn: 'Thu', shortEs: 'Jue' },
        vie: { en: 'Friday', es: 'Viernes', shortEn: 'Fri', shortEs: 'Vie' },
        sab: { en: 'Saturday', es: 'Sábado', shortEn: 'Sat', shortEs: 'Sáb' },
        Sunday: { en: 'Sunday', es: 'Domingo', shortEn: 'Sun', shortEs: 'Dom' },
        Monday: { en: 'Monday', es: 'Lunes', shortEn: 'Mon', shortEs: 'Lun' },
        Tuesday: { en: 'Tuesday', es: 'Martes', shortEn: 'Tue', shortEs: 'Mar' },
        Wednesday: { en: 'Wednesday', es: 'Miércoles', shortEn: 'Wed', shortEs: 'Mié' },
        Thursday: { en: 'Thursday', es: 'Jueves', shortEn: 'Thu', shortEs: 'Jue' },
        Friday: { en: 'Friday', es: 'Viernes', shortEn: 'Fri', shortEs: 'Vie' },
        Saturday: { en: 'Saturday', es: 'Sábado', shortEn: 'Sat', shortEs: 'Sáb' }
    };

    var CRISIS_TYPES = {
        'Estrés': { en: '😣 Stress', es: '😣 Estrés', plainEn: 'Stress', plainEs: 'Estrés' },
        'Ira / Rabia': { en: '😠 Anger / Rage', es: '😠 Ira / Rabia', plainEn: 'Anger / Rage', plainEs: 'Ira / Rabia' },
        'Ansiedad': { en: '😰 Anxiety', es: '😰 Ansiedad', plainEn: 'Anxiety', plainEs: 'Ansiedad' },
        'Pánico': { en: '🫨 Panic', es: '🫨 Pánico', plainEn: 'Panic', plainEs: 'Pánico' },
        'Llanto / Sobrecarga': { en: '😢 Crying / Overload', es: '😢 Llanto / Sobrecarga', plainEn: 'Crying / Overload', plainEs: 'Llanto / Sobrecarga' },
        'Bloqueo / Saturación': { en: '🧱 Shutdown / Overwhelmed', es: '🧱 Bloqueo / Saturación', plainEn: 'Shutdown / Overwhelmed', plainEs: 'Bloqueo / Saturación' },
        'Insomnio / Agitación': { en: '🌘 Insomnia / Restlessness', es: '🌘 Insomnio / Agitación', plainEn: 'Insomnia / Restlessness', plainEs: 'Insomnio / Agitación' },
        'Otro': { en: '📝 Other', es: '📝 Otro', plainEn: 'Other', plainEs: 'Otro' }
    };

    function getLang() {
        return currentLang;
    }

    function pick(en, es) {
        return currentLang === 'es' ? es : en;
    }

    function locale() {
        return currentLang === 'es' ? 'es-MX' : 'en-US';
    }

    function formatDate(dateVal, opts) {
        var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (Number.isNaN(d.getTime())) return String(dateVal || '');
        return d.toLocaleDateString(locale(), opts || {});
    }

    function momentLabel(momentKey) {
        var entry = MOMENT_NAMES[momentKey];
        if (!entry) return String(momentKey || '');
        return currentLang === 'es' ? entry.es : entry.en;
    }

    function moodLabel(moodKey) {
        var entry = MOOD_NAMES[moodKey];
        if (!entry) return String(moodKey || '');
        return currentLang === 'es' ? entry.es : entry.en;
    }

    function sleepQualityLabel(q) {
        if (q === 'Good') return pick('🟢 Good / Restorative', '🟢 Bueno / Reparador');
        if (q === 'Bad') return pick('🔴 Poor / Heavy', '🔴 Malo / Pesado');
        return pick('🟡 Fair / Light', '🟡 Regular / Ligero');
    }

    function agendaStatusLabel(status) {
        if (status === 'done') return pick('Done', 'Completado');
        if (status === 'in_progress') return pick('In Progress', 'En progreso');
        return pick('To Do', 'Por hacer');
    }

    function agendaBlockLabel(blockKey) {
        if (blockKey === 'manana') return pick('Morning', 'Mañana');
        if (blockKey === 'cole') return pick('At School / Classes', 'En Escuela / Clases');
        if (blockKey === 'tarde') return pick('Afternoon', 'Tarde');
        if (blockKey === 'noche') return pick('Night', 'Noche');
        return String(blockKey || '');
    }

    function agendaDayName(dayKeyOrEn, shortForm) {
        var d = DAY_NAMES[dayKeyOrEn];
        if (!d) return String(dayKeyOrEn || '');
        if (shortForm) return currentLang === 'es' ? d.shortEs : d.shortEn;
        return currentLang === 'es' ? d.es : d.en;
    }

    function crisisTypeLabel(val, plain) {
        var c = CRISIS_TYPES[val];
        if (!c) return String(val || '');
        if (plain) return currentLang === 'es' ? c.plainEs : c.plainEn;
        return currentLang === 'es' ? c.es : c.en;
    }

    function crisisIntensityLabel(lvl) {
        var n = Math.min(5, Math.max(1, Number(lvl) || 3));
        var map = {
            1: ['1 · Mild', '1 · Leve'],
            2: ['2 · Moderate', '2 · Moderada'],
            3: ['3 · Strong', '3 · Fuerte'],
            4: ['4 · Very Strong', '4 · Muy Fuerte'],
            5: ['5 · Severe', '5 · Severa']
        };
        return currentLang === 'es' ? map[n][1] : map[n][0];
    }

    function musicStatusLabel(statusKey) {
        if (statusKey === 'dominada') return pick('Mastered', 'Dominada');
        if (statusKey === 'en_progreso') return pick('In Progress', 'En Progreso');
        return pick('To Study', 'Por Estudiar');
    }

    function musicLanguageLabel(langKey) {
        if (langKey === 'en') return pick('English', 'Inglés');
        if (langKey === 'kr') return pick('Korean (한국어)', 'Coreano (한국어)');
        if (langKey === 'other') return pick('Other', 'Otro');
        return pick('English + Korean (K-Pop)', 'Inglés + Coreano (K-Pop)');
    }

    function translatePattern(text) {
        var s = String(text || '');
        var trim = s.trim();
        if (!trim) return s;

        var m;
        // 0 / 32 characters <-> 0 / 32 caracteres
        if ((m = trim.match(/^(\d+)\s*\/\s*32\s*(characters|caracteres)$/i))) {
            return m[1] + ' / 32 ' + pick('characters', 'caracteres');
        }
        // Intensity 3/5 <-> Intensidad 3/5
        if ((m = trim.match(/^(Intensity|Intensidad)\s*(\d+)\s*\/\s*5$/i))) {
            return pick('Intensity', 'Intensidad') + ' ' + m[2] + '/5';
        }
        // 0 words · 0 chars <-> 0 palabras · 0 caracteres
        if ((m = trim.match(/^(\d+)\s*(word|words|palabra|palabras)\s*·\s*(\d+)\s*(char|chars|carácter|caracteres)$/i))) {
            var w = Number(m[1]);
            var wLbl = w === 1 ? pick('word', 'palabra') : pick('words', 'palabras');
            return w + ' ' + wLbl + ' · ' + m[3] + ' ' + pick('chars', 'caracteres');
        }
        // Translation (Noun) <-> Traducción (Noun)
        if ((m = trim.match(/^(Translation|Traducción)\s*\(([^)]+)\)$/i))) {
            return pick('Translation', 'Traducción') + ' (' + m[2] + ')';
        }
        // Pronunciación / Romanization: xxx <-> Pronunciation / Romanization: xxx
        if ((m = trim.match(/^(Pronunciation|Pronunciación)\s*\/\s*Romanization:\s*(.+)$/i))) {
            return pick('Pronunciation / Romanization', 'Pronunciación / Romanización') + ': ' + m[2];
        }
        // Otras formas / matices: xxx <-> Other forms / nuances: xxx
        if ((m = trim.match(/^(Other forms \/ nuances|Otras formas \/ matices):\s*(.+)$/i))) {
            return pick('Other forms / nuances', 'Otras formas / matices') + ': ' + m[2];
        }
        // Ejemplo: xxx <-> Example: xxx
        if ((m = trim.match(/^(Example|Ejemplo):\s*(.+)$/i))) {
            return pick('Example', 'Ejemplo') + ': ' + m[2];
        }
        // Moment: Late Night <-> Momento: Madrugada
        if ((m = trim.match(/^(Moment|Momento):\s*(.+)$/i))) {
            var rawMom = m[2].trim();
            var key = rawMom === 'Late Night' || rawMom === 'Madrugada' ? 'Madrugada'
                : (rawMom === 'Morning' || rawMom === 'Mañana' ? 'Morning'
                    : (rawMom === 'Noon' || rawMom === 'Mediodía' ? 'Noon'
                        : (rawMom === 'Afternoon' || rawMom === 'Tarde' ? 'Afternoon'
                            : (rawMom === 'Night' || rawMom === 'Noche' ? 'Night' : rawMom))));
            return pick('Moment: ', 'Momento: ') + momentLabel(key);
        }
        if ((m = trim.match(/^(Current moment|Momento actual):\s*(.+)$/i))) {
            var rm = m[2].trim();
            var mk = rm === 'Late Night' || rm === 'Madrugada' ? 'Madrugada'
                : (rm === 'Morning' || rm === 'Mañana' ? 'Morning'
                    : (rm === 'Noon' || rm === 'Mediodía' ? 'Noon'
                        : (rm === 'Afternoon' || rm === 'Tarde' ? 'Afternoon'
                            : (rm === 'Night' || rm === 'Noche' ? 'Night' : rm))));
            return pick('Current moment: ', 'Momento actual: ') + momentLabel(mk);
        }
        // 0 classes <-> 0 clases
        if ((m = trim.match(/^(\d+)\s*(classes|class\(es\)|clases|clase\(s\))$/i))) {
            return m[1] + ' ' + (Number(m[1]) === 1 ? pick('class', 'clase') : pick('classes', 'clases'));
        }
        return null;
    }

    function translateText(raw) {
        if (typeof raw !== 'string') return raw;
        var norm = normKey(raw);
        if (!norm) return raw;

        var targetMap = currentLang === 'es' ? ES_FROM_KEY : EN_FROM_KEY;
        var exact = targetMap.get(norm);
        if (exact) {
            var lead = (raw.match(/^\s*/) || [''])[0];
            var trail = (raw.match(/\s*$/) || [''])[0];
            return lead + exact + trail;
        }

        var pat = translatePattern(raw);
        if (pat !== null) {
            var pLead = (raw.match(/^\s*/) || [''])[0];
            var pTrail = (raw.match(/\s*$/) || [''])[0];
            return pLead + pat + pTrail;
        }
        return raw;
    }

    function translateServerMessage(msg) {
        if (!msg) return '';
        var str = String(msg).trim();
        var mapped = translateText(str);
        if (mapped !== str) return mapped;

        if (currentLang === 'es') {
            var rulesEs = [
                [/^Too many (login|failed|registration|password recovery|password reset|verification) attempts/i, 'Demasiados intentos recientes. Por favor espera unos minutos.'],
                [/^Model "([^"]+)" returned HTTP 404.*$/i, 'El modelo "$1" devolvió HTTP 404 en Google Gemini API. Prueba "Probar Conexión IA" en Ajustes.'],
                [/^Gemini rate limit \/ quota exceeded.*$/i, 'Límite / cuota de Gemini excedida (429). Intenta gemini-flash-latest o gemini-2.5-flash-lite en 1 minuto.'],
                [/^Timed out contacting Google Gemini API.*$/i, 'Tiempo agotado al contactar Google Gemini API. Verifica tu conexión HTTPS saliente.'],
                [/^Synced (\d+) schedule item\(s\) to Weekly Agenda(.*)$/i, 'Se sincronizaron $1 actividades a tu Agenda Semanal$2'],
                [/^Selected class was not found in your semester schedule\.?$/i, 'La clase seleccionada no se encontró en tu horario semestral.'],
                [/^Mood Check-in \((.+)\)$/i, 'Registro de Ánimo ($1)'],
                [/^Mid-(.+) check-in:\s*log how you feel right now in Daily Hub\.?$/i, 'Recordatorio de $1: registra cómo te sientes ahora en Daily Hub.'],
                [/^Pending Mood Check-in \((.+)\)$/i, 'Ánimo pendiente por registrar ($1)'],
                [/^You still have unlogged mood block\(s\) for today \((.+)\)\.\s*Tap to record your mood in Daily Hub\.?$/i, 'Aún tienes bloque(s) sin registrar hoy ($1). Toca aquí para registrar tu ánimo en Daily Hub.'],
                [/^You logged bedtime at ([^\s]+) \(Desvelo\)\.\s*Tap to record when you woke up\.?$/i, 'Registraste tu hora de dormir a las $1 (Desvelo). Toca para registrar a qué hora despertaste.'],
                [/^Welcome,\s*(.+)!\s*Your session stays active until Sunday at 00:00\.?$/i, '¡Bienvenido(a), $1! Tu sesión permanece activa hasta el domingo a las 00:00.'],
                [/^Imported (\d+) lyric lines cleanly \(E2EE local only\)\.?$/i, 'Se importaron $1 líneas limpias de letra (solo cifrado local E2EE).'],
                [/^Cleaned timestamps \((\d+) lines ready\)\.?$/i, 'Marcas de tiempo limpiadas ($1 líneas listas).'],
                [/^Playback link mode set to:\s*(.+)$/i, 'Modo de enlace configurado a: $1'],
                [/^Could not load music catalog:\s*(.+)$/i, 'No se pudo cargar el catálogo musical: $1'],
                [/^Could not read file:\s*(.+)$/i, 'No se pudo leer el archivo: $1']
            ];
            for (var i = 0; i < rulesEs.length; i++) {
                if (rulesEs[i][0].test(str)) return str.replace(rulesEs[i][0], rulesEs[i][1]);
            }
        } else {
            var rulesEn = [
                [/^Modelo "([^"]+)" devolvió 404;\s*se usó "([^"]+)"\.(.*)$/i, 'Model "$1" returned 404; auto-switched to "$2".$3'],
                [/^Sin traducción exacta en diccionario local \((.+)\)$/i, 'No exact match in local dictionary ($1)'],
                [/^Activa Google Gemini API en Settings.*$/i, 'Enable your Google Gemini key in Settings for contextual translations, song breakdowns, and interactive examples.'],
                [/^¡Letra guardada automáticamente en tu cuaderno Word!$/i, 'Lyrics saved automatically in your Word notebook!'],
                [/^Letra cargada y lista para estudiar\.$/i, 'Lyrics loaded and ready to study.']
            ];
            for (var j = 0; j < rulesEn.length; j++) {
                if (rulesEn[j][0].test(str)) return str.replace(rulesEn[j][0], rulesEn[j][1]);
            }
        }
        return str;
    }

    function isProtectedElement(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.closest('[data-no-i18n="true"]')) return true;
        var tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE' || tag === 'TEXTAREA' || tag === 'NOSCRIPT') {
            return true;
        }
        return false;
    }

    function translateAttributes(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.hasAttribute('data-no-i18n-attrs')) return;
        var attrs = ['placeholder', 'title', 'aria-label', 'data-title'];
        for (var i = 0; i < attrs.length; i++) {
            var attr = attrs[i];
            if (!el.hasAttribute(attr)) continue;
            var cur = el.getAttribute(attr);
            var dsKey = attrPrefix + attr.replace(/[^a-zA-Z0-9]/g, '_');
            var orig = el.dataset ? el.dataset[dsKey] : undefined;
            if (orig === undefined) {
                orig = cur;
                if (el.dataset) el.dataset[dsKey] = orig;
            } else {
                // If app code deliberately updated the attribute to a new non-translated value, refresh origin
                var curNorm = normKey(cur);
                var prevEn = EN_FROM_KEY.get(normKey(orig));
                var prevEs = ES_FROM_KEY.get(normKey(orig));
                if (cur !== orig && curNorm !== normKey(prevEn) && curNorm !== normKey(prevEs)) {
                    orig = cur;
                    if (el.dataset) el.dataset[dsKey] = orig;
                }
            }
            var nextVal = translateText(orig);
            if (nextVal !== cur) {
                el.setAttribute(attr, nextVal);
            }
        }
    }

    function translateTextNode(node) {
        if (!node || node.nodeType !== 3) return;
        var parent = node.parentElement;
        if (!parent || isProtectedElement(parent)) return;
        if (parent.closest('[data-i18n-html]')) return;

        var cur = node.nodeValue || '';
        if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(cur)) return;

        var orig = nodeOriginals ? nodeOriginals.get(node) : undefined;
        if (orig === undefined) {
            orig = cur;
            if (nodeOriginals) nodeOriginals.set(node, orig);
        } else {
            var curNorm = normKey(cur);
            var origNorm = normKey(orig);
            var prevEn = EN_FROM_KEY.get(origNorm);
            var prevEs = ES_FROM_KEY.get(origNorm);
            if (cur !== orig && curNorm !== normKey(prevEn) && curNorm !== normKey(prevEs)) {
                orig = cur;
                if (nodeOriginals) nodeOriginals.set(node, orig);
            }
        }

        var next = translateText(orig);
        if (next !== cur) {
            node.nodeValue = next;
        }
    }

    function translateHtmlBlocks(rootEl) {
        if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
        var blocks = rootEl.querySelectorAll('[data-i18n-html]');
        for (var i = 0; i < blocks.length; i++) {
            var el = blocks[i];
            if (el.closest('[data-no-i18n="true"]')) continue;
            var key = el.getAttribute('data-i18n-html');
            var entry = HTML_BLOCKS[key];
            if (!entry) continue;
            var desired = currentLang === 'es' ? entry.es : entry.en;
            if (el.innerHTML !== desired) {
                el.innerHTML = desired;
            }
        }
    }

    function applyTranslations(targetRoot) {
        if (typeof document === 'undefined') return;
        var rootEl = targetRoot || document.body || document.documentElement;
        if (!rootEl) return;

        isApplyingDom = true;
        try {
            translateHtmlBlocks(rootEl);
            if (rootEl.nodeType === 1) translateAttributes(rootEl);

            if (typeof rootEl.querySelectorAll === 'function') {
                var allEls = rootEl.querySelectorAll('*');
                for (var i = 0; i < allEls.length; i++) {
                    var el = allEls[i];
                    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
                    translateAttributes(el);
                }
            }

            if (typeof document.createTreeWalker === 'function') {
                var walker = document.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */);
                var n;
                while ((n = walker.nextNode())) {
                    translateTextNode(n);
                }
            }

            syncToggleButtons();
            syncDocumentMeta();
        } finally {
            isApplyingDom = false;
        }
    }

    function syncDocumentMeta() {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('lang', currentLang);
        document.documentElement.setAttribute('data-lang', currentLang);
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';

        if (document.body && document.body.classList && document.body.classList.contains('translator-popup-body')) {
            document.title = pick('Daily Hub Translator (Mini Window)', 'Traductor Daily Hub (Mini Ventana)');
        }
    }

    function syncToggleButtons() {
        if (typeof document === 'undefined') return;
        var isEs = currentLang === 'es';
        var pillText = isEs ? '🌐 ES · Español' : '🌐 EN · English';
        var nextTitle = isEs ? 'Cambiar a Inglés (Switch to English)' : 'Switch to Spanish (Cambiar a Español)';

        var authBtn = document.getElementById('btnLangToggleAuth');
        if (authBtn) {
            authBtn.textContent = pillText;
            authBtn.title = nextTitle;
            authBtn.setAttribute('aria-label', nextTitle);
        }

        var mobBtn = document.getElementById('btnLangToggleMobile');
        if (mobBtn) {
            mobBtn.textContent = isEs ? 'ES' : 'EN';
            mobBtn.title = nextTitle;
            mobBtn.setAttribute('aria-label', nextTitle);
        }

        var sideBtn = document.getElementById('btnLangToggleSidebar');
        if (sideBtn) {
            var sideLbl = sideBtn.querySelector('.lang-label');
            if (sideLbl) sideLbl.textContent = isEs ? 'Idioma: Español' : 'Language: English';
            sideBtn.title = nextTitle;
            sideBtn.setAttribute('aria-label', nextTitle);
        }

        var settingsBtn = document.getElementById('btnSettingsLangToggle');
        if (settingsBtn) {
            settingsBtn.textContent = isEs ? '🌐 Cambiar a English' : '🌐 Switch to Español';
            settingsBtn.title = nextTitle;
        }

        var settingsSelect = document.getElementById('setUiLanguage');
        if (settingsSelect && settingsSelect.value !== currentLang) {
            settingsSelect.value = currentLang;
        }

        var popupBtn = document.getElementById('btnPopupLangToggle');
        if (popupBtn) {
            popupBtn.textContent = isEs ? 'ES' : 'EN';
            popupBtn.title = nextTitle;
            popupBtn.setAttribute('aria-label', nextTitle);
        }
    }

    function flushMutationQueue() {
        rafScheduled = false;
        if (pendingRoots.size === 0) return;
        var roots = Array.from(pendingRoots);
        pendingRoots.clear();
        for (var i = 0; i < roots.length; i++) {
            var r = roots[i];
            if (r && r.isConnected !== false) {
                applyTranslations(r);
            }
        }
    }

    function scheduleTranslation(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            if (node.parentElement) pendingRoots.add(node.parentElement);
        } else if (node.nodeType === 1) {
            pendingRoots.add(node);
        }
        if (!rafScheduled) {
            rafScheduled = true;
            if (typeof root.requestAnimationFrame === 'function') {
                root.requestAnimationFrame(flushMutationQueue);
            } else {
                setTimeout(flushMutationQueue, 16);
            }
        }
    }

    function startObserver() {
        if (observerStarted || typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) {
            return;
        }
        observerStarted = true;
        var mo = new MutationObserver(function (mutations) {
            if (isApplyingDom) return;
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'childList') {
                    for (var j = 0; j < m.addedNodes.length; j++) {
                        var an = m.addedNodes[j];
                        if (an.nodeType === 1 || an.nodeType === 3) scheduleTranslation(an);
                    }
                } else if (m.type === 'characterData') {
                    scheduleTranslation(m.target);
                } else if (m.type === 'attributes') {
                    if (m.attributeName !== 'lang' && m.attributeName !== 'data-lang' && !String(m.attributeName || '').startsWith('data-i18n')) {
                        scheduleTranslation(m.target);
                    }
                }
            }
        });
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label', 'data-title']
        });
    }

    function setLang(nextLang, options) {
        var opts = options || {};
        var resolved = normalizeLang(nextLang);
        var changed = resolved !== currentLang;
        currentLang = resolved;

        if (opts.persist !== false) {
            try {
                if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, resolved);
            } catch (_) {}
        }

        if (typeof document !== 'undefined') {
            applyTranslations(document.body || document.documentElement);
        }

        if (changed || opts.forceNotify) {
            listeners.forEach(function (fn) {
                try {
                    fn(resolved);
                } catch (_) {}
            });
        }
        return resolved;
    }

    function toggleLang() {
        return setLang(currentLang === 'es' ? 'en' : 'es');
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.add(fn);
        return function () {
            listeners.delete(fn);
        };
    }

    function initDomBindings() {
        if (typeof document === 'undefined') return;
        applyTranslations(document.body || document.documentElement);
        startObserver();

        ['btnLangToggleAuth', 'btnLangToggleMobile', 'btnLangToggleSidebar', 'btnSettingsLangToggle', 'btnPopupLangToggle'].forEach(function (id) {
            var btn = document.getElementById(id);
            if (btn && !btn.dataset.i18nBound) {
                btn.dataset.i18nBound = '1';
                btn.addEventListener('click', function () {
                    toggleLang();
                });
            }
        });

        var sel = document.getElementById('setUiLanguage');
        if (sel && !sel.dataset.i18nBound) {
            sel.dataset.i18nBound = '1';
            sel.value = currentLang;
            sel.addEventListener('change', function () {
                setLang(sel.value);
            });
        }
    }

    if (typeof root.addEventListener === 'function') {
        root.addEventListener('storage', function (ev) {
            if (ev && ev.key === STORAGE_KEY) {
                var next = normalizeLang(ev.newValue);
                if (next !== currentLang) {
                    setLang(next, { persist: false });
                }
            }
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDomBindings);
        } else {
            initDomBindings();
        }
    }

    var DailyHubI18n = {
        STORAGE_KEY: STORAGE_KEY,
        PAIRS: PAIRS,
        HTML_BLOCKS: HTML_BLOCKS,
        getLang: getLang,
        setLang: setLang,
        toggleLang: toggleLang,
        onChange: onChange,
        pick: pick,
        locale: locale,
        formatDate: formatDate,
        momentLabel: momentLabel,
        moodLabel: moodLabel,
        sleepQualityLabel: sleepQualityLabel,
        agendaStatusLabel: agendaStatusLabel,
        agendaBlockLabel: agendaBlockLabel,
        agendaDayName: agendaDayName,
        crisisTypeLabel: crisisTypeLabel,
        crisisIntensityLabel: crisisIntensityLabel,
        musicStatusLabel: musicStatusLabel,
        musicLanguageLabel: musicLanguageLabel,
        translateText: translateText,
        translateServerMessage: translateServerMessage,
        applyTranslations: applyTranslations,
        syncToggleButtons: syncToggleButtons,
        initDomBindings: initDomBindings
    };

    root.DailyHubI18n = DailyHubI18n;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DailyHubI18n;
    }
})(typeof window !== 'undefined' ? window : globalThis);
