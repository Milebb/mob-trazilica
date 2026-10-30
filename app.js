const NTFY = "https://ntfy.sh";
const SEND_INTERVAL_MS = 2500;
const ALT_THRESHOLD_M = 2.5;

const setup = document.getElementById("setup");
const main = document.getElementById("main");
const roomInput = document.getElementById("roomInput");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const arrow = document.getElementById("arrow");
const distLine = document.getElementById("distLine");
const altLine = document.getElementById("altLine");
const peerName = document.getElementById("peerName");
const statusDot = document.getElementById("statusDot");
const vertBlock = document.getElementById("vertBlock");
const vertIcon = document.getElementById("vertIcon");
const vertText = document.getElementById("vertText");

let room = "";
let myName = "";
let myPos = null;
let peerPos = null;
let peerLabel = "Druga osoba";
let heading = null;
let ws = null;
let geoWatch = null;
let sendTimer = null;

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function formatDist(m) {
  if (m < 1) return "Ovdje ste blizu";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatAltDelta(delta) {
  const a = Math.abs(delta);
  if (a < ALT_THRESHOLD_M) return "Ista visina (±GPS)";
  return `${Math.round(a)} m ${delta > 0 ? "više" : "niže"}`;
}

function updateUI() {
  if (!myPos || !peerPos) {
    distLine.textContent = peerPos ? "Čekam tvoju lokaciju…" : "Čekam drugu osobu…";
    altLine.textContent = "";
    vertBlock.className = "vert";
    vertIcon.textContent = "…";
    vertText.textContent = "Kad se oboje spojite, strelica radi.";
    return;
  }

  const d = haversineM(myPos, peerPos);
  distLine.textContent = formatDist(d);

  const b = bearingDeg(myPos, peerPos);
  const rot = heading != null ? b - heading : b;
  arrow.style.transform = `rotate(${rot}deg)`;

  const myAlt = myPos.alt;
  const peerAlt = peerPos.alt;
  if (myAlt != null && peerAlt != null && !Number.isNaN(myAlt) && !Number.isNaN(peerAlt)) {
    const delta = peerAlt - myAlt;
    altLine.textContent = `Visina: ${formatAltDelta(delta)}`;
    if (delta > ALT_THRESHOLD_M) {
      vertBlock.className = "vert up";
      vertIcon.textContent = "▲";
      vertText.textContent = "Gore — druga osoba je više";
    } else if (delta < -ALT_THRESHOLD_M) {
      vertBlock.className = "vert down";
      vertIcon.textContent = "▼";
      vertText.textContent = "Dolje — druga osoba je niže";
    } else {
      vertBlock.className = "vert same";
      vertIcon.textContent = "●";
      vertText.textContent = "Isti sprat / ista visina";
    }
  } else {
    altLine.textContent = "Visina: GPS nema podatak (npr. unutra)";
    vertBlock.className = "vert same";
    vertIcon.textContent = "—";
    vertText.textContent = "Koristi udaljenost i strelicu";
  }
}

async function publish(payload) {
  const topic = encodeURIComponent(room);
  await fetch(`${NTFY}/${topic}`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { Title: "loc", Priority: "2" },
  });
}

function connectWs() {
  const topic = encodeURIComponent(room);
  ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.event !== "message" || !data.message) return;
      const msg = JSON.parse(data.message);
      if (msg.name === myName) return;
      peerLabel = msg.name || peerLabel;
      peerName.textContent = peerLabel;
      peerPos = { lat: msg.lat, lng: msg.lng, alt: msg.alt ?? null, t: msg.t };
      updateUI();
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    setTimeout(connectWs, 2000);
  };
}

function onGeo(pos) {
  myPos = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    alt: pos.coords.altitude,
    acc: pos.coords.accuracy,
    t: Date.now(),
  };
  updateUI();
}

async function startCompass() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== "granted") return;
    } catch {
      return;
    }
  }

  window.addEventListener(
    "deviceorientationabsolute",
    (e) => {
      if (e.alpha != null && e.absolute) {
        heading = (360 - e.alpha) % 360;
        updateUI();
      }
    },
    true
  );

  window.addEventListener(
    "deviceorientation",
    (e) => {
      if (e.webkitCompassHeading != null) {
        heading = e.webkitCompassHeading;
        updateUI();
      } else if (e.alpha != null && heading == null) {
        heading = (360 - e.alpha) % 360;
        updateUI();
      }
    },
    true
  );
}

joinBtn.addEventListener("click", async () => {
  room = roomInput.value.trim();
  myName = nameInput.value.trim() || "Ja";
  if (room.length < 6) {
    alert("Kod sobe: barem 6 znakova, teško pogodljiv (npr. trgovina-ana-4829).");
    return;
  }

  setup.classList.add("hidden");
  main.classList.remove("hidden");
  peerName.textContent = "Tražim…";
  statusDot.className = "dot live";

  await startCompass();
  connectWs();

  geoWatch = navigator.geolocation.watchPosition(onGeo, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });

  sendTimer = setInterval(() => {
    if (!myPos) return;
    publish({
      name: myName,
      lat: myPos.lat,
      lng: myPos.lng,
      alt: myPos.alt,
      t: Date.now(),
    }).catch(() => {});
  }, SEND_INTERVAL_MS);

});

const savedRoom = localStorage.getItem("mt_room");
const savedName = localStorage.getItem("mt_name");
if (savedRoom) roomInput.value = savedRoom;
if (savedName) nameInput.value = savedName;
roomInput.addEventListener("change", () => localStorage.setItem("mt_room", roomInput.value.trim()));
nameInput.addEventListener("change", () => localStorage.setItem("mt_name", nameInput.value.trim()));
