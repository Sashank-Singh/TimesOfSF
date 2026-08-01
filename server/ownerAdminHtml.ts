/** Single-page owner tool (HTML only). Not linked from the public app. */
export function buildOwnerArticleIngestPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title>Article ingest</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 1.5rem; line-height: 1.45; }
    .wrap { max-width: 32rem; margin: 0 auto; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    .sub { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; color: #737373; margin: 0 0 1rem; }
    p.note { font-size: 0.875rem; color: #a3a3a3; margin: 0 0 1.25rem; }
    label { display: block; margin-bottom: 1rem; }
    label span { display: block; font-size: 0.75rem; color: #737373; margin-bottom: 0.25rem; }
    input, select, button { width: 100%; box-sizing: border-box; padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid #404040; background: #171717; color: #e5e5e5; font-size: 0.875rem; }
    input:focus, select:focus { outline: none; border-color: #737373; }
    button { background: #d97706; color: #0a0a0a; font-weight: 600; border: none; margin-top: 0.25rem; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .row input { width: auto; }
    pre { white-space: pre-wrap; font-size: 0.75rem; background: #171717; border: 1px solid #262626; padding: 0.75rem; border-radius: 0.375rem; margin-top: 1rem; }
    a { color: #fbbf24; }
    .tips { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid #262626; }
    .tip-item { border: 1px solid #262626; border-radius: 0.375rem; padding: 0.75rem; margin-top: 0.75rem; font-size: 0.8125rem; }
    .tip-item .meta { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.1em; color: #737373; margin-bottom: 0.35rem; }
    .tip-item .msg { color: #e5e5e5; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="sub">Owner only</p>
    <h1>Article from URL</h1>
    <p class="note">Paste a news article link. This page is not linked from the public site. Uses the same <code>OWNER_CLI_SECRET</code> as your server env.</p>
    <form id="f">
      <label><span>Article URL</span><input type="url" name="url" required placeholder="https://…" /></label>
      <label><span>Desk (optional)</span>
        <select name="desk">
          <option value="">Auto from model</option>
          <option>Tech</option><option>Funding</option><option>Civics</option><option>Culture</option><option>Transit</option><option>Food</option><option>Events</option>
        </select>
      </label>
      <label><span>OWNER_CLI_SECRET</span><input type="password" name="secret" required autocomplete="off" id="secret" /></label>
      <div class="row"><input type="checkbox" id="remember" /><span style="font-size:0.875rem;color:#a3a3a3">Remember secret in this browser</span></div>
      <button type="submit" id="go">Generate & publish</button>
    </form>
    <pre id="out" hidden></pre>
    <p style="margin-top:1.5rem;font-size:0.75rem;color:#525252">Do not bookmark with the secret in the URL. Bookmark this page path only.</p>
    <p style="margin-top:0.5rem"><a href="/">← Public site</a></p>

    <div class="tips">
      <h1>Tips & corrections</h1>
      <p class="note">Reader submissions from article pages.</p>
      <button type="button" id="loadTips">Load recent</button>
      <div id="tipsOut"></div>
    </div>
  </div>
  <script>
    (function () {
      var key = "tosf-owner-secret";
      var sec = document.getElementById("secret");
      var rem = document.getElementById("remember");
      try {
        var s = sessionStorage.getItem(key);
        if (s) { sec.value = s; rem.checked = true; }
      } catch (e) {}
      document.getElementById("f").onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var url = (fd.get("url") || "").trim();
        var secret = (fd.get("secret") || "").trim();
        var desk = (fd.get("desk") || "").trim();
        try {
          if (rem.checked && secret) sessionStorage.setItem(key, secret);
          else sessionStorage.removeItem(key);
        } catch (e) {}
        var btn = document.getElementById("go");
        var out = document.getElementById("out");
        btn.disabled = true;
        out.hidden = true;
        fetch("/api/admin/article-from-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, secret: secret, editorialCategory: desk || undefined })
        }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (_ref) {
          var r = _ref.r, j = _ref.j;
          out.hidden = false;
          if (!r.ok) { out.textContent = j.error || r.statusText; return; }
          if (j.ok && j.slug) {
            var o = location.origin;
            out.textContent = ["Published.", "", "Open:", o + "/articles/" + encodeURIComponent(j.slug)].join(String.fromCharCode(10));
            ev.target.url.value = "";
          } else {
            out.textContent = (j.result && j.result.reason) || "Not published.";
          }
        }).catch(function (e) {
          out.hidden = false;
          out.textContent = e.message || "Network error";
        }).finally(function () { btn.disabled = false; });
      };

      document.getElementById("loadTips").onclick = function () {
        var tipsOut = document.getElementById("tipsOut");
        var secretValue = sec.value.trim();
        if (!secretValue) { tipsOut.textContent = "Enter OWNER_CLI_SECRET above first."; return; }
        tipsOut.textContent = "Loading…";
        fetch("/api/tips", { headers: { "x-admin-secret": secretValue } })
          .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
          .then(function (_ref) {
            var r = _ref.r, j = _ref.j;
            if (!r.ok) { tipsOut.textContent = (j && j.error) || r.statusText; return; }
            if (!Array.isArray(j) || j.length === 0) { tipsOut.textContent = "No submissions yet."; return; }
            tipsOut.innerHTML = "";
            j.forEach(function (tip) {
              var div = document.createElement("div");
              div.className = "tip-item";
              var meta = document.createElement("div");
              meta.className = "meta";
              var when = new Date(tip.createdAt).toLocaleString();
              meta.textContent = [tip.kind, tip.postSlug || "(no article)", tip.contactEmail || "no email", when].join(" · ");
              var msg = document.createElement("div");
              msg.className = "msg";
              msg.textContent = tip.message;
              div.appendChild(meta);
              div.appendChild(msg);
              tipsOut.appendChild(div);
            });
          })
          .catch(function (e) { tipsOut.textContent = e.message || "Network error"; });
      };
    })();
  </script>
</body>
</html>`;
}
