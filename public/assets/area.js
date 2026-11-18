// Area personale: invio automatico cambio stato, conferma eliminazioni
(function () {
  document.querySelectorAll('select[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
  document.querySelectorAll('form[data-conferma]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.dataset.conferma)) e.preventDefault(); });
  });
})();
