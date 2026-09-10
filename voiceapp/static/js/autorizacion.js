/*
 * Lógica de la pantalla de autorización ("/", plantilla
 * autorizacion.html). Es el punto de entrada real de la app: antes de
 * cualquier otra cosa, pide aceptar el aviso de tratamiento de datos
 * personales. Si se acepta, pasa a "Entrenar mi voz"; si no, la propia
 * pantalla cambia de estado (sin navegar a otra URL) y ofrece volver a
 * intentarlo.
 */

/** El usuario acepta el aviso: pasa a la pantalla de entrenamiento de voz. */
function autorizar() {
  window.location = '/entrenar-voz/';
}

/** El usuario no acepta: se queda en esta misma pantalla, mostrando el estado de rechazo. */
function noAutorizar() {
  document.getElementById('cardPregunta').hidden = true;
  document.getElementById('cardRechazado').hidden = false;
}

/** Vuelve a mostrar la pregunta de autorización (botón "Intentar de nuevo"). */
function reintentar() {
  document.getElementById('cardRechazado').hidden = true;
  document.getElementById('cardPregunta').hidden = false;
}
