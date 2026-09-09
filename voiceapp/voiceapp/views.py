import os
import json
import tempfile
import requests
import base64
from io import BytesIO

from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from openai import OpenAI
from elevenlabs import ElevenLabs
from elevenlabs.client import ElevenLabs

# ✅ CLIENTES BIEN SEPARADOS
openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
eleven_client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)

def index(request):
    return render(request, 'index.html')

def onboarding(request):
    return render(request, 'onboarding.html')

def sin_autorizar(request):
    return render(request, 'sin_autorizar.html')

#======================
# 🎙️ ENTRENAR VOZ
#======================

@csrf_exempt
def entrenar_voz(request):

    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        archivos = request.FILES.getlist('samples')

        if not archivos:
            return JsonResponse({'error': 'Sin muestras de voz'}, status=400)

        files_bytes = []
        for archivo in archivos:
            files_bytes.append(archivo.read())

        voice_name = request.POST.get('voice_name', 'MiVoz').strip() or 'MiVoz'

        voice = eleven_client.voices.ivc.create(
            name=voice_name,
            files=files_bytes,
            labels={},  # el SDK envía un valor inválido si se omite este parámetro
        )

        return JsonResponse({
            "ok": True,
            "voice_id": voice.voice_id
        })

    except Exception as e:
        import traceback
        err = str(e).lower()
        print("🔥 ERROR COMPLETO ELEVENLABS:")
        print(traceback.format_exc())

        # Detectar límite de voces de ElevenLabs
        if any(x in err for x in ['voice_limit', 'maximum', 'limit', 'quota', 'exceeded']):
            return JsonResponse({
                "ok": False,
                "limite": True,
                "mensaje": "Has alcanzado el límite de voces en ElevenLabs. Ve a 'Mis voces' y elimina una para poder crear una nueva."
            }, status=200)

        return JsonResponse({
            'error': 'No se pudo clonar la voz. Verifica tu conexión e intenta de nuevo en unos segundos.'
        }, status=500)

# =========================
# 📝 PROCESAR TEXTO
# =========================
@csrf_exempt
def procesar_texto(request):

    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)

        texto_original = data.get('texto', '').strip()
        tono = data.get('tono', 'profesional')
        idioma = data.get('idioma', 'es')
        voice_id = data.get('voice_id')   # 🔥 CLAVE

        if not texto_original:
            return JsonResponse({'error': 'El texto no puede estar vacío'}, status=400)

        texto_mejorado = mejorar_texto(texto_original, tono, idioma)

        audio_b64 = texto_a_audio(texto_mejorado, voice_id)  # 🔥 AQUÍ SE USA VOZ CLONADA

        return JsonResponse({
            'texto_original': texto_original,
            'texto_mejorado': texto_mejorado,
            'audio_base64': audio_b64,
        })

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': 'No se pudo procesar el mensaje. Intenta de nuevo en unos segundos.'}, status=500)

# =========================
# 🎧 PROCESAR AUDIO
# =========================
@csrf_exempt
def procesar_audio(request):

    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        archivo_audio = request.FILES.get('audio')
        tono = request.POST.get('tono', 'profesional')
        idioma = request.POST.get('idioma', 'es')

        if not archivo_audio:
            return JsonResponse({'error': 'No se recibió audio'}, status=400)

        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp:
            for chunk in archivo_audio.chunks():
                tmp.write(chunk)
            tmp_path = tmp.name

        try:
            with open(tmp_path, 'rb') as f:
                transcripcion = openai_client.audio.transcriptions.create(
                    model='whisper-1',
                    file=f,
                    language='es'
                )
            texto_transcrito = transcripcion.text
        finally:
            os.unlink(tmp_path)

        texto_mejorado = mejorar_texto(texto_transcrito, tono, idioma)
        audio_b64 = texto_a_audio(texto_mejorado)

        return JsonResponse({
            'texto_original': texto_transcrito,
            'texto_mejorado': texto_mejorado,
            'audio_base64': audio_b64,
        })

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': 'No se pudo procesar el audio. Intenta de nuevo en unos segundos.'}, status=500)


# =========================
# ✍️ MEJORAR TEXTO (GPT)
# =========================
def mejorar_texto(texto, tono='profesional', idioma='es'):

    prompts = {
        'profesional': 'formal y profesional',
        'motivador': 'motivador y energizante',
        'directo': 'claro y conciso',
        'empático': 'empático y cercano',
    }

    idiomas = {
        'es': 'Responde siempre en español, sin importar el idioma del texto original.',
        'en': 'Always respond in English, no matter what language the original text is in.',
    }

    descripcion = prompts.get(tono, prompts['profesional'])
    instruccion_idioma = idiomas.get(idioma, idiomas['es'])

    respuesta = openai_client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {
                'role': 'system',
                'content': f'Eres un experto en comunicación empresarial. Mejora el texto para que sea {descripcion}. {instruccion_idioma}'
            },
            {
                'role': 'user',
                'content': texto
            }
        ],
        max_tokens=500,
        temperature=0.7
    )

    return respuesta.choices[0].message.content.strip()

def listar_voces(request):
    try:
        resultado = eleven_client.voices.get_all()
        print("TIPO:", type(resultado))
        print("DIR:", dir(resultado))
        # Intentar ambas estructuras posibles
        if hasattr(resultado, 'voices'):
            voces_raw = resultado.voices
        else:
            voces_raw = resultado  # a veces es directo una lista

        generos = {'male': 'Masculino', 'female': 'Femenino'}

        def nombre_limpio(nombre):
            # ElevenLabs nombra sus voces prediseñadas como
            # "Roger - Laid-Back, Casual, Resonant"; nos quedamos
            # solo con el nombre propio.
            return nombre.split(' - ')[0].strip()

        voces = []
        for v in voces_raw:
            labels = getattr(v, 'labels', None) or {}
            voces.append({
                "voice_id": v.voice_id,
                "name": nombre_limpio(v.name),
                "category": getattr(v, 'category', None),
                "gender": generos.get(labels.get('gender')),
            })
        # Las voces creadas por el usuario ('cloned') primero; las
        # prediseñadas de ElevenLabs (no se pueden borrar) después.
        voces.sort(key=lambda v: 0 if v['category'] == 'cloned' else 1)
        print("VOCES ENCONTRADAS:", len(voces))
        return JsonResponse({"voces": voces})
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({"voces": [], "error": str(e)})
    
# =========================
# 🔊 TEXTO A AUDIO
# =========================
def texto_a_audio(texto, voice_id=None):

    audio_stream = eleven_client.text_to_speech.convert(
        voice_id=voice_id or settings.ELEVENLABS_VOICE_ID,
        text=texto,
        model_id="eleven_multilingual_v2"
    )

    audio_bytes = b"".join(audio_stream)

    return base64.b64encode(audio_bytes).decode("utf-8")

# =========================
# 🔊 ELIMINAR VOCES
# =========================
@csrf_exempt
def eliminar_voz(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        data = json.loads(request.body)
        eleven_client.voices.delete(data.get('voice_id'))
        return JsonResponse({'ok': True})
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': 'No se pudo eliminar la voz. Intenta de nuevo en unos segundos.'}, status=500)