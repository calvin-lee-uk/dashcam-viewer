/* ═══ State ══════════════════════════════════════════════ */
var allFiles  = {};
var rootName  = '';
var gpsPoints = [];
var ggaMap    = {};
var startUTC  = 0;
var leafMap   = null, gpsMarker = null;
var hasRear   = false, hasGPS = false;
var recsList  = [], activeRecIdx = -1;

/* Set timezone selector to system local offset */
(function() {
  var off = -(new Date().getTimezoneOffset()) / 60; /* minutes west → hours east */
  var sel = document.getElementById('sel-tz');
  /* find closest option value */
  var best = null, bestDist = Infinity;
  for (var i = 0; i < sel.options.length; i++) {
    var v = parseFloat(sel.options[i].value);
    var d = Math.abs(v - off);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best !== null) sel.selectedIndex = best;
  /* draw idle speedo once layout is ready */
  requestAnimationFrame(function(){
    drawSpeedo(0, document.getElementById('sel-spd').value);
    drawCompass(0);
  });
})();

var vF = document.getElementById('vf');
var vR = document.getElementById('vr');

/* ═══ Folder picker ══════════════════════════════════════ */
document.getElementById('folder-input').addEventListener('change', function(e) {
  allFiles = {};
  rootName = '';
  var files = e.target.files;
  if (!files || !files.length) return;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!rootName) rootName = f.webkitRelativePath.split('/')[0];
    allFiles[f.webkitRelativePath] = f;
  }

  document.getElementById('folder-path').textContent = rootName;
  scanRecordings();
});

