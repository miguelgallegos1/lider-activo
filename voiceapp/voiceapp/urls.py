"""
Enrutador principal de Líder Activo.

Separa las URLs en dos grupos:

1. Pantallas (devuelven HTML): cada una tiene su propio nombre de
   URL para que quede claro en qué pantalla está el usuario, tanto
   en la barra de direcciones como en el <title> de cada página.
2. Endpoints de la API interna (devuelven JSON): los usa el
   JavaScript de las plantillas via fetch() para procesar texto/audio
   y gestionar las voces clonadas, sin recargar la página.
"""

from django.contrib import admin
from django.urls import path
from . import views

urlpatterns = [
    # --- Las 3 pantallas de la app (una plantilla HTML cada una) ---
    # "/" es el aviso de tratamiento de datos: el punto de entrada real
    # de la app. Si se acepta, pasa a "entrenar-voz"; si no, se queda
    # en la misma pantalla (la plantilla cambia de estado con JS, sin
    # redirigir a otra URL).
    path('', views.autorizacion, name='autorizacion'),
    path('entrenar-voz/', views.onboarding, name='entrenar-voz'),          # 1. grabar/subir la muestra de voz y clonarla (o saltar sin entrenar)
    path('mensajes/', views.index, name='mensajes'),                       # 2. escribir/grabar y transformar el mensaje (pantalla principal)

    # Panel de administración estándar de Django (no lo usa la app,
    # pero se deja disponible por si se necesita inspeccionar la base
    # de datos durante el desarrollo).
    path('admin/', admin.site.urls),

    # --- Endpoints JSON que consume el JavaScript de las plantillas ---
    path('procesar-texto/', views.procesar_texto),   # mejora un texto escrito y genera su audio
    path('procesar-audio/', views.procesar_audio),   # transcribe un audio grabado, lo mejora y genera su audio
    path('listar-voces/', views.listar_voces),       # lista las voces disponibles en la cuenta de ElevenLabs
    path('eliminar-voz/', views.eliminar_voz),       # elimina una voz clonada por el usuario

    # Fase de entrenamiento de voz: recibe la muestra de audio y la
    # envía a ElevenLabs para crear la voz clonada.
    path('clonar-voz/', views.entrenar_voz),
]
