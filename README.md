# Líder Activo

Aplicación web (Django) que ayuda a un líder de equipo a comunicar mejor sus mensajes: escribe o graba un mensaje, la IA lo redacta de forma profesional (OpenAI) y lo convierte en audio (ElevenLabs), incluso con una voz clonada del propio usuario.

Proyecto de graduación — Ingeniería en Software.

## Funcionalidad

La app tiene 3 pantallas, cada una con su propia URL:

| Pantalla | URL | Qué hace |
|---|---|---|
| Autorización | `/` | Punto de entrada real de la app. Aviso de tratamiento de un dato biométrico (LOPDP Ecuador); sin aceptar no se puede continuar. Si se rechaza, se queda en la misma pantalla (sin navegar) con opción de reintentar. |
| Entrenar mi voz | `/entrenar-voz/` | Grabar (con guion de lectura sugerido, colapsado por defecto) o subir un archivo de audio (1–3min) y clonarlo con ElevenLabs. Puede saltarse sin entrenar. |
| Mensajes | `/mensajes/` | Pantalla principal: escribir o grabar un mensaje, elegir tono/idioma/voz, mejorarlo con IA (GPT, con filtro de contenido ofensivo/amenazas) y generar el audio final. También lista y gestiona ("Mis voces") las voces clonadas. |

## Stack

- **Backend:** Django (sin modelos propios: no hay base de datos de negocio, todo el estado vive en el navegador). Servido con Gunicorn + WhiteNoise.
- **IA de texto:** OpenAI (`gpt-4o-mini` para mejorar redacción, `whisper-1` para transcribir audio).
- **Voz:** ElevenLabs (clonación de voz + texto a voz).
- **Frontend:** HTML + CSS + JavaScript vanilla, sin framework ni build step (no hay bundler, npm ni compilación: los archivos `.css`/`.js` se sirven tal cual).
- **Deploy:** Railway (`railway.json`, servidor Gunicorn persistente) o Vercel (`vercel.json`, funciones serverless vía `api/index.py`).

## Estructura del proyecto

```
lider-activo/
├── api/
│   └── index.py            # Adaptador WSGI para desplegar como función serverless en Vercel
├── requirements.txt         # Dependencias Python (copia para que Vercel las encuentre en la raíz)
├── vercel.json               # Configuración de deploy en Vercel
│
└── voiceapp/                 # Proyecto Django (contiene manage.py)
    ├── manage.py
    ├── requirements.txt       # Dependencias Python (para desarrollo local y Railway)
    ├── railway.json           # Configuración de deploy en Railway
    ├── .env.example           # Plantilla de variables de entorno (sin secretos)
    │
    ├── voiceapp/              # Paquete de configuración de Django
    │   ├── settings.py        # Configuración del proyecto (comentada)
    │   ├── urls.py             # Enrutador: pantallas + endpoints de la API interna
    │   ├── views.py            # Toda la lógica de la app: pantallas y llamadas a OpenAI/ElevenLabs
    │   ├── wsgi.py / asgi.py   # Puntos de entrada estándar de Django
    │   └── __init__.py
    │
    ├── templates/              # Un archivo HTML por pantalla (solo estructura, sin CSS/JS inline)
    │   ├── autorizacion.html   # Pantalla "Autorización" (punto de entrada, "/")
    │   ├── onboarding.html      # Pantalla "Entrenar mi voz"
    │   └── index.html          # Pantalla "Mensajes"
    │
    └── static/                 # CSS y JavaScript, un archivo por pantalla (misma separación que templates/)
        ├── css/
        │   ├── autorizacion.css
        │   ├── entrenar-voz.css
        │   └── mensajes.css
        └── js/
            ├── autorizacion.js
            ├── entrenar-voz.js
            └── mensajes.js
```

Ver [`RESUMEN_TECNICO.md`](RESUMEN_TECNICO.md) para un resumen técnico más detallado (APIs externas, parámetros de OpenAI/ElevenLabs, decisiones de diseño y preguntas frecuentes), pensado como apoyo para la sustentación del proyecto de graduación.

**Por qué el CSS/HTML/servidor están separados:** cada plantilla en `templates/` solo tiene marcado HTML; su estilo vive en el `.css` correspondiente dentro de `static/css/` y su lógica de interfaz en el `.js` correspondiente dentro de `static/js/`, enlazados con `<link rel="stylesheet">` y `<script src="...">` (usando el sistema de archivos estáticos de Django, `{% static %}`). Toda la lógica de servidor (llamadas a OpenAI/ElevenLabs, endpoints JSON) vive exclusivamente en `voiceapp/voiceapp/views.py`; ninguna plantilla ni archivo estático contiene lógica de negocio.

**Por qué hay dos `requirements.txt`:** Vercel busca ese archivo en la raíz del repositorio, mientras que el entorno local y Railway lo usan desde dentro de `voiceapp/`. Ambos deben mantenerse iguales.

**Por qué no hay `models.py` ni migraciones propias:** la app no guarda datos de negocio (el estado de "voz activa" se guarda en el `localStorage` del navegador, no en el servidor). La base de datos SQLite que trae Django solo la usan internamente `django.contrib.admin`/`auth`/`sessions`, que quedaron instalados por ser parte del scaffold estándar del framework.

## Configuración local

1. Crear un entorno virtual e instalar dependencias:
   ```bash
   python -m venv venv
   venv\Scripts\activate
   pip install -r voiceapp/requirements.txt
   ```
2. Copiar `voiceapp/.env.example` a `voiceapp/.env` y completar tus claves:
   ```
   SECRET_KEY=...
   DEBUG=True
   ALLOWED_HOSTS=127.0.0.1,localhost
   OPENAI_API_KEY=...
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...
   ```
3. Ejecutar migraciones y levantar el servidor:
   ```bash
   cd voiceapp
   python manage.py migrate
   python manage.py runserver
   ```
4. Abrir http://127.0.0.1:8000/ (pantalla de autorización, punto de entrada de la app).

## Deploy (Railway)

En producción define en las variables de entorno de Railway: `SECRET_KEY` (una clave nueva y secreta), `DEBUG=False`, `ALLOWED_HOSTS` con el dominio público que asigne Railway, y las claves de `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`. `railway.json` corre las migraciones y levanta Gunicorn; los archivos estáticos los sirve WhiteNoise directamente desde `voiceapp/static/`.

## Deploy (Vercel)

El proyecto no usa base de datos para nada de su funcionalidad, así que el filesystem efímero de las funciones serverless de Vercel no afecta el uso real de la app.

1. En [vercel.com](https://vercel.com), "Add New Project" → importar `miguelgallegos1/lider-activo` desde GitHub. Vercel detecta `vercel.json` automáticamente (usa `@vercel/python` sobre `api/index.py`, que expone la app Django como WSGI).
2. En las variables de entorno del proyecto en Vercel, define:
   - `SECRET_KEY` (una clave nueva, no la de desarrollo)
   - `DEBUG=False`
   - `ALLOWED_HOSTS=.vercel.app` (cubre el dominio de preview y de producción; agrega tu dominio propio si conectas uno)
   - `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
3. Deploy. Cada push a `master` genera un deploy nuevo automáticamente; cada PR obtiene su propia URL de preview para ir probando.

También se puede probar desde la terminal con `vercel` (CLI) apuntando a la raíz del repo.

## Nota de seguridad

`voiceapp/.env` y `db.sqlite3` están excluidos del repositorio (`.gitignore`). Nunca subas claves reales de OpenAI/ElevenLabs al repositorio.
