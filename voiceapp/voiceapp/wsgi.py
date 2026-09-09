"""
WSGI config for voiceapp project.

It exposes the WSGI callable as a module-level variable named ``application``.

Este es el punto de entrada que usa Gunicorn en producción (ver
railway.json: "gunicorn voiceapp.wsgi:application") y también el que
importa api/index.py para exponer la app en Vercel.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'voiceapp.settings')

application = get_wsgi_application()