function scanRecordings() {
  var recs = [];
  var re = new RegExp('^' + escRe(rootName) + '\\/F\\/HPIM(\\d{6})-(\\d{6})F\\.MOV$', 'i');
  for (var path in allFiles) {
    var m = path.match(re);
    if (m) {
      var d = m[1], t = m[2], base = 'HPIM' + d + '-' + t;
      var pR = rootName + '/R/' + base + 'R.MOV';
      var pN = rootName + '/F/' + base + 'F.NMEA';
      if (!allFiles[pN]) pN = rootName + '/' + base + 'F.NMEA';
      recs.push({ d: d, t: t, hasR: !!allFiles[pR], hasN: !!allFiles[pN] });
    }
  }
  recs.sort(function(a, b){ return (a.d + a.t) < (b.d + b.t) ? -1 : 1; });
  buildList(recs);
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ═══ Recording list ══════════════════════════════════════ */
function buildList(recs) {
  var listEl = document.getElementById('rec-list');
  if (!recs.length) {
    listEl.innerHTML = '<div class="rec-empty">No recordings found.<br>Expected files at<br>F/HPIM______-______F.MOV</div>';
    return;
  }
  listEl.innerHTML = '';
  recsList = recs;
  recs.forEach(function(r, idx) {
    var yy = r.d.slice(0,2), mo = r.d.slice(2,4), dd = r.d.slice(4,6);
    var hh = r.t.slice(0,2), mm = r.t.slice(2,4), ss = r.t.slice(4,6);
    var wkdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var wkday  = wkdays[new Date(2000+parseInt(yy), parseInt(mo)-1, parseInt(dd)).getDay()];
    var el = document.createElement('div');
    el.className = 'rec-item';
    el.innerHTML =
      '<div class="ri-date">20' + yy + '-' + mo + '-' + dd + '</div>' +
      '<div class="ri-wkday">' + wkday + '</div>' +
      '<div class="ri-time">' + hh + ':' + mm + ':' + ss + '</div>' +
      '<div class="ri-badges">' +
        '<span class="ri-badge' + (r.hasR ? '' : ' miss') + '">REAR</span>' +
        '<span class="ri-badge' + (r.hasN ? '' : ' miss') + '">GPS</span>' +
      '</div>';
    el.addEventListener('click', function() {
      document.querySelectorAll('.rec-item').forEach(function(x){ x.classList.remove('active'); });
      el.classList.add('active');
    });
    el.addEventListener('dblclick', function() {
      document.querySelectorAll('.rec-item').forEach(function(x){ x.classList.remove('active'); });
      el.classList.add('active');
      activeRecIdx = idx;
      loadRecording(r.d, r.t);
      if (document.getElementById('chk-advance').checked) {
        vF.addEventListener('loadedmetadata', function playOnce() {
          vF.removeEventListener('loadedmetadata', playOnce);
          vF.play().catch(function(){});
        });
      }
    });
    listEl.appendChild(el);
  });
}

/* ═══ Load recording ══════════════════════════════════════ */
function loadRecording(d, t) {
  var base = 'HPIM' + d + '-' + t;
  var pF   = rootName + '/F/' + base + 'F.MOV';
  var pR   = rootName + '/R/' + base + 'R.MOV';
  var pN   = rootName + '/F/' + base + 'F.NMEA';
  if (!allFiles[pN]) pN = rootName + '/' + base + 'F.NMEA';

  /* Front is the only hard requirement */
  if (!allFiles[pF]) {
    alert('Front video not found:\n  F/' + base + 'F.MOV\n\nCheck the selected folder.');
    return;
  }

  hasRear = !!allFiles[pR];
  hasGPS  = !!allFiles[pN];

  /* Reset state */
  gpsPoints = []; ggaMap = {}; startUTC = 0;
  if (vF.src) { URL.revokeObjectURL(vF.src); vF.src = ''; }
  if (vR.src) { URL.revokeObjectURL(vR.src); vR.src = ''; }

  /* Front video — always */
  vF.src = URL.createObjectURL(allFiles[pF]);

  /* Rear video — optional; box always stays same size as front */
  var rearVideo = document.getElementById('vr');
  var rearBlank = document.getElementById('vcam-rear-blank');
  if (hasRear) {
    vR.src = URL.createObjectURL(allFiles[pR]);
    rearVideo.style.display = '';
    rearBlank.style.display = 'none';
  } else {
    rearVideo.style.display = 'none';
    rearBlank.style.display = '';
  }

  /* NMEA / GPS — optional */
  if (hasGPS) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var parsed = parseNMEA(e.target.result);
      gpsPoints  = parsed.rmc;
      ggaMap     = parsed.gga;
      showPlayer();
      if (!gpsPoints.length) {
        setStatus(true, 'No valid GPS fixes in NMEA file', availNote());
        return;
      }
      startUTC = gpsPoints[0].utcSec;
      applyTimezoneFromFilename(t, startUTC);
      initMap();
      var dur = gpsPoints[gpsPoints.length - 1].utcSec - startUTC;
      setStatus(false,
        gpsPoints.length + ' GPS fixes \u00b7 ' + availNote(),
        'Duration ' + Math.round(dur) + 's \u00b7 Start UTC ' + fmtTime(startUTC, 0)
      );
      reverseGeocode(gpsPoints[0].lat, gpsPoints[0].lon);
    };
    reader.readAsText(allFiles[pN]);
  } else {
    showPlayer();
    setStatus(false, 'Playing \u00b7 ' + availNote(), 'No GPS log \u2014 map unavailable');
  }
}

function availNote() {
  var parts = ['Front'];
  if (hasRear) parts.push('Rear'); else parts.push('(no rear)');
  if (hasGPS)  parts.push('GPS');  else parts.push('(no GPS)');
  return parts.join(' \u00b7 ');
}

