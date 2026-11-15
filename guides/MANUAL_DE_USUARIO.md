# 📘 Manual de Usuario — Personal Daily Hub

> Guía práctica paso a paso para aprovechar todas las herramientas de bienestar, organización personal, estudio de inglés con música y privacidad de **Personal Daily Hub** desde PC o celular.

---

## 📑 Índice de Contenidos

1. [Primeros pasos y acceso seguro](#-1-primeros-pasos-y-acceso-seguro)
2. [Inicio (`Home`)](#-2-inicio-home)
3. [Registro de Estado de Ánimo (`Mood Tracker`)](#-3-registro-de-estado-de-ánimo-mood-tracker)
4. [Control de Sueño (`Sleep Tracker`)](#-4-control-de-sueño-sleep-tracker)
5. [Diario Privado E2EE (`Journal Notes`)](#-5-diario-privado-e2ee-journal-notes)
6. [Cuaderno de Inglés y Learn with Music (`English Notebook`)](#-6-cuaderno-de-inglés-y-learn-with-music-english-notebook)
   - [YouTube en PC vs YouTube Music en Celular (Protección de tus Playlists)](#youtube-en-pc-vs-youtube-music-en-celular-protección-de-tus-playlists)
7. [Agenda Semanal (`Weekly Agenda`)](#-7-agenda-semanal-weekly-agenda)
8. [Resumen Semanal (`Weekly Summary`) y Acceso Médico (`Psychiatrist Access`)](#-8-resumen-semanal-weekly-summary-y-acceso-médico-psychiatrist-access)
9. [Configuración y Notificaciones al Celular (`Settings & Reminders`)](#-9-configuración-y-notificaciones-al-celular-settings--reminders)
10. [Preguntas frecuentes (FAQ)](#-10-preguntas-frecuentes-faq)

---

## 🔐 1. Primeros pasos y acceso seguro

### Iniciar sesión y verificación en dos pasos (MFA)
1. Ingresa tu correo y contraseña en la pantalla **Personal Daily Hub** y haz clic en **Sign In**.
2. Si la verificación en dos pasos está activa, recibirás un código de **6 dígitos** en tu correo electrónico. Introdúcelo en **Two-step email verification**.
3. Puedes mostrar u ocultar cualquier contraseña usando el botón del ojo junto al campo.
4. Todos los mensajes de éxito o error aparecen directamente dentro de la tarjeta o mediante avisos discretos en la esquina superior derecha, sin ventanas emergentes molestas.

### Cierre automático semanal
Por seguridad y orden semanal, todas las sesiones activas se cierran automáticamente **cada domingo a las 00:00**. Cuando ocurra, verás un aviso en pantalla para volver a iniciar sesión.

### Tema Claro / Oscuro y Navegación
- Puedes cambiar entre **Light Mode** y **Dark Mode** en cualquier momento desde el menú lateral o desde **Settings & Reminders → Switch Theme**.
- En PC puedes contraer o expandir la barra lateral con el botón `◀` / `▶`. En celular se abre con el botón de menú en la barra superior.

---

## 🏠 2. Inicio (`Home`)

La vista **Home** te muestra un panorama inmediato del día:
- **Saludo y bloque horario actual** (`Late Night`, `Morning`, `Noon`, `Afternoon` o `Night`).
- **Today's Summary**:
  - **Mood Tracker**: estados de ánimo ya registrados hoy.
  - **Sleep**: total acumulado de horas dormidas hoy.
  - **Today's Agenda**: eventos y tareas pendientes o completadas del día.
- **All Features**: accesos directos de un clic a cualquier módulo de la aplicación.

---

## 🧠 3. Registro de Estado de Ánimo (`Mood Tracker`)

Pensado para registrar cómo te sientes en hasta **5 momentos del día**:
- `Late Night (00:00 - 05:59)`
- `Morning (06:00 - 11:59)`
- `Noon (12:00 - 13:59)`
- `Afternoon (14:00 - 19:59)`
- `Night (20:00 - 23:59)`

### Cómo registrar o actualizar un estado
1. Al abrir **Mood Tracker**, la fecha de hoy y el bloque horario actual se seleccionan automáticamente.
2. Haz clic en una de las 16 emociones disponibles (p. ej. `Happy`, `Calm`, `Focused`, `Anxious`). Verás la selección confirmada arriba en la píldora de vista previa.
3. Pulsa **Save Mood Entry**.

### Panel lateral `Today's Check-ins`
- A la derecha (o abajo en celular) verás los **5 bloques de hoy** y cuáles ya tienen registro o siguen pendientes (`Not logged`).
- Puedes tocar cualquiera de los 5 bloques en esa lista para seleccionarlo inmediatamente en el formulario.
- Mientras la ventana de edición del día actual siga abierta para ese bloque horario, puedes corregir o actualizar tu estado de ánimo sin problemas.

---

## 🌙 4. Control de Sueño (`Sleep Tracker`)

Diseñado para registrar tu descanso justo al despertar, compatible con **sueño intermitente o siestas**.

### Cómo registrar una sesión de sueño
1. En **Fell asleep at**, indica la hora a la que te dormiste.
2. En **Woke up at**, indica a qué hora despertaste (o toca **Use current time** para llenar automáticamente la hora actual del reloj).
3. Verás la duración calculada al instante en el recuadro **Calculated sleep duration** (incluso si dormiste antes de medianoche y despertaste al día siguiente).
4. Elige rápidamente cómo sentiste el descanso con las tarjetas visuales:
   - `🟢 Restorative` (`Good`)
   - `🟡 Fair / Light` (`Regular`)
   - `🔴 Poor / Heavy` (`Bad`)
5. Pulsa **Log Sleep Session**.

### Sueño intermitente (`Today's Sleep Summary`)
Si duermes por partes durante el mismo día (por ejemplo, 5 horas en la noche y una siesta de 1.5 horas en la tarde), cada registro nuevo **se suma al acumulado del día** sin sobrescribir los anteriores.

---

## 🖋️ 5. Diario Privado E2EE (`Journal Notes`)

Tu diario personal está protegido con **cifrado de extremo a extremo (E2EE AES)** directamente en tu navegador.

### Configurar tu llave secreta de 32 caracteres (`🔐 E2EE Key`)
1. En la esquina superior de **Journal Notes** (o **English Notebook**), toca el botón **🔑 Set 32-char Key** (cambia a **🔐 E2EE Key Ready** cuando ya está activa).
2. Introduce tu clave secreta exacta de **32 caracteres** (debe coincidir con la llave configurada en tu PC para sincronizar Word). Un contador en tiempo real te muestra `32 / 32 characters`.
3. La llave se guarda únicamente en el almacenamiento local de tu navegador actual y **nunca se envía ni se guarda en el servidor ni en MySQL**.

### Borrador automático y envío a Word
- Mientras escribes en inglés, el editor muestra el conteo de palabras/caracteres y guarda automáticamente tu texto como borrador local (`Draft saved locally`) para que no pierdas lo escrito si cambias de pantalla o recargas la página.
- Si deseas limpiar el cuadro de texto manualmente, usa **Clear draft**.
- Al pulsar **Encrypt E2EE & Send to Word (PC)**, el texto se cifra en tu dispositivo y queda en cola segura para que el sincronizador de tu PC lo añada a tu documento local de Word.

---

## 📖 6. Cuaderno de Inglés y Learn with Music (`English Notebook`)

Tiene 4 pestañas principales en la parte superior:
1. **📖 Glossary / New Word**: palabra, categoría gramatical, significado en español, definición/sinónimos y oración de ejemplo.
2. **✍️ Grammar & Usage Note**: regla gramatical, ejemplos correctos vs. errores frecuentes y notas personales.
3. **🔗 Phrasal Verb**: verbo compuesto, significado en español, si es separable o no, y ejemplo en contexto.
4. **🎵 Learn with Music**: estudio de inglés con canciones, organizado por artista, colaboraciones y álbum/mini álbum.

Todos los apuntes escritos de estudio (`Glossary`, `Grammar`, `Phrasal Verb` y notas de canciones) se cifran con E2EE y van únicamente a tu carpeta local `english-notes/English_Learning_Notebook.docx` en tu PC (con índice automático).

---

### YouTube en PC vs YouTube Music en Celular (Protección de tus Playlists)

En la pestaña **🎵 Learn with Music** cuentas con la barra **Playback Platform** que adapta automáticamente qué servicio se abre según desde dónde entres:

| Dispositivo | Modo `Auto (PC / Mobile)` | Enlaces que abre |
| :--- | :--- | :--- |
| **🖥️ PC / Laptop** | Usa **YouTube normal** (`www.youtube.com`) | Búsquedas en `youtube.com/results?...`, inicio en `youtube.com` y canciones en `youtube.com/watch?v=...` |
| **📱 Celular / Tablet** | Usa **YouTube Music** (`music.youtube.com`) | Búsquedas en `music.youtube.com/search?...`, biblioteca en `music.youtube.com/library` y canciones en `music.youtube.com/watch?v=...` |

> **🛡️ Garantía total: tus listas de reproducción del celular NO se modifican ni alteran**
> - La aplicación **no usa OAuth ni credenciales de Google** en tu cuenta personal: nunca tiene permisos para agregar, borrar, reordenar o editar tus playlists ni tu biblioteca.
> - Cuando pegas un enlace que incluye cola o playlist (`&list=...`) junto con un video (`watch?v=...`), el servidor y la interfaz extraen únicamente el ID limpio de la pista individual (`watch?v=...`), evitando alterar tu cola o tus listas al abrir la canción.
> - Además de `Auto`, puedes cambiar manualmente entre `Auto (PC / Mobile)`, `📺 YouTube (PC)` o `🎵 YT Music (Mobile)` desde los botones rápidos en **Learn with Music** o en **Settings & Reminders → Learn with Music YouTube Platform**; esa preferencia se recuerda de forma independiente por dispositivo.

### Flujo recomendado para estudiar una canción
1. Usa el **Song Finder** para buscar una canción en YouTube (PC) o YouTube Music (Celular), o pega directamente su enlace/ID en **Register or Link Song** y pulsa **Auto-fill**.
2. Completa artista principal, colaboradores opcionales (la canción aparecerá listada bajo cada artista colaborador) y álbum o mini álbum. Pulsa **Save Song**.
3. En **My Music Catalog**, pulsa **YouTube** / **YT Music** para escuchar la pista o **Study -> Word** para abrir el panel inferior **Song Study Notes -> Encrypted Word (PC)** (también incluye botón **Mini Player** embebido opcional).
4. Escribe tus desgloses de significado, vocabulario y pronunciación y pulsa **Encrypt E2EE & Save Study Notes to Word (PC)**.

---

## 🗓️ 7. Agenda Semanal (`Weekly Agenda`), Auto-Bloque y Corrector Tipo Word

Organizador semanal visual compatible con vista de **cuadrícula semanal** (PC) o **enfoque por día** (celular / botón **Day View**):
- **Auto-selección de bloque al elegir la hora**: al seleccionar **Time** (`#agendaHora`), el campo **Time block (part of day)** selecciona automáticamente `☕ Morning` (`05:00–11:59`), `🎓 School / University` (`07:00–16:59` cuando la categoría es Universidad), `☀️ Afternoon` (`12:00–18:59`) o `🌙 Night` (`19:00–04:59`).
- **Título/Etiqueta y Descripción separados**: cada actividad o nota de Journal separa el **Title / Label** de la **Description**, permitiendo ver tarjetas limpias y estructuradas.
- **Corrector de Ortografía y Gramática en Inglés (Estilo Microsoft Word)**:
  - Disponible en **Journal Notes**, **English Notebook** y **Weekly Agenda**.
  - Detecta errores de **Ortografía (`🔴 Spelling`)** y **Gramática (`🟦 Grammar`)** en inglés en tiempo real, permitiendo corregir cada sugerencia con un toque o aplicar todas con **✨ Apply All Fixes**.
- **Categorías y Tipos**:
  - `🎓 University` y `👤 Personal`.
  - `📅 Event` (clases/citas) y `✅ Task (Jira)` con flujo **`To Do` → `In Progress` → `Done`** y notificaciones automáticas si una tarea o registro de ánimo queda pendiente.

---

## 🎓 8. Horario ITS por Semestre, Croquis (`R02`/`R11`/`N21`), Vacaciones, Residencias, Trabajo y Tráfico (`ITS, Residencias & Work`)

Módulo diseñado específicamente para el **Instituto Tecnológico de Saltillo (TecNM - ITS)**:
1. **Horario por Semestres y Croquis Oficial del ITS (`CTO-001` a `CTO-004`)**:
   - Administra tus materias por semestre (incluye botón rápido **📥 Load 9th Sem MindBox Preset** con `ACA0910`, `SCG1009`, `DED2504`, `SCC1019` y `DED2505`).
   - Al escribir el salón (`R02`, `R11`, `N21`, `S12`, `LC2`, `A14`, etc.), el sistema detecta automáticamente el edificio y campus según los planos oficiales del ITS (**Campus Principal** `CTO-002`, **Campus Miravalle** `CTO-003` o **Campus Boillot** `CTO-004`).
   - El botón **🗓️ Sync Current Week to Agenda** vuelca tus clases, residencias y turnos de trabajo en la Agenda Semanal.
2. **Periodos de Vacaciones (`Vacations`)**:
   - Registra vacaciones de Semana Santa, verano o invierno. Durante esas fechas, el sistema pausa automáticamente las notificaciones de clases y evita agendarlas.
3. **Residencias Profesionales (`Residencias 500h`)**:
   - Lleva el control de tu proyecto, empresa, asesores (interno y externo), barra de progreso de **500 horas**, horario y ubicación de Google Maps.
4. **Horario de Trabajo (`Work FT / PT`)**:
   - Registra tu empleo de **Tiempo Completo (`Full-Time`)** o **Medio Tiempo (`Part-Time`)**, empresa, puesto, régimen (presencial, híbrido o remoto), días, horario y ubicación en Google Maps.
5. **Ubicaciones GPS, Tráfico y Notificaciones Inteligentes en Carro**:
   - Registra la ubicación de tu **Casa**, **Campus del ITS**, **Empresa de Residencias** y **Trabajo** (con el botón **📡 Use My Current GPS** o pegando un enlace/coordenadas de Google Maps).
   - **Si es tu primera clase del día o estás en tu casa / lejos del Tec**: te envía la notificación con **mínimo 30 minutos de anticipación** (o más si el tiempo en carro + tráfico hora pico de Saltillo + estacionamiento requiere salir antes), incluyendo un botón directo **🗺️ Google Maps Route** en tu celular.
   - **Si ya estás en el Tec o cerca del campus (`<= 0.85 km`)**: te notifica **10 minutos antes** indicando el aula y edificio del croquis al que debes caminar.

---

## 📈 9. Resumen Semanal (`Weekly Summary`) y Acceso Médico (`Psychiatrist Access`)

### Resumen Semanal (`Weekly Summary`)
- Elige cualquier semana en **Select a week**.
- La tabla de estados de ánimo muestra los colores registrados por día y bloque horario. Si pasas el cursor (o inspeccionas la celda) verás el nombre exacto del estado de ánimo (por ejemplo, `Monday (Morning): Calm`).
- Debajo verás **Sleep Summary** con las horas totales y calidad de descanso de cada día de la semana.

### Gestión de Psiquiatras (`Psychiatrist Access` — solo dueño)
- Crea o actualiza cuentas de acceso **de solo lectura** para tu médico o especialista.
- Un usuario con rol **Psychiatrist (Read-Only)** únicamente puede consultar **Weekly Summary** (ánimo y sueño): tiene bloqueado el acceso a Diario, Inglés, Música, Agenda, Configuración y creación/edición de registros.
- Puedes usar **Suspend / Activate** para pausar o reactivar el acceso temporalmente, o **Revoke access** para eliminarlo.

---

## ⚙️ 9. Configuración y Notificaciones al Celular (`Settings & Reminders`)

### 📱 Recibir recordatorios en la barra de notificaciones de tu celular (`ntfy`)
Así recibes avisos de agenda, sueño, ánimo o estudio de inglés directamente en tu teléfono aunque cierres el navegador:
1. Instala la app gratuita **ntfy** en tu celular (Android / iOS).
2. En **Settings & Reminders → Phone Notification Bar (ntfy)** activa **Enable notifications on my phone's notification bar**.
3. Presiona **Generate** para crear un tópico privado único (mínimo 8 caracteres), o escribe uno propio difícil de adivinar.
4. En la app **ntfy** de tu celular, pulsa `+` y suscríbete exactamente a ese mismo tópico.
5. Guarda cambios con **Save All Settings** y pulsa **Send Test Notification** para comprobar que llega al instante a la barra de tu teléfono.

### Recordatorios configurables y valores por defecto
- **Mood Check-in Reminder** (opcional incluir `Late Night`), **Morning Sleep Log**, **Agenda Event & Task Reminders** (minutos de anticipación), **End-of-Day Word Notes Check** y **English Study Reminder** (días y horario personalizados).
- **Workspace Defaults & Security**:
  - Categoría y vista inicial de la Agenda, visibilidad de fin de semana y zona horaria (por defecto `America/Monterrey`).
  - **Learn with Music YouTube Platform**: elige `Auto (YouTube on PC · YT Music on Mobile)` para mantener YouTube normal en PC y YouTube Music en el celular de forma automática.
  - Botones para actualizar (**Update 32-char Key**) o borrar (**Clear from Browser**) la llave E2EE de ese navegador.

---

## ❓ 10. Preguntas frecuentes (FAQ)

- **¿Por qué en mi PC `Learn with Music` abre YouTube normal y en mi celular abre YouTube Music?**  
  Porque la configuración predeterminada es `Auto (PC / Mobile)`. Detecta si estás en una computadora (abre `youtube.com`) o en un dispositivo móvil (abre `music.youtube.com`). Si alguna vez quieres forzar uno u otro en ese dispositivo, cambia los botones en la barra **Playback Platform** dentro de **Learn with Music**.
- **¿Se puede alterar mi playlist personal de YouTube Music al usar esta app?**  
  No. La app no tiene inicio de sesión ni permisos OAuth sobre tu cuenta de Google/YouTube y solo abre enlaces individuales de canciones (`watch?v=...`).
- **¿Qué pasa si olvidé ingresar la llave E2EE antes de escribir en Journal o English Notebook?**  
  Al intentar guardar, se abrirá el modal **🔐 Local E2EE Secret Key** dentro de la misma página sin hacerte perder lo que ya redactaste.
- **¿Dónde se almacenan mis notas del diario y apuntes de inglés?**  
  Se cifran en tu navegador y únicamente pasan por una cola temporal cifrada hasta que tu script de PC las desencripta localmente y las agrega a tus archivos `.docx` de Word.

---

*Consulta la [Guía Técnica de Arquitectura](./GUIA_TECNICA_ARQUITECTURA.md) o la [Guía de Operación y Migración](./GUIA_OPERACION_Y_MIGRACION.md) para detalles técnicos y de despliegue en servidor.*
