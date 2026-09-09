/*
 * Lógica de la pantalla "Entrenar mi voz" (/entrenar-voz/, plantilla
 * onboarding.html). Cubre el modal de consentimiento de datos
 * biométricos, la grabación/subida de la muestra de voz y el envío
 * a /clonar-voz/.
 */

let mediaRecorder=null,chunks=[],audioBlob=null,timerInt=null,secs=0;
let consentimientoAceptado=false;  // se pone en true solo cuando el usuario acepta el modal de consentimiento
let toastIntervalId=null;

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

/**
 * Maneja la respuesta al modal de consentimiento de datos biométricos
 * que se muestra al entrar a esta pantalla (ver #consentOverlay).
 * Si acepta: cierra el modal y quita el atributo "inert" que hasta
 * ese momento bloqueaba cualquier interacción con el resto de la
 * página. Si no acepta: lo manda a la pantalla /sin-autorizar/ sin
 * dejarlo usar esta pantalla.
 */
function responderConsentimiento(aceptado){
  const overlay=document.getElementById('consentOverlay');
  const contenido=document.getElementById('appContent');
  if(aceptado){
    consentimientoAceptado=true;
    overlay.style.display='none';
    contenido.removeAttribute('inert');
  } else {
    window.location='/sin-autorizar/';
  }
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
 * Segunda barrera de seguridad además del modal: aunque este código
 * solo es alcanzable después de aceptar el consentimiento (el resto
 * de la página queda "inert" hasta entonces), esta función se llama
 * de nuevo justo antes de clonar por si alguien manipula el DOM
 * desde las herramientas de desarrollador para saltarse el modal.
 */
function tieneConsentimiento(){
  if(!consentimientoAceptado){
    toast('Debes aceptar el aviso de datos personales para clonar tu voz','warn',5000);
    return false;
  }
  return true;
}

/** Inicia o detiene la grabación del micrófono; valida que dure entre 30s y 5min antes de habilitar "Clonar". */
async function toggleRec(){
  if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();return;}
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

      if(secs < 30){
        toast('La muestra debe tener al menos 30 segundos','warn');
        audioBlob=null;
        document.getElementById('btnCloneRec').disabled=true;
        document.getElementById('recStatus').textContent='Toca para intentarlo de nuevo';
      } else if(secs > 300){
        toast('La muestra no puede superar los 5 minutos','warn');
        audioBlob=null;
        document.getElementById('btnCloneRec').disabled=true;
        document.getElementById('recStatus').textContent='Toca para intentarlo de nuevo';
      } else {
        audioBlob=new Blob(chunks,{type:'audio/webm'});
        document.getElementById('recStatus').innerHTML='Audio listo ('+secs+'s). Ya puedes clonar.';
        document.getElementById('btnCloneRec').disabled=false;
        toast('Muestra grabada correctamente','success');
      }
    };

    mediaRecorder.start();
    secs=0;
    document.getElementById('progWrap').style.display='block';
    document.getElementById('micBtn').className='mic-btn recording';
    document.getElementById('recStatus').innerHTML='<strong>Grabando...</strong> Toca para detener';

    timerInt=setInterval(()=>{
      secs++;
      document.getElementById('recTimer').textContent=secs+'s grabando...';
      document.getElementById('progFill').style.width=Math.min((secs/30)*100,100)+'%';
      if(secs>=300) mediaRecorder.stop();
    },1000);

  }catch(e){
    toast('No se pudo acceder al micrófono. Revisa los permisos del navegador.','error');
  }
}

/** Envía la muestra grabada por micrófono a /clonar-voz/. */
async function clonarGrabacion(){
  if(!tieneConsentimiento())return;
  const name=validateName();if(!name)return;
  if(!audioBlob){toast('Graba al menos 30 segundos primero','warn');return;}
  setLoading('btnCloneRec','spinRec',true);
  const form=new FormData();
  form.append('samples',audioBlob,'voz.webm');
  form.append('voice_name',name);
  await enviarClone(form);
  setLoading('btnCloneRec','spinRec',false);
}

/**
 * Valida el archivo de audio elegido en "Subir archivo" (tamaño y
 * duración entre 30s y 5min) antes de habilitar el botón de clonar.
 * Incluye manejo especial para navegadores/formatos que no calculan
 * bien la duración de entrada (ver comentario más abajo) y un
 * timeout de respaldo para que la interfaz nunca se quede colgada
 * sin avisar si el archivo no se puede leer.
 */
function archivoSeleccionado(){
  const f=document.getElementById('fileInput').files[0];
  if(!f)return;

  const maxBytes=50*1024*1024;
  if(f.size>maxBytes){
    toast('El archivo no puede superar los 50MB (≈ 5 minutos)','warn');
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
  };

  const rechazar=(msg)=>{
    if(resuelto)return; resuelto=true;
    limpiar();
    URL.revokeObjectURL(url);
    toast(msg,'warn');
    document.getElementById('fileInput').value='';
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
            if(d>300){rechazar('El audio no puede superar los 5 minutos');return;}
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
    if(audio.duration>300){rechazar('El audio no puede superar los 5 minutos');return;}
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
  if(!tieneConsentimiento())return;
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
