/*
 * Lógica de la pantalla "Mensajes" (/mensajes/, plantilla index.html).
 * Se comunica con el backend vía fetch() a los endpoints definidos en
 * voiceapp/voiceapp/urls.py (procesar-texto, procesar-audio,
 * listar-voces, eliminar-voz); no hay recarga de página en ningún
 * flujo.
 */

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let timerInterval = null;
let segundos = 0;
let audioBase64 = null;
let recordPreviewUrl = null;   // object URL del reproductor de verificación del mensaje grabado
let avisoTiempoMostrado = false;  // evita repetir el aviso de "quedan 15s" en la misma grabación

// =====================
// DROPDOWN PERSONALIZADO
// =====================
// Reemplaza los <select> nativos del navegador (Tono/Idioma/Voz)
// por un menú desplegable propio (un <div class="dd"> con un botón
// disparador y una lista de opciones), para poder controlar 100%
// su estilo, incluida la lista abierta. El valor elegido se guarda
// en el atributo data-value del contenedor y se lee con ddValue().

/** Abre/cierra el menú del dropdown que contiene a `triggerBtn`, cerrando cualquier otro que estuviera abierto. */
function ddToggle(triggerBtn) {
  const dd = triggerBtn.closest('.dd');
  const wasOpen = dd.classList.contains('open');
  document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
  if (!wasOpen) dd.classList.add('open');
}
/** Marca `optionEl` como seleccionada dentro del dropdown `id` y actualiza la etiqueta visible. */
function ddPick(id, optionEl) {
  const dd = document.getElementById(id);
  dd.dataset.value = optionEl.dataset.value;
  dd.querySelector('.dd-trigger-label').textContent = optionEl.textContent;
  dd.querySelectorAll('.dd-option').forEach(o => o.classList.remove('selected'));
  optionEl.classList.add('selected');
  dd.classList.remove('open');
}
/** Devuelve el valor actualmente elegido en el dropdown `id` (equivalente a `select.value`). */
function ddValue(id) {
  return document.getElementById(id).dataset.value || '';
}

/** Reconstruye las opciones del dropdown `id` (usado para la lista de voces, que se carga por fetch) y preselecciona `preferredValue` si existe entre ellas. */
function ddSetOptions(id, options, preferredValue) {
  const dd = document.getElementById(id);
  const match = options.find(o => o.value === preferredValue);
  const chosen = match || options[0] || null;
  dd.dataset.value = chosen ? chosen.value : '';
  dd.querySelector('.dd-trigger-label').textContent = chosen ? chosen.label : 'Sin opciones';
  const menu = dd.querySelector('.dd-menu');
  menu.innerHTML = options.length
    ? options.map(o => `<div class="dd-option${o.value === dd.dataset.value ? ' selected' : ''}" data-value="${o.value}" onclick="ddPick('${id}', this)">${o.label}</div>`).join('')
    : '<div class="dd-empty">Sin opciones</div>';
}
/** Selecciona `value` en el dropdown `id` de forma programática (usado por usarVoz para sincronizar los dos selectores de voz). */
function ddSetValue(id, value) {
  const dd = document.getElementById(id);
  const opt = dd.querySelector('.dd-option[data-value="' + value + '"]');
  if (!opt) return;
  dd.dataset.value = value;
  dd.querySelector('.dd-trigger-label').textContent = opt.textContent;
  dd.querySelectorAll('.dd-option').forEach(o => o.classList.remove('selected'));
  opt.classList.add('selected');
}
// Cierra cualquier dropdown abierto si se hace clic fuera de él o se presiona Escape.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dd')) document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
});

