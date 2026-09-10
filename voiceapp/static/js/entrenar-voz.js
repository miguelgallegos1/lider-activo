/*
 * Lógica de la pantalla "Entrenar mi voz" (/entrenar-voz/, plantilla
 * onboarding.html). Cubre la grabación/subida de la muestra de voz y
 * el envío a /clonar-voz/. El aviso de tratamiento de datos ya se
 * resolvió antes, en la pantalla de autorización ("/").
 */

let mediaRecorder=null,chunks=[],audioBlob=null,timerInt=null,secs=0;
let toastIntervalId=null;
let recPreviewUrl=null,filePreviewUrl=null;  // object URLs de los reproductores de verificación; se revocan al reemplazarlos

/*
 * Guion sugerido para leer mientras se graba la muestra de voz.
 * ElevenLabs no publica un texto fijo para esto (su documentación de
 * Instant Voice Cloning pide sobre todo audio limpio, sin ruido y con
 * un tono/ritmo consistente, sin música de fondo); este guion aplica
 * esa idea con frases variadas -afirmaciones, preguntas, exclamaciones,
 * números, palabras con "rr"/"ll"/"ñ"- para que la muestra cubra una
 * gama amplia de sonidos, en vez de repetir siempre el mismo patrón.
 * Cada párrafo está pensado para leerse en unos 30s a ritmo normal; si
 * la grabación sigue después del último, se vuelve a resaltar desde el
 * primero (hasta el máximo de 3 minutos que ya valida el resto del flujo).
 */
const GUION = [
  'Buenos días a todo el equipo. Antes de empezar, quiero agradecerles el esfuerzo que ponen cada día en su trabajo. Esta semana cerramos con doscientos cuarenta y siete pedidos entregados a tiempo, y eso es un resultado excelente para todos nosotros. Sigamos así, cuidando cada detalle y apoyándonos entre todos.',
  '¿Cómo van con las metas de este mes? Me encantaría escuchar sus ideas en la próxima reunión, porque entre todos siempre encontramos mejores soluciones. ¡Vamos muy bien encaminados y quiero que lo celebremos juntos! No se olviden de revisar el correo antes del viernes, por favor, es importante.',
  'El carro llegó temprano y el guardia abrió el portón sin ningún problema. La niña pequeña corrió alrededor del jardín mientras el perro ladraba a lo lejos. Necesitamos organizar bien la próxima reunión y explicar con claridad cada tarea pendiente, para que nadie se quede con dudas.',
  'Sé que ha sido una semana difícil para algunos de ustedes, y quiero que sepan que pueden contar conmigo. Tómense el tiempo que necesiten, hablemos con calma y busquemos juntos la mejor solución. Confío plenamente en cada uno de ustedes y en lo que somos capaces de lograr juntos.',
  '¡Vamos con todo esta última semana del mes! Si cumplimos el objetivo, superaremos los quinientos mil dólares en ventas, y eso sería un logro histórico para todo el equipo. Ánimo, ustedes pueden lograrlo, yo confío plenamente en cada uno de ustedes.',
  'Quiero cerrar agradeciéndoles nuevamente por su compromiso. Sé que no siempre es fácil, pero el trabajo en equipo que hemos construido es algo de lo que debemos sentirnos orgullosos. Nos vemos el lunes con toda la energía para seguir creciendo juntos.',
];

/** Pinta los párrafos del guion sugerido dentro de #scriptBox. */
function renderGuion(){
  const box=document.getElementById('scriptBox');
  box.innerHTML=GUION.map((p,i)=>`<p class="script-p" id="guion-p-${i}">${p}</p>`).join('');
}
renderGuion();

/** Resalta el párrafo del guion que toca leer según los segundos grabados, ciclando si se supera el guion completo. */
function resaltarGuion(segundosGrabados){
  const idx=Math.floor(segundosGrabados/30)%GUION.length;
  document.querySelectorAll('.script-p').forEach((el,i)=>el.classList.toggle('active',i===idx));
  const activo=document.getElementById('guion-p-'+idx);
  if(activo) activo.scrollIntoView({block:'nearest',behavior:'smooth'});
}

/** Expande/colapsa la tarjeta del guion sugerido. */
function toggleGuion(){
  document.querySelector('.script-card').classList.toggle('collapsed');
}

