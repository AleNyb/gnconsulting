/* Gounari & Nyberg — front-end behaviour.
   Small and dependency-free: theme, nav, scroll state, reveals, contact form. */

(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------------------------- theme ---------------------------- */

  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('gn-theme', next); } catch (e) {}
    });
  }

  /* -------------------------- mobile nav -------------------------- */

  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');

  function closeNav() {
    if (!nav) return;
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', function (event) {
      if (event.target.tagName === 'A') closeNav();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeNav();
    });
  }

  /* ------------------- sticky header + active link ---------------- */

  var header = document.getElementById('siteHeader');
  var onScroll = function () {
    if (header) header.classList.toggle('is-stuck', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]')) : [];
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          navLinks.forEach(function (link) {
            link.classList.toggle('is-active', link.getAttribute('href') === '#' + entry.target.id);
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach(function (section) { spy.observe(section); });
  }

  /* --------------------------- reveals ---------------------------- */

  var revealTargets = [];
  document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child) { revealTargets.push(child); });
  });
  document.querySelectorAll('.section-head, .hero-copy, .snapshot, .contact-intro, .contact-form').forEach(function (el) {
    revealTargets.push(el);
  });

  if ('IntersectionObserver' in window) {
    revealTargets.forEach(function (el, i) {
      el.setAttribute('data-reveal', '');
      el.style.transitionDelay = (i % 6) * 55 + 'ms';
    });
    var revealer = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    revealTargets.forEach(function (el) { revealer.observe(el); });

    // Safety net: never leave content invisible if the observer misbehaves.
    window.setTimeout(function () {
      revealTargets.forEach(function (el) { el.classList.add('is-visible'); });
    }, 2500);
  }

  /* ------------------------- contact form ------------------------- */

  var form = document.getElementById('contactForm');
  var status = document.getElementById('formStatus');
  var submitBtn = document.getElementById('submitBtn');

  function clearErrors() {
    form.querySelectorAll('.field-error').forEach(function (el) { el.textContent = ''; });
    form.querySelectorAll('.field').forEach(function (el) { el.classList.remove('has-error'); });
  }

  function showErrors(errors) {
    Object.keys(errors).forEach(function (key) {
      var slot = form.querySelector('[data-error-for="' + key + '"]');
      if (!slot) return;
      slot.textContent = errors[key];
      slot.closest('.field').classList.add('has-error');
    });
    var first = form.querySelector('.field.has-error input, .field.has-error textarea');
    if (first) first.focus();
  }

  function mailtoFallback(payload) {
    var subject = 'Consultation enquiry' + (payload.topic ? ' — ' + payload.topic : '');
    var body = [
      'Name: ' + (payload.name || ''),
      'Company: ' + (payload.company || '—'),
      'Email: ' + (payload.email || ''),
      '',
      payload.message || ''
    ].join('\n');
    return 'mailto:hello@gounarinyberg.co?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearErrors();
      setStatus('', '');

      var payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });

      submitBtn.disabled = true;
      var label = submitBtn.innerHTML;
      submitBtn.textContent = 'Sending…';

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().then(function (data) { return { ok: response.ok, data: data }; });
        })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            form.reset();
            setStatus(result.data.message, 'ok');
            return;
          }
          if (result.data.errors) showErrors(result.data.errors);
          setStatus(result.data.message || 'Something went wrong. Please try again.', 'error');
        })
        .catch(function () {
          // No backend reachable (e.g. the shared static preview) — hand the
          // visitor a pre-filled email instead of losing what they wrote.
          setStatus('We could not reach the server. ', 'error');
          var link = document.createElement('a');
          link.href = mailtoFallback(payload);
          link.textContent = 'Send this as an email instead';
          status.appendChild(link);
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = label;
        });
    });
  }

  /* ---------------------------- misc ------------------------------ */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
