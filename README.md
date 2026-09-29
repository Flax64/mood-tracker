# Personal Mood Tracker

Aplicación web full-stack diseñada para el registro diario y la visualización semanal del estado de ánimo. El sistema permite a los usuarios registrar cómo se sienten en diferentes momentos del día (Mañana, Mediodía, Tarde, Noche) y generar automáticamente una matriz visual de colores basada en un selector dinámico de semanas (de Domingo a Sábado).

## 🛠️ Tecnologías Utilizadas

**Frontend:**

* **HTML5 & CSS3:** Diseño responsivo adaptado para dispositivos móviles y de escritorio.


* **JavaScript (Vanilla):** Consumo de API REST, manipulación del DOM y lógica de cálculo de rangos de fechas (ISO 8601 adaptado).



**Backend:**

* **Node.js & Express:** Servidor web y enrutamiento de la API.


* **MySQL 8.0:** Base de datos relacional persistente.


* **Cors & Dotenv:** Manejo de variables de entorno y políticas de intercambio de recursos.



**DevOps & Despliegue:**

* **Docker & Docker Compose:** Contenerización de la aplicación y orquestación de servicios.


* **GitHub Actions:** Flujo de trabajo CI/CD automatizado (`deploy.yml`) para despliegue en instancias AWS EC2.



---

## 📁 Estructura del Proyecto

La arquitectura del proyecto sigue una separación clara entre el código fuente del cliente (interfaz gráfica) y el servidor, orquestado mediante contenedores:

```text
mood-tracker/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Pipeline de CI/CD para despliegue en EC2
├── public/                     # Archivos estáticos servidos por Express
│   ├── dashboard.html          # Vista de la matriz semanal de colores
│   ├── index.html              # Vista del formulario de registro diario
│   ├── style.css               # Hojas de estilo unificadas y responsivas
│   └── frontend.js             # Lógica de cliente (registro y renderizado visual)
├── .env                        # Variables de entorno (No incluido en el repositorio)
├── .gitignore                  # Reglas de exclusión para Git
├── docker-compose.yml          # Definición de servicios (App + MySQL)
├── Dockerfile                  # Receta de construcción de la imagen de Node.js
├── init.sql                    # Script de inicialización de la tabla RegistrosMood
├── package.json                # Dependencias del proyecto Node.js
├── README.md                   # Documentación principal
└── server.js                   # Lógica del backend y conexión a base de datos

```

---

## 🚀 Instalación y Ejecución (Entorno Local/Docker)

El proyecto está diseñado para levantarse rápidamente utilizando Docker Compose, el cual inicializará tanto el servidor de Node.js en el puerto `3000` como la base de datos MySQL en el puerto `3306`.

1. **Clonar el repositorio:**
```bash
git clone <URL_DEL_REPOSITORIO>
cd mood-tracker

```


2. **Configurar Variables de Entorno:**
Crea un archivo `.env` en la raíz del proyecto y define las credenciales de la base de datos.


```env
DB_HOST=db
DB_USER=root
DB_PASS=tu_contraseña_segura
DB_NAME=MoodTrackerLocal
PORT=3000

```


3. **Construir y levantar los contenedores:**
```bash
docker compose up -d --build

```


Nota: Durante el primer arranque, el volumen de la base de datos ejecutará automáticamente el archivo `init.sql` para estructurar la tabla necesaria. El contenedor de la aplicación incluye un `healthcheck` que esperará hasta 20 segundos a que MySQL esté listo antes de arrancar Node.js.


4. **Acceso a la aplicación:**
Abre tu navegador web e ingresa a `http://localhost:3000`.

---

## 📡 Endpoints de la API

El backend expone rutas RESTful estandarizadas para la comunicación con el cliente web.

### 1. Guardar un registro de estado de ánimo

* **Ruta:** `POST /api/mood`

* **Descripción:** Inserta un nuevo registro en la base de datos. Posee una restricción `UNIQUE` para evitar duplicidad de registros en el mismo momento del día.


* **Body (JSON):**
```json
{
  "fecha": "2026-09-28",
  "momento_dia": "Morning",
  "estado_animo": "Happy",
  "color_hex": "#FDE047"
}

```


* **Respuestas:**
* `200 OK`: 'Estado de ánimo registrado correctamente'.


* `400 Bad Request`: 'Ya registraste tu estado de ánimo para este momento del día' (Error `ER_DUP_ENTRY`).





### 2. Consultar registros por rango de fechas

* **Ruta:** `GET /api/moods`

* **Descripción:** Retorna todos los registros almacenados que coincidan con el rango de fechas proporcionado, utilizados para rellenar el dashboard visual.


* **Query Parameters:**
* `inicio`: Fecha de inicio (ej. `2026-09-27`).
* `fin`: Fecha de fin (ej. `2026-10-03`).


* **Respuesta Exitosa (JSON):**
```json
[
  {
    "fecha": "2026-09-28T00:00:00.000Z",
    "momento_dia": "Morning",
    "color_hex": "#FDE047"
  }
]

```



---

## 🌐 Despliegue en Producción (AWS EC2)

Para entornos de producción, el repositorio utiliza un flujo de GitHub Actions ubicado en `.github/workflows/deploy.yml`.

Al integrar cambios en la rama principal (`main`), el pipeline se conecta mediante SSH a la instancia EC2, actualiza el código fuente, reconstruye las imágenes y levanta los servicios mediante `docker compose up -d --build` garantizando una integración continua. Asegúrese de que el **Security Group** de la instancia EC2 tenga habilitado el puerto TCP `3000` para permitir tráfico HTTP entrante hacia el contenedor de Node.js.