/** Muestra una notificación abajo-centro con contador regresivo visible y botón para cerrarla antes. */
function toast(msg,type='ok',dur=3500){
  const t=document.getElementById('toast');
  clearInterval(toastIntervalId);
  let restante=Math.max(1,Math.round(dur/1000));
  t.innerHTML='<span class="toast-msg"></span><span class="toast-timer"></span><button class="toast-close" onclick="cerrarToast()" aria-label="Cerrar">&times;</button>';
  t.querySelector('.toast-msg').textContent=msg;
  t.querySelector('.toast-timer').textContent=restante;
  t.className='toast show '+type;
  toastIntervalId=setInterval(()=>{
    restante--;
    const el=t.querySelector('.toast-timer');
    if(el) el.textContent=restante;
    if(restante<=0) cerrarToast();
  },1000);
}
function cerrarToast(){
  clearInterval(toastIntervalId);
  document.getElementById('toast').classList.remove('show');
}

/** Alterna entre el panel "Grabar" y el panel "Subir archivo" de la muestra de voz. */
function switchTab(tab){
  document.getElementById('tab-rec').classList.toggle('active',tab==='rec');
  document.getElementById('tab-up').classList.toggle('active',tab==='up');
  document.getElementById('panel-rec').classList.toggle('active',tab==='rec');
  document.getElementById('panel-up').classList.toggle('active',tab==='up');
}

/** Valida que se haya escrito un nombre para la voz antes de clonar; devuelve el nombre o null. */
function validateName(){
  const n=document.getElementById('voiceName').value.trim();
  if(!n){toast('Escribe un nombre para tu voz primero','warn');return null;}
  return n;
}

/**
 * Bloquea "Grabar"/"Subir archivo" hasta que haya un nombre de voz
 * escrito: sin nombre no tiene sentido dejar avanzar el resto del
 * flujo, porque igual no se podría clonar al final. Se llama en cada
 * tecla del campo de nombre y una vez al cargar la página.
 */
function onVoiceNameInput(){
  const hayNombre=document.getElementById('voiceName').value.trim().length>0;
  document.getElementById('sampleCard').classList.toggle('locked',!hayNombre);
  document.getElementById('micBtn').disabled=!hayNombre;
}
onVoiceNameInput();

/** Abre el selector de archivos de "Subir archivo", exigiendo primero el nombre de la voz. */
function abrirSelectorArchivo(){
  if(!validateName())return;
  document.getElementById('fileInput').click();
}

/** Inicia o detiene la grabación del micrófono; valida que dure entre 30s y 3min antes de habilitar "Clonar". */
async function toggleRec(){
  if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();return;}
  if(!validateName())return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    chunks=[];
    mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>chunks.push(e.data);
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearInterval(timerInt);
      document.getElementById('micBtn').className='mic-btn';
      document.getElementById('progWrap').style.display='none';
      document.getElementById('recTimer').textContent='';

      const preview=document.getElementById('recPreview');

      if(secs < 30){
        toast('La muestra debe tener al menos 30 segundos','warn');
        audioBlob=null;
        document.getElementById('btnCloneRec').disabled=true;
        document.getElementById('recStatus').textContent='Toca para intentarlo de nuevo';
        preview.hidden=true; preview.removeAttribute('src');
      } else if(secs > 180){
        toast('La muestra no puede superar los 3 minutos','warn');
        audioBlob=null;
        document.getElementById('btnCloneRec').disabled=true;
        document.getElementById('recStatus').textContent='Toca para intentarlo de nuevo';
        preview.hidden=true; preview.removeAttribute('src');
      } else {
        // El Blob debe llevar el mimeType que realmente eligió el
        // navegador para grabar (mediaRecorder.mimeType), no uno fijo:
        // en iPhone/Safari MediaRecorder graba en MP4, no en WebM: si
        // se etiqueta el Blob como "audio/webm" con bytes que en
        // realidad son MP4, el <audio> de abajo no puede decodificarlo
        // y muestra "Error" aunque la grabación en sí esté bien.
        audioBlob=new Blob(chunks,{type:mediaRecorder.mimeType||'audio/webm'});
        document.getElementById('recStatus').innerHTML='Audio listo ('+secs+'s). Escúchalo antes de clonar.';
        document.getElementById('btnCloneRec').disabled=false;
        // Reproductor para que el usuario verifique la calidad de la
        // grabación antes de gastar la llamada a ElevenLabs clonando
        // una muestra que podría salir mal (ruido, corte, etc.).
        if(recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
        recPreviewUrl=URL.createObjectURL(audioBlob);
        preview.src=recPreviewUrl;
        preview.hidden=false;
        toast('Muestra grabada correctamente','success');
      }
    };

    mediaRecorder.start();
    secs=0;
    document.getElementById('progWrap').style.display='block';
    document.getElementById('micBtn').className='mic-btn recording';
    document.getElementById('recStatus').innerHTML='<strong>Grabando...</strong> Toca para detener';
    resaltarGuion(0);

    timerInt=setInterval(()=>{
      secs++;
      document.getElementById('recTimer').textContent=secs+'s grabando...';
      document.getElementById('progFill').style.width=Math.min((secs/30)*100,100)+'%';
      resaltarGuion(secs);
      if(secs>=180) mediaRecorder.stop();
    },1000);

  }catch(e){
    toast('No se pudo acceder al micrófono. Revisa los permisos del navegador.','error');
  }
}

