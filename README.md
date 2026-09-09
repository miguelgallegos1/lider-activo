# Líder Activo

Aplicación Django que ayuda a líderes de equipo a comunicar mejor sus mensajes: escribe o graba un mensaje, la IA lo redacta de forma profesional (OpenAI) y lo convierte en audio (ElevenLabs), incluso con una voz clonada propia.

## Funcionalidad

- **Onboarding de voz** (`/`): graba o sube una muestra de audio (30s–5min) y clona tu voz con ElevenLabs, con aviso de tratamiento de datos biométricos (LOPDP Ecuador).
- **App principal** (`/app/`):
  - Escribir un mensaje de texto y mejorarlo con IA según un tono (profesional, motivador, directo, empático).
  - Grabar un mensaje de voz, transcribirlo (Whisper) y mejorarlo.
  - Generar el audio final con la voz clonada activa o la voz por defecto.
  - Gestionar ("Mis voces"): ver, activar y eliminar voces clonadas.

## Stack

- Backend: Django, servido con Gunicorn + WhiteNoise.
- IA de texto: OpenAI (`gpt-4o-mini`, `whisper-1`).
- Voz: ElevenLabs (clonación de voz + text-to-speech).
- Frontend: HTML + CSS + JS vanilla (sin build step).
- Deploy: configurado para Railway (`railway.json`).

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

## Deploy (Railway)

En producción define en las variables de entorno de Railway: `SECRET_KEY` (una clave nueva y secreta), `DEBUG=False`, `ALLOWED_HOSTS` con el dominio público que asigne Railway, y las claves de `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`. `railway.json` corre las migraciones, recolecta los estáticos (servidos con WhiteNoise) y levanta Gunicorn.

## Nota de seguridad

`voiceapp/.env` y `db.sqlite3` están excluidos del repositorio (`.gitignore`). Nunca subas claves reales de OpenAI/ElevenLabs al repositorio.
