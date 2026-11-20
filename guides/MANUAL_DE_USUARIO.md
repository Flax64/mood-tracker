# 📖 Manual de Usuario — Personal Daily Hub
> **Guía rápida visual (sin bloques largos de texto).** Todo viaja cifrado (`X25519 + AES-256-CTR`) y tus notas privadas de Word usan cifrado de extremo a extremo (`E2EE AES-256-CBC`).
## Índice
1. [1. Inicio Rápido y Acceso](#1-inicio-rápido-y-acceso)
2. [2. Registros Diarios (Ánimo, Sueño y Crisis)](#2-registros-diarios-ánimo-sueño-y-crisis)
3. [3. Diario Personal y Estudio de Idiomas (Word + IA + Música)](#3-diario-personal-y-estudio-de-idiomas-word--ia--música)
4. [4. Agenda Semanal, Horario ITS, Residencias y Trabajo](#4-agenda-semanal-horario-its-residencias-y-trabajo)
5. [5. Vista Clínica del Médico y Archivo Histórico en Google Drive](#5-vista-clínica-del-médico-y-archivo-histórico-en-google-drive)
6. [6. Ajustes, Notificaciones Push (ntfy) y Respaldos](#6-ajustes-notificaciones-push-ntfy-y-respaldos)
7. [7. Atajos de Teclado](#7-atajos-de-teclado)

---

## 1. Inicio Rápido y Acceso

| Rol | Qué puede hacer | Expiración de sesión |
| :--- | :--- | :--- |
| **Propietario (Admin)** | Control total de todos los módulos, IA, Word y Ajustes. | Automática cada **Domingo 00:00**. |
| **Psiquiatra / Médico** | **Solo lectura** en `📈 Resumen Semanal` (Ánimo, Sueño/Desvelos y Crisis). | Automática cada **Domingo 00:00**. |

* **Cambiar idioma (EN / ES):** Botón `🌐 EN / ES` arriba a la derecha o en el menú lateral.
* **Llave E2EE (32 caracteres):** Pulsa `🔑 E2EE Key` una sola vez en tu navegador para activar el envío cifrado a tus archivos Word.
* **Límite de Sesiones y Pestaña Única:** Cada cuenta conserva máximo **3 sesiones activas** (ej. PC + Celular; las más antiguas se limpian automáticamente) y el navegador permite **1 sola pestaña activa a la vez** (`#singleTabGuardModal`) con opción de transferir el control en 1 clic (**`Usar aquí`**) para cuidar la memoria RAM.

---

## 2. Registros Diarios (Ánimo, Sueño y Crisis)

### 🧠 Mood Tracker (`#mood`)
1. Elige **Fecha** y **Bloque del día** (*Madrugada, Mañana, Mediodía, Tarde, Noche*).
2. Toca tu **Emoción** (16 colores disponibles).
3. Pulsa **Guardar** (puedes actualizar el bloque actual mientras siga abierto).

### 🌙 Sleep & Desvelo Tracker (`#sueno`)
1. Elige el modo: **🌙 Sesión Normal**, **🦉 Desvelo / Dormir Tarde (ej. 3 AM)** o **⚡ Desvelo Total (0 hrs)**.
2. Si te vas a dormir de madrugada, marca **"⏳ Me voy a dormir ahora"** y completa la hora de despertar al levantarte.
3. Selecciona la calidad (**🟢 Reparador**, **🟡 Regular**, **🔴 Pesado**) y guarda.

### ⚠️ Bitácora de Crisis (`#crisis`)
1. Pulsa `⏱️ Now` para poner fecha y hora actual.
2. Elige el **Tipo de episodio** (si eliges `📝 Otro`, escribe qué emoción sentiste) y la **Intensidad (1 a 5)**.
3. *(Opcional)* Escribe el detonante en español (**máx. 250 caracteres**) y presiona `Ctrl + Enter`.

---

## 3. Diario Personal y Estudio de Idiomas (Word + IA + Música)

### 🖋️ Journal Notes (`#journal`)
* **Privacidad total:** Lo que escribes se cifra en tu navegador y se guarda únicamente en tu `Journal.docx` local con contraseña (jamás se guarda en MySQL ni se sube a Google Drive).
* **Uso en 3 pasos:** `1. Elige etiqueta o título` → `2. Escribe tu nota en inglés (revisión ortográfica en vivo)` → `3. Pulsa Encrypt E2EE & Send to Word`.

### 📖 Language Studio: Inglés (1°) y Coreano (2°) (`#english`)
* **Prioridad de idioma:**
  * `🇺🇸 1° Inglés (EN → ES)`: Explicaciones y traducciones de Inglés a Español.
  * `🇰🇷 2° Coreano (KO → EN)`: Hangul + Romanización automática traducida de Coreano a Inglés.
  * `🎵 K-Pop (EN + KR)`: Modo mixto para canciones.
* **🎯 Curso Práctico (15 min) y Pronunciación:**
  1. Pulsa `▶️ Iniciar / Pausar Curso (15 min)` para activar recordatorios sin fecha límite.
  2. Abre `📚 Ver Lecciones Secuenciales`: completa la práctica en tu Word para desbloquear la siguiente lección.
  3. Pulsa `🎤 Practicar Pronunciación` para hablar al micrófono y recibir puntaje fonético.

### 🎵 Learn with Music + Carpetas Estilo Windows 11
* **Explorador por Carpetas:**
  1. Haz clic en la **Carpeta amarilla del Artista** para ver sus álbumes.
  2. Haz clic en la **Carpeta amarilla del Álbum** para desplegar sus canciones.
  3. Pulsa `Estudiar -> Word` en cualquier canción.
* **Visor de Letras (Solo Lectura y Sin Cortes):**
  * `📄 Extraer Letra`: Verifica en tiempo real (`< 150 ms`) si tu PC está encendida y carga la letra completa en **solo lectura**, dividida por bloques de idioma (`🇺🇸 Inglés`, `🇰🇷 Coreano + Romanización`, `🇪🇸 Español`).
  * `🇪🇸 Traducir Canción a Español`: Traduce la letra completa con IA, la muestra al final del visor y la guarda automáticamente en tu Word.
  * `✨ Analizar Estrofas con IA`: Divide la canción por estrofas (*Intro, Verso, Pre-Coro, Coro, Rap*) con vocabulario y fonética.
* **Respaldo automático del Word de Idiomas:** Tu `English_Learning_Notebook.docx` se respalda automáticamente en tu Google Drive bajo la carpeta **`NotasIdiomas`** (`gdrive:NotasIdiomas/English_Learning_Notebook.docx`).

---

## 4. Agenda Semanal, Horario ITS, Residencias y Trabajo

### 🗓️ Weekly Agenda (`#agenda`)
* **Crear actividad:** Pulsa `+ New Activity` o el botón `+ Add` dentro de cualquier bloque (*Mañana, Escuela, Tarde, Noche*).
* **Alcance especial:**
  * `📌 Actividad Estándar`: Eventos o tareas normales con estado Jira (`To Do`, `In Progress`, `Done`).
  * `📚 Proyecto / Tarea Larga (Universidad)`: Permite recordatorios de **6h, 1 día, 3 días o 1 semana antes**.
  * `🗣️ Lección de Idiomas`: Se asigna automáticamente a tu agenda **Personal** (recordatorio 15 min antes).
* **Repetición:** Usa `🔁 Repetir cada X días` para programar sesiones recurrentes de una sola vez.

### 🎓 Horario ITS, Residencias, Trabajo y Tráfico (`#horario`)
1. **Semestre ITS y Croquis:** Escribe tu salón (`R02`, `R11`, `N21`, `A10`, `S15`) y el sistema detecta automáticamente el campus (**Principal CTO-002**, **Miravalle CTO-003** o **Boillot/Sistemas CTO-004**) con coordenadas exactas sobre bulevar.
2. **Vacaciones:** Registra periodos vacacionales para pausar alertas de clases automáticamente.
3. **Residencias (500 hrs) y Trabajo:** Registra horario y ubicación de la empresa para calcular ruta con tráfico.
4. **Sincronizar:** Pulsa `🗓️ Sync Week to Agenda` para volcar tus clases y turnos en la Agenda Semanal.

---

## 5. Vista Clínica del Médico y Archivo Histórico en Google Drive

### 📈 Resumen Semanal (`#resumen`)
* **Calendario Interactivo:** Elige cualquier día en `📅 Elegir día o semana en Calendario` (o usa `◀ Semana Ant.` / `Semana Sig. ▶`) para cargar esa semana completa de domingo a sábado.
* **Retención inteligente (1 Mes Local + Drive en RAM):**
  * La base de datos MySQL local guarda solo los **últimos 30 días** para no llenar la instancia EC2.
  * Para consultar los **últimos 3, 6 o 12 meses**, selecciónalo en `☁️ Drive` y pulsa **`☁️ Extraer Historial de Drive (RAM)`**: los datos se leen temporalmente en memoria RAM sin ocupar disco.

---

## 6. Ajustes, Notificaciones Push (`ntfy`) y Respaldos

1. **Notificaciones en el celular (`ntfy`):**
   * Instala la app **ntfy** en tu teléfono y suscríbete al tópico generado en `⚙️ Settings`.
   * Desde la notificación en tu barra de Android puedes tocar **`Open App`**, **`Snooze 15m`** o **`Snooze 30m`** directamente.
   * Si ya tienes una pestaña abierta de Personal Daily Hub al tocar **`Open App`**, la aplicación transfiere la vista/recordatorio directo a esa pestaña activa sin acumular pestañas repetidas.
2. **IA Google Gemini:** Pega tu `GEMINI_API_KEY` y pulsa `🧪 Test AI Connection` (el selector muestra únicamente los modelos activos en tu cuenta).
3. **Carpeta `NotasIdiomas` en Drive:** En `⚙️ Settings` puedes activar/desactivar el respaldo automático de `English_Learning_Notebook.docx` y personalizar el nombre de la carpeta (`NotasIdiomas`).

---

## 7. Atajos de Teclado

| Atajo | Acción inmediata |
| :--- | :--- |
| `Alt + T` | Abrir / cerrar el **Traductor Rápido Flotante** en cualquier pestaña (toma el texto que tengas seleccionado). |
| `Ctrl + Enter` | Guardar inmediatamente en **Bitácora de Crisis**, **Nota de Desvelo** o ejecutar **Desglose de Letra con IA**. |
| `Enter` | Enviar pregunta al **Tutor de IA** (`Shift + Enter` inserta salto de línea) o buscar canción en YouTube. |
| `Esc` | Cerrar cualquier ventana modal, traductor flotante o menú móvil. |