/** Deduce una extensión de archivo razonable a partir del mimeType real de una grabación (ej. "audio/mp4;codecs=..." -> "mp4"). */
function extensionParaMime(mime){
  if(!mime)return'webm';
  if(mime.includes('mp4'))return'mp4';
  if(mime.includes('ogg'))return'ogg';
  if(mime.includes('wav'))return'wav';
  return'webm';
}

/** Envía la muestra grabada por micrófono a /clonar-voz/. */
async function clonarGrabacion(){
  const name=validateName();if(!name)return;
  if(!audioBlob){toast('Graba al menos 30 segundos primero','warn');return;}
  setLoading('btnCloneRec','spinRec',true);
  const form=new FormData();
  form.append('samples',audioBlob,'voz.'+extensionParaMime(audioBlob.type));
  form.append('voice_name',name);
  await enviarClone(form);
  setLoading('btnCloneRec','spinRec',false);
}

/**
 * Valida el archivo de audio elegido en "Subir archivo" (tamaño y
 * duración entre 30s y 3min) antes de habilitar el botón de clonar.
 * Incluye manejo especial para navegadores/formatos que no calculan
 * bien la duración de entrada (ver comentario más abajo) y un
 * timeout de respaldo para que la interfaz nunca se quede colgada
 * sin avisar si el archivo no se puede leer.
 */
