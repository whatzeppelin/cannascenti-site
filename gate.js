(function () {
  if (document.cookie.split(';').some(function (c) { return c.trim().startsWith('cs_access='); })) return;

  var style = document.createElement('style');
  style.textContent = [
    '#cs-gate{position:fixed;inset:0;z-index:9999;background:rgba(6,14,8,0.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:24px}',
    '.cs-gate-card{background:#0d2818;border:1px solid rgba(82,183,136,0.2);border-radius:28px;padding:64px 56px;max-width:460px;width:100%;text-align:center}',
    '.cs-gate-logo{font-family:"Cormorant Garamond",serif;font-size:22px;color:#F2EAD8;letter-spacing:.06em;margin-bottom:36px;display:block}',
    '.cs-gate-eyebrow{font-size:9px;font-weight:500;letter-spacing:.45em;text-transform:uppercase;color:rgba(82,183,136,0.55);margin-bottom:16px}',
    '.cs-gate-h{font-family:"Cormorant Garamond",serif;font-size:44px;font-weight:300;color:#F2EAD8;line-height:1.05;margin-bottom:14px;letter-spacing:-.01em}',
    '.cs-gate-h em{color:#74c69d;font-style:italic}',
    '.cs-gate-sub{font-size:13px;color:rgba(242,234,216,0.5);line-height:1.75;margin-bottom:32px;font-family:"Montserrat",sans-serif;font-weight:300}',
    '.cs-gate-input{width:100%;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 18px;color:#F2EAD8;font-family:"Montserrat",sans-serif;font-size:13px;font-weight:300;outline:none;transition:border-color .2s;margin-bottom:10px;box-sizing:border-box}',
    '.cs-gate-input:focus{border-color:rgba(82,183,136,0.4)}',
    '.cs-gate-input::placeholder{color:rgba(242,234,216,0.2)}',
    '.cs-gate-err{font-size:12px;color:#e05c5c;min-height:18px;margin-bottom:8px;font-family:"Montserrat",sans-serif;font-weight:300}',
    '.cs-gate-btn{width:100%;background:transparent;color:#F2EAD8;border:2px solid rgba(242,234,216,0.6);border-radius:14px;padding:15px;font-family:"Montserrat",sans-serif;font-size:11px;font-weight:500;letter-spacing:.15em;cursor:pointer;transition:background .25s,border-color .25s}',
    '.cs-gate-btn:hover{background:rgba(242,234,216,0.07);border-color:#F2EAD8}',
    '.cs-gate-btn:disabled{opacity:.4;cursor:default}',
    '.cs-gate-fine{font-size:10px;color:rgba(242,234,216,0.2);margin-top:18px;font-family:"Montserrat",sans-serif;letter-spacing:.05em}',
    '@media(max-width:520px){.cs-gate-card{padding:40px 28px;border-radius:20px}.cs-gate-h{font-size:36px}}'
  ].join('');
  document.head.appendChild(style);

  var html = '<div id="cs-gate">'
    + '<div class="cs-gate-card">'
    + '<span class="cs-gate-logo">Cannascenti</span>'
    + '<div class="cs-gate-eyebrow">free access</div>'
    + '<div class="cs-gate-h">unlock <em>everything.</em></div>'
    + '<p class="cs-gate-sub">Strain profiles, AI recommendations, terpene guides, and more — all free. Drop your email to get in.</p>'
    + '<input class="cs-gate-input" id="cs-gate-email" type="email" placeholder="your@email.com" autocomplete="email">'
    + '<div class="cs-gate-err" id="cs-gate-err"></div>'
    + '<button class="cs-gate-btn" id="cs-gate-btn" onclick="csGateSubmit()">get free access &rarr;</button>'
    + '<p class="cs-gate-fine">No spam. Unsubscribe anytime.</p>'
    + '</div></div>';

  function inject() {
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.style.overflow = 'hidden';
    document.getElementById('cs-gate-email').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') csGateSubmit();
    });
  }

  if (document.body) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }

  window.csGateSubmit = async function () {
    var email = document.getElementById('cs-gate-email').value.trim();
    var err = document.getElementById('cs-gate-err');
    var btn = document.getElementById('cs-gate-btn');
    err.textContent = '';
    if (!email || !email.includes('@')) {
      err.textContent = 'Please enter a valid email.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'unlocking\u2026';
    try {
      var res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, profile: 'gate' })
      });
      var data = await res.json();
      if (data.ok) {
        var exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = 'cs_access=1; expires=' + exp + '; path=/; SameSite=Lax';
        var gate = document.getElementById('cs-gate');
        if (gate) gate.remove();
        document.body.style.overflow = '';
      } else {
        err.textContent = data.error || 'Something went wrong. Try again.';
        btn.disabled = false;
        btn.textContent = 'get free access \u2192';
      }
    } catch (e) {
      err.textContent = 'Something went wrong. Try again.';
      btn.disabled = false;
      btn.textContent = 'get free access \u2192';
    }
  };
})();
