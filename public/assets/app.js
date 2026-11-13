// Calcolatore nota spese: stato nel browser (localStorage, solo comodità), calcolo sul server via /api/calcola
(function () {
  'use strict';
  var I = JSON.parse(document.getElementById('i18n').textContent);
  var ST = JSON.parse(document.getElementById('stato').textContent);
  var LANG = document.documentElement.lang === 'en' ? 'en' : 'it';
  var KEY = 'rkm_stato_v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var oggi = function () { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()); };

  var stato = carica() || {
    metodo: 'aci', aci: null, fisso: '', carb: { tipo: 'benzina', consumo: 6.5, prezzo: '' }, alim: 'benzina',
    intest: '', azienda: '', periodo: '', targa: '',
    trasferte: [nuova()],
  };
  // veicolo passato dalla pagina Tabelle ACI
  try {
    var u = new URL(location.href);
    if (u.searchParams.get('veicolo') && u.searchParams.get('costo')) {
      stato.metodo = 'aci';
      stato.aci = { nome: u.searchParams.get('veicolo'), costo: Number(u.searchParams.get('costo')), det: '', alim: u.searchParams.get('alim') || '' };
      if (stato.aci.alim) stato.alim = stato.aci.alim === 'gpl-metano' ? 'gpl-metano' : stato.aci.alim;
      history.replaceState(null, '', u.pathname + '#calc');
    }
  } catch (e) { /* URL non supportato */ }

  function nuova() { return { data: oggi(), partenza: '', arrivo: '', motivo: '', km: '', andataRitorno: true, pedaggio: '', parcheggio: '', vitto: '', alloggio: '', altro: '', evita: false }; }
  function carica() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function salva() { try { localStorage.setItem(KEY, JSON.stringify(stato)); } catch (e) { /* storage non disponibile */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { var x = Number(String(v).replace(',', '.')); return isFinite(x) && x > 0 ? x : 0; }
  function msg(t, err) { var m = $('#msg'); m.textContent = t || ''; m.classList.toggle('err', !!err); }

  // ---------- metodo ----------
  function mostraMetodo() {
    $$('[role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.metodo === stato.metodo); });
    $$('.pane').forEach(function (p) { p.hidden = p.dataset.pane !== stato.metodo; });
  }
  $$('[role=tab]').forEach(function (b) { b.addEventListener('click', function () { stato.metodo = b.dataset.metodo; mostraMetodo(); aggiorna(); }); });

  function mostraAci() {
    var s = stato.aci; $('#aci-scelto').hidden = !s;
    if (s) { $('#aci-nome').textContent = s.nome; $('#aci-det').textContent = s.det || ''; $('#aci-costo').textContent = s.costo.toLocaleString('it-IT', { minimumFractionDigits: 4 }); }
  }
  var timer, lista = $('#aci-list'), q = $('#aci-q');
  q.addEventListener('input', function () {
    clearTimeout(timer);
    var v = q.value.trim();
    if (v.length < 2) { lista.hidden = true; return; }
    timer = setTimeout(function () {
      fetch('/api/aci/cerca?q=' + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.risultati.length) { lista.innerHTML = '<li class="vuoto">' + esc(I['acitab.vuoto']) + '</li>'; lista.hidden = false; return; }
        lista.innerHTML = j.risultati.map(function (v, i) {
          return '<li role="option" tabindex="-1" data-i="' + i + '"><span><b>' + esc(v.marca + ' ' + v.modello) + '</b> ' + esc(v.serie || '') +
            '<small>' + esc(v.alimentazione) + (v.in_produzione ? '' : ' · ' + esc(I['acitab.prod'])) + '</small></span><em>' + v.costo_km.toLocaleString('it-IT', { minimumFractionDigits: 4 }) + '</em></li>';
        }).join('');
        lista.hidden = false;
        $$('li[data-i]', lista).forEach(function (li) {
          var scegli = function () {
            var v = j.risultati[li.dataset.i];
            stato.aci = { nome: v.marca + ' ' + v.modello, det: (v.serie || '') + ' · ' + v.alimentazione + ' · ACI ' + j.anno, costo: v.costo_km, alim: v.alimentazione };
            if (v.alimentazione && $('#alim option[value="' + v.alimentazione + '"]')) { stato.alim = v.alimentazione; $('#alim').value = v.alimentazione; }
            lista.hidden = true; q.value = ''; mostraAci(); aggiorna();
          };
          li.addEventListener('click', scegli);
          li.addEventListener('keydown', function (e) { if (e.key === 'Enter') scegli(); });
        });
      }).catch(function () { lista.hidden = true; });
    }, 220);
  });
  q.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { var f = $('li[data-i]', lista); if (f) { e.preventDefault(); f.focus(); } } });
  lista.addEventListener('keydown', function (e) {
    var a = document.activeElement;
    if (e.key === 'ArrowDown' && a.nextElementSibling) { e.preventDefault(); a.nextElementSibling.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (a.previousElementSibling || q).focus(); }
    if (e.key === 'Escape') { lista.hidden = true; q.focus(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.ac')) lista.hidden = true; });

  // carburante: prezzo medio del giorno
  function prezzoAuto() {
    var f = ST.fuel && ST.fuel[stato.carb.tipo];
    if (f && !stato.carb.prezzoManuale) { stato.carb.prezzo = f.prezzo; $('#carb-prezzo').value = f.prezzo; }
  }
  $('#carb-tipo').addEventListener('change', function () { stato.carb.tipo = this.value; stato.carb.prezzoManuale = false; prezzoAuto(); aggiorna(); });
  $('#carb-cons').addEventListener('input', function () { stato.carb.consumo = this.value; aggiorna(); });
  $('#carb-prezzo').addEventListener('input', function () { stato.carb.prezzo = this.value; stato.carb.prezzoManuale = true; aggiorna(); });
  $('#fisso').addEventListener('input', function () { stato.fisso = this.value; aggiorna(); });
  $('#alim').addEventListener('change', function () { stato.alim = this.value; salva(); });
  [['#h-intest', 'intest'], ['#h-azienda', 'azienda'], ['#h-periodo', 'periodo'], ['#h-targa', 'targa']].forEach(function (x) {
    $(x[0]).addEventListener('input', function () { stato[x[1]] = this.value; salva(); });
  });

  // ---------- trasferte ----------
  var campiEuro = [['pedaggio', 't.ped'], ['parcheggio', 't.park'], ['vitto', 't.vitto'], ['alloggio', 't.alloggio'], ['altro', 't.altro']];
  function disegnaTrasferte() {
    var box = $('#trasferte');
    box.innerHTML = stato.trasferte.map(function (t, i) {
      var id = 't' + i + '-';
      return '<fieldset class="tr" data-i="' + i + '"><legend>#' + (i + 1) + '</legend>' +
        '<div class="grid-tr">' +
        '<div class="c-data"><label for="' + id + 'data">' + I['t.data'] + '</label><input id="' + id + 'data" type="date" data-k="data" value="' + esc(t.data) + '"></div>' +
        '<div class="c-da"><label for="' + id + 'da">' + I['t.da'] + '</label><input id="' + id + 'da" data-k="partenza" maxlength="200" autocomplete="off" value="' + esc(t.partenza) + '"></div>' +
        '<div class="c-a"><label for="' + id + 'a">' + I['t.a'] + '</label><input id="' + id + 'a" data-k="arrivo" maxlength="200" autocomplete="off" value="' + esc(t.arrivo) + '"></div>' +
        '<div class="c-mot"><label for="' + id + 'mot">' + I['t.motivo'] + '</label><input id="' + id + 'mot" data-k="motivo" maxlength="300" value="' + esc(t.motivo) + '"></div>' +
        '</div>' +
        '<div class="tr-calc">' +
        (ST.routes ? '<button type="button" class="btn small" data-calc>' + I['t.calc'] + '</button>' : '') +
        '<label class="chk"><input type="checkbox" data-k="andataRitorno"' + (t.andataRitorno ? ' checked' : '') + '> ' + I['t.ar'] + '</label>' +
        (ST.routes ? '<label class="chk"><input type="checkbox" data-k="evita"' + (t.evita ? ' checked' : '') + '> ' + I['t.noautostrada'] + '</label>' : '') +
        '<span class="tr-info" data-info></span></div>' +
        '<div class="grid-num">' +
        '<div><label for="' + id + 'km">' + I['t.km'] + '</label><input id="' + id + 'km" type="number" step="0.1" min="0" inputmode="decimal" data-k="km" value="' + esc(t.km) + '"></div>' +
        campiEuro.map(function (c) { return '<div><label for="' + id + c[0] + '">' + I[c[1]] + ' €</label><input id="' + id + c[0] + '" type="number" step="0.01" min="0" inputmode="decimal" data-k="' + c[0] + '" value="' + esc(t[c[0]]) + '"></div>'; }).join('') +
        '</div>' +
        '<div class="tr-foot"><span class="tr-tot" data-tot></span>' + (stato.trasferte.length > 1 ? '<button type="button" class="link" data-del>' + I['t.del'] + '</button>' : '') + '</div>' +
        '</fieldset>';
    }).join('');
  }
  $('#trasferte').addEventListener('input', function (e) {
    var k = e.target.dataset.k; if (!k) return;
    var i = Number(e.target.closest('.tr').dataset.i);
    stato.trasferte[i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    aggiorna();
  });
  $('#trasferte').addEventListener('click', function (e) {
    var tr = e.target.closest('.tr'); if (!tr) return;
    var i = Number(tr.dataset.i);
    if (e.target.matches('[data-del]')) { stato.trasferte.splice(i, 1); disegnaTrasferte(); aggiorna(); }
    if (e.target.matches('[data-calc]')) calcolaPercorso(i, tr, e.target);
  });
  $('#add').addEventListener('click', function () {
    var ult = stato.trasferte[stato.trasferte.length - 1];
    var t = nuova(); if (ult) { t.partenza = ult.partenza; }
    stato.trasferte.push(t); disegnaTrasferte(); aggiorna();
    var f = $('.tr:last-of-type [data-k=arrivo]'); if (f) f.focus();
  });

  var ERR = {
    it: { indirizzo: 'Indirizzo non trovato: controlla partenza e arrivo.', quota: 'Limite di calcoli raggiunto per oggi: inserisci i km a mano.', troppe_richieste: 'Troppe richieste: riprova tra poco.', non_configurato: 'Calcolo percorso non disponibile: inserisci i km a mano.', default: 'Calcolo non riuscito: inserisci i km a mano.', noped: 'pedaggio non stimabile: inseriscilo a mano', min: 'min' },
    en: { indirizzo: 'Address not found: check origin and destination.', quota: 'Daily calculation limit reached: enter km manually.', troppe_richieste: 'Too many requests: try again shortly.', non_configurato: 'Route calculation unavailable: enter km manually.', default: 'Calculation failed: enter km manually.', noped: 'toll not available: enter it manually', min: 'min' },
  }[LANG];
  function calcolaPercorso(i, tr, btn) {
    var t = stato.trasferte[i];
    if (!t.partenza.trim() || !t.arrivo.trim()) { $('[data-k=' + (t.partenza.trim() ? 'arrivo' : 'partenza') + ']', tr).focus(); return; }
    btn.disabled = true; var info = $('[data-info]', tr); info.textContent = '…'; info.classList.remove('err');
    fetch('/api/percorso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partenza: t.partenza, arrivo: t.arrivo, alimentazione: stato.alim, evitaAutostrade: !!t.evita }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) { info.textContent = ERR[x.j.errore] || ERR.default; info.classList.add('err'); return; }
        t.km = x.j.km; t.pedaggio = x.j.pedaggioNoto ? x.j.pedaggio : t.pedaggio;
        $('[data-k=km]', tr).value = t.km; $('[data-k=pedaggio]', tr).value = t.pedaggio;
        info.textContent = x.j.km.toLocaleString('it-IT') + ' km · ' + x.j.durataMin + ' ' + ERR.min + (x.j.conPedaggi && !x.j.pedaggioNoto ? ' · ' + ERR.noped : '');
        aggiorna();
      })
      .catch(function () { info.textContent = ERR.default; info.classList.add('err'); })
      .then(function () { btn.disabled = false; });
  }

  // ---------- calcolo ----------
  function payload() {
    var m;
    if (stato.metodo === 'aci') m = { tipo: 'aci', costoKm: stato.aci ? stato.aci.costo : 0, veicolo: stato.aci ? stato.aci.nome : '' };
    else if (stato.metodo === 'fisso') m = { tipo: 'fisso', costoKm: n(stato.fisso) };
    else m = { tipo: 'carburante', consumo: n(stato.carb.consumo), prezzo: n(stato.carb.prezzo), carburante: stato.carb.tipo };
    return {
      intestatario: stato.intest, azienda: stato.azienda, periodo: stato.periodo, targa: stato.targa, metodo: m,
      trasferte: stato.trasferte.map(function (t) {
        return { data: t.data, partenza: t.partenza, arrivo: t.arrivo, motivo: t.motivo, km: n(t.km), andataRitorno: !!t.andataRitorno,
          pedaggio: n(t.pedaggio), parcheggio: n(t.parcheggio), vitto: n(t.vitto), alloggio: n(t.alloggio), altro: n(t.altro) };
      }),
    };
  }
  var tCalc;
  function aggiorna() {
    salva();
    clearTimeout(tCalc);
    tCalc = setTimeout(function () {
      fetch('/api/calcola', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) {
          if (!r) return;
          $('#r-tariffa').textContent = r.tariffaKm ? r.tariffaKm.toLocaleString('it-IT', { minimumFractionDigits: 4 }) + ' €/km' : '–';
          $('#r-km').textContent = r.totali.km.toLocaleString('it-IT');
          $('#r-kmrimb').textContent = euro.format(r.totali.rimborsoKm / 100);
          $('#r-ped').textContent = euro.format(r.totali.pedaggi / 100);
          $('#r-extra').textContent = euro.format(r.totali.extra / 100);
          $('#r-tot').textContent = euro.format(r.totali.totale / 100);
          r.righe.forEach(function (rr, i) { var el = $('.tr[data-i="' + i + '"] [data-tot]'); if (el) el.textContent = rr.kmTotali.toLocaleString('it-IT') + ' km · ' + euro.format(rr.totale / 100); });
        }).catch(function () {});
    }, 150);
  }

  $$('[data-export]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = payload();
      if (!p.metodo.costoKm && !(p.metodo.consumo && p.metodo.prezzo)) { msg(LANG === 'en' ? 'Choose a vehicle or enter a rate first.' : 'Prima scegli un veicolo o inserisci una tariffa.', true); return; }
      b.disabled = true; msg('…');
      fetch('/api/export/' + b.dataset.export + '?lang=' + LANG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
        .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
        .then(function (blob) {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = 'nota-spese-' + oggi() + '.' + b.dataset.export; document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); msg('');
          if (window.gtag) gtag('event', 'export_' + b.dataset.export);
        })
        .catch(function () { msg(LANG === 'en' ? 'Export failed: check the data entered.' : 'Export non riuscito: controlla i dati inseriti.', true); })
        .then(function () { b.disabled = false; });
    });
  });
  $('#reset').addEventListener('click', function () {
    if (!window.confirm(LANG === 'en' ? 'Clear all trips?' : 'Svuotare tutte le trasferte?')) return;
    stato.trasferte = [nuova()]; disegnaTrasferte(); aggiorna();
  });

  // ---------- avvio ----------
  $('#fisso').value = stato.fisso || '';
  $('#carb-tipo').value = stato.carb.tipo; $('#carb-cons').value = stato.carb.consumo; $('#carb-prezzo').value = stato.carb.prezzo;
  if (!stato.carb.prezzoManuale) prezzoAuto();
  $('#alim').value = stato.alim;
  $('#h-intest').value = stato.intest || ''; $('#h-azienda').value = stato.azienda || ''; $('#h-periodo').value = stato.periodo || ''; $('#h-targa').value = stato.targa || '';
  mostraMetodo(); mostraAci(); disegnaTrasferte(); aggiorna();
})();