function archivoSeleccionado(){
  const f=document.getElementById('fileInput').files[0];
  if(!f)return;

  if(!validateName()){
    document.getElementById('fileInput').value='';
    return;
  }

  const maxBytes=30*1024*1024;
  if(f.size>maxBytes){
    toast('El archivo no puede superar los 30MB (≈ 3 minutos)','warn');
    document.getElementById('fileInput').value='';
    return;
  }

  const url=URL.createObjectURL(f);
  const audio=new Audio();
  let resuelto=false;

  const limpiar=()=>{
    audio.removeEventListener('loadedmetadata',onMeta);
    audio.removeEventListener('error',onError);
    clearTimeout(timeoutId);
  };

  const aceptar=(duracion)=>{
    if(resuelto)return; resuelto=true;
    limpiar();
    URL.revokeObjectURL(url);
    document.getElementById('fileReady').style.display='flex';
    document.getElementById('fileName').textContent=f.name+(duracion?' ('+Math.round(duracion)+'s)':'');
    document.getElementById('btnCloneFile').disabled=false;
    // Reproductor aparte del "url" de arriba (que solo se usaba para
    // medir la duración y ya se revocó): deja escuchar el archivo
    // antes de clonar, para verificar que se subió el correcto y que
    // se oye bien.
    if(filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    filePreviewUrl=URL.createObjectURL(f);
    const preview=document.getElementById('filePreview');
    preview.src=filePreviewUrl;
    preview.hidden=false;
  };

  const rechazar=(msg)=>{
    if(resuelto)return; resuelto=true;
    limpiar();
    URL.revokeObjectURL(url);
    toast(msg,'warn');
    document.getElementById('fileInput').value='';
    const preview=document.getElementById('filePreview');
    preview.hidden=true; preview.removeAttribute('src');
  };

  const onMeta=()=>{
    if(!isFinite(audio.duration)){
      // Algunas grabaciones de celular no traen la duración en los
      // metadatos; hay que "buscar" hasta el final para calcularla.
      // Este truco funciona en Chrome/Android, pero en Safari/iOS a
      // veces no dispara "timeupdate" (o lanza una excepción al
      // buscar fuera de rango); si eso pasa, el timeout de más abajo
      // deja pasar el archivo igual sin bloquear al usuario.
      try{
        audio.currentTime=1e101;
        audio.addEventListener('timeupdate',function onTU(){
          audio.removeEventListener('timeupdate',onTU);
          const d=audio.duration;
          if(isFinite(d)){
            if(d<30){rechazar('El audio debe tener al menos 30 segundos');return;}
            if(d>180){rechazar('El audio no puede superar los 3 minutos');return;}
            aceptar(d);
          } else {
            // No se pudo calcular la duración; dejamos continuar igual.
            aceptar(null);
          }
        },{once:true});
      }catch(e){
        aceptar(null);
      }
      return;
    }
    if(audio.duration<30){rechazar('El audio debe tener al menos 30 segundos');return;}
    if(audio.duration>180){rechazar('El audio no puede superar los 3 minutos');return;}
    aceptar(audio.duration);
  };

  const onError=()=>{
    rechazar('No se pudo leer este archivo. Prueba con otro formato (MP3, WAV o M4A).');
  };

  const timeoutId=setTimeout(()=>{
    if(!resuelto) aceptar(null);
  },8000);

  audio.addEventListener('loadedmetadata',onMeta);
  audio.addEventListener('error',onError);
  audio.src=url;
}

/** Envía el archivo de audio subido por el usuario a /clonar-voz/. */
async function clonarArchivo(){
  const name=validateName();if(!name)return;
  const f=document.getElementById('fileInput').files[0];
  if(!f){toast('Selecciona un archivo de audio','warn');return;}
  setLoading('btnCloneFile','spinFile',true);
  const form=new FormData();
  form.append('samples',f);
  form.append('voice_name',name);
  await enviarClone(form);
  setLoading('btnCloneFile','spinFile',false);
}

/** Lógica compartida por clonarGrabacion() y clonarArchivo(): hace el POST a /clonar-voz/ y redirige a /mensajes/ si sale bien. */
async function enviarClone(form){
  try{
    const r=await fetch('/clonar-voz/',{method:'POST',body:form});
    const data=await r.json();
    if(data.ok){
      localStorage.setItem('voice_id',data.voice_id);
      toast('¡Voz clonada correctamente!','success',2500);
      setTimeout(()=>window.location='/mensajes/',2500);
    } else if(data.limite){
      toast(data.mensaje,'warn',6000);
      setTimeout(()=>window.location='/mensajes/',3000);
    } else {
      toast(data.error||'No se pudo clonar la voz. Intenta de nuevo.','error');
    }
  }catch(e){
    toast('Error de conexión. Revisa tu internet e intenta de nuevo.','error');
  }
}

/** Deshabilita el botón `btnId` y muestra su spinner mientras `on` es true (durante la llamada a clonar). */
function setLoading(btnId,spinnerId,on){
  document.getElementById(btnId).disabled=on;
  document.getElementById(spinnerId).style.display=on?'block':'none';
}

/** Limpia el estado de grabación para permitir capturar una nueva muestra desde cero. */
function resetFlow(){
  audioBlob=null;chunks=[];mediaRecorder=null;
  clearInterval(timerInt);
  document.getElementById('micBtn').className='mic-btn';
  document.getElementById('recStatus').textContent='Toca para comenzar a grabar';
  document.getElementById('recTimer').textContent='';
  document.getElementById('progFill').style.width='0%';
  document.getElementById('progWrap').style.display='none';
  document.getElementById('btnCloneRec').disabled=true;
  document.querySelectorAll('.script-p').forEach(el=>el.classList.remove('active'));
  if(recPreviewUrl){URL.revokeObjectURL(recPreviewUrl);recPreviewUrl=null;}
  const preview=document.getElementById('recPreview');
  preview.hidden=true; preview.removeAttribute('src');
  switchTab('rec');
  toast('Listo para grabar una nueva muestra','ok');
}

const zone=document.getElementById('uploadZone');
zone.addEventListener('dragover',e=>{e.preventDefault();zone.style.borderColor='var(--brand)'});
zone.addEventListener('dragleave',()=>zone.style.borderColor='');
zone.addEventListener('drop',e=>{
  e.preventDefault();zone.style.borderColor='';
  const f=e.dataTransfer.files[0];
  if(f&&f.type.startsWith('audio/')){
    const dt=new DataTransfer();dt.items.add(f);
    document.getElementById('fileInput').files=dt.files;
    archivoSeleccionado();
  }else{
    toast('Solo se aceptan archivos de audio','warn');
  }
});