/* ═══ Timezone from filename ══════════════════════════════
   The dashcam writes local time into the filename (hhmmss).
   The first GPS fix gives us UTC.  Their difference is the offset.
══════════════════════════════════════════════════════════ */
function applyTimezoneFromFilename(t, utcSec) {
  /* t = 'hhmmss' string from filename */
  var hh = parseInt(t.slice(0, 2), 10);
  var mm = parseInt(t.slice(2, 4), 10);
  var ss = parseInt(t.slice(4, 6), 10);
  var localSec = hh * 3600 + mm * 60 + ss;

  var utcMidnight = utcSec % 86400;                 /* GPS UTC, seconds into day */
  var diffHours   = (localSec - utcMidnight) / 3600;

  /* normalise to −12 … +14 (crossing midnight gives ±24 artefacts) */
  if (diffHours >  14) diffHours -= 24;
  if (diffHours < -12) diffHours += 24;

  /* snap to nearest option in sel-tz */
  var sel  = document.getElementById('sel-tz');
  var best = 0, bestDist = Infinity;
  for (var i = 0; i < sel.options.length; i++) {
    var d = Math.abs(parseFloat(sel.options[i].value) - diffHours);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  sel.selectedIndex = best;
}

/* ═══ Reverse geocode (Nominatim, called once per recording) ═══ */
function reverseGeocode(lat, lon) {
  var locEl = document.getElementById('slocation');
  locEl.textContent = '';
  var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' +
            lat.toFixed(6) + '&lon=' + lon.toFixed(6) + '&zoom=16&addressdetails=1';
  fetch(url, { headers: { 'Accept-Language': 'en' } })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var a = data.address || {};
      /* Town: prefer city > town > village > suburb > county */
      var town = a.city || a.town || a.village || a.suburb || a.county || '';
      var postcode = a.postcode || '';
      var parts = [];
      if (postcode) parts.push(postcode);
      if (town)     parts.push(town);
      if (parts.length) locEl.textContent = '\u00b7 ' + parts.join(', ');

      /* UK uses mph — switch automatically */
      var selSpd = document.getElementById('sel-spd');
      if (['uk','gb'].includes((a.country_code || '').toLowerCase())) {
        if (selSpd.value !== 'mph') {
          selSpd.value = 'mph';
          /* redraw speedo with the new unit at current speed */
          updateTelemetry(vF.currentTime || 0);
        }
      } else {
        if (selSpd.value !== 'kmh') {
          selSpd.value = 'kmh';
          /* redraw speedo with the new unit at current speed */
          updateTelemetry(vF.currentTime || 0);
        }
      }
    })
    .catch(function(){ /* silently ignore — network may be unavailable */ });
}

/* ═══ NMEA parser ════════════════════════════════════════ */
function toSec(s) {
  return parseInt(s.slice(0,2)) * 3600 + parseInt(s.slice(2,4)) * 60 + parseFloat(s.slice(4));
}
function dmm(v, h) {
  var dot = v.indexOf('.');
  var deg = parseFloat(v.slice(0, dot - 2));
  var min = parseFloat(v.slice(dot - 2));
  var d   = deg + min / 60;
  return (h === 'S' || h === 'W') ? -d : d;
}
function parseNMEA(txt) {
  var rmc = [], gga = {};
  txt.split(/\r?\n/).forEach(function(ln) {
    ln = ln.trim();
    var star = ln.indexOf('*');
    var body = (star >= 0 ? ln.slice(1, star) : ln.slice(1));
    var p = body.split(','), id = p[0];
    if ((id === 'GPRMC' || id === 'GNRMC') && p[2] === 'A' && p[1] && p[3] && p[5]) {
      try {
        rmc.push({
          utcSec     : toSec(p[1]),
          lat        : dmm(p[3], p[4]),
          lon        : dmm(p[5], p[6]),
          speedKnots : parseFloat(p[7]) || 0,
          course     : parseFloat(p[8]) || 0
        });
      } catch(e) {}
    }
    if ((id === 'GPGGA' || id === 'GNGGA') && p[1] && p[6] !== '0') {
      try {
        var k = Math.round(toSec(p[1]));
        gga[k] = { sats: parseInt(p[7]) || 0, hdop: parseFloat(p[8]) || 0, alt: parseFloat(p[9]) || 0 };
      } catch(e) {}
    }
  });
  return { rmc: rmc, gga: gga };
}

