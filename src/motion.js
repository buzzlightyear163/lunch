/* LUNCH motion: grain, section reveals, count-ups and bar growth. Everything is visible without it. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // film grain, generated once
  try {
    var g = document.querySelector('.grain');
    if (g) {
      var c = document.createElement('canvas'); c.width = c.height = 220;
      var x = c.getContext('2d'), img = x.createImageData(220, 220);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.random() * 255 | 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      g.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    }
  } catch (e) {}

  if (reduce || !('IntersectionObserver' in window)) return;

  var vh = window.innerHeight;
  function below(el) { return el.getBoundingClientRect().top > vh * 0.92; }

  // sections slide up as they enter (only ones that start below the fold)
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' });
  Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) {
    if (below(el)) { el.classList.add('pre'); io.observe(el); }
  });

  // numbers count up to their printed value
  function fmt(v, dec, suf) {
    var s = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
    return s + (suf || '');
  }
  function count(el) {
    var to = parseFloat(el.getAttribute('data-count')), dec = +el.getAttribute('data-dec') || 0, suf = el.getAttribute('data-suf') || '';
    var t0 = null, dur = 1400;
    function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(to * e, dec, suf);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to, dec, suf);
    }
    requestAnimationFrame(step);
  }
  var co = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { count(e.target); co.unobserve(e.target); } });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) { co.observe(el); });

  // evidence bars grow from zero when the chart comes into view
  var chart = document.getElementById('barChart');
  function armBars() {
    if (!chart) return;
    var bars = chart.querySelectorAll('.track i');
    if (!bars.length || !below(chart)) return;
    var finals = [];
    Array.prototype.forEach.call(bars, function (b, i) { finals[i] = b.style.transform; b.style.transition = 'none'; b.style.transform = 'scaleX(0)'; });
    chart.offsetWidth;
    Array.prototype.forEach.call(bars, function (b) { b.style.transition = ''; });
    var bo = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      Array.prototype.forEach.call(bars, function (b, i) { b.style.transitionDelay = (i * 70) + 'ms'; b.style.transform = finals[i]; });
      bo.disconnect();
    }, { threshold: 0.35 });
    bo.observe(chart);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armBars); else setTimeout(armBars, 0);
})();
