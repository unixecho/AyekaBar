// Shared portal behavior for the desktop (index.html) and mobile
// (portal-mobile.html) entry pages. Layout/scaling lives in each HTML file's
// CSS; all content + i18n + link wiring lives here so there's one source of truth.
(function () {
  "use strict";

  // ---- External destinations. Replace placeholders with real URLs. ----
  var LINKS = {
    navigate:  "#",            // ⚠️ placeholder — maps/Waze link (needs address/coords)
    menu:      "menu.html",    // internal — the digital menu
    instagram: "#",            // ⚠️ placeholder — Instagram profile
    review:    "#",            // ⚠️ placeholder — Google "write a review" link
  };

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

  var ORDER = ["navigate", "menu", "instagram", "review"];

  var lang = localStorage.getItem("siteLanguage");
  if (LANGS.indexOf(lang) === -1) lang = "he";

  function render() {
    var t = I18N[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";

    var brandEl = document.getElementById("brand");
    if (brandEl) brandEl.innerHTML = t.brand;
    document.getElementById("tagline").textContent = t.tagline;
    document.getElementById("footer").textContent = t.footer;

    // arrow flips with direction
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

    // action buttons
    var box = document.getElementById("actions");
    box.innerHTML = "";
    ORDER.forEach(function (key, i) {
      var a = document.createElement("a");
      a.className = "btn anim" + (key === "menu" ? " hero" : "");
      a.href = LINKS[key];
      a.style.setProperty("--d", (260 + i * 90) + "ms");
      if (key === "instagram" || key === "review" || key === "navigate") {
        a.target = "_blank"; a.rel = "noopener noreferrer";
      }
      a.innerHTML =
        '<span class="ic">' + ICONS[key] + "</span>" +
        '<span class="label">' + t[key] + "</span>" +
        ARROW;
      box.appendChild(a);
    });
    // flip arrows for direction
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
