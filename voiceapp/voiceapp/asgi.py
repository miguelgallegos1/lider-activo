"""
ASGI config for voiceapp project.

It exposes the ASGI callable as a module-level variable named ``application``.

El proyecto se despliega con WSGI (ver wsgi.py), no con un servidor
ASGI, así que este archivo no se usa en producción hoy. Se conserva
porque forma parte del scaffold estándar de Django y deja la puerta
abierta a soporte async en el futuro.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'voiceapp.settings')

application = get_asgi_application()
