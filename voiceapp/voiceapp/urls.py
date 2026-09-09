
from django.contrib import admin
from django.urls import path
from . import views

urlpatterns = [
    path('', views.onboarding, name='onboarding'), # ahora abre onboarding primero
    path('app/', views.index, name='index'),      # tu app principal
    path('admin/', admin.site.urls),

    path('procesar-texto/', views.procesar_texto),
    path('procesar-audio/', views.procesar_audio),
    path('listar-voces/', views.listar_voces),
    path('eliminar-voz/', views.eliminar_voz),

    # fase entrenamiento voz
    path('clonar-voz/', views.entrenar_voz),
]