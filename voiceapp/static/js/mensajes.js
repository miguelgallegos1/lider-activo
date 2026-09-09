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
/** Cambia a la pestaña `tab` ("texto"/"audio"/"voces") y refresca la lista de voces si corresponde. */
function cambiarTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('#panel-' + tab).classList.add('active');
  btn.classList.add('active');
  document.getElementById('resultado').classList.remove('visible');

  if (tab === 'voces') cargarVoces();
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
  } catch (e) {
    mostrarToast(e.message || 'Error al procesar', 'error');
  } finally {
    btn.disabled = false; spinner.style.display = 'none';
  }
}

// =====================
// GRABAR AUDIO
// =====================
/** Inicia o detiene la grabación del micrófono con la Web Audio API (MediaRecorder); tope de 120s. */
async function toggleGrabacion() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
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

      audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      document.getElementById('record-status').innerHTML = `Audio listo (${segundos}s). Pulsa procesar.`;
      document.getElementById('btn-audio').disabled = false;
    };
    mediaRecorder.start();
    segundos = 0;
    timerInterval = setInterval(() => {
      segundos++;
      document.getElementById('timer').textContent = `${segundos}s grabando...`;
      if (segundos >= 120) mediaRecorder.stop();
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
  formData.append('audio', audioBlob, 'mensaje.webm');
  formData.append('tono', tono);
  formData.append('idioma', idioma);
  formData.append('voice_id', voiceId || '');

  try {
    const res = await fetch('/procesar-audio/', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    mostrarResultado(data);
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