/* ═══ Map ════════════════════════════════════════════════ */
function initMap() {
  if (leafMap) { leafMap.remove(); leafMap = null; }

  syncMapHeight();   /* set pixel height before Leaflet init */

  leafMap = L.map('map', { zoomSnap: 0.5 });

  /*
   * CARTO Voyager tiles — no Referer policy, works from file:// URLs.
   * This avoids the 403 "Referer required" error from OSM's volunteer servers.
   */
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains  : 'abcd',
    maxZoom     : 19
  }).addTo(leafMap);

  var lls = gpsPoints.map(function(p){ return [p.lat, p.lon]; });
  L.polyline(lls, { color: '#2a80c8', weight: 4, opacity: .85 }).addTo(leafMap);

  L.circleMarker(lls[0],
    { radius: 6, fillColor: '#5c9e2c', color: '#fff', weight: 2, fillOpacity: 1 })
   .bindTooltip('Start').addTo(leafMap);
  L.circleMarker(lls[lls.length - 1],
    { radius: 6, fillColor: '#c84820', color: '#fff', weight: 2, fillOpacity: 1 })
   .bindTooltip('End').addTo(leafMap);

  gpsMarker = L.marker(lls[0], {
    icon: L.divIcon({
      className  : '',
      html       : '<div style="width:13px;height:13px;background:#e05a30;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
      iconSize   : [13, 13],
      iconAnchor : [6, 6]
    }),
    zIndexOffset: 1000
  }).addTo(leafMap);

  leafMap.fitBounds(
    L.latLngBounds(lls),
    { padding: [20, 20] }
  );
}

function syncMapHeight() {
  var lowerRow = document.getElementById('lower-row');
  var mapEl    = document.getElementById('map');
  if (!lowerRow || !mapEl) return;
  var h = lowerRow.getBoundingClientRect().height;
  if (h > 0) {
    mapEl.style.height = h + 'px';
    if (leafMap) leafMap.invalidateSize();
  }
}

if (window.ResizeObserver) {
  new ResizeObserver(syncMapHeight).observe(document.getElementById('lower-row'));
}

/* ═══ Telemetry update ═══════════════════════════════════ */
function nearest(sec) {
  var pts = gpsPoints, lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (pts[mid].utcSec < sec) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(pts[lo-1].utcSec - sec) < Math.abs(pts[lo].utcSec - sec)) return pts[lo-1];
  return pts[lo];
}

function updateTelemetry(videoTime) {
  if (!gpsPoints.length) return;
  var sec = startUTC + videoTime;
  var p   = nearest(sec);

  if (leafMap && gpsMarker) {
    gpsMarker.setLatLng([p.lat, p.lon]);
    if (!leafMap.getBounds().contains([p.lat, p.lon]))
      leafMap.panTo([p.lat, p.lon], { animate: true, duration: .4 });
  }

  /* speed */
  var unit = document.getElementById('sel-spd').value;
  var spd, spdLbl;
  if      (unit === 'mph') { spd = p.speedKnots * 1.15078; spdLbl = 'mph'; }
  else if (unit === 'kn')  { spd = p.speedKnots;           spdLbl = 'kn';  }
  else                     { spd = p.speedKnots * 1.852;   spdLbl = 'km/h';}
  document.getElementById('tel-spd').textContent   = spd.toFixed(1);
  document.getElementById('tel-spd-u').textContent = ' ' + spdLbl;
  drawSpeedo(spd, unit);

  /* time + timezone */
  var tzOff = parseFloat(document.getElementById('sel-tz').value) || 0;
  document.getElementById('tel-time').textContent     = fmtTime(sec, tzOff);
  document.getElementById('tel-time-lbl').textContent = 'Time (' + tzLbl(tzOff) + ')';

  /* position */
  document.getElementById('tel-lat').textContent = p.lat.toFixed(5) + '\u00b0';
  document.getElementById('tel-lon').textContent = p.lon.toFixed(5) + '\u00b0';
  document.getElementById('tel-crs').textContent = Math.round(p.course);
  drawCompass(p.course);

  /* GGA extras */
  var g = ggaMap[Math.round(sec)];
  if (g) {
    document.getElementById('tel-alt').textContent  = g.alt.toFixed(1);
    document.getElementById('tel-sat').textContent  = g.sats;
    document.getElementById('tel-hdop').textContent = g.hdop.toFixed(1);
  }
}

