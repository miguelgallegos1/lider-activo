"""
Configuración de Django para el proyecto "Líder Activo".

Líder Activo es una aplicación web que ayuda a un líder de equipo a
comunicar mejor sus mensajes: el usuario escribe o graba un mensaje,
OpenAI (GPT) lo redacta de forma más profesional y ElevenLabs lo
convierte en audio, opcionalmente con una voz clonada del propio
usuario.

Generado originalmente por 'django-admin startproject' y adaptado
para leer su configuración sensible desde variables de entorno (ver
voiceapp/.env.example) y para desplegarse tanto en Railway (servidor
persistente con Gunicorn) como en Vercel (funciones serverless).

Documentación de referencia:
https://docs.djangoproject.com/en/6.0/topics/settings/
https://docs.djangoproject.com/en/6.0/ref/settings/
"""

from pathlib import Path
import os
from dotenv import load_dotenv

# Carga las variables definidas en voiceapp/.env (si el archivo existe)
# hacia el entorno del proceso. En producción (Railway/Vercel) estas
# variables se configuran directamente en el panel del proveedor, por
# lo que load_dotenv() simplemente no encuentra el archivo y no falla.
load_dotenv()

# Claves de las APIs externas que usan las vistas en views.py.
# Se leen una sola vez aquí para que el resto del proyecto no tenga
# que importar "os" ni saber el nombre exacto de la variable de entorno.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")  # voz por defecto si el usuario no eligió ninguna

# Carpeta raíz del proyecto Django (voiceapp/), es decir, la carpeta
# que contiene manage.py. A partir de aquí se construyen otras rutas
# como la plantilla de templates/ o la base de datos SQLite.
BASE_DIR = Path(__file__).resolve().parent.parent


# =============================================================
# Seguridad básica
# =============================================================

# SECURITY WARNING: keep the secret key used in production secret!
# En local usa una clave de desarrollo fija (no es un problema porque
# nunca se sube al repositorio); en producción se debe definir
# SECRET_KEY como variable de entorno con un valor único y secreto.
SECRET_KEY = os.getenv(
    'SECRET_KEY',
    'django-insecure-c=d#da#^%!o5-=h!6k!=mdc&*ua%cg89l1m5xy0hiofjnka&m@',
)

# SECURITY WARNING: don't run with debug turned on in production!
# DEBUG=True muestra páginas de error con detalles internos (código,
# variables, rutas del servidor); solo debe estar activo en desarrollo.
DEBUG = os.getenv('DEBUG', 'False') == 'True'

# Dominios desde los que Django aceptará peticiones. Si el host de la
# petición no está en esta lista, Django responde 400 Bad Request
# (protección contra ataques de "Host header"). Se define por entorno
# porque cada proveedor de hosting usa un dominio distinto.
ALLOWED_HOSTS = [h.strip() for h in os.getenv('ALLOWED_HOSTS', '127.0.0.1,localhost').split(',') if h.strip()]


# =============================================================
# Aplicación
# =============================================================

# Apps instaladas. El proyecto no define una app propia (no hay
# modelos ni migraciones: toda la lógica vive en voiceapp/views.py),
# así que aquí solo están las apps que trae Django por defecto y que
# usan otras piezas del framework (el panel /admin/, el sistema de
# sesiones que usa CSRF, los archivos estáticos, etc).
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

# Middlewares: cada petición pasa por esta lista en orden (y la
# respuesta la atraviesa en orden inverso). WhiteNoiseMiddleware se
# agregó justo después de SecurityMiddleware, que es la posición que
# recomienda la documentación de WhiteNoise, para servir los archivos
# estáticos directamente desde Django/Gunicorn sin depender de un
# servidor web aparte (Nginx, etc).
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'voiceapp.urls'

# Motor de plantillas. DIRS apunta a voiceapp/templates/, donde viven
# index.html, onboarding.html y sin_autorizar.html (las 3 pantallas
# de la app).
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'voiceapp.wsgi.application'


# =============================================================
# Base de datos
# =============================================================
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases
#
# La app no guarda datos propios (no hay modelos): esta base de
# datos SQLite solo la usan internamente las apps de Django que
# quedaron instaladas arriba (admin, auth, sessions). Por eso basta
# con SQLite, sin necesidad de un motor de base de datos aparte.

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        # En Vercel el filesystem del proyecto es de solo lectura
        # salvo la carpeta /tmp, así que ahí es donde debe vivir el
        # archivo de la base de datos cuando se corre en ese entorno.
        'NAME': '/tmp/db.sqlite3' if os.getenv('VERCEL') else BASE_DIR / 'db.sqlite3',
    }
}


# Validadores de contraseña (los usa el sistema de autenticación de
# Django si en el futuro se agregan usuarios/login; hoy no hay ningún
# formulario de registro en la app, pero se dejan porque son parte
# del scaffold estándar de Django y no tienen costo si no se usan).
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# =============================================================
# Internacionalización
# =============================================================
# https://docs.djangoproject.com/en/6.0/topics/i18n/
# (Estos valores controlan el framework de traducción interno de
# Django, no el idioma que elige el usuario para su mensaje: eso se
# maneja aparte, en el parámetro "idioma" que reciben las vistas de
# procesar-texto/procesar-audio.)

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# =============================================================
# Archivos estáticos
# =============================================================
# https://docs.djangoproject.com/en/6.0/howto/static-files/
#
# El CSS y el JavaScript de cada pantalla viven como archivos propios
# en voiceapp/static/css/ y voiceapp/static/js/ (uno por plantilla),
# separados de la plantilla HTML. STATICFILES_DIRS le indica a Django
# dónde buscarlos, además de la carpeta static/ de cada app instalada
# (que aquí no aplica porque el proyecto no define apps propias).
STATICFILES_DIRS = [BASE_DIR / 'static']

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'  # carpeta donde collectstatic reúne los archivos en Railway

# En Vercel no hay un paso de build que corra "collectstatic" (cada
# request es una función serverless nueva), así que WhiteNoise no
# podría depender de STATIC_ROOT ahí. WHITENOISE_USE_FINDERS le dice
# a WhiteNoise que sirva los archivos directamente desde
# STATICFILES_DIRS (igual que hace el runserver de desarrollo), sin
# necesitar collectstatic. Por eso también se usa un storage sin
# manifest: ManifestStaticFilesStorage exige que el manifiesto
# generado por collectstatic exista, y en Vercel nunca se genera.
WHITENOISE_USE_FINDERS = True
STORAGES = {
    'staticfiles': {
        # Storage de WhiteNoise: comprime los archivos (gzip/brotli)
        # pero sin manifiesto de hashes, para no depender de que se
        # haya corrido collectstatic.
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}