// =====================
// CARGAR VOCES
// =====================
// Pide al backend la lista de voces disponibles y con ella: (1)
// llena los dos dropdowns de voz (texto y audio), (2) muestra el
// indicador de "voz activa" en el header si hay una guardada en
// localStorage, y (3) dibuja la tabla de la pestaña "Mis voces".
async function cargarVoces() {
  try {
    const res = await fetch('/listar-voces/');
    const data = await res.json();
    const voces = data.voces || [];
    const savedId = localStorage.getItem('voice_id');

    const opciones = voces.map(v => ({ value: v.voice_id, label: v.name + (v.gender ? ' · ' + v.gender : '') }));

    ['voice-texto', 'voice-audio'].forEach(id => {
      ddSetOptions(id, opciones.length ? opciones : [{ value: '', label: 'Sin voces disponibles' }], savedId);
      document.getElementById(id).classList.remove('loading');
    });

    // Mostrar indicador si hay voz clonada
    if (savedId && voces.some(v => v.voice_id === savedId)) {
      const voz = voces.find(v => v.voice_id === savedId);
      document.getElementById('voiceIndicator').style.display = 'flex';
      document.getElementById('voiceIndicatorText').textContent = 'Voz: ' + voz.name;
    }

    // Renderizar lista en tab Mis Voces
    const lista = document.getElementById('voicesList');
    if (voces.length === 0) {
      lista.innerHTML = `
        <div class="voices-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          <p>No tienes voces creadas aún.</p>
          <a href="/entrenar-voz/" style="display:inline-block;margin-top:10px;font-size:.85rem;color:var(--brand);font-weight:600">+ Crear mi primera voz</a>
        </div>`;
    } else {
      lista.innerHTML = voces.map(v => `
        <div class="voice-row" id="vrow-${v.voice_id}">
          <div class="voice-row-left">
            <span class="voice-dot-sm ${v.voice_id === savedId ? 'active' : ''}"></span>
            <span class="voice-row-name">${v.name}</span>
            ${v.gender ? `<span class="voice-row-gender">${v.gender}</span>` : ''}
            ${v.voice_id === savedId ? '<span class="voice-active-badge">Activa</span>' : ''}
            ${v.category !== 'cloned' ? '<span class="voice-stock-badge" title="Es una voz de stock de ElevenLabs, no se puede eliminar">Voz de stock · no se puede eliminar</span>' : ''}
          </div>
          <div class="voice-row-actions">
            ${v.voice_id === savedId
              ? '<span class="btn-use current">En uso</span>'
              : `<button class="btn-use" onclick="usarVoz('${v.voice_id}','${v.name}')">Usar</button>`
            }
            ${v.category === 'cloned' ? `
            <button class="btn-del" onclick="confirmarEliminar('${v.voice_id}','${v.name}')" title="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </button>` : ''}
          </div>
        </div>`).join('');
    }
  } catch (e) {
    ['voice-texto', 'voice-audio'].forEach(id => {
      ddSetOptions(id, [{ value: '', label: 'Error al cargar' }], '');
      document.getElementById(id).classList.remove('loading');
    });
  }
}
cargarVoces();

// =====================
// TABS
// =====================
/** Cambia a la pestaña `tab` ("texto"/"audio"/"historial"/"voces") y refresca la lista de voces/historial si corresponde. */
function cambiarTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('#panel-' + tab).classList.add('active');
  btn.classList.add('active');
  document.getElementById('resultado').classList.remove('visible');

  if (tab === 'voces') { cargarVoces(); cargarWebhookTeamsGuardado(); }
  if (tab === 'historial') cargarHistorial();
}

function actualizarContador(el) {
  document.getElementById('contador').textContent = el.value.length;
}

// =====================
// PROCESAR TEXTO
// =====================
/** Envía el mensaje escrito al backend (/procesar-texto/) para mejorarlo con IA y convertirlo en audio. */
async function procesarTexto() {
  const texto = document.getElementById('textarea-msg').value.trim();
  const tono = ddValue('tono-texto');
  const idioma = ddValue('idioma-texto');
  const voiceId = ddValue('voice-texto');
  if (!texto) { mostrarToast('Escribe un mensaje primero', 'error'); return; }

  const btn = document.getElementById('btn-texto');
  const spinner = document.getElementById('spinner-texto');
  btn.disabled = true; spinner.style.display = 'block';

  try {
    const res = await fetch('/procesar-texto/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, tono, idioma, voice_id: voiceId || null }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    mostrarResultado(data);
    guardarEnHistorial({ ...data, tono, idioma });
  } catch (e) {
    mostrarToast(e.message || 'Error al procesar', 'error');
  } finally {
    btn.disabled = false; spinner.style.display = 'none';
  }
}

// =====================
// GRABAR AUDIO
// =====================
/** Inicia o detiene la grabación del micrófono con la Web Audio API (MediaRecorder); tope de 3 minutos, con aviso a los 15s restantes. Volver a pulsar el botón descarta la grabación anterior y empieza una nueva. */
async function toggleGrabacion() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    avisoTiempoMostrado = false;

    // Al empezar una grabación nueva se descarta la anterior (si había
    // una): se limpia el reproductor de verificación y se revoca su
    // object URL para no ir acumulando blobs en memoria.
    const preview = document.getElementById('record-preview');
    if (recordPreviewUrl) { URL.revokeObjectURL(recordPreviewUrl); recordPreviewUrl = null; }
    preview.hidden = true;
    preview.removeAttribute('src');

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(timerInterval);
      document.getElementById('record-btn').className = 'record-btn idle';
      document.getElementById('timer').textContent = '';

      if (segundos < 2) {
        // Un clip tan corto casi siempre es silencio o un toque
        // accidental: Whisper no tiene nada real que transcribir y
        // GPT terminaría "mejorando" texto vacío o basura.
        audioBlob = null;
        document.getElementById('record-status').textContent = 'Grabación muy corta. Intenta de nuevo.';
        document.getElementById('btn-audio').disabled = true;
        mostrarToast('Graba al menos 2 segundos de tu mensaje', 'error');
        return;
      }

      // El Blob debe llevar el mimeType que realmente eligió el
      // navegador (mediaRecorder.mimeType), no uno fijo: en
      // iPhone/Safari MediaRecorder graba en MP4, no en WebM, y
      // etiquetarlo distinto confunde tanto la reproducción como la
      // detección de formato de Whisper del lado del servidor.
      audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      document.getElementById('record-status').innerHTML = `Audio listo (${segundos}s). Escúchalo antes de procesar.`;
      document.getElementById('btn-audio').disabled = false;

      // Reproductor para verificar la grabación (ruido, volumen, corte)
      // antes de gastar la llamada a Whisper/GPT/ElevenLabs con un
      // audio que podría salir mal.
      recordPreviewUrl = URL.createObjectURL(audioBlob);
      preview.src = recordPreviewUrl;
      preview.hidden = false;
    };
    mediaRecorder.start();
    segundos = 0;
    timerInterval = setInterval(() => {
      segundos++;
      document.getElementById('timer').textContent = `${segundos}s grabando...`;
      if (segundos === 165 && !avisoTiempoMostrado) {
        avisoTiempoMostrado = true;
        mostrarToast('Quedan 15 segundos de grabación', 'warn', 4000);
      }
      if (segundos >= 180) mediaRecorder.stop();
    }, 1000);
    document.getElementById('record-btn').className = 'record-btn recording';
    document.getElementById('record-status').innerHTML = '<strong>Grabando...</strong> Toca para detener';
    document.getElementById('btn-audio').disabled = true;
  } catch (e) {
    mostrarToast('No se pudo acceder al micrófono. Revisa los permisos del navegador.', 'error');
  }
}

// =====================
// PROCESAR AUDIO
// =====================
/** Deduce una extensión de archivo razonable a partir del mimeType real de una grabación (ej. "audio/mp4;codecs=..." -> "mp4"). */
function extensionParaMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

/** Envía el audio grabado al backend (/procesar-audio/) para transcribirlo, mejorarlo y regenerarlo en voz. */
async function procesarAudio() {
  if (!audioBlob) { mostrarToast('Graba un mensaje primero', 'error'); return; }
  const tono = ddValue('tono-audio');
  const idioma = ddValue('idioma-audio');
  const voiceId = ddValue('voice-audio');
  const btn = document.getElementById('btn-audio');
  const spinner = document.getElementById('spinner-audio');
  btn.disabled = true; spinner.style.display = 'block';

  const formData = new FormData();
  formData.append('audio', audioBlob, 'mensaje.' + extensionParaMime(audioBlob.type));
  formData.append('tono', tono);
  formData.append('idioma', idioma);
  formData.append('voice_id', voiceId || '');

  try {
    const res = await fetch('/procesar-audio/', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    mostrarResultado(data);
    guardarEnHistorial({ ...data, tono, idioma });
  } catch (e) {
    mostrarToast(e.message || 'Error al procesar', 'error');
  } finally {
    btn.disabled = false; spinner.style.display = 'none';
  }
}

// =====================
// RESULTADO
// =====================
/** Pinta el texto original/mejorado y el reproductor de audio con la respuesta del backend. */
function mostrarResultado(data) {
  audioBase64 = data.audio_base64;
  document.getElementById('texto-original').textContent = data.texto_original;
  document.getElementById('texto-mejorado').textContent = data.texto_mejorado;
  const audioEl = document.getElementById('audio-player');
  audioEl.src = 'data:audio/mp3;base64,' + data.audio_base64;
  const resultado = document.getElementById('resultado');
  resultado.classList.add('visible');
  resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function descargarAudio() {
  if (!audioBase64) return;
  const link = document.createElement('a');
  link.href = 'data:audio/mp3;base64,' + audioBase64;
  link.download = 'mensaje-profesional.mp3';
  link.click();
}

function copiarTexto() {
  const texto = document.getElementById('texto-mejorado').textContent;
  navigator.clipboard.writeText(texto).then(() => mostrarToast('Texto copiado al portapapeles'));
}

/**
 * Comparte el audio generado (no el texto) usando la hoja de compartir
 * nativa del sistema (Web Share API), donde WhatsApp aparece como una
 * de las apps disponibles si está instalada. No existe un link de
 * WhatsApp que adjunte un archivo directamente (wa.me solo admite
 * texto), así que esta es la única forma real de mandar el audio: el
 * usuario elige WhatsApp desde ese menú del sistema.
 */
async function compartirWhatsApp() {
  if (!audioBase64) { mostrarToast('Genera un mensaje primero', 'error'); return; }

  const binario = atob(audioBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  const archivo = new File([bytes], 'mensaje-profesional.mp3', { type: 'audio/mpeg' });

  if (!navigator.canShare || !navigator.canShare({ files: [archivo] })) {
    mostrarToast('Tu navegador no permite compartir audio directo. Usa "Descargar audio" y adjúntalo desde WhatsApp.', 'warn', 6000);
    return;
  }

  try {
    await navigator.share({ files: [archivo], title: 'Mensaje generado con Líder Activo' });
  } catch (e) {
    if (e.name !== 'AbortError') mostrarToast('No se pudo compartir el audio.', 'error');
  }
}

/** Abre WhatsApp (app o web) con el texto mejorado precargado, listo para elegir el chat y enviarlo. */
function compartirTextoWhatsApp() {
  const texto = document.getElementById('texto-mejorado').textContent;
  if (!texto || texto === '—') { mostrarToast('Genera un mensaje primero', 'error'); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
}

/** Abre el cliente de correo por defecto (ej. Outlook) con el texto mejorado precargado en el cuerpo. */
function compartirCorreo() {
  const texto = document.getElementById('texto-mejorado').textContent;
  if (!texto || texto === '—') { mostrarToast('Genera un mensaje primero', 'error'); return; }
  window.location.href = 'mailto:?subject=' + encodeURIComponent('Mensaje de Líder Activo') + '&body=' + encodeURIComponent(texto);
}

// =====================
// NOTIFICACIONES (toast)
// =====================
let toastIntervalId = null;

/** Muestra una notificación abajo-centro con contador regresivo visible y botón para cerrarla antes. */
function mostrarToast(msg, tipo = 'ok', durMs = 3500) {
  const toast = document.getElementById('toast');
  clearInterval(toastIntervalId);
  let restante = Math.max(1, Math.round(durMs / 1000));
  toast.innerHTML = '<span class="toast-msg"></span><span class="toast-timer"></span><button class="toast-close" onclick="cerrarToast()" aria-label="Cerrar">&times;</button>';
  toast.querySelector('.toast-msg').textContent = msg;
  toast.querySelector('.toast-timer').textContent = restante;
  toast.className = 'toast show' + (tipo === 'error' ? ' error' : '');
  toastIntervalId = setInterval(() => {
    restante--;
    const t = toast.querySelector('.toast-timer');
    if (t) t.textContent = restante;
    if (restante <= 0) cerrarToast();
  }, 1000);
}
/** Marca `voiceId` como la voz activa (persistida en localStorage) y la preselecciona en ambos dropdowns de voz. */
function usarVoz(voiceId, name) {
  localStorage.setItem('voice_id', voiceId);
  ['voice-texto', 'voice-audio'].forEach(id => ddSetValue(id, voiceId));
  mostrarToast('Voz "' + name + '" activada');
  cargarVoces();
}

function cerrarToast() {
  clearInterval(toastIntervalId);
  document.getElementById('toast').classList.remove('show');
}

/** Llama a /eliminar-voz/ y refresca la lista; si la voz eliminada era la activa, la limpia de localStorage. */
async function eliminarVoz(voiceId) {
  cerrarToast();
  try {
    const r = await fetch('/eliminar-voz/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: voiceId })
    });
    const data = await r.json();
    if (data.ok) {
      if (localStorage.getItem('voice_id') === voiceId) {
        localStorage.removeItem('voice_id');
        document.getElementById('voiceIndicator').style.display = 'none';
      }
      mostrarToast('Voz eliminada correctamente');
      cargarVoces();
    } else {
      mostrarToast(data.error || 'No se pudo eliminar la voz. Intenta de nuevo.', 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión. Revisa tu internet e intenta de nuevo.', 'error');
  }
}
/** Reutiliza el mismo elemento de toast como diálogo de confirmación (Eliminar/Cancelar) antes de borrar una voz. */
function confirmarEliminar(voiceId, name) {
  clearInterval(toastIntervalId);
  const toast = document.getElementById('toast');
  toast.innerHTML = `¿Eliminar la voz "<strong>${name}</strong>"?
    <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
      <button onclick="eliminarVoz('${voiceId}')" style="background:#DC2626;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;font-family:inherit">Eliminar</button>
      <button onclick="cerrarToast()" style="background:rgba(255,255,255,.15);color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-family:inherit">Cancelar</button>
    </div>`;
  toast.className = 'toast show error';
}

// =====================
// HISTORIAL DE MENSAJES
// =====================
// Se guarda solo en este navegador (localStorage), no en el servidor:
// coherente con el resto de la app, que no persiste datos de negocio
// del lado del backend. Solo se guarda texto (original y mejorado) y
// el tono/idioma usados; el audio NO se persiste (evita inflar
// localStorage con base64 y no duplica indefinidamente un dato
// sensible fuera de lo estrictamente necesario).
const HISTORIAL_KEY = 'historial_mensajes';
const HISTORIAL_MAX = 30;
const TONOS_LABEL = { profesional: 'Profesional', motivador: 'Motivador', directo: 'Directo', 'empático': 'Empático' };

/** Lee el historial guardado en localStorage; devuelve [] si no hay nada o está corrupto. */
function leerHistorial() {
  try {
    return JSON.parse(localStorage.getItem(HISTORIAL_KEY)) || [];
  } catch (e) {
    return [];
  }
}

/** Agrega un mensaje ya mejorado al historial (lo más nuevo primero, tope de 30 entradas). */
function guardarEnHistorial({ texto_original, texto_mejorado, tono, idioma }) {
  const historial = leerHistorial();
  historial.unshift({ id: Date.now(), fecha: new Date().toISOString(), texto_original, texto_mejorado, tono, idioma });
  try {
    localStorage.setItem(HISTORIAL_KEY, JSON.stringify(historial.slice(0, HISTORIAL_MAX)));
  } catch (e) {
    // localStorage lleno o deshabilitado (modo privado, etc.): no vale la pena
    // interrumpir el flujo principal por no poder guardar el historial.
  }
}

/** Pinta #historialList a partir de lo guardado en localStorage. */
function cargarHistorial() {
  const historial = leerHistorial();
  const lista = document.getElementById('historialList');
  if (historial.length === 0) {
    lista.innerHTML = '<p style="font-size:.875rem;color:var(--gray-400);text-align:center;padding:2rem 0">Todavía no hay mensajes en tu historial.</p>';
    return;
  }
  lista.innerHTML = '';
  historial.forEach(item => {
    const fecha = new Date(item.fecha);
    const fechaTexto = fecha.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' · ' + fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

    const row = document.createElement('div');
    row.className = 'hist-row';

    const meta = document.createElement('div');
    meta.className = 'hist-meta';
    const spanFecha = document.createElement('span');
    spanFecha.className = 'hist-fecha';
    spanFecha.textContent = fechaTexto;
    const spanTono = document.createElement('span');
    spanTono.className = 'hist-tono-badge';
    spanTono.textContent = TONOS_LABEL[item.tono] || item.tono || '';
    meta.appendChild(spanFecha);
    meta.appendChild(spanTono);

    // texto_mejorado viene de GPT y se pinta con textContent (no innerHTML)
    // para no correr riesgo de interpretar como HTML nada de lo que devuelva.
    const texto = document.createElement('div');
    texto.className = 'hist-texto';
    texto.textContent = item.texto_mejorado;

    const acciones = document.createElement('div');
    acciones.className = 'hist-acciones';
    const btnReusar = document.createElement('button');
    btnReusar.className = 'btn-use';
    btnReusar.textContent = 'Reutilizar';
    btnReusar.onclick = () => reutilizarHistorial(item.id);
    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'btn-del';
    btnBorrar.title = 'Eliminar del historial';
    btnBorrar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
    btnBorrar.onclick = () => eliminarHistorialItem(item.id);
    acciones.appendChild(btnReusar);
    acciones.appendChild(btnBorrar);

    row.appendChild(meta);
    row.appendChild(texto);
    row.appendChild(acciones);
    lista.appendChild(row);
  });
}

/** Carga un mensaje del historial de vuelta al compositor de texto, para reutilizarlo o editarlo. */
function reutilizarHistorial(id) {
  const item = leerHistorial().find(h => h.id === id);
  if (!item) return;
  const textarea = document.getElementById('textarea-msg');
  textarea.value = item.texto_original;
  actualizarContador(textarea);
  ddSetValue('tono-texto', item.tono);
  ddSetValue('idioma-texto', item.idioma);
  cambiarTab('texto', document.getElementById('tabBtnTexto'));
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  textarea.focus();
  mostrarToast('Mensaje cargado. Puedes editarlo antes de mejorarlo de nuevo.');
}

function eliminarHistorialItem(id) {
  const historial = leerHistorial().filter(h => h.id !== id);
  localStorage.setItem(HISTORIAL_KEY, JSON.stringify(historial));
  cargarHistorial();
}

/** Diálogo de confirmación (mismo patrón que confirmarEliminar) antes de borrar todo el historial. */
function confirmarLimpiarHistorial() {
  if (leerHistorial().length === 0) return;
  clearInterval(toastIntervalId);
  const toast = document.getElementById('toast');
  toast.innerHTML = `¿Borrar todo el historial de mensajes?
    <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
      <button onclick="limpiarHistorial()" style="background:#DC2626;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;font-family:inherit">Borrar</button>
      <button onclick="cerrarToast()" style="background:rgba(255,255,255,.15);color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-family:inherit">Cancelar</button>
    </div>`;
  toast.className = 'toast show error';
}

function limpiarHistorial() {
  cerrarToast();
  localStorage.removeItem(HISTORIAL_KEY);
  cargarHistorial();
  mostrarToast('Historial borrado');
}

// =====================
// INTEGRACIÓN CON MICROSOFT TEAMS
// =====================
// La URL del webhook se guarda en este navegador (localStorage), igual
// que el resto de preferencias de la app (voz activa, etc.). El envío
// en sí no se hace directo desde el navegador porque el webhook de
// Teams no responde con cabeceras CORS para peticiones de otro origen;
// pasa por /enviar-teams/, que hace esa llamada del lado del servidor.
const TEAMS_WEBHOOK_KEY = 'teams_webhook_url';

/** Precarga el campo de configuración con el webhook ya guardado (si hay uno) al entrar a "Mis voces". */
function cargarWebhookTeamsGuardado() {
  const input = document.getElementById('teamsWebhookInput');
  if (input) input.value = localStorage.getItem(TEAMS_WEBHOOK_KEY) || '';
}

/** Guarda la URL del webhook de Teams; si se deja vacía, borra la configuración guardada. */
function guardarWebhookTeams() {
  const input = document.getElementById('teamsWebhookInput');
  const estado = document.getElementById('teamsStatus');
  const url = input.value.trim();

  if (!url) {
    localStorage.removeItem(TEAMS_WEBHOOK_KEY);
    estado.textContent = '';
    mostrarToast('Webhook de Teams borrado');
    return;
  }
  try {
    new URL(url);
  } catch (e) {
    mostrarToast('Esa URL no parece válida', 'error');
    return;
  }
  localStorage.setItem(TEAMS_WEBHOOK_KEY, url);
  estado.textContent = 'Webhook guardado. Ya puedes usar "Enviar a Teams" desde cualquier mensaje.';
  mostrarToast('Webhook de Teams guardado');
}

/** Envía `texto` al canal de Teams configurado a través del backend. */
async function enviarTextoATeams(texto) {
  const webhookUrl = localStorage.getItem(TEAMS_WEBHOOK_KEY);
  if (!webhookUrl) { mostrarToast('Primero configura el webhook de Teams en "Mis voces"', 'warn', 5000); return; }

  try {
    const res = await fetch('/enviar-teams/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url: webhookUrl, texto }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    mostrarToast('Mensaje enviado a Teams');
  } catch (e) {
    mostrarToast(e.message || 'No se pudo enviar a Teams', 'error');
  }
}

/** Botón "Enviar a Teams" de la sección de resultado: manda el mensaje ya mejorado. */
function enviarATeams() {
  const texto = document.getElementById('texto-mejorado').textContent;
  if (!texto || texto === '—') { mostrarToast('Genera un mensaje primero', 'error'); return; }
  enviarTextoATeams(texto);
}

/** Botón "Enviar mensaje de prueba" de la configuración de Teams. */
function probarWebhookTeams() {
  enviarTextoATeams('Mensaje de prueba desde Líder Activo. Si ves esto en el canal, la integración con Teams está funcionando.');
}