/* ═══ Speedometer ════════════════════════════════════════ */
function drawSpeedo(spd, unit) {
  var canvas = document.getElementById('speedo');
  if (!canvas) return;

  var dpr = window.devicePixelRatio || 1;
  var W   = canvas.parentElement.clientWidth - 16;
  canvas.width  = W * dpr;
  canvas.height = W * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = W + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, W);

  /* Gauge pivot = bezel centre = canvas centre */
  var cx = W / 2, cy = W / 2;
  var Rb = W * 0.46;   /* bezel radius — matches compass */

  /* Arc track width; outer edge of track sits flush with bezel inner edge.
     track outer edge = Rg + tw/2 = Rb  →  Rg = Rb - tw/2
     tw = Rg * 0.20  →  Rg + Rg*0.10 = Rb  →  Rg = Rb / 1.10            */
  var Rg  = Rb / 1.10;
  var tw  = Rg * 0.20;   /* track stroke width */

  var startA = Math.PI * 7 / 6;    /* 210° */
  var endA   = Math.PI * 11 / 6;   /* 330° */
  var sweep  = (endA - startA + 2 * Math.PI) % (2 * Math.PI); /* 240° */

  var maxSpd  = unit === 'mph' ? 100 : unit === 'kn' ? 87 : 160;
  var frac    = Math.min(Math.max(spd / maxSpd, 0), 1);
  var needleA = startA + frac * sweep;

  var tickCount = unit === 'mph' ? 10 : unit === 'kn' ? 9 : 8;
  var tickStep  = unit === 'mph' ? 10 : unit === 'kn' ? 10 : 20;

  /* ── outer bezel circle ── */
  ctx.beginPath();
  ctx.arc(cx, cy, Rb, 0, Math.PI * 2);
  ctx.strokeStyle = '#d0cfc8';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  /* ── gauge background track — centred on same point, flush with bezel ── */
  ctx.beginPath();
  ctx.arc(cx, cy, Rg, startA, endA, false);
  ctx.strokeStyle = '#e2e2dd';
  ctx.lineWidth   = tw;
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* ── gauge value arc ── */
  var arcColor = frac < 0.6 ? '#5c9e2c' : frac < 0.8 ? '#d08c10' : '#c84820';
  if (frac > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, Rg, startA, needleA, false);
    ctx.strokeStyle = arcColor;
    ctx.lineWidth   = tw;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }

  /* ── tick marks & labels (along the inner face of the arc) ── */
  for (var i = 0; i <= tickCount; i++) {
    var tv    = i * tickStep;
    var tf    = Math.min(tv / maxSpd, 1);
    var ta    = startA + tf * sweep;
    var major = (i % 2 === 0);
    var outer = Rg - tw * 0.5;           /* inner edge of track */
    var inner = major ? outer - Rg * 0.12 : outer - Rg * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ta) * inner, cy + Math.sin(ta) * inner);
    ctx.lineTo(cx + Math.cos(ta) * outer, cy + Math.sin(ta) * outer);
    ctx.strokeStyle = major ? '#999' : '#bbb';
    ctx.lineWidth   = major ? 1.5 : 0.8;
    ctx.lineCap     = 'square';
    ctx.stroke();

    if (major) {
      var lr = inner - Rg * 0.13;
      ctx.fillStyle    = '#aaa';
      ctx.font         = 'bold ' + Math.round(Rg * 0.17) + 'px system-ui,Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tv, cx + Math.cos(ta) * lr, cy + Math.sin(ta) * lr);
    }
  }

  /* ── needle (from centre outward) ── */
  var nLen  = Rg * 0.80;
  var nBack = Rg * 0.15;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(needleA) * nBack, cy - Math.sin(needleA) * nBack);
  ctx.lineTo(cx + Math.cos(needleA) * nLen,  cy + Math.sin(needleA) * nLen);
  ctx.strokeStyle = '#e05a30';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* ── centre cap ── */
  ctx.beginPath();
  ctx.arc(cx, cy, Rg * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#e05a30';
  ctx.fill();

  /* ── speed readout in the lower half of the circle ── */
  ctx.fillStyle    = '#1a1a1a';
  ctx.font         = 'bold ' + Math.round(Rg * 0.40) + 'px system-ui,Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(spd), cx, cy + Rg * 0.30);

  ctx.fillStyle    = '#aaa';
  ctx.font         = Math.round(Rg * 0.18) + 'px system-ui,Arial';
  ctx.fillText(unit, cx, cy + Rg * 0.55);
}

