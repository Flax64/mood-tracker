# Guía Técnica y Arquitectura del Sistema

## Índice

- [1. Visión General de Arquitectura](#1-visión-general-de-arquitectura)
- [2. Reglas Arquitectónicas Obligatorias](#2-reglas-arquitectónicas-obligatorias)
- [3. Estructura Pedagógica del Cuaderno Word (Bloques A y B)](#3-estructura-pedagógica-del-cuaderno-word-bloques-a-y-b)
- [4. Arquitectura Dual Drive Independiente (`rclone`)](#4-arquitectura-dual-drive-independiente-rclone)
- [5. Dependencias, Licencias y Costos (Gratuito vs. Pago)](#5-dependencias-licencias-y-costos-gratuito-vs-pago)
- [6. Coordenadas Oficiales de Campus (TecNM Saltillo)](#6-coordenadas-oficiales-de-campus-tecnm-saltillo)

---

## 1. Visión General de Arquitectura

El repositorio **Personal Daily Hub** implementa una arquitectura híbrida de **bajo consumo de memoria y almacenamiento cero-bloat**:

1. **Cliente Web / Móvil (`public/`)**: Interfaz oscura unificada optimizada para escritorio y celular (OPPO A79 5G) con barra superior fija, modo lectura horizontal para canciones, cifrado en navegador (`AES-256-CBC` + transporte `X25519 + AES-256-CTR + HMAC-SHA256`), micrófono para pronunciación (`Web Speech API`) y traductor acoplado.
2. **Proxy Inverso HTTPS (`Caddyfile` + Docker `proxy`)**: Terminación TLS automática vía ACME (cuando hay dominio configurado en `SITE_ADDRESS`) o certificado interno local (`tls internal`) para habilitar contexto seguro (micrófono y GPS) sin exponer puertos innecesarios.
3. **API y Planificador (`server.js` + `lib/`)**: Servidor Node.js 20 + Express 5 con límite de heap controlado (`--max-old-space-size=128`), gestión de sesiones HTTP-only, motor de recordatorios inteligentes (Agenda repetitiva, proyectos complejos Universidad, Lección de Idiomas secuencial 10–15 min y traslado con tráfico), integración con Google Gemini API y proxy de cola cifrada en RAM hacia Windows.
4. **Base de Datos Ligera (`MySQL 8.0` / `init.sql`)**: Retiene ventana móvil de **30 días** para Ánimo, Sueño, Crisis y Agenda completada. Las lecciones guardan exclusivamente `{ id, lesson_name, completed }` (`EstudioLecciones`). Nunca persiste letras completas, audios, videos ni historiales extensos de chat IA.
5. **Acompañante Local Windows (`sincronitation/sincronizador.py` + `yt_lyrics_helper.py`)**: Escucha la cola cifrada, consulta primero el documento Word existente, extrae metadatos y subtítulos mediante perfiles multi-cliente de `yt-dlp` cuando la PC está encendida, y reescribe XML Word preservando tablas y estilos sin pérdida de datos.

---

## 2. Reglas Arquitectónicas Obligatorias

- **Cero pérdida de datos en Word**: Toda migración respalda previamente el `.docx`, conserva entradas previas e inserta usando marcadores estructurados sin sobrescribir destructivamente.
- **Zero-Bloat**: Datos históricos mayores a 30 días residen comprimidos en `historico_completo.json.gz` (Drive 1) y se cargan temporalmente en RAM al consultarse desde Vista Clínica. Las letras e historiales extensos viven únicamente en Word local.
- **Derechos de autor**: Jamás descarga ni almacena archivos de audio o video en el servidor nube. La reproducción ocurre únicamente mediante embeds oficiales de YouTube/YouTube Music con detección automática de restricciones (`onError` / `embeddable: false`) y botones oficiales alternativos (`Abrir en YouTube`, `Abrir en YouTube Music`, `Reproducir en PC`).
- **Infraestructura Plug-and-Play (Cloud Agnostic)**: Cero IPs, contraseñas o rutas personales fijas en el código; toda conexión usa variables de entorno (`EC2_HOST`, `SERVER_HOST`, `DB_HOST`, `RCLONE_CONF_B64`, `STUDY_RCLONE_CONF_B64`, `GEMINI_API_KEY`).

---

## 3. Estructura Pedagógica del Cuaderno Word (Bloques A y B)

`English_Learning_Notebook.docx` se organiza con etiquetas legibles tanto por el usuario como por Gemini IA (`[SECCION]`, `[LECCION_ID]`):

1. **BLOQUE A (Prioridad 1): INGLÉS (EN → ES)**
   - `[SECCION: A1]` Base Fonética, Alfabeto Rápido y Tabla de Vocabulario (5 columnas: `Palabra | Sonido Fonético | Significado (ES) | Ejemplo Práctico | Contador de Repasos`).
   - `[SECCION: A2]` Patrones Prácticos (`Modal Verbs`, `Idioms` y gramática en uso en 4 partes: estructura, uso en 1 línea, frase real y reto de transformación).
   - `[SECCION: A3]` Estudio por Canciones (desglose `[Intro]`, `[Pre-Coro]`, `[Coro Principal]`, `[Intermedio / Rap]`, `[Coro Final]`) e Historial de Prácticas de 10–15 min.
2. **BLOQUE B (Prioridad 2): COREANO (KO → EN)**
   - Misma estructura `[SECCION: B1]`, `[SECCION: B2]` y `[SECCION: B3]` manteniendo explicaciones **Coreano → Inglés** y romanización precisa para mezcla K-Pop.

---

## 4. Arquitectura Dual Drive Independiente (`rclone`)

| Rol | Variables de Entorno | Contenido Sincronizado | Aislamiento |
| --- | --- | --- | --- |
| **Drive 1 (Clínico / Sistema)** | `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `RCLONE_CONF_B64` | Volcado `.sql.gz` de `MoodTrackerLocal` + `historico_completo.json.gz` | Purga registros locales > 30 días tras respaldo exitoso. |
| **Drive 2 (Estudio de Idiomas)** | `STUDY_RCLONE_REMOTE`, `STUDY_RCLONE_DIR`, `STUDY_RCLONE_CONF_B64` | Exclusivamente `English_Learning_Notebook.docx` | Bloqueo estricto HTTP `403` si se intenta enviar Diario personal. |

---

## 5. Dependencias, Licencias y Costos (Gratuito vs. Pago)

| Dependencia / Servicio | Propósito en el Proyecto | Clasificación | Costo / Modelo de Precios |
| --- | --- | --- | --- |
| **Node.js 20 + Express 5 + `mysql2` + `bcryptjs` + `nodemailer`** | Backend HTTP/API, autenticación y lógica de negocio | **Gratuito (Open Source MIT)** | \$0 USD permanente (software libre). |
| **MySQL 8.0 (Docker oficial)** | Base de datos relacional ligera (ventana 30 días) | **Gratuito (Open Source GPL)** | \$0 USD autohospedado en Docker. |
| **Caddy v2 (`caddy:2-alpine`)** | Proxy inverso HTTPS automático (TLS/ACME) | **Gratuito (Open Source Apache-2.0)** | \$0 USD incluidos certificados TLS Let's Encrypt gratuitos. |
| **Docker Engine & Compose** | Empaquetado reproducible y aislamiento de procesos | **Gratuito (Apache-2.0 / Engine)** | \$0 USD en Ubuntu Server Linux. |
| **`rclone`** | Sincronización Dual Drive y lectura bajo demanda en RAM | **Gratuito (Open Source MIT)** | \$0 USD (cuentas Google Drive estándar de 15 GB gratis c/u). |
| **`yt-dlp` (local Windows)** | Extracción local de subtítulos CC y metadatos exactos | **Gratuito (Unlicense Open Source)** | \$0 USD en computadora local Windows. |
| **Python 3 + `python-docx` + `pycryptodome` + `pywin32`** | Acompañante local en PC y edición OOXML sin pérdida | **Gratuito (Open Source)** | \$0 USD en Windows. |
| **Google Gemini API (`GEMINI_API_KEY`)** | Tutor IA, desglose de estrofas y cuestionarios | **Capa Gratuita / Pago por uso** | Tier gratuito en Google AI Studio con límites por minuto; pago por token solo si habilitas facturación (*Pay-as-you-go*). |
| **Gmail SMTP App Password** | Envío de códigos MFA/registro por correo | **Gratuito** | \$0 USD dentro de cuotas personales estándar de Gmail. |
| **`ntfy` (`https://ntfy.sh`)** | Notificaciones push instantáneas al celular (OPPO A79) | **Gratuito (Apache-2.0) / Planes Pro opcionales** | \$0 USD en servidor público estándar o autohospedado; planes de pago solo para cuotas empresariales. |
| **Servidor VPS Ubuntu (AWS EC2 / GCP / DigitalOcean)** | Alojamiento 24/7 en la nube | **Capa Gratuita Temporal / Pago mensual** | **Pago** tras vencer el Free Tier (ej. AWS `t3.micro` o VPS ~\$5–\$10 USD/mes; **Google Cloud `e2-micro`** ofrece capa *Always Free* en regiones US elegibles con límites de red). |
| **Nombre de Dominio Propio / DuckDNS** | Habilitar HTTPS público confiable sin advertencias | **Gratuito (DuckDNS) / Pago (`.com`)** | \$0 USD usando subdominio DuckDNS; \$10–\$15 USD/año si compras dominio propio. |

---

## 6. Coordenadas Oficiales de Campus (TecNM Saltillo)

| Campus | Dirección de Referencia | Latitud | Longitud |
| --- | --- | --- | --- |
| **Campus Principal** | Blvd. Venustiano Carranza #2400, Col. Tecnológico, Saltillo, Coahuila | `25.4414` | `-100.9922` |
| **Campus Blvd (Glorieta)** | Blvd. Venustiano Carranza esq. Av. Universidad, Saltillo, Coahuila | `25.4385` | `-100.9940` |
| **Campus Miravalle** | Blvd. Vito Alessio Robles, Col. Miravalle, Saltillo, Coahuila | `25.4194` | `-101.0232` |
