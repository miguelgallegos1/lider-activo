"""
Vistas de Líder Activo.

Este módulo concentra toda la lógica de la aplicación (no hay una
carpeta de "apps" separada porque el proyecto no usa modelos ni base
de datos propia). Se divide en dos tipos de funciones:

- Vistas de pantalla (index, onboarding, sin_autorizar): solo
  renderizan una plantilla HTML, sin lógica adicional.
- Endpoints de API (procesar_texto, procesar_audio, entrenar_voz,
  listar_voces, eliminar_voz): reciben peticiones AJAX del
  JavaScript de las plantillas y devuelven JSON. Hablan con dos
  servicios externos:
    * OpenAI   -> mejora la redacción del mensaje (GPT) y transcribe
                  audio a texto (Whisper).
    * ElevenLabs -> convierte texto a voz y gestiona las voces
                    clonadas del usuario.
"""

import os
import json
import tempfile
import base64

from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from openai import OpenAI
from elevenlabs.client import ElevenLabs
from elevenlabs import VoiceSettings

# Los clientes se crean una sola vez al iniciar el proceso (no en
# cada request) para reutilizar la conexión HTTP con cada servicio.
openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
eleven_client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)


# =============================================================
# Pantallas
# =============================================================

def index(request):
    """Pantalla "Mensajes" (/mensajes/): escribir/grabar un mensaje y transformarlo."""
    return render(request, 'index.html')


def onboarding(request):
    """Pantalla "Entrenar mi voz" (/entrenar-voz/): grabar/subir la muestra y clonar la voz."""
    return render(request, 'onboarding.html')


def sin_autorizar(request):
    """Pantalla a la que se llega si el usuario no acepta el aviso de datos personales."""
    return render(request, 'sin_autorizar.html')


# =============================================================
# 🚫 Moderación de contenido
# =============================================================
# Antes de mandar un texto a GPT o de usarlo para generar audio con
# una voz clonada, se revisa que no contenga insultos ni lenguaje
# de amenaza/extorsión, para evitar que la clonación de voz se use
# para hacerse pasar por otra persona con fines maliciosos.

# Insultos comunes en español. Filtro local (rápido, sin costo) que
# además sirve de respaldo si la API de moderación de OpenAI falla.
PALABRAS_OFENSIVAS = [
    'idiota', 'estupido', 'estúpido', 'imbecil', 'imbécil', 'pendejo',
    'hijo de puta', 'hijueputa', 'malparido', 'perra', 'puta',
    'maricon', 'maricón', 'marica', 'gonorrea', 'zorra', 'cabron',
    'cabrón', 'culicagado', 'hp',
]

# Frases típicas de amenaza o extorsión (pedir dinero/silencio bajo
# amenaza, amenazas de daño, etc.).
FRASES_AMENAZA = [
    'te voy a matar', 'te vamos a matar', 'vas a morir', 'te mato',
    'paga o', 'si no pagas', 'si no me pagas', 'transfiere o',
    'tengo fotos tuyas', 'tengo un video tuyo', 'voy a filtrar',
    'voy a publicar tus fotos', 'voy a hacerte daño',
    'sabemos donde vives', 'sé donde vives',
    'le va a pasar algo a tu familia', 'te va a pasar algo',
]


def _primer_termino_encontrado(texto_normalizado, terminos):
    return next((t for t in terminos if t in texto_normalizado), None)


