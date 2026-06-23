// Shared portal behavior for the desktop (index.html) and mobile
// (portal-mobile.html) entry pages. Layout/scaling lives in each HTML file's
// CSS; all content + i18n + link wiring lives here so there's one source of truth.
(function () {
  "use strict";

  // ---- External destinations ----
  var LINKS = {
    menu:      "menu.html?v=20260623",                       // internal — the digital menu (?v busts stale caches)
    instagram: "https://www.instagram.com/ayeka_bar/",
    review:    "https://www.google.com/search?sca_esv=bf5b70d178609590&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_7KuVymh7UmzzptLxAMIed7ULsObX2FBkuw7nT2KAF8MiqFu6xqzwWnw0NKO515Um1Z0Z8-i9F5axbTKJbSaHBIaHv9J&q=%D7%90%D7%99%D7%99%D7%9B%D7%94+Reviews&sa=X&ved=2ahUKEwjbgtyuopuVAxWRBNsEHV7yGVoQ0bkNegQIQhAH#",
  };

  // ---- Navigation: three map providers under the "navigate" button ----
  var NAV_ORDER = ["gmaps", "waze", "amaps"];
  var NAV = {
    gmaps: "https://maps.app.goo.gl/RkQKuohRE2WnxehDA",
    waze:  "https://waze.com/ul/hsvbbtt1nb",
    amaps: "https://maps.apple/r/I8JK.APxMAXYhS",
  };
  var NAV_LABELS = { gmaps: "Google Maps", waze: "Waze", amaps: "Apple Maps" };

  var LANGS = ["he", "en", "ar"];
  var RTL = { he: true, ar: true, en: false };

  // Brand wordmark per language. Arabic intentionally stays Hebrew for now.
  var BRAND_HE = 'אייכה<span class="dot"> ·</span> בר';

  var I18N = {
    he: {
      brand: BRAND_HE,
      tagline: "חריש · ישראל",
      navigate: "ניווט אלינו",
      menu: "תפריט דיגיטלי",
      instagram: "אינסטגרם",
      review: "השארת ביקורת",
      footer: "© אייכה בר",
      langName: "עברית",
    },
    en: {
      brand: "Ayeka Bar",
      tagline: "Harish · Israel",
      navigate: "Navigate to us",
      menu: "Digital menu",
      instagram: "Instagram",
      review: "Leave a review",
      footer: "© Ayeka Bar",
      langName: "English",
    },
    ar: {
      brand: BRAND_HE,          // Hebrew wordmark for now
      tagline: "حريش · إسرائيل",
      navigate: "الوصول إلينا",
      menu: "القائمة الرقمية",
      instagram: "إنستغرام",
      review: "اترك تقييماً",
      footer: "© אייכה בר",
      langName: "العربية",
    },
  };

  var ICONS = {
    navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"/><path d="M4 10h16"/><path d="M4 15h10"/><path d="M4 20h7"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L4.3 9.4l6-.9z"/></svg>',
  };
  var ARROW = '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  var CHEVRON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>';

  var ORDER = ["navigate", "menu", "instagram", "review"];

  // ---- styles for the navigation chooser (kept here so both portal pages share them) ----
  (function injectNavCSS() {
    var css =
      ".nav-wrap{width:100%}" +
      ".nav-toggle{width:100%}" +
      ".nav-toggle .chev{width:18px;height:18px;flex:0 0 auto;color:var(--text-faint);transition:transform .3s var(--ease),color .3s var(--ease)}" +
      ".nav-wrap.open .nav-toggle .chev{transform:rotate(180deg);color:var(--neon-soft)}" +
      ".nav-options{display:grid;grid-template-rows:0fr;transition:grid-template-rows .42s var(--ease)}" +
      ".nav-wrap.open .nav-options{grid-template-rows:1fr}" +
      ".nav-opts-inner{overflow:hidden;min-height:0}" +
      ".nav-list{display:flex;flex-direction:column;gap:8px;padding:8px 0 2px}" +
      ".nav-opt{display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:13px;border:1px solid var(--line);background:rgba(20,20,32,0.62);color:var(--text);text-decoration:none;font-weight:600;font-size:0.98rem;transition:border-color .2s var(--ease),background .2s var(--ease),transform .15s var(--ease)}" +
      ".nav-opt:hover{border-color:var(--line-strong);background:var(--bg-elev-2)}" +
      ".nav-opt:active{transform:scale(0.99)}" +
      ".nav-opt .pin{width:22px;height:22px;flex:0 0 auto;color:var(--neon-soft);display:grid;place-items:center}" +
      ".nav-opt .pin svg{width:20px;height:20px}" +
      ".nav-opt .label{flex:1;text-align:start}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  })();

  var lang = localStorage.getItem("siteLanguage");
  if (LANGS.indexOf(lang) === -1) lang = "he";

  function makeLinkBtn(key, t) {
    var a = document.createElement("a");
    a.className = "btn" + (key === "menu" ? " hero" : "");
    a.href = LINKS[key];
    if (key !== "menu") { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    a.innerHTML =
      '<span class="ic">' + ICONS[key] + "</span>" +
      '<span class="label">' + t[key] + "</span>" +
      ARROW;
    return a;
  }

  function makeNavWrap(t) {
    var wrap = document.createElement("div");
    wrap.className = "nav-wrap";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn nav-toggle";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      '<span class="ic">' + ICONS.navigate + "</span>" +
      '<span class="label">' + t.navigate + "</span>" +
      CHEVRON;

    var options = document.createElement("div");
    options.className = "nav-options";
    var inner = document.createElement("div");
    inner.className = "nav-opts-inner";
    var list = document.createElement("div");
    list.className = "nav-list";
    NAV_ORDER.forEach(function (p) {
      var a = document.createElement("a");
      a.className = "nav-opt";
      a.href = NAV[p];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = '<span class="pin">' + PIN + "</span><span class=\"label\">" + NAV_LABELS[p] + "</span>";
      list.appendChild(a);
    });
    inner.appendChild(list);
    options.appendChild(inner);

    btn.addEventListener("click", function () {
      var open = wrap.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    wrap.appendChild(btn);
    wrap.appendChild(options);
    return wrap;
  }

  function render() {
    var t = I18N[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";

    var brandEl = document.getElementById("brand");
    if (brandEl) brandEl.innerHTML = t.brand;
    document.getElementById("tagline").textContent = t.tagline;
    document.getElementById("footer").textContent = t.footer;

    var arrowRot = RTL[lang] ? "rotate(180deg)" : "none";

    // language menu
    var lm = document.getElementById("langMenu");
    lm.innerHTML = "";
    LANGS.forEach(function (l) {
      var b = document.createElement("button");
      b.className = "lang-opt" + (l === lang ? " active" : "");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = I18N[l].langName;
      b.addEventListener("click", function () {
        lang = l;
        localStorage.setItem("siteLanguage", l);
        closeLang();
        render();
      });
      lm.appendChild(b);
    });

    // action buttons (navigate expands into 3 map providers)
    var box = document.getElementById("actions");
    box.innerHTML = "";
    ORDER.forEach(function (key, i) {
      var node = (key === "navigate") ? makeNavWrap(t) : makeLinkBtn(key, t);
      node.classList.add("anim");
      node.style.setProperty("--d", (260 + i * 90) + "ms");
      box.appendChild(node);
    });
    // flip the ">" arrows for direction (chevron is vertical, unaffected)
    Array.prototype.forEach.call(document.querySelectorAll(".btn .arrow"), function (el) {
      el.style.transform = arrowRot;
    });
  }

  // ---- language dropdown ----
  var langWrap = document.getElementById("lang");
  var globeBtn = document.getElementById("globeBtn");
  function openLang() { langWrap.classList.add("open"); globeBtn.setAttribute("aria-expanded", "true"); }
  function closeLang() { langWrap.classList.remove("open"); globeBtn.setAttribute("aria-expanded", "false"); }
  globeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    langWrap.classList.contains("open") ? closeLang() : openLang();
  });
  document.addEventListener("click", function (e) { if (!langWrap.contains(e.target)) closeLang(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLang(); });

  render();
  // trigger entrance after first paint
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { document.body.classList.add("ready"); });
  });
})();
