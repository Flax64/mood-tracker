# 📘 Manual de Usuario — Personal Daily Hub

> Guía completa, paso a paso y campo por campo para dominar todos los módulos del sistema: registro emocional y sueño, bitácora clínica de crisis para psiquiatra/psicóloga, diario E2EE hacia Microsoft Word, estudio de Inglés / 한국어 / K-Pop con IA Gemini y repertorio musical, horario universitario ITS con alertas por tráfico GPS, agenda estilo Jira, notificaciones en celular (`ntfy`) y túnel cifrado de red X25519.

## 📑 Índice

- [1. Inicio de Sesión, Roles y Acceso Clínico](#1-inicio-de-sesión-roles-y-acceso-clínico)
- [2. Home y Recordatorios Inteligentes](#2-home-y-recordatorios-inteligentes)
- [3. Mood Tracker (Estado de Ánimo)](#3-mood-tracker-estado-de-ánimo)
- [4. Bitácora de Crisis (Registro Clínico en Español)](#4-bitácora-de-crisis-registro-clínico-en-español)
- [5. Sleep & Desvelo Tracker (Horas, Madrugadas y Desvelos)](#5-sleep--desvelo-tracker-horas-madrugadas-y-desvelos)
- [6. Journal Notes y Llave E2EE Local](#6-journal-notes-y-llave-e2ee-local)
- [7. Estudio de Idiomas (English · 한국어 · K-Pop), Traductor Global, IA Gemini y Música](#7-estudio-de-idiomas-english--한국어--k-pop-traductor-global-ia-gemini-y-música)
  - [7.1 Traductor Bilingüe Global (Cualquier Pestaña, Alt+T y Ventana tipo Extensión)](#71-traductor-bilingüe-global-cualquier-pestaña-altt-y-ventana-tipo-extensión)
  - [7.2 Cómo configurar la IA de Google Gemini paso a paso](#72-cómo-configurar-la-ia-de-google-gemini-paso-a-paso)
  - [7.3 Tutor IA, Memoria Persistente y Reconocimiento de Repertorio](#73-tutor-ia-memoria-persistente-y-reconocimiento-de-repertorio)
  - [7.4 Reproducción YouTube (PC), Mini Player y Ventana Flotante vs YT Music](#74-reproducción-youtube-pc-mini-player-y-ventana-flotante-vs-yt-music)
  - [7.5 Qué poner en cada campo del Registro de Canciones y Álbumes](#75-qué-poner-en-cada-campo-del-registro-de-canciones-y-álbumes)
  - [7.6 Carpetas Estilo Windows 11, CRUD de Álbumes y Visor de Letras por Idiomas](#76-carpetas-estilo-windows-11-crud-de-álbumes-y-visor-de-letras-por-idiomas)
- [8. Agenda Semanal y Flujo de Trabajo Jira](#8-agenda-semanal-y-flujo-de-trabajo-jira)
- [9. Horario ITS (Salones, Semestres, Vacaciones), Residencias, Trabajo y GPS](#9-horario-its-salones-semestres-vacaciones-residencias-trabajo-y-gps)
- [10. Resumen Semanal y Gestión de Acceso a Psiquiatra](#10-resumen-semanal-y-gestión-de-acceso-a-psiquiatra)
- [11. Configuración, Notificaciones en Celular (ntfy) y Cifrado de Transporte X25519](#11-configuración-notificaciones-en-celular-ntfy-y-cifrado-de-transporte-x25519)
- [12. Atajos de Teclado Óptimos](#12-atajos-de-teclado-óptimos)
- [13. Modo Oscuro Permanente, Cambio de Idioma (EN ↔ ES), Guía Visual y Word Automático](#13-modo-oscuro-permanente-cambio-de-idioma-en--es-guía-visual-y-word-automático)

---

## 1. Inicio de Sesión, Roles y Acceso Clínico

1. **Dueño (`Owner / Admin`)**:
   - Ingresa con tu correo y contraseña configurados. Si activaste 2FA/MFA recibirás un código temporal de verificación en tu correo.
   - Tienes acceso total a todos los módulos del menú lateral.
   - Por seguridad, la sesión se renueva automáticamente cada semana (**domingos a las 00:00**).
2. **Psiquiatra / Psicóloga (`Psychiatrist Mode - Read-Only`)**:
   - Si creas una cuenta médica desde **`🩺 Psychiatrist Access`**, tu especialista inicia sesión con su propio correo y contraseña asignada.
   - Al entrar, el sistema bloquea la barra de edición y la redirige directamente a **`📈 Weekly Summary`** en **modo solo lectura**:
     - Puede ver tu **matriz semanal de Mood**, tu **resumen semanal de Sueño y Desvelos (hrs/min, dormir tarde como 3:00 AM, noches sin dormir y motivo)** y tu **Bitácora de Crisis en español (`⚠️ Crisis & Episode Log`)**.
     - **Nunca** puede ver tu Diario Privado, Notas de Idiomas, Agenda Personal ni configuración, ni modificar o borrar ningún dato (el servidor responde `403 Forbidden`).

---

## 2. Home y Recordatorios Inteligentes

Al abrir **`🏠 Home`** verás:
- El **saludo del bloque horario actual** (`Morning`, `Noon`, `Afternoon`, `Night`, `Madrugada`).
- La bandeja **`Reminder Tray`** en la parte superior con alertas activas:
  - Registros de Mood pendientes del día actual.
  - Recordatorios de tareas o eventos de Agenda pendientes.
  - Recordatorios diarios de estudio de idiomas o clases próximas según tu tiempo de traslado.
- **Autoselección inteligente al abrir notificaciones**:
  - Al tocar **`Log Mood`**, **`Open`** o abrir el enlace enviado al celular por `ntfy`, el sistema abre exactamente la vista correcta y **autoselecciona la fecha (`Date`) y el bloque horario (`Moment / Block`) exactos** que faltaban por registrar.

---

## 3. Mood Tracker (Estado de Ánimo)

Accede desde **`🧠 Mood Tracker`**. Qué poner en cada campo:

| Campo | Qué ingresar / seleccionar |
| --- | --- |
| **Date** | Fecha del registro (se llena automáticamente con la fecha de hoy o la fecha de la notificación que tocaste). |
| **Time Block (Momento)** | `Morning` (06:00–11:59), `Noon` (12:00–14:59), `Afternoon` (15:00–19:59), `Night` (20:00–23:59) o `Madrugada` (00:00–05:59, si está activada en Settings). |
| **Emotion Color Grid** | Haz clic en el estado de ánimo que represente cómo te sientes en ese bloque. En el panel derecho (**Today's Check-ins**) puedes tocar cualquier bloque para cambiar rápidamente el selector. |

> [!NOTE]
> Puedes actualizar el Mood del bloque horario en curso mientras la ventana de tiempo actual siga abierta; los días pasados quedan protegidos como historial clínico inalterable.

---

## 4. Bitácora de Crisis (Registro Clínico en Español)

Accede desde **`⚠️ Crisis Log`** en el menú lateral o desde la tarjeta en **Home**. Está diseñada específicamente para registrar episodios agudos (estrés, ira, rabia, pánico, sobrecarga) con información clara en español para ti y tu psiquiatra/psicóloga:

| Campo | Qué ingresar |
| --- | --- |
| **Date (Fecha)** | Fecha en que ocurrió la crisis (se llena automáticamente con hoy). |
| **Time (Hora exacta)** | Hora exacta en formato normal (`HH:MM`). Usa el botón **`⏱️ Now`** para capturar el minuto exacto actual en 1 clic. |
| **Crisis Type (Tipo de episodio)** | Elige el botón correspondiente: `😣 Estrés`, `😠 Ira / Rabia`, `😰 Ansiedad`, `🫨 Pánico`, `😢 Llanto / Sobrecarga`, `🧱 Bloqueo / Saturación`, `🌘 Insomnio / Agitación`, `😔 Tristeza / Desánimo`, `😤 Frustración / Impotencia`, `🪫 Agotamiento Mental` o `📝 Otro`. Si eliges **`📝 Otro`**, aparece automáticamente un campo corto para especificar con exactitud qué emoción sentiste o qué pasó (máx. 80 caracteres). |
| **Intensity Level (Intensidad 1–5)** | Escala del `1 · Leve` al `5 · Severa`. |
| **Reason / Context in Spanish (Motivo)** | Campo opcional en español (con contador en vivo, **máx. 250 caracteres** para mantener ligera la BD) donde puedes describir brevemente qué detonó la crisis o cómo te sentiste. La caja crece automáticamente mientras escribes (`Ctrl + Enter` guarda al instante). |

- En el panel derecho (**Recent Crisis Log**) puedes consultar tus episodios recientes y eliminar un registro si lo capturaste por error.
- Tu **psiquiatra o psicóloga** verá automáticamente todas las crisis de la semana seleccionada dentro de **`📈 Weekly Summary -> ⚠️ Crisis & Episode Log`** en **modo solo lectura**.

---

## 5. Sleep & Desvelo Tracker (Horas, Madrugadas y Desvelos)

Accede desde **`🌙 Sleep Tracker`**. Todas las duraciones se muestran en formato normal de horas y minutos (ejemplo: `5 hrs 30 min` o `5h 30m`) y horarios legibles (`3:00 AM`). Tienes **3 modos** para registrar con precisión tanto descanso normal como desvelos:

| Campo / Opción | Qué ingresar y cómo funciona |
| --- | --- |
| **Entry Type** | `🌙 Sleep Session` (sueño habitual), `🦉 Desvelo / Late Bedtime` (dormirse tarde, ej. 3:00 AM), o `⚡ All-Nighter / No Sleep (0 hrs)` (noche en vela sin dormir). |
| **Date of rest / wake-up** | Fecha del descanso (puedes usar los botones rápidos **`Yesterday`** / **`Today`**). Si dormiste de forma intermitente el mismo día, los intervalos se suman automáticamente. |
| **Fell asleep at** *(Use current time)* | Hora exacta a la que te dormiste (ej. `03:00 AM`). Si capturas una hora de madrugada (**`01:00 AM – 05:59 AM`**), el sistema detecta y activa **automáticamente** el indicador **`🦉 Desvelo`**. También se guarda borrador local automático si presionas *Use current time* a las 3 AM antes de dormir. |
| **Going to sleep just now** | Casilla opcional al registrar un desvelo en vivo (ej. son las 3:00 AM y apenas vas a dormir): guarda tu hora de dormir inmediatamente en la base de datos y al despertar te aparecerá el botón **`⏰ Complete Wake-Up Now`** en *Today's Sleep Summary*. |
| **Woke up at** *(Use current time)* | Hora en la que despertaste (se omite si eliges *All-Nighter* o *Going to sleep just now*). |
| **Sleep Quality** | Selecciona la tarjeta visual: `🟢 Restorative`, `🟡 Fair / Light` o `🔴 Poor / Heavy`. |
| **Motivo / Nota del desvelo** *(opcional)* | Nota clínica breve (en español o inglés, máx. 500 caracteres) explicando el motivo del desvelo (ej. *"Me dormí a las 3:00 AM por insomnio / ansiedad / proyecto escolar"*). |

- Todo lo que marques como **Desvelo** (dormirse de madrugada como a las 3:00 AM, pasar la noche en vela con `0 hrs`, horario `Bed → Wake` y motivo) **se muestra automáticamente a tu psiquiatra/psicóloga** dentro de **`📈 Weekly Summary`**.

---

## 6. Journal Notes y Llave E2EE Local

Accede desde **`🖋️ Journal Notes`**. Todos tus textos personales se cifran en tu navegador con **AES-256** antes de salir hacia el servidor (`Encrypted Word Queue -> sincronizador.py`):

| Campo | Qué ingresar |
| --- | --- |
| **Date** | Fecha de la entrada de diario. |
| **Journal Title** | Título corto de tu reflexión (opcional). |
| **Your Thoughts** | Texto libre de tus pensamientos. Nunca se almacena en texto plano en MySQL: solo tú lo descifras en tu PC con tu llave de **32 caracteres**. |

> [!IMPORTANT]
> La primera vez que envíes una nota al diario o al cuaderno de idiomas, el sistema te pedirá tu llave E2EE de **32 caracteres exactos** (la misma que usa `sincronizador.py` en tu `.env`). Se guarda localmente en tu navegador hasta que decidas borrarla o actualizarla desde Settings.

---

## 7. Estudio de Idiomas (English · 한국어 · K-Pop), Traductor Global, IA Gemini y Música

Accede desde **`📖 English Notebook`** (o desde el **Traductor Global `🌐`** / **`Alt + T`** en cualquier vista). Este módulo combina:
- Cuaderno privado hacia Word (`Vocabulary`, `Grammar`, `Phrasal Verbs`, corrector ortográfico/gramatical estilo Word y **`Music & Lyrics Study`**).
- **Traductor Bilingüe Global (EN ↔ ES · 한국어 ↔ EN/ES)** accesible desde cualquier pantalla, con barra lateral/superior, cajón flotante rápido (**`Alt + T`**) y **ventana independiente tipo extensión** (`/translator-popup.html`).
- **Tutor IA bilingüe (English + 한국어 / K-Pop)** con **Google Gemini** e **Instant Local Engine (0 MB RAM)**.
- **Catálogo Musical y Repertorio Completo** (Artistas → Colaboraciones → Álbumes/Mini Álbumes/EPs → Canciones) con **CRUD completo**, reproductor integrado + ventana flotante e importador de subtítulos `yt-dlp`.

### 7.1 Traductor Bilingüe Global (Cualquier Pestaña, Alt+T y Ventana tipo Extensión)

Cuando estás leyendo un artículo, viendo un PDF, revisando tu Agenda o estudiando letras y aparece una palabra desconocida en inglés o coreano, el **Traductor Bilingüe (`EN ↔ ES` · `한국어 ↔ EN/ES`)** funciona como una extensión global sin ocupar espacio fijo dentro de *Learn with AI*:

1. **Cajón Flotante Movible `🌐 Quick Translator` + Atajo Global `Alt + T` *(En toda la aplicación)*:**
   - Disponible en **PC y Celular (OPPO A79)** mediante el botón flotante inferior derecho (**`🌐 Translator`**), el enlace **`🌐 Quick Translator`** de la barra lateral, el ícono **`🌐`** en la barra superior móvil *(solo visible para Admin)* o al seleccionar parte de una letra en Música y presionar **`🌐 Traducir`**.
   - **Auto-captura inteligente:** si seleccionas/subrayas una palabra o frase en pantalla y presionas **`Alt + T`** (o tocas `🌐`), el traductor flotante se abre al instante con ese texto ya cargado. Incluye **`📋 Paste & Translate`**, caja de texto amplia redimensionable con estilo unificado al resto de la app, y selector rápido de dirección y motor (**Auto / Gemini / Local 0 RAM**).
   - **Ventana movible (sin tapar tu vista):** arrastra el traductor desde su barra superior (**`⋮⋮`**) para colocarlo en cualquier lugar de la pantalla; tu posición se guarda automáticamente en el navegador y puedes volver a la esquina original en cualquier momento con el botón **`↺`**.
2. **Ventana Independiente tipo Extensión (`/translator-popup.html`):**
   - Haz clic en **`🪟 Window`** en el cajón flotante para abrir una mini ventana independiente conectada a tu sesión y tu `Gemini API Key` (si Gemini falla o no hay internet, cae automáticamente al diccionario local `0 MB RAM`).
   - **Fijar como extensión / app en Chrome o Edge (Windows / Android):** abre la ventana emergente → menú **`⋮` → Guardar y compartir → Crear acceso directo** marcando **Abrir como ventana** (en Android: **Agregar a pantalla principal**). Así queda fijado en tu barra de tareas o celular como una extensión independiente junto a YouTube, PDFs o Teams.
   - **Guardar en tu cuaderno:** cualquier resultado muestra IPA/Romanización Hangul, ejemplo y el botón **`📥 Send to Vocabulary Study Form`** (incluso desde la ventana emergente), enviando la palabra y su traducción directo a tu formulario de Word.

### 7.2 Cómo configurar la IA de Google Gemini paso a paso

El servidor AWS `t3.micro` tiene **1 GB de RAM**, por lo que correr un LLM pesado local dentro de EC2 saturaría la memoria. Por eso el sistema usa la arquitectura híbrida óptima (**0 MB de RAM en servidor**):

1. **Obtén tu clave gratuita de Google Gemini (API Key)**:
   - Entra a Google AI Studio en tu navegador: `https://aistudio.google.com/apikey`
   - Inicia sesión con tu cuenta de Google y haz clic en **`Create API key`**.
   - Copia la clave generada (normalmente empieza con `AIzaSy...`).
2. **Elige dónde guardarla (tienes 2 opciones seguras)**:
   - **Opción A (Recomendada — Directo desde la app)**:
     1. Ve a **`⚙️ Settings & Reminders`**.
     2. Busca la tarjeta **`🤖 Language AI & Multilingual Study (English · 한국어 · K-Pop)`**.
     3. En **Default Study Language**, elige tu perfil (ej. `🎵 English + Korean (K-Pop)`).
     4. En **Gemini Model Preset**, selecciona el modelo:
        - `gemini-2.5-flash` *(Recomendado · Rápido, económico y óptimo para letras EN/KR)*.
        - `gemini-2.5-flash-lite` *(Ultra rápido · Mayor cuota gratuita diaria)*.
        - `gemini-2.5-pro` *(Mayor profundidad en gramática poética y matices complejos)*.
        - `gemini-flash-latest` *(Alias siempre actualizado de Flash)*.
        - `Custom Model ID` *(Para escribir cualquier modelo nuevo de Gemini en el campo de texto inferior)*.
     5. Pega tu API Key en **`Google Gemini API Key`** y presiona **`🧪 Test AI Connection`**: la app valida la clave en vivo y, si un modelo devuelve `HTTP 404` por retiro en tu cuenta, auto-selecciona un modelo compatible vigente.
     6. Haz clic en **`Save All Settings`** al final de la página. La clave viaja cifrada por el túnel X25519 al servidor y el servidor **nunca** la devuelve expuesta en texto plano al navegador.
   - **Opción B (Global en servidor EC2 / GitHub Secrets)**:
     - Añade el secreto `GEMINI_API_KEY` en GitHub Secrets o en el archivo `.env` de EC2. El backend lo usará como respaldo si no guardaste una clave personal en Settings.
3. **Si no pones API key o estás sin internet en Gemini**:
   - El **Instant Local Engine** funciona al instante con **0 MB de RAM extra**, realiza romanización Hangul (`Revised Romanization`) línea por línea, detecta mezclas K-Pop (`English + 한국어`), phrasal verbs, partículas coreanas y consulta tu **Memory Bank** y **Repertorio**.

### 7.3 Tutor IA, Memoria Persistente y Reconocimiento de Repertorio

En el panel **`✨ AI Language Tutor & Lyrics Breakdown`** encontrarás:
- **Badge `🎵 Repertoire: N songs`**: confirma cuántas canciones registradas de tu catálogo conoce automáticamente la IA. Si mencionas una canción o artista de tu repertorio (por ejemplo `"Explain DRIP by BABYMONSTER"` o seleccionas una canción del navegador visual), el Tutor IA enlaza el álbum, idioma, colaboradores y enfoque de estudio de tu catálogo y además actualiza tu historial.
- **Badge `🧠 Memory: N learned`**: muestra cuántos términos, modismos, expresiones coreanas y reglas gramaticales recuerda la IA en tu cuenta.
  - Todo lo que analizas con la IA o guardas en Word queda guardado en tu **`Memory Bank`** persistente.
  - Cuando una palabra o expresión vuelve a aparecer en otra canción o frase, la IA **mantiene exactamente el mismo significado que ya aprendiste**, la marca con `🧠 [Learned]` y evita contradicciones entre sesiones.
- **Resiliencia ante red inestable:** si Gemini tarda >12 s o falla por red/cuota, la interfaz no se congela; reintenta de forma segura y ofrece el banner no bloqueante **`Switch to Instant Local Engine`** para continuar offline sin perder lo escrito.
- **Selector de Motor (`Auto` / `Google Gemini API` / `Instant Local Engine`)**:
  - **Auto**: usa Google Gemini si hay clave configurada; si falla la red/cuota o no hay clave, cambia automáticamente al Instant Local Engine.
  - **Google Gemini API**: fuerza consulta a Gemini con tu memoria y repertorio incluidos.
  - **Instant Local Engine**: romanización instantánea offline + léxico EN/KR sin consumir cuota de Gemini.

### 7.4 Reproducción YouTube (PC), Mini Player y Ventana Flotante vs YT Music

En la pestaña **`🎵 Music & Songs`**:
- **`Auto (PC / Mobile)` *(Modo por defecto)***:
  - En tu **PC**, los enlaces externos abren **YouTube normal** (`youtube.com/watch?v=...`).
  - En tu **celular**, los botones abren **YouTube Music** (`music.youtube.com/watch?v=...`).
- También puedes forzar **`📺 YouTube (PC)`** o **`🎵 YT Music (Mobile)`** en cualquier momento.
- **Mini Player directo (`yt-dlp` sin bloqueo) + Iframe embebido + Ventana Flotante (`Este video no está disponible`):**
  - El botón **`Mini Player`** reproduce la pista dentro de la app mediante streaming directo **`yt-dlp`** (`/api/english/music/songs/:id/media` con soporte HTTP `Range` en reproductor `<video>` nativo), evitando los bloqueos de iframe de sellos discográficos (p. ej. K-Pop/VEVO) o orígenes HTTP sin HTTPS.
  - Desde la barra superior del Mini Player también puedes cambiar en un clic entre **`🎧 Reproducir en App (yt-dlp · sin bloqueo)`**, **`▶️ Probar YouTube iframe`** (con cambio `youtube.com` / `youtube-nocookie.com`), **`📺 Ventana flotante (sin bloqueo)`** y **`↗ Abrir en YouTube`**.
- **Seguridad garantizada de tus playlists**: todos los enlaces son de solo lectura hacia pistas individuales (`watch?v=...`) sin OAuth ni permisos de escritura sobre tu cuenta de YouTube, así tu lista de reproducción personal nunca se modifica ni se altera.

### 7.5 Qué poner en cada campo del Registro de Canciones y Álbumes

En la tarjeta **`Register or Link Song`** (pestaña **`🎵 Music & Songs`**):

| Campo | Qué escribir o seleccionar | Ejemplo |
| --- | --- | --- |
| **YouTube Music / YouTube URL or 11-char ID (optional)** | Pega cualquier enlace de **YouTube** o **YouTube Music** (normal, `youtu.be`, `shorts`, o con `&list=...`) y presiona `Enter` o clic en **Auto-fill**. Detecta automáticamente título, artista principal, colaboradores, **álbum/mini álbum**, año y si permite Mini Player. | `https://music.youtube.com/watch?v=ZpI...` |
| **Song Title \*** *(Obligatorio)* | Nombre exacto de la canción sin adornos innecesarios para que la IA la reconozca mejor. | `DRIP` |
| **Track #** *(Opcional)* | Número de orden de la pista dentro del álbum o EP (sirve para ordenar el repertorio). | `2` |
| **Language** | Idioma principal de la letra: `🇺🇸 English`, `🇰🇷 Korean (한국어)`, `🎵 English + Korean (K-Pop)` o `🌐 Other`. | `🎵 English + Korean (K-Pop)` |
| **Main Artist / Group \*** *(Obligatorio)* | Artista solista o grupo principal (sugiere autocompletado con artistas que ya registraste). | `BABYMONSTER` |
| **Artist Format** | Formato del artista principal: `Group`, `Solo Artist`, `Duo` o `Collab Unit`. | `Group` |
| **Collaborators / Featured Artists** *(Opcional)* | Artistas invitados o colaboraciones separados por coma. La canción aparecerá también bajo cada colaborador. | `Bruno Mars, feat. Cardi B` |
| **Album / Mini Album Title** *(Opcional)* | Nombre del álbum, mini álbum, EP o banda sonora. Usa el botón **`+ New Album`** al lado para crear un álbum vacío primero o asignar uno existente. | `DRIP` |
| **Release Type** | Tipo de lanzamiento: `Album`, `Mini Album`, `EP`, `Single`, `Collab Single` u `OST / Soundtrack`. | `Album` |
| **Year** *(Opcional)* | Año de lanzamiento (4 dígitos). | `2024` |
| **Study Status** | Estado actual de estudio: `To Study`, `In Progress` o `Mastered` (puedes avanzar el estado con un clic desde el catálogo). | `In Progress` |
| **Short Study Focus** *(Opcional, máx. 255 caracteres)* | Enfoque o meta corta de aprendizaje (sin pegar letra completa aquí). | `Connected speech & rapid K-Pop switch in chorus` |

> [!TIP]
> También puedes usar el buscador superior **Song Finder** (escribe artista y canción y presiona **`Enter`**): abre resultados sin tocar tus playlists y muestra tarjetas con el botón **Select Song** para llenar el enlace al instante.

### 7.6 Carpetas Estilo Windows 11, CRUD de Álbumes y Visor de Letras por Idiomas

En el catálogo verás **carpetas visuales estilo Windows 11** organizadas jerárquicamente (`Artista → Álbum → Canciones`) con miniatura de portada:
1. **Carpetas de Artistas:** haz **clic** en la carpeta amarilla de cualquier artista para desplegar sus álbumes, sencillos y botones rápidos (`💿 + Álbum`, `➕ Agregar Canción`, `✏️ Editar Artista`).
2. **Carpetas de Álbumes / Lanzamientos:** haz **clic** en un álbum, mini álbum o `Sencillos y Pistas Sueltas` para desplegar sus canciones ordenadas por número de pista (o pulsa `▲ Cerrar Carpeta` para contraerla).
3. **Selección para estudio:** haz **clic** en cualquier canción o en **`Study -> Word`** para abrir su reproductor y el visor de letras en **`Song Study Notes -> Encrypted Word (PC)`**.

**Cómo crear y editar canciones, artistas o álbumes (CRUD completo):**
- **Crear Álbum o Mini Álbum desde cero:** haz clic en **`💿 + New Album / Mini Album`** (o **`+ New Album`** junto al campo de álbum) para registrar título, artista principal, tipo (`Album`, `Mini Album`, `EP`, `Single`, `Collab Single`, `OST`), año y notas. Luego en cualquier álbum puedes tocar **`➕ Agregar Canción`** para agregar pistas directamente a ese lanzamiento.
- **Editar Canción:** haz clic en el botón **`Edit`** de la fila de la canción o **`✏️ Edit Song / Link`** en la barra de estudio para cambiar título, enlace de YouTube/YT Music, Track #, idioma, colaboradores o álbum.
- **Editar Artista:** haz clic en **`✏️ Editar Artista`** dentro de la carpeta del artista para corregir su nombre, cambiar su formato (`Group`, `Solo Artist`, `Duo`, `Collab Unit`) o agregar notas en todas sus canciones al instante.
- **Editar o Eliminar Álbum:** haz clic en **`✏️ Editar Álbum`** junto al lanzamiento para modificar título, tipo o año, o en **`Delete`** para eliminar una canción del catálogo sin perder tus notas locales en Word.

**Visor de Letra en Solo Lectura (Completo por Idiomas) y Traducción Automática a Word:**
En **`Song Study Notes -> Encrypted Word (PC)`**:
- **Panel `📄 Letra en Word PC (Solo Lectura · Completa por Idiomas)`:** al seleccionar cualquier canción se muestra el selector rápido del álbum o lista ordenada por número de pista (**`01.`**, **`02.`**, etc.) y el indicador en tiempo real del puente PC (`🟢 PC en línea · Sync Word` o `☁️ PC desconectada · Cola RAM EC2`):
  - **Visor sin recortes ni scroll atrapado:** la letra se muestra completa en modo **100 % solo lectura** y dividida automáticamente por bloques de idioma (`🇺🇸 Inglés`, `🇰🇷 Coreano + Romanización`, `🇪🇸 Español`) usando el filtro superior (`🌐 Todos los Idiomas`, `🇺🇸 Solo Inglés`, `🇰🇷 Solo Coreano`, `🇪🇸 Solo Español`).
  - Presiona **`📄 Extraer Letra`**: antes de encolar nada, la app verifica en tiempo real (`< 150 ms`) si tu PC está encendida y `sincronizador.py` está conectado. Si la PC está apagada, bloquea la extracción al instante para no saturar la cola; si está conectada, consulta cifradamente (**E2EE + HMAC**) a `English_Learning_Notebook.docx` (o extrae con `yt-dlp` local en Windows usando `YT_DLP_PATH`) y organiza la letra bajo **Sección 4 → Álbum/Lista → Pista ordenada**.
  - Presiona **`🇪🇸 Traducir Canción a Español`**: traduce la canción completa al español (o toma los subtítulos `[ES]` si ya venían), anexa el bloque en español **al final del visor** y lo guarda automáticamente con cifrado E2EE en `English_Learning_Notebook.docx` (opcionalmente respaldado a una segunda nube `STUDY_RCLONE_REMOTE` sin tocar jamás `Journal.docx`).
  - Selecciona cualquier frase con el mouse o el dedo y pulsa **`🌐 Traductor Rápido`** para abrirla en el traductor flotante, o pulsa **`✨ Analizar Estrofas con IA`** para desglosar la canción línea por línea en el módulo inferior.
- **Auto-registro de aprendizaje IA en Word PC:** tanto en **`✨ AI Language Tutor`** como en **`✨ Desglosar por Estrofas (IA)`**, la casilla **`☁️ Registrar automáticamente en Word PC`** envía al instante las explicaciones, romanización y vocabulario generados por la IA directamente hacia tu Word (fusionándolos bajo la misma pista sin borrar la letra original), o los conserva cifrados E2EE en la RAM de EC2 mientras tu PC está desconectada.
- **Desde archivo o comando `yt-dlp` local (PC):** también puedes limpiar marcas de tiempo con **`🧹 Limpiar Texto`** o usar el modo de importación/comando local. Todas las cajas de texto de notas de estudio crecen automáticamente conforme escribes sin barras de scroll pequeñas.

---

## 8. Agenda Semanal y Flujo de Trabajo Jira

Accede desde **`🗓️ Weekly Agenda`**. Qué poner en cada campo:

| Campo | Qué ingresar / comportamiento |
| --- | --- |
| **Activity type** | `📌 Event (Class / Appointment)` para clases o citas con hora fija, o `☑️ Task / Deliverable (Jira Workflow)` para tareas y entregas con tablero Kanban. |
| **Category** | `🎓 University` o `👤 Personal` (filtra arriba entre All, University, Personal y clase específica). |
| **Linked university class** | Visible **solo** al elegir `🎓 University` (oculto y limpiado automáticamente en `👤 Personal`). Vincula tus tareas o entregas con una materia de tu semestre actual (ITS) para que la tarjeta muestre su etiqueta con el nombre de la clase (`🎓 Nombre de la clase`) y permita filtrar la semana por materia. |
| **Date** & **Time** | Al cambiar la hora en **`Time`**, el sistema **selecciona automáticamente el bloque del día (`Time block`)** (`Morning` 05:00–11:59, `School / University` 12:00–15:59, `Afternoon` 16:00–19:59, `Night` 20:00–04:59). |
| **Workflow status (Jira)** | `To Do`, `In Progress` o `Done` (avanza estados desde las tarjetas semanales o usa el modo Kanban). |
| **Clasificación / Alcance & Repetición** | Elige entre `Actividad / Tarea Estándar`, `📚 Proyecto / Tarea Larga Compleja` (recordatorios de hasta **7 días antes**) o `🗣️ Lección de Idiomas` (15 min antes). Además, puedes configurar **tareas repetitivas** (`Repetir cada X días` y número de repeticiones hasta 12 sesiones). |
| **Title / Activity Tag** & **Description** | Separa el título corto de la descripción detallada (caja de texto oscura auto-ajustable). Ambos cuadros cuentan con validación en tiempo real de **ortografía y gramática en inglés estilo Microsoft Word** (subrayado de sugerencias y corrección con un clic). |
| **Phone Reminder** | Elige cuántos minutos/horas/días antes quieres recibir aviso en tu celular vía `ntfy`. |

---

## 9. Horario ITS (Salones, Semestres, Vacaciones), Residencias, Trabajo y GPS

Accede desde **`🎓 ITS, Residencias & Work`**. Permite planificar tu carrera en el **Instituto Tecnológico de Saltillo (ITS)** y vida laboral sin perder ninguna clase ni turno:

1. **Semestres y Periodo de Vacaciones (Tabs `🎓 ITS Semester & Croquis` y `🏖️ Vacations & Breaks`)**:
   - Define tu semestre activo (fecha de inicio y fin) y registra rangos de **vacaciones / días inhábiles** (`Period Name` + fechas). Durante vacaciones o días marcados, no te enviará falsas alertas de primera clase.
2. **Horario de Clases por Salón (`Add / Edit ITS Class`)**:
   - Selecciona días de la semana, hora de inicio/fin en formato normal (`HH:MM`), **Clave de materia** (ej. `ACA0910`), **Nombre**, **Docente** y **Salón ITS** (`R02`, `R11`, `N21`, Lab, etc. con detección automática de edificio/campus y **coordenadas exactas de acceso sobre bulevares principales** para los 3 Campus: **`Principal CTO-002`**, **`Miravalle CTO-003`** y **`Boillot/Sistemas CTO-004`**). También puedes cargar al instante tus materias base con **⚡ Load MindBox 9th Sem Preset** y editar cualquier clase con **`Edit`**.
3. **Residencias Profesionales (Tab `🏢 Residencias Profesionales`)**:
   - Registra tu empresa, proyecto, asesor interno/externo, horario, avance de las 500 horas y ubicación para alertas de traslado.
4. **Horario Laboral (Tab `💼 Work (Full / Part-Time)`)**:
   - Registra si trabajas tiempo completo (`Tiempo Completo`) o medio tiempo (`Medio Tiempo`), horario, modalidad y ubicación para integrar notificaciones de salida.
5. **Ubicaciones (Casa), GPS del Teléfono en HTTP y Tráfico en Carro (Tab `📍 Maps, GPS & Traffic Alerts` / botón `📍 Update My GPS`)**:
   - **Configurar tu Casa (`🏠 Home / Base Location`)**:
     - Puedes ingresar una **etiqueta** (`Home Label`, ej. `Mi Casa`), tu **dirección de calle en Saltillo** (ej. `Margarita Maza de Juárez 924, Saltillo, Coah.`), pegar un **enlace de Google Maps** (`maps.app.goo.gl/...`, `google.com/maps/...` o con `@` / `!3d!4d`) o escribir latitud/longitud directamente.
     - Pulsa **`💾 Save & 🔍 Find Home Location`**: si pegaste un link o dirección sin coordenadas manuales, el servidor extrae el pin exacto (o geocodifica tu calle en Saltillo) y habilita el botón **`🗺️ Verify Home in Maps`** para comprobar el punto en el mapa. *(Nunca genera coordenadas `0.000000, 0.000000`.)*
     - Si antes habías capturado un GPS temporal y quieres volver a calcular tus rutas desde tu Casa guardada, pulsa **`🏠 Use Saved Home`**.
   - **Actualizar ubicación desde tu teléfono (OPPO A79) usando `http://TU_IP:3000` sin dominio**:
     - **Opción A — Botón rápido en tu celular + Chrome Flag (1 sola vez):** en Chrome de tu OPPO A79 abre `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, agrega `http://TU_IP:3000` (usa el botón **`📋 Copy`** dentro del modal `Update My GPS`), cámbialo a **Enabled** y reinicia Chrome. Desde entonces, al tocar **`📍 Update My GPS`** en tu teléfono tomará tu **GPS real con 1 toque** aun en HTTP.
     - **Opción B — Botón `📲 Ping Phone GPS (ntfy)` desde la PC:** envía una notificación a tu celular; al tocarla se abre directo el asistente de ubicación en tu OPPO A79 para capturar su GPS (o pegar el enlace de tu punto azul en Google Maps / dirección).
     - **Opción C — Webhook Automático HTTP para Android (`🔑 Show Phone HTTP Webhook`):** genera una URL HTTP firmada con HMAC (`GET` o `POST` a `/api/planner/phone-location?token=...`, revocable con **`🔄 Rotate Token`**) para apps como **MacroDroid**, **Automate** o **Tasker** en Android, enviando latitud/longitud real del teléfono en segundo plano sin necesitar HTTPS ni dominio.
   - Con base en tu posición actual o Casa:
     - Si estás **lejos** (en casa u otra zona de Saltillo) → te notifica al menos **30 minutos antes + tiempo estimado de traslado en carro** antes de tu primera clase o turno.
     - Si estás **cerca o ya dentro del ITS** → te notifica **10 minutos antes** para trasladarte entre salones.

---

## 10. Resumen Semanal y Gestión de Acceso a Psiquiatra

- **`📈 Weekly Summary`**:
  - **Calendario visual y navegación semanal (`#resumenCalendarioDia`):** elige cualquier día en el calendario (o navega con **`◀ Semana Ant.`**, **`Hoy`** y **`Semana Sig. ▶`**) para visualizar automáticamente toda la semana correspondiente (Domingo a Sábado).
  - **Retención de 1 mes en servidor + Historial Drive en RAM:** la base de datos local conserva el último mes (30 días) para mantener rápida y ligera la instancia AWS. Si tú o tu psiquiatra necesitan revisar periodos más largos, el selector **`☁️ Drive: Últimos 3 / 6 / 12 meses`** + botón **`☁️ Extraer Historial de Drive (RAM)`** descarga temporalmente el archivo acumulado de Google Drive directo a memoria RAM sin llenar el disco.
  - Muestra la matriz de colores del **Mood** por día y los 5 bloques del día.
  - Muestra tarjetas diarias de **Sueño y Desvelos** con duración total en horas y minutos (`5h 30m` o `0h 00m`), indicador especial **`🦉 3:00 AM`** / **`⚡ Desvelo total`** cuando hubo desvelo o trasnoche, y la lista detallada **`🦉 Bedtimes, Desvelos & Late-Night Details`** con hora exacta de dormir/despertar, calidad y motivo opcional (**visible en solo lectura para tu psiquiatra/psicóloga**).
  - Muestra la lista completa de **`⚠️ Crisis & Episode Log`** de esa semana con fecha, hora, tipo, intensidad (`1/5`–`5/5`) y motivo breve en español. **Tanto tú como tu psiquiatra/psicóloga** pueden revisarla aquí.
- **`🩺 Psychiatrist Access`** *(Solo Admin)*:
  - Llena `Doctor's name`, `Doctor's email address` y `Assigned password` (mín. 8 caracteres con letras y números) y guarda para generar el acceso de solo lectura.
  - Desde la lista inferior puedes **Suspender / Reactivar** el acceso clínico al instante (cierra de inmediato todas sus sesiones activas en `SesionesAuth`).

---

## 11. Configuración, Notificaciones en Celular (ntfy) y Cifrado de Transporte X25519

Accede desde **`⚙️ Settings & Reminders`**:

### A) Configurar notificaciones móviles (`ntfy`) paso a paso:
1. Instala la app gratuita **ntfy** en tu celular Android (`Google Play` / `F-Droid`) o iPhone (`App Store`).
2. En Daily Hub -> **`⚙️ Settings & Reminders`**:
   - Marca **`Enable notifications on my phone's notification bar`**.
   - Haz clic en **`Generate`** para crear un **Private phone topic** único (ej. `hub_personal_...`) y tócalo para copiarlo (si estás en HTTP plano donde el navegador bloquea el portapapeles automático, el botón abrirá una cajita lista para copiar manualmente).
   - Deja **Push server** en `https://ntfy.sh`.
   - En **Public server URL (for Open / Snooze phone buttons)** escribe exactamente la dirección con la que entras desde tu celular, sin barra diagonal final: ejemplo `http://3.149.248.153:3000`.
3. En la app **`ntfy`** de tu celular:
   - Toca el botón **`+`** (`Subscribe to topic`).
   - Pega exactamente tu **Topic name** (`hub_personal_...`) y toca **Subscribe** (sin cambiar `Use another server`, usando `ntfy.sh`).
4. Vuelve a Daily Hub y haz clic en **`Save All Settings`** primero y luego en **`🔔 Send Test to Phone`**. Deberías recibir la alerta con botones interactivos (**`Open App`**, **`Snooze 15m`**, **`Snooze 30m`**, **`Mark Done`**) firmados de forma persistente para funcionar al primer toque incluso si el servidor se reinició tras un despliegue.

### B) Cifrado de Transporte de Red (`Simulated HTTPS: X25519 + AES-256-CTR + HMAC-SHA256`):
Aunque la IP pública de EC2 opere sobre HTTP puerto `3000`, todos los paquetes sensibles entre tu navegador y el servidor se encapsulan dentro de un túnel criptográfico equivalente a TLS:
1. Al abrir la app se realiza un intercambio de llaves efímeras **ECDH X25519** + derivación **HKDF-SHA256** (secreto hacia adelante / *Forward Secrecy*).
2. Cada petición `POST`/`PUT`/`PATCH`/`DELETE` y respuesta JSON se cifra simétricamente con **AES-256-CTR** e integridad **HMAC-SHA256 (Encrypt-then-MAC)**.
3. En la tarjeta **`🔒 Simulated HTTPS Network Encryption`** dentro de Settings puedes hacer clic en:
   - **`⚡ Benchmark Large Payloads (1 KB · 64 KB · 192 KB)`**: mide en vivo el cifrado en el cliente y el descifrado en OpenSSL del servidor. Aunque el payload crezca **192x** (`1 KB` → `192 KB`), el tiempo escala de forma lineal $O(N)$ en milisegundos porque X25519 corre **una sola vez al iniciar la sesión**, no en cada paquete.
   - **`🔍 Inspect Live Wire Packet`**: muestra el JSON real cifrado que viaja por la red (`ciphertext`, `iv`, `mac` + verificador SHA-256), demostrando que ningún dato en claro es legible en Wireshark o en la red.

---

## 12. Atajos de Teclado Óptimos

| Dónde estás | Tecla rápida | Qué hace |
| --- | --- | --- |
| **Cualquier pantalla de la app *(Global Admin)*** | `Alt + T` | Abre/cierra el **Traductor Rápido Flotante (`🌐`)** y captura automáticamente cualquier palabra o frase que tengas subrayada/seleccionada. |
| **Traductor Flotante / Extensión (`floatTranslatorInput` / `popupTranslatorInput`)** | `Enter` | Traduce al instante (`Shift + Enter` inserta salto de línea). |
| **Traductor Flotante / Modales abiertos** | `Esc` | Cierra el traductor flotante, menús móviles o ventanas modales activas. |
| **Music Song Finder (`musicYtSearchQuery`)** | `Enter` | Abre/ejecuta la búsqueda de la canción al instante sin soltar el teclado. |
| **Campo URL de Canción (`musicSongYtUrl`)** | `Enter` | Dispara **Auto-fill** (rellena título, artista y álbum/año desde YouTube/YT Music antes de guardar). |
| **Filtro de Catálogo (`musicFilterSearch`)** | `Enter` | Selecciona directamente la primera canción coincidente para estudiar. |
| **Pregunta al Tutor IA (`langAiQuestion`)** | `Enter` | Envía la pregunta a Gemini / Local Engine (`Shift + Enter` agrega salto de línea). |
| **Caja de Letra de Canción (`musicStudyLyrics`)** | `Ctrl + Enter` | Ejecuta **`✨ Explain Lyrics & Romanize (AI)`** al instante. |
| **Motivo en Bitácora de Crisis (`crisisMotivo`)** | `Ctrl + Enter` | Guarda directamente el registro de crisis con su fecha, hora y motivo en español. |
| **Motivo de Desvelo (`sleepMotivoDesvelo`)** | `Ctrl + Enter` | Guarda directamente el registro de sueño / desvelo. |
| **Modal de Ubicación / Link de Maps (`quickLocationInput`)** | `Enter` | Aplica el enlace de Google Maps o coordenadas y recalcula las rutas al instante. |
| **Formulario de Vacaciones (`vacName`)** | `Enter` | Envía el formulario para añadir el periodo vacacional cuando ya elegiste fechas. |

---

## 13. Modo Oscuro Permanente, Cambio de Idioma (EN ↔ ES), Guía Visual y Word Automático

- **🌙 Modo Oscuro Permanente:** Toda la aplicación (Login, Dashboard, Modales, **Traductor Bilingüe**, Ventana Popup y **Guía Visual**) funciona siempre en **tema oscuro unificado**, evitando cambios bruscos de brillo nocturno.
- **🌐 Cambio Completo de Idioma (`English` ↔ `Español`):**
  - Puedes cambiar el idioma completo desde la esquina del panel lateral (`🇺🇸 EN` / `🇲🇽 ES`), la cabecera móvil, el Login, **`⚙️ Settings → Interface Language`** o el selector superior de **`/translator-popup.html`**.
  - Al cambiar de idioma se traducen menús, botones, tarjetas, fechas, mensajes de confirmación, respuestas del servidor, el **Traductor Global** y las explicaciones de la IA (**Gemini** / motor local), **sin modificar jamás el contenido real de tus notas, canciones o agenda** (`data-no-i18n`).
- **📖 Guía Visual Interactiva (Sin exceso de texto):**
  - Si prefieres ver todo rápido y visual sin leer párrafos largos, haz clic en **`📖 Visual Guide`** en la barra lateral, en la tarjeta rápida de **`Home`** o abre `/guia-visual.html`. Incluye mapa de pantallas, flujo gráfico del **Traductor (`Alt+T` / movible)**, esquema visual de seguridad (**E2EE + X25519**) y guía exprés de uso diario.
- **🏷️ Historial de Versiones Automático (`SemVer 2.0.0`):**
  - En la esquina inferior del panel lateral verás el botón **`🏷️ Version vX.Y.Z`** (y también dentro de **`⚙️ Settings → Application Version & Release History`**).
  - Al hacer clic se abre el historial completo de despliegues con su clasificación estándar **Semantic Versioning 2.0.0**:
    - **PATCH (`+0.0.1`, ej. `1.0.0 → 1.0.1`):** Correcciones de errores (`fix:`), seguridad o mejoras menores.
    - **MINOR (`+0.1.0`, ej. `1.0.1 → 1.1.0`):** Nuevas funcionalidades (`feat:`).
    - **MAJOR (`+1.0.0`, ej. `1.1.0 → 2.0.0`):** Cambios incompatibles (`BREAKING CHANGE` / `!:`).
- **📄 Creación Automática del Word de Idiomas vs Journal:**
  - **`English_Learning_Notebook.docx` (`ENGLISH_WORD_FILE_PATH` o `english-notes/English_Learning_Notebook.docx`)**: si no existe todavía en esa ruta al enviar o extraer algo, `sincronizador.py` **lo crea automáticamente** junto con su carpeta, portada, **Tabla de Contenidos** y sus 4 secciones (`1. Glossary & New Words`, `2. Grammar & Usage Notes`, `3. Phrasal Verbs`, `4. Songs & Music Study`).
  - **Journal `.docx` (`WORD_FILE_PATH` con contraseña):** por integridad y seguridad de contraseña, **debe existir previamente** en tu PC (el script no crea ni sobrescribe un `.docx` diario nuevo con contraseña).
  - Para comandos exactos de **reinicio del Python local** y configuración de **arranque tras apagar/reiniciar tu PC**, consulta la [Guía de Operación, Secciones 2 y 10](./GUIA_OPERACION_Y_MIGRACION.md#10-renombrar-repositorio-autoinicio-y-reiniciar-python-local), o abre directamente el catálogo completo en la [Guía Rápida de Comandos](./GUIA_COMANDOS_RAPIDOS.md).