/* ═══ Compass ════════════════════════════════════════════ */
function drawCompass(course) {
  var canvas = document.getElementById('compass');
  if (!canvas) return;

  var dpr = window.devicePixelRatio || 1;
  var W   = canvas.parentElement.clientWidth - 16;
  canvas.width  = W * dpr;
  canvas.height = W * dpr;          /* square */
  canvas.style.width  = W + 'px';
  canvas.style.height = W + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, W);

  var cx = W / 2, cy = W / 2;
  var R  = W * 0.46;
  var deg = course || 0;

  /* ── outer bezel ── */
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#d0cfc8';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  /* ── tick marks every 5°, long every 30° ── */
  for (var a = 0; a < 360; a += 5) {
    var rad   = (a - 90) * Math.PI / 180;
    var major = (a % 30 === 0);
    var inner = major ? R * 0.80 : R * 0.88;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
    ctx.lineTo(cx + Math.cos(rad) * R,     cy + Math.sin(rad) * R);
    ctx.strokeStyle = major ? '#aaa' : '#ddd';
    ctx.lineWidth   = major ? 1.2 : 0.6;
    ctx.stroke();
  }

  /* ── cardinal & intercardinal labels ── */
  var labels = [
    { t: 'N',  a:   0, sz: R * 0.26, bold: true,  color: '#c84820' },
    { t: 'NE', a:  45, sz: R * 0.16, bold: false, color: '#888' },
    { t: 'E',  a:  90, sz: R * 0.22, bold: true,  color: '#555' },
    { t: 'SE', a: 135, sz: R * 0.16, bold: false, color: '#888' },
    { t: 'S',  a: 180, sz: R * 0.22, bold: true,  color: '#555' },
    { t: 'SW', a: 225, sz: R * 0.16, bold: false, color: '#888' },
    { t: 'W',  a: 270, sz: R * 0.22, bold: true,  color: '#555' },
    { t: 'NW', a: 315, sz: R * 0.16, bold: false, color: '#888' }
  ];
  labels.forEach(function(lb) {
    var rad = (lb.a - 90) * Math.PI / 180;
    var lr  = R * 0.65;
    ctx.fillStyle    = lb.color;
    ctx.font         = (lb.bold ? 'bold ' : '') + Math.round(lb.sz) + 'px system-ui,Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lb.t, cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
  });

  /* ── needle — red North tip, grey South tail ── */
  var nLen = R * 0.50, sLen = R * 0.30, hw = R * 0.07;
  var nRad = (deg - 90) * Math.PI / 180; /* North tip direction */
  var sRad = nRad + Math.PI;              /* South tail direction */
  var px   = Math.cos(nRad), py = Math.sin(nRad);  /* unit vector North */
  var sx   = Math.cos(sRad), sy = Math.sin(sRad);  /* unit vector South */
  /* perpendicular for arrowhead width */
  var perpx = -py, perpy = px;

  /* North (red) arrowhead */
  ctx.beginPath();
  ctx.moveTo(cx + px * nLen, cy + py * nLen);
  ctx.lineTo(cx + perpx * hw, cy + perpy * hw);
  ctx.lineTo(cx - perpx * hw, cy - perpy * hw);
  ctx.closePath();
  ctx.fillStyle = '#c84820';
  ctx.fill();

  /* South (grey) tail */
  ctx.beginPath();
  ctx.moveTo(cx + sx * sLen, cy + sy * sLen);
  ctx.lineTo(cx + perpx * hw, cy + perpy * hw);
  ctx.lineTo(cx - perpx * hw, cy - perpy * hw);
  ctx.closePath();
  ctx.fillStyle = '#ccc';
  ctx.fill();

  /* ── centre cap ── */
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = '#888';
  ctx.fill();

  /* ── heading readout ── */
  ctx.fillStyle    = '#1a1a1a';
  ctx.font         = 'bold ' + Math.round(R * 0.22) + 'px system-ui,Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(deg) + '\u00b0', cx, cy);
}