def verificar_contenido_prohibido(texto):
    """
    Revisa si `texto` contiene insultos o lenguaje de amenaza/extorsión.

    Combina dos capas:
      1. Listas locales (PALABRAS_OFENSIVAS / FRASES_AMENAZA): rápidas,
         sin costo, y funcionan aunque la API de moderación falle.
      2. La API de Moderación de OpenAI, que detecta acoso, amenazas y
         otro contenido dañino que las listas locales no cubren.

    Devuelve (True, motivo) si el texto debe bloquearse, o
    (False, None) si puede continuar normalmente.
    """
    texto_normalizado = texto.lower()

    if _primer_termino_encontrado(texto_normalizado, PALABRAS_OFENSIVAS):
        return True, 'El mensaje contiene lenguaje ofensivo y no se puede procesar.'

    if _primer_termino_encontrado(texto_normalizado, FRASES_AMENAZA):
        return True, 'El mensaje parece contener amenazas o extorsión y no se puede procesar.'

    try:
        resultado = openai_client.moderations.create(
            model='omni-moderation-latest',
            input=texto,
        )
        flag = resultado.results[0]
        if flag.flagged:
            categorias = flag.categories
            if getattr(categorias, 'harassment_threatening', False) or getattr(categorias, 'violence', False):
                return True, 'El mensaje parece contener amenazas o extorsión y no se puede procesar.'
            return True, 'El mensaje contiene lenguaje ofensivo o inapropiado y no se puede procesar.'
    except Exception:
        # Si la API de moderación falla (timeout, error de red, etc.)
        # no se bloquea el flujo solo por eso: ya pasó el filtro local
        # de arriba, que cubre los casos más graves.
        import traceback
        print(traceback.format_exc())

    return False, None


# =============================================================
# 🎙️ Entrenar voz (clonación con ElevenLabs)
# =============================================================

@csrf_exempt
def entrenar_voz(request):
    """
    Endpoint POST /clonar-voz/.

    Recibe una o más muestras de audio (grabadas o subidas por el
    usuario en la pantalla de onboarding) y crea una voz clonada en
    la cuenta de ElevenLabs mediante Instant Voice Cloning (IVC).

    Parámetros esperados en el POST (multipart/form-data):
        samples (archivo, uno o más): la muestra de voz.
        voice_name (str): nombre con el que se guardará la voz.

    Responde con JSON:
        {"ok": true, "voice_id": "..."} si se creó correctamente.
        {"ok": false, "limite": true, "mensaje": "..."} si la cuenta
            de ElevenLabs ya alcanzó su límite de voces.
        {"error": "..."} (HTTP 400/500) ante cualquier otro problema.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        archivos = request.FILES.getlist('samples')

        if not archivos:
            return JsonResponse({'error': 'Sin muestras de voz'}, status=400)

        # El SDK de ElevenLabs acepta los archivos como bytes crudos.
        files_bytes = [archivo.read() for archivo in archivos]

        voice_name = request.POST.get('voice_name', 'MiVoz').strip() or 'MiVoz'

        bloqueado, motivo = verificar_contenido_prohibido(voice_name)
        if bloqueado:
            return JsonResponse({'error': 'El nombre de la voz contiene lenguaje inapropiado. Elige otro nombre.'}, status=400)

        voice = eleven_client.voices.ivc.create(
            name=voice_name,
            files=files_bytes,
            # Las muestras se graban con el micrófono del navegador o
            # se suben desde el celular, así que casi siempre traen
            # ruido de fondo (habitación, eco, ventilador, etc.). Ese
            # ruido confunde al modelo de clonación y es la causa más
            # común de que la voz clonada no se parezca a la real;
            # ElevenLabs lo limpia con su propio modelo de aislamiento
            # de audio antes de entrenar la voz.
            remove_background_noise=True,
            # Si se omite "labels", el SDK envía un valor que la API
            # de ElevenLabs rechaza con el error 400 "Labels must be
            # serialized dictionary object." Pasar un diccionario
            # vacío evita ese bug.
            labels={},
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

        # ElevenLabs limita cuántas voces puede tener una cuenta; se
        # detecta ese caso por el texto del error para mostrar un
        # mensaje específico en vez de uno genérico.
        if any(x in err for x in ['voice_limit', 'maximum', 'limit', 'quota', 'exceeded']):
            return JsonResponse({
                "ok": False,
                "limite": True,
                "mensaje": "Has alcanzado el límite de voces en ElevenLabs. Ve a 'Mis voces' y elimina una para poder crear una nueva."
            }, status=200)

        # El detalle técnico ya quedó impreso arriba (para los logs
        # del servidor); al navegador solo se le devuelve un mensaje
        # corto y claro.
        return JsonResponse({
            'error': 'No se pudo clonar la voz. Verifica tu conexión e intenta de nuevo en unos segundos.'
        }, status=500)


# =============================================================
# 📝 Procesar mensaje de texto
# =============================================================

@csrf_exempt
def procesar_texto(request):
    """
    Endpoint POST /procesar-texto/.

    Recibe el mensaje escrito por el usuario, lo mejora con GPT y lo
    convierte en audio con ElevenLabs (con la voz clonada indicada,
    o la voz por defecto si no se eligió ninguna).

    Body esperado (JSON):
        {"texto": "...", "tono": "profesional", "idioma": "es",
         "voice_id": "..." | null}

    Responde con JSON:
        {"texto_original", "texto_mejorado", "audio_base64"}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)

        texto_original = data.get('texto', '').strip()
        tono = data.get('tono', 'profesional')
        idioma = data.get('idioma', 'es')
        voice_id = data.get('voice_id')  # None => usa la voz por defecto de la cuenta

        if not texto_original:
            return JsonResponse({'error': 'El texto no puede estar vacío'}, status=400)

        bloqueado, motivo = verificar_contenido_prohibido(texto_original)
        if bloqueado:
            return JsonResponse({'error': motivo}, status=400)

        texto_mejorado = mejorar_texto(texto_original, tono, idioma)
        audio_b64 = texto_a_audio(texto_mejorado, voice_id)

        return JsonResponse({
            'texto_original': texto_original,
            'texto_mejorado': texto_mejorado,
            'audio_base64': audio_b64,
        })

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': 'No se pudo procesar el mensaje. Intenta de nuevo en unos segundos.'}, status=500)


