const NTFY_HOST = "ntfy.sh";
const TOPIC_PREFIX = "mobtrazilica-";
const SEND_INTERVAL_MS = 5000;
const STALE_MS = 30000;
const NEAR_M = 15;
const ALT_THRESHOLD_M = 4;

const $ = (id) => document.getElementById(id);
const setup = $("setup");
const main = $("main");
const roomInput = $("roomInput");
const nameInput = $("nameInput");
const joinBtn = $("joinBtn");
const compassBtn = $("compassBtn");
const arrow = $("arrow");
const distLine = $("distLine");
const infoLine = $("infoLine");
const peerName = $("peerName");
const statusDot = $("statusDot");
const vertBlock = $("vertBlock");
const vertIcon = $("vertIcon");
const vertText = $("vertText");

const needsCompassPermission =
  typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
const myId = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const altSamples = [];

let topic = "";
let myName = "";
let myPos = null;
let peer = null;
let heading = null;
let geoProblem = "";
let arrowAngle = 0;
let renderQueued = false;
let compassListening = false;

function cleanCode(code) {
  return code
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64 - TOPIC_PREFIX.length);
}

function haversineM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function bearingDeg(from, to) {
  const rad = Math.PI / 180;
  const lat1 = from.lat * rad;
  const lat2 = to.lat * rad;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function formatDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
  return typeof window.orientation === "number" ? window.orientation : 0;
}

function rotateArrow(target) {
  arrowAngle += ((((target - arrowAngle) % 360) + 540) % 360) - 180;
  arrow.style.transform = `rotate(${arrowAngle}deg)`;
}

function setVertical(icon, text, cls = "") {
  vertBlock.className = `vert ${cls}`;
  vertIcon.textContent = icon;
  vertText.textContent = text;
}

function renderVertical() {
  if (myPos.alt == null || peer.alt == null) {
    setVertical("—", "Visina: GPS je trenutno ne daje");
    return;
  }
  const delta = peer.alt - myPos.alt;
  const m = Math.round(Math.abs(delta));
  const rough = (myPos.altAcc ?? 99) > 15 || (peer.altAcc ?? 99) > 15 ? " (grubo)" : "";
  const who = peerName.textContent;
  if (delta > ALT_THRESHOLD_M) setVertical("▲ GORE", `${who} je ~${m} m više${rough}`, "up");
  else if (delta < -ALT_THRESHOLD_M) setVertical("▼ DOLJE", `${who} je ~${m} m niže${rough}`, "down");
  else setVertical("= ISTA VISINA", `razlika ~${m} m${rough}`);
}