function fmtTime(utcSec, offsetHr) {
  var s = Math.floor(utcSec + offsetHr * 3600) % 86400;
  if (s < 0) s += 86400;
  return pad(Math.floor(s/3600)) + ':' + pad(Math.floor((s%3600)/60)) + ':' + pad(Math.floor(s%60));
}
function tzLbl(off) {
  if (off === 0) return 'UTC';
  var abs = Math.abs(off), h = Math.floor(abs), m = Math.round((abs - h) * 60);
  return (off > 0 ? 'UTC+' : 'UTC\u2212') + h + (m ? ':' + pad(m) : '');
}
function pad(n){ return String(Math.floor(n)).padStart(2, '0'); }

document.getElementById('sel-tz').addEventListener('change',  function(){ updateTelemetry(vF.currentTime || 0); });
document.getElementById('sel-spd').addEventListener('change', function(){
  updateTelemetry(vF.currentTime || 0);
  if (!gpsPoints.length) drawSpeedo(0, document.getElementById('sel-spd').value);
});

/* ═══ Video sync ═════════════════════════════════════════
   syncTarget tracks which video WE just programmatically seeked.
   When that video's 'seeked' fires we know it was ours — clear
   the flag and ignore it, preventing the feedback loop that was
   causing playback to stall.
══════════════════════════════════════════════════════════ */
var syncTarget = null; /* 'rear' | 'front' | null */

function doSync(video, t) {
  if (Math.abs(video.currentTime - t) < 0.5) return;
  syncTarget = (video === vR) ? 'rear' : 'front';
  video.currentTime = t;
}

vF.addEventListener('play',  function() { if (hasRear) { doSync(vR, vF.currentTime); vR.play().catch(function(){}); } });
vF.addEventListener('pause', function() { if (hasRear) vR.pause(); });
vF.addEventListener('seeked', function() {
  if (syncTarget === 'front') { syncTarget = null; return; } /* our own seek, ignore */
  if (hasRear) doSync(vR, vF.currentTime);
});

vR.addEventListener('play',  function() { if (hasRear) vF.play().catch(function(){}); });
vR.addEventListener('pause', function() { if (hasRear) vF.pause(); });
vR.addEventListener('seeked', function() {
  if (syncTarget === 'rear') { syncTarget = null; return; } /* our own seek, ignore */
  if (hasRear) doSync(vF, vR.currentTime);
});

vF.addEventListener('timeupdate', function() {
  if (hasGPS) updateTelemetry(vF.currentTime);
});

vF.addEventListener('ended', function() {
  if (!document.getElementById('chk-advance').checked) return;
  var next = activeRecIdx + 1;
  if (next >= recsList.length) return;
  var r = recsList[next];
  activeRecIdx = next;
  /* update sidebar highlight */
  var items = document.querySelectorAll('.rec-item');
  items.forEach(function(x){ x.classList.remove('active'); });
  if (items[next]) {
    items[next].classList.add('active');
    items[next].scrollIntoView({ block: 'nearest' });
  }
  loadRecording(r.d, r.t);
  /* auto-play once metadata is ready */
  vF.addEventListener('loadedmetadata', function playOnce() {
    vF.removeEventListener('loadedmetadata', playOnce);
    vF.play().catch(function(){});
  });
});

/* ═══ Show player ════════════════════════════════════════ */
function showPlayer() {
  document.getElementById('placeholder').style.display = 'none';
  if (hasGPS) requestAnimationFrame(function(){ setTimeout(syncMapHeight, 60); });
}

function setStatus(warn, msg, detail) {
  document.getElementById('sdot').className      = 'dot' + (warn ? ' w' : '');
  document.getElementById('smsg').textContent    = msg;
  document.getElementById('sdetail').textContent = detail;
}