# =============================================================
# 🎧 Procesar mensaje de audio
# =============================================================

@csrf_exempt
def procesar_audio(request):
    """
    Endpoint POST /procesar-audio/.

    Recibe un mensaje grabado por el usuario (audio/webm), lo
    transcribe a texto con Whisper (OpenAI), mejora ese texto con GPT
    y genera el audio final con ElevenLabs.

    Body esperado (multipart/form-data):
        audio (archivo): la grabación del usuario.
        tono, idioma (str): igual que en procesar_texto.

    Responde con JSON:
        {"texto_original" (transcripción), "texto_mejorado", "audio_base64"}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        archivo_audio = request.FILES.get('audio')
        tono = request.POST.get('tono', 'profesional')
        idioma = request.POST.get('idioma', 'es')

        if not archivo_audio:
            return JsonResponse({'error': 'No se recibió audio'}, status=400)

        # La API de transcripción de OpenAI necesita un archivo real
        # en disco (no acepta bytes en memoria directamente), así que
        # el audio recibido se escribe primero a un archivo temporal.
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
            # Se borra el archivo temporal siempre, incluso si la
            # transcripción falla, para no dejar audios acumulados
            # en el disco del servidor.
            os.unlink(tmp_path)

        bloqueado, motivo = verificar_contenido_prohibido(texto_transcrito)
        if bloqueado:
            return JsonResponse({'error': motivo}, status=400)

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


# =============================================================
# ✍️ Mejorar texto con GPT (función interna, sin endpoint propio)
# =============================================================

def mejorar_texto(texto, tono='profesional', idioma='es'):
    """
    Reescribe `texto` con GPT-4o-mini según el `tono` elegido y en el
    `idioma` solicitado (puede ser distinto al idioma original del
    texto: por ejemplo, escribir en español y pedir el resultado en
    inglés).

    Usada internamente por procesar_texto y procesar_audio.
    """
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
                'content': (
                    'Eres un asistente que pule mensajes cortos que un líder va a enviar '
                    'como nota de voz a su equipo. Tu única tarea es corregir gramática, '
                    'ortografía y fluidez, y ajustar el tono para que sea '
                    f'{descripcion}, sin cambiar el significado ni la intención original del '
                    'mensaje. El resultado se va a leer en voz alta tal cual, así que debe '
                    'sonar natural y directo, como si la persona lo dijera de viva voz: NO '
                    'lo conviertas en una carta o correo formal, no agregues saludos tipo '
                    '"Estimado/a", frases de cortesía genéricas, despedidas ni firma, y NO '
                    'inventes ni agregues placeholders como [Nombre], [Cargo], [Empresa] o '
                    'datos que el usuario no haya escrito. Devuelve únicamente el mensaje '
                    f'final, sin explicaciones. {instruccion_idioma}'
                )
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


# =============================================================
# 🗂️ Listar voces
# =============================================================

def listar_voces(request):
    """
    Endpoint GET /listar-voces/.

    Devuelve todas las voces disponibles en la cuenta de ElevenLabs:
    tanto las prediseñadas por ElevenLabs ("premade"/"professional",
    que no se pueden eliminar) como las que el propio usuario clonó
    ("cloned"). Para cada voz se limpia el nombre y se traduce el
    género, y la lista queda ordenada con las voces clonadas por el
    usuario primero.

    Responde con JSON:
        {"voces": [{"voice_id", "name", "category", "gender"}, ...]}
    """
    try:
        resultado = eleven_client.voices.get_all()
        # Distintas versiones del SDK devuelven la lista de voces de
        # forma distinta (a veces envuelta en un objeto con atributo
        # .voices, a veces la lista directa), por eso se contemplan
        # ambos casos.
        if hasattr(resultado, 'voices'):
            voces_raw = resultado.voices
        else:
            voces_raw = resultado

        generos = {'male': 'Masculino', 'female': 'Femenino'}

        def nombre_limpio(nombre):
            # ElevenLabs nombra sus voces prediseñadas como
            # "Roger - Laid-Back, Casual, Resonant"; nos quedamos
            # solo con el nombre propio para que se vea limpio en la
            # interfaz.
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

        return JsonResponse({"voces": voces})
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JsonResponse({"voces": [], "error": str(e)})


# =============================================================
# 🔊 Texto a audio (función interna, sin endpoint propio)
# =============================================================

def texto_a_audio(texto, voice_id=None):
    """
    Convierte `texto` en audio (MP3) usando ElevenLabs y lo devuelve
    codificado en base64, listo para incrustar en el JSON de
    respuesta y reproducirse directamente en el <audio> del navegador.

    Si no se indica `voice_id`, se usa la voz por defecto configurada
    en ELEVENLABS_VOICE_ID.
    """
    audio_stream = eleven_client.text_to_speech.convert(
        voice_id=voice_id or settings.ELEVENLABS_VOICE_ID,
        text=texto,
        model_id="eleven_multilingual_v2",
        # Sin voice_settings explícitos, ElevenLabs usa valores por
        # defecto pensados para voces de stock, no para una voz recién
        # clonada. Estos valores priorizan que el audio se parezca lo
        # más posible a la voz original:
        voice_settings=VoiceSettings(
            # Similitud alta: prioriza sonar como la voz clonada por
            # sobre cualquier otro criterio (es el parámetro con más
            # impacto directo en el parecido con la voz real).
            similarity_boost=0.9,
            # Boost de parecido al hablante; consume algo más de
            # cómputo/latencia a cambio de mayor fidelidad.
            use_speaker_boost=True,
            # Estabilidad media: si se sube demasiado la voz suena
            # monótona/robótica; si se baja demasiado, generación tras
            # generación deja de sonar como la misma persona.
            stability=0.5,
            # Sin exageración de estilo: en voces clonadas (a
            # diferencia de las voces diseñadas de ElevenLabs) subir
            # "style" tiende a alejar el resultado de cómo suena la
            # persona real.
            style=0.0,
        ),
    )

    audio_bytes = b"".join(audio_stream)

    return base64.b64encode(audio_bytes).decode("utf-8")


# =============================================================
# 🗑️ Eliminar voz
# =============================================================

@csrf_exempt
def eliminar_voz(request):
    """
    Endpoint POST /eliminar-voz/.

    Elimina una voz clonada de la cuenta de ElevenLabs. Las voces
    prediseñadas ("premade"/"professional") no se pueden eliminar y
    la interfaz ya evita mostrar el botón para ellas, pero si de
    todas formas se recibiera un voice_id no eliminable, la API de
    ElevenLabs lo rechazaría y ese error se refleja igual como un
    JSON de error.

    Body esperado (JSON): {"voice_id": "..."}
    """
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
