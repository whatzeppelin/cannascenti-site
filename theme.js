(function () {
  var KEY = 'cs_theme';
  var current = 'dark';
  try { current = localStorage.getItem(KEY) || 'dark'; } catch (e) {}

  // Apply immediately — prevents flash of wrong theme
  document.documentElement.setAttribute('data-theme', current);

  var SUN = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var MOON = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  var style = document.createElement('style');
  style.textContent = [
    /* ── Light mode CSS variable overrides ── */
    'html[data-theme="light"]{',
      '--bg:#F5F0E8;--card:#FDFAF5;--cream:#1a2918;',
      '--dim:rgba(26,41,24,0.55);--border:rgba(82,183,136,0.18);',
      '--bright:#2d9464;--green:#267a54;',
      /* server.js page vars */
      '--dark:#F5F0E8;--bright-green:#2d9464;--warm-black:#F5F0E8;',
      '--card-bg:rgba(0,0,0,0.025);--amber:#c97f28;',
    '}',
    'html[data-theme="light"] body{background:#F5F0E8;color:#1a2918}',

    /* Nav */
    'html[data-theme="light"] nav{background:rgba(245,240,232,0.97)!important;border-bottom-color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .nav-links a{color:rgba(26,41,24,0.5)!important}',
    'html[data-theme="light"] .nav-links a:hover{color:#2d9464!important}',
    'html[data-theme="light"] .nav-cta{border-color:rgba(26,41,24,0.35)!important;color:#1a2918!important}',
    'html[data-theme="light"] .nav-cta:hover{background:rgba(26,41,24,0.05)!important}',
    'html[data-theme="light"] .nav-back{color:rgba(26,41,24,0.4)!important}',
    'html[data-theme="light"] .nav-back:hover{color:#2d9464!important}',
    'html[data-theme="light"] .nav-logo{color:#1a2918!important}',

    /* Cards */
    'html[data-theme="light"] .card{background:#FDFAF5;border-color:rgba(82,183,136,0.18)}',
    'html[data-theme="light"] .item-card{background:rgba(0,0,0,0.025)!important;border-color:rgba(82,183,136,0.15)!important}',
    'html[data-theme="light"] .stat-item{background:rgba(0,0,0,0.025)!important;border-color:rgba(82,183,136,0.15)!important}',
    'html[data-theme="light"] .plan-card{background:#FDFAF5!important;border-color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .plan-card.featured{background:rgba(82,183,136,0.05)!important;border-color:rgba(82,183,136,0.45)!important}',

    /* Hero */
    'html[data-theme="light"] .hero{background:#F5F0E8!important}',
    'html[data-theme="light"] .hero-card{background:#FDFAF5;border-color:rgba(82,183,136,0.18)}',
    'html[data-theme="light"] .hero-right{background:rgba(82,183,136,0.04)!important;border-left-color:rgba(82,183,136,0.15)!important}',
    'html[data-theme="light"] .hero-eyebrow{color:rgba(82,183,136,0.6)!important}',

    /* Quiz effect cards */
    'html[data-theme="light"] .quiz-effect-card{background:rgba(0,0,0,0.025)!important;border-color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .quiz-effect-card:hover{background:rgba(0,0,0,0.05)!important}',
    'html[data-theme="light"] .quiz-effect-name{color:#1a2918!important}',
    'html[data-theme="light"] .quiz-effect-desc{color:rgba(26,41,24,0.55)!important}',

    /* Encyclopedia cards */
    'html[data-theme="light"] .enc-topic-card{background:rgba(0,0,0,0.025)!important;border-color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .enc-topic-card:hover{background:rgba(0,0,0,0.05)!important}',
    'html[data-theme="light"] .enc-topic-name{color:#1a2918!important}',
    'html[data-theme="light"] .enc-topic-desc{color:rgba(26,41,24,0.55)!important}',

    /* Mary Jane section */
    'html[data-theme="light"] .mj-spotlight{background:#F5F0E8!important}',
    'html[data-theme="light"] .mj-panel{background:#FDFAF5!important;border-color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .mj-scanner-mock{background:rgba(0,0,0,0.03)!important;border-color:rgba(82,183,136,0.2)!important}',
    'html[data-theme="light"] .mj-msg-bot{background:rgba(0,0,0,0.04)!important;border-color:rgba(0,0,0,0.08)!important}',
    'html[data-theme="light"] .mj-msg-user{background:rgba(82,183,136,0.12)!important}',
    'html[data-theme="light"] .mj-input-wrap{background:rgba(0,0,0,0.03)!important;border-color:rgba(0,0,0,0.1)!important}',

    /* Compare table */
    'html[data-theme="light"] .compare-card.them{background:rgba(0,0,0,0.02)!important;border-color:rgba(0,0,0,0.1)!important}',
    'html[data-theme="light"] .compare-card.us{background:rgba(82,183,136,0.05)!important;border-color:rgba(82,183,136,0.3)!important}',
    'html[data-theme="light"] .compare-table th{color:rgba(26,41,24,0.4)!important;border-bottom-color:rgba(82,183,136,0.2)!important}',
    'html[data-theme="light"] .compare-table td{border-bottom-color:rgba(82,183,136,0.1)!important;color:rgba(26,41,24,0.7)!important}',

    /* Forms */
    'html[data-theme="light"] .form-input{background:rgba(0,0,0,0.03)!important;border-color:rgba(0,0,0,0.12)!important;color:#1a2918!important}',
    'html[data-theme="light"] .form-input::placeholder{color:rgba(26,41,24,0.3)!important}',
    'html[data-theme="light"] .form-input:focus{border-color:rgba(82,183,136,0.45)!important}',
    'html[data-theme="light"] .form-label{color:rgba(82,183,136,0.6)!important}',
    'html[data-theme="light"] .form-select{background:rgba(0,0,0,0.03)!important;border-color:rgba(0,0,0,0.12)!important;color:#1a2918!important}',

    /* Buttons */
    'html[data-theme="light"] .btn,.html[data-theme="light"] .hero-cta-outline{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .btn{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .btn:hover{background:rgba(26,41,24,0.05)!important;border-color:#1a2918!important;opacity:1!important}',
    'html[data-theme="light"] .btn-ghost{border-color:rgba(26,41,24,0.2)!important;color:rgba(26,41,24,0.5)!important}',
    'html[data-theme="light"] .btn-ghost:hover{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .hero-cta-outline{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .hero-cta-outline:hover{background:rgba(26,41,24,0.05)!important;border-color:#1a2918!important}',
    'html[data-theme="light"] .form-submit{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .form-submit:hover{background:rgba(26,41,24,0.05)!important;border-color:#1a2918!important}',
    'html[data-theme="light"] .plan-cta-outline{border-color:rgba(26,41,24,0.4)!important;color:#1a2918!important}',
    'html[data-theme="light"] .plan-cta-outline:hover{background:rgba(26,41,24,0.05)!important;border-color:#1a2918!important}',
    'html[data-theme="light"] .plan-cta-green{background:#267a54!important}',

    /* Eyebrows and dim text */
    'html[data-theme="light"] .eyebrow{color:rgba(82,183,136,0.6)!important}',
    'html[data-theme="light"] .intro-body{color:rgba(26,41,24,0.55)!important}',
    'html[data-theme="light"] .body-text{color:rgba(26,41,24,0.6)!important}',
    'html[data-theme="light"] .detail-label{color:rgba(82,183,136,0.6)!important}',
    'html[data-theme="light"] .detail-value{color:#1a2918!important}',

    /* Footer */
    'html[data-theme="light"] footer{border-top-color:rgba(82,183,136,0.18)!important;color:rgba(26,41,24,0.3)!important}',
    'html[data-theme="light"] footer a{color:rgba(26,41,24,0.3)!important}',
    'html[data-theme="light"] footer a:hover{color:#2d9464!important}',

    /* Platform items */
    'html[data-theme="light"] .platform-item{border-bottom-color:rgba(82,183,136,0.12)!important}',
    'html[data-theme="light"] .platform-item:first-child{border-top-color:rgba(82,183,136,0.12)!important}',
    'html[data-theme="light"] .platform-name{color:#1a2918!important}',
    'html[data-theme="light"] .platform-desc{color:rgba(26,41,24,0.55)!important}',

    /* FAQ */
    'html[data-theme="light"] .faq-item{border-bottom-color:rgba(82,183,136,0.15)!important}',
    'html[data-theme="light"] .faq-q{color:#1a2918!important}',
    'html[data-theme="light"] .faq-a{color:rgba(26,41,24,0.6)!important}',

    /* Step numbers / how-it-works */
    'html[data-theme="light"] .step-num{color:rgba(82,183,136,0.18)!important}',
    'html[data-theme="light"] .step-title{color:#1a2918!important}',
    'html[data-theme="light"] .step-desc{color:rgba(26,41,24,0.55)!important}',

    /* ── Toggle button ── */
    '#cs-theme-btn{background:transparent;border:1px solid rgba(82,183,136,0.28);border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(242,234,216,0.5);transition:border-color .2s,color .2s;flex-shrink:0;margin-left:12px;padding:0;line-height:1}',
    '#cs-theme-btn:hover{border-color:rgba(116,198,157,0.7);color:#74c69d}',
    'html[data-theme="light"] #cs-theme-btn{color:rgba(26,41,24,0.45);border-color:rgba(26,41,24,0.2)}',
    'html[data-theme="light"] #cs-theme-btn:hover{border-color:#2d9464;color:#2d9464}',
  ].join('');
  document.head.appendChild(style);

  function setIcon() {
    var icon = document.getElementById('cs-theme-icon');
    if (icon) icon.innerHTML = current === 'light' ? MOON : SUN;
  }

  function applyTheme(theme) {
    current = theme;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    setIcon();
  }

  function injectToggle() {
    var nav = document.querySelector('nav');
    if (!nav || document.getElementById('cs-theme-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'cs-theme-btn';
    btn.setAttribute('aria-label', 'Toggle light / dark mode');
    btn.innerHTML = '<span id="cs-theme-icon">' + (current === 'light' ? MOON : SUN) + '</span>';
    btn.onclick = function () { applyTheme(current === 'dark' ? 'light' : 'dark'); };
    nav.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectToggle);
  } else {
    injectToggle();
  }
})();
