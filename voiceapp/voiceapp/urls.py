
from django.contrib import admin
from django.urls import path
from django.views.generic.base import RedirectView
from . import views

urlpatterns = [
    # "/" solo redirige a la pantalla de entrenamiento de voz, que es
    # el punto de entrada real de la app.
    path('', RedirectView.as_view(pattern_name='entrenar-voz', permanent=False)),

    # Las 3 pantallas de la app, cada una con su propia URL:
    path('entrenar-voz/', views.onboarding, name='entrenar-voz'),   # 1. grabar/subir la muestra de voz
    path('mensajes/', views.index, name='mensajes'),                # 2. escribir/grabar y transformar el mensaje
    path('sin-autorizar/', views.sin_autorizar, name='sin-autorizar'),  # 3. cuando no se acepta el aviso de datos

    path('admin/', admin.site.urls),

    path('procesar-texto/', views.procesar_texto),
    path('procesar-audio/', views.procesar_audio),
    path('listar-voces/', views.listar_voces),
    path('eliminar-voz/', views.eliminar_voz),

    # fase entrenamiento voz
    path('clonar-voz/', views.entrenar_voz),
]
