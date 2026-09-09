"""
Adaptador para desplegar Líder Activo como función serverless en
Vercel.

Vercel no ejecuta un servidor persistente (a diferencia de Railway,
que corre Gunicorn de forma continua): en su lugar, invoca este
archivo como una función por cada petición HTTP. @vercel/python
detecta automáticamente que expone una app WSGI a través de la
variable `app` y usa esa misma variable para servir tanto la app
principal como los endpoints de la API (ver vercel.json, que enruta
todo el tráfico hacia aquí).

No contiene lógica propia: solo agrega la carpeta voiceapp/ al
PYTHONPATH (para poder importar el paquete "voiceapp") y reexpone la
aplicación WSGI real de Django (voiceapp/voiceapp/wsgi.py).
"""

import os
import sys

# La carpeta voiceapp/ (donde vive manage.py y el paquete "voiceapp")
# no está en el PYTHONPATH por defecto en el entorno de Vercel, así
# que se agrega manualmente antes de importar Django.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'voiceapp'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'voiceapp.settings')

from django.core.wsgi import get_wsgi_application

# Vercel busca específicamente una variable llamada "app".
app = get_wsgi_application()
