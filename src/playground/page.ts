export const PLAYGROUND_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "connect-src 'self' wss:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const PLAYGROUND_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drops API : démonstration WebSocket</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #0b0d10; color: #f5f7fa; font: 18px/1.5 system-ui, sans-serif; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    h2 { font-size: 22px; margin: 0 0 12px; color: #ffd166; }
    p.lead { margin: 0 0 24px; color: #c9d1d9; }
    .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
    section { background: #151a21; border: 2px solid #2d3643; border-radius: 12px; padding: 16px 20px; }
    label { display: block; margin: 8px 0 4px; }
    input { font: inherit; width: 100%; padding: 8px 10px; border-radius: 8px; border: 2px solid #4b5668; background: #0b0d10; color: #fff; }
    button { font: inherit; font-weight: 600; margin: 8px 8px 0 0; padding: 8px 16px; border-radius: 8px; border: 2px solid #ffd166; background: #ffd166; color: #0b0d10; cursor: pointer; }
    button.secondary { background: transparent; color: #ffd166; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .row { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    .row > div { flex: 1; min-width: 140px; }
    .status { font-weight: 700; padding: 2px 10px; border-radius: 6px; background: #2d3643; }
    .status.OPEN { background: #1f8a4c; }
    .status.CONNECTING, .status.CLOSING { background: #b7791f; }
    .status.CLOSED { background: #9b2c2c; }
    code, pre { font-family: ui-monospace, Menlo, monospace; font-size: 18px; }
    #ticket { word-break: break-all; }
    #closed { display: none; margin-top: 16px; padding: 16px; border-radius: 12px; background: #3b1219; border: 3px solid #ff6b6b; font-size: 32px; font-weight: 700; }
    #log { list-style: none; margin: 12px 0 0; padding: 0; max-height: 520px; overflow: auto; }
    #log li { border-top: 1px solid #2d3643; padding: 8px 0; }
    #log .up { color: #74c0fc; }
    #log .down { color: #8ce99a; }
    #log .info { color: #ffd166; }
    #log pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
    .error { color: #ff8787; min-height: 1.5em; }
  </style>
</head>
<body>
  <h1>Démonstration WebSocket</h1>
  <p class="lead">Un client minimal pour voir le protocole en direct. Le token reste en mémoire : rien n'est stocké.</p>
  <div class="grid">
    <div>
      <section>
        <h2>1. Connexion</h2>
        <form id="login-form">
          <label for="login">Identifiant</label>
          <input id="login" value="demo" autocomplete="off">
          <label for="password">Mot de passe</label>
          <input id="password" type="password" value="drops2026" autocomplete="off">
          <button type="submit">Se connecter</button>
        </form>
        <p id="user">Non connecté.</p>
        <p id="login-error" class="error"></p>
      </section>
      <section style="margin-top:20px">
        <h2>2. Ticket</h2>
        <button id="ticket-btn" disabled>Obtenir un ticket</button>
        <p id="ticket">Aucun ticket.</p>
        <p id="countdown"></p>
      </section>
      <section style="margin-top:20px">
        <h2>3. Connexion WebSocket</h2>
        <p>État : <span id="state" class="status CLOSED">CLOSED</span></p>
        <button id="connect-btn" disabled>Se connecter</button>
        <button id="close-btn" class="secondary" disabled>Fermer (1000)</button>
        <button id="reuse-btn" class="secondary" disabled>Réutiliser le dernier ticket</button>
        <div id="closed"></div>
      </section>
      <section style="margin-top:20px">
        <h2>4. Actions</h2>
        <button id="ping-btn" disabled>ping</button>
        <button id="leave-btn" class="secondary" disabled>presence:leave</button>
        <div class="row">
          <div>
            <label for="drop-id">dropId</label>
            <input id="drop-id" type="number" min="1" value="1">
          </div>
          <button id="view-btn" disabled>presence:view</button>
        </div>
        <div class="row">
          <div>
            <label for="raw">Texte brut</label>
            <input id="raw" value="ceci n'est pas du JSON" autocomplete="off">
          </div>
          <button id="raw-btn" disabled>Envoyer du texte brut</button>
        </div>
      </section>
    </div>
    <section>
      <h2>Journal des trames</h2>
      <button id="clear-btn" class="secondary">Vider le journal</button>
      <ul id="log"></ul>
    </section>
  </div>
  <script src="/ws-playground.js"></script>
</body>
</html>`;

export const PLAYGROUND_JS = `(function () {
  var token = null;
  var currentUser = null;
  var lastTicket = null;
  var ticketExpiry = 0;
  var socket = null;
  var $ = function (id) { return document.getElementById(id); };

  function setText(id, text) { $(id).textContent = text; }
  function setDisabled(id, value) { $(id).disabled = value; }

  function stateName() {
    if (!socket) return 'CLOSED';
    return ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket.readyState];
  }

  function refresh() {
    var name = stateName();
    var badge = $('state');
    badge.textContent = name;
    badge.className = 'status ' + name;
    var open = name === 'OPEN';
    var busy = name === 'CONNECTING' || name === 'CLOSING';
    setDisabled('ticket-btn', !token);
    setDisabled('connect-btn', !lastTicket || open || busy);
    setDisabled('reuse-btn', !lastTicket || busy);
    setDisabled('close-btn', !open);
    ['ping-btn', 'leave-btn', 'view-btn', 'raw-btn'].forEach(function (id) { setDisabled(id, !open); });
  }

  function log(kind, label, body) {
    var item = document.createElement('li');
    item.className = kind;
    var head = document.createElement('strong');
    var arrow = kind === 'up' ? '\\u2191' : kind === 'down' ? '\\u2193' : '\\u2022';
    head.textContent = arrow + ' ' + new Date().toLocaleTimeString('fr-FR') + ' ' + label;
    item.appendChild(head);
    if (body !== undefined) {
      var pre = document.createElement('pre');
      pre.textContent = body;
      item.appendChild(pre);
    }
    $('log').insertBefore(item, $('log').firstChild);
  }

  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }

  function sendFrame(text, label) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(text);
    log('up', label, pretty(text));
  }

  function sendMessage(type, data) {
    sendFrame(JSON.stringify({ type: type, data: data || {} }), type);
  }

  function open(url) {
    $('closed').style.display = 'none';
    socket = new WebSocket(url);
    var mine = socket;
    log('info', 'Connexion en cours', url.replace(/ticket=.*/, 'ticket=\\u2026'));
    mine.onopen = function () { log('info', 'Connexion ouverte'); refresh(); };
    mine.onmessage = function (event) {
      var parsed = null;
      try { parsed = JSON.parse(event.data); } catch (e) { parsed = null; }
      log('down', parsed && parsed.type ? parsed.type : 'message', pretty(event.data));
    };
    mine.onerror = function () { log('info', 'Erreur : connexion refusée ou interrompue'); };
    mine.onclose = function (event) {
      if (mine !== socket) return;
      var banner = $('closed');
      var reason = event.reason ? ' ' + event.reason : '';
      banner.textContent = 'Fermée : ' + event.code + reason;
      if (event.code === 1006) {
        banner.textContent += ' (refus au handshake ou coupure : ouvrez l\\u2019onglet Réseau pour voir le 401)';
      }
      banner.style.display = 'block';
      log('info', 'Connexion fermée', event.code + (event.reason ? ' ' + event.reason : ''));
      refresh();
    };
    refresh();
  }

  function tickCountdown() {
    if (!lastTicket) return;
    var left = Math.round((ticketExpiry - Date.now()) / 1000);
    setText('countdown', left > 0 ? 'Valable encore ' + left + ' s.' : 'Ticket expiré.');
  }

  $('login-form').addEventListener('submit', function (event) {
    event.preventDefault();
    setText('login-error', '');
    fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: $('login').value, password: $('password').value })
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) {
          setText('login-error', result.body.error ? result.body.error.message : 'Connexion impossible.');
          return;
        }
        token = result.body.token;
        currentUser = result.body.user;
        setText('user', 'Connecté : ' + currentUser.displayName + ' (@' + currentUser.username + ', id ' + currentUser.id + ')');
        refresh();
      })
      .catch(function () { setText('login-error', 'L\\u2019API ne répond pas.'); });
  });

  $('ticket-btn').addEventListener('click', function () {
    fetch('/realtime/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) {
          setText('ticket', result.body.error ? result.body.error.message : 'Ticket refusé.');
          return;
        }
        lastTicket = result.body;
        ticketExpiry = new Date(result.body.expiresAt).getTime();
        setText('ticket', result.body.ticket);
        tickCountdown();
        log('info', 'Ticket obtenu', pretty(JSON.stringify(result.body)));
        refresh();
      });
  });

  $('connect-btn').addEventListener('click', function () { open(lastTicket.url); });
  $('reuse-btn').addEventListener('click', function () {
    log('info', 'Réutilisation du dernier ticket : un refus 401 est attendu');
    open(lastTicket.url);
  });
  $('close-btn').addEventListener('click', function () { socket.close(1000, 'fermeture demandée'); refresh(); });
  $('ping-btn').addEventListener('click', function () { sendMessage('ping'); });
  $('leave-btn').addEventListener('click', function () { sendMessage('presence:leave'); });
  $('view-btn').addEventListener('click', function () { sendMessage('presence:view', { dropId: Number($('drop-id').value) }); });
  $('raw-btn').addEventListener('click', function () { sendFrame($('raw').value, 'texte brut'); });
  $('clear-btn').addEventListener('click', function () { $('log').textContent = ''; });

  setInterval(function () { tickCountdown(); refresh(); }, 500);
  refresh();
})();
`;
