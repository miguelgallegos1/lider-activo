import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'voiceapp'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'voiceapp.settings')

from django.core.wsgi import get_wsgi_application

app = get_wsgi_application()
