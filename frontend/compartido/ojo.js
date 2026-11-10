// Botón «mostrar/ocultar contraseña» para cualquier campo dentro de .campo-ico
document.addEventListener('click', function (e) {
  var b = e.target.closest('.ojo'); if (!b) return;
  var inp = b.parentNode.querySelector('input'); if (!inp) return;
  var ver = inp.type === 'password'; inp.type = ver ? 'text' : 'password';
  b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); b.setAttribute('aria-pressed', String(ver));
  b.querySelector('use').setAttribute('href', '/compartido/iconos.svg#' + (ver ? 'ojo-no' : 'ojo'));
});