function render() {
  const peerAge = peer ? Date.now() - peer.at : Infinity;
  statusDot.className = `dot ${peerAge < STALE_MS ? "live" : peer ? "stale" : ""}`;

  if (!myPos || !peer) {
    arrow.classList.add("idle");
    distLine.textContent = myPos ? "Čekam drugu osobu…" : geoProblem || "Tražim tvoj GPS…";
    infoLine.textContent = peer ? "" : "Druga osoba treba otvoriti app s istim kodom.";
    setVertical("", "");
    return;
  }

  const d = haversineM(myPos, peer);
  const acc = Math.round(Math.max(myPos.acc, peer.acc || 0));
  distLine.textContent = d <= Math.max(NEAR_M, acc) ? `Blizu ste (~${Math.round(d)} m)` : formatDist(d);

  rotateArrow(bearingDeg(myPos, peer) - (heading ?? 0));
  arrow.classList.toggle("idle", peerAge > STALE_MS);

  const secs = Math.round(peerAge / 1000);
  const parts = [`GPS ±${acc} m`, secs < 8 ? "uživo" : `prije ${secs} s`];
  if (heading == null) parts.push("bez kompasa: vrh mobitela = sjever");
  infoLine.textContent = parts.join(" · ");

  renderVertical();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function publish() {
  if (!topic || !myPos) return;
  const body = JSON.stringify({ id: myId, name: myName, ...myPos });
  fetch(`https://${NTFY_HOST}/${topic}`, { method: "POST", body }).catch(() => {});
}

function connect() {
  const ws = new WebSocket(`wss://${NTFY_HOST}/${topic}/ws`);
  ws.onmessage = (ev) => {
    let msg;
    try {
      const data = JSON.parse(ev.data);
      if (data.event !== "message") return;
      msg = JSON.parse(data.message);
    } catch {
      return;
    }
    if (!msg || msg.id === myId || typeof msg.lat !== "number") return;
    peer = { ...msg, at: Date.now() };
    peerName.textContent = msg.name || "Druga osoba";
    scheduleRender();
  };
  ws.onclose = () => setTimeout(connect, 3000);
}

function onGeo(pos) {
  const c = pos.coords;
  if (c.altitude == null) {
    altSamples.length = 0;
  } else {
    altSamples.push(c.altitude);
    if (altSamples.length > 5) altSamples.shift();
  }
  const first = !myPos;
  myPos = {
    lat: c.latitude,
    lng: c.longitude,
    acc: Math.round(c.accuracy),
    alt: altSamples.length ? altSamples.reduce((sum, a) => sum + a, 0) / altSamples.length : null,
    altAcc: c.altitudeAccuracy == null ? null : Math.round(c.altitudeAccuracy),
  };
  geoProblem = "";
  if (first) publish();
  scheduleRender();
}

function onGeoError(err) {
  geoProblem = err.code === 1 ? "Dozvoli lokaciju za ovu stranicu" : "GPS je slab, pričekaj malo…";
  scheduleRender();
}

function setHeading(raw) {
  heading = (raw + screenAngle() + 360) % 360;
  scheduleRender();
}

function listenCompass() {
  if (compassListening) return;
  compassListening = true;
  const hasAbsolute = "ondeviceorientationabsolute" in window;
  if (hasAbsolute) {
    window.addEventListener("deviceorientationabsolute", (e) => {
      if (e.alpha != null) setHeading(360 - e.alpha);
    });
  }
  window.addEventListener("deviceorientation", (e) => {
    if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
    else if (!hasAbsolute && e.absolute && e.alpha != null) setHeading(360 - e.alpha);
  });
}

function startCompass() {
  if (!needsCompassPermission) {
    listenCompass();
    return;
  }
  DeviceOrientationEvent.requestPermission()
    .then((state) => {
      compassBtn.classList.toggle("hidden", state === "granted");
      if (state === "granted") listenCompass();
    })
    .catch(() => compassBtn.classList.remove("hidden"));
}

async function keepScreenOn() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}

async function shareLink() {
  const code = cleanCode(roomInput.value);
  if (!code) {
    alert("Prvo upiši zajednički kod.");
    return;
  }
  localStorage.setItem("mt_room", code);
  const url = `${location.origin}${location.pathname}#k=${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Mob Trazilica", text: "Otvori da se nađemo u trgovini:", url });
    } catch {}
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("Link je kopiran, zalijepi ga u poruku.");
  } catch {
    prompt("Kopiraj ovaj link i pošalji ga:", url);
  }
}

function join() {
  const code = cleanCode(roomInput.value);
  if (code.replace(/[-_]/g, "").length < 4) {
    alert("Upiši zajednički kod (barem 4 slova ili broja), isti na oba mobitela.");
    return;
  }
  startCompass();
  myName = nameInput.value.trim();
  roomInput.value = code;
  localStorage.setItem("mt_room", code);
  localStorage.setItem("mt_name", myName);
  topic = TOPIC_PREFIX + code;

  setup.classList.add("hidden");
  main.classList.remove("hidden");
  keepScreenOn();
  connect();
  navigator.geolocation.watchPosition(onGeo, onGeoError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  setInterval(publish, SEND_INTERVAL_MS);
  setInterval(scheduleRender, 1000);
  render();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !topic) return;
  keepScreenOn();
  publish();
});

roomInput.value = cleanCode(new URLSearchParams(location.hash.slice(1)).get("k") || localStorage.getItem("mt_room") || "");
nameInput.value = localStorage.getItem("mt_name") || "";
joinBtn.addEventListener("click", join);
compassBtn.addEventListener("click", startCompass);
document.querySelectorAll(".share-btn").forEach((btn) => btn.addEventListener("click", shareLink));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
