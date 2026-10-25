// CarLight UI: drive screen (glance and tap), looks management, and the parked tools.
// Frames come from protocol.js (verified against the APK); every write passes P.isSafe first.
import * as P from "./protocol.js";
import { SEED, MAX_PINNED, SPLITS, lookFrames, swatchOf, kindOf, describe, stripe, newId } from "./looks.js";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hx = n => n.toString(16).padStart(2, "0").toUpperCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem("clb." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("clb." + k, JSON.stringify(v)); } catch {} },
};
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (typeof v === "function") e[k] = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.filter(k => k != null));
  return e;
}
const ICONS = {
  static: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
  flow: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-3 5-2"/></svg>',
  strobe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  music: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 17V5l11-2v12"/><circle cx="6" cy="17" r="3"/><circle cx="17" cy="15" r="3"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  star: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  starO: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
};
function icon(name) { const t = document.createElement("template"); t.innerHTML = ICONS[name]; return t.content.firstChild; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { prompt("Copy this:", text); }
}

/* ---------- log and toast ---------- */
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = err ? "err" : ""; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}
function log(kind, msg) {
  const box = $("#log");
  box.append(el("div", { class: kind, text: `${new Date().toLocaleTimeString()}  ${{ tx: "→", rx: "←", err: "!", info: "·" }[kind]} ${msg}` }));
  while (box.childElementCount > 400) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
  if (kind === "err") toast(msg, true);
}

/* ---------- connections ----------
   main  = HRS-MBLEM / MELK-QA / MHRS-QA (E2 frames). MELK-QA and MHRS-QA also run the strips (E1 frames, same link).
   strip = separate MELK-O strip controller (E1 frames). */
const links = { main: null, strip: null }; // {device, name, role, twoInOne, chr, state, manual, looping}
let demo = false;
const stripLink = () => links.strip || (links.main?.twoInOne ? links.main : null);
const can = role => demo || !!(role === "main" ? links.main?.chr : stripLink()?.chr);
const anyLink = () => demo || !!(links.main || links.strip);
const stripName = () => stripLink()?.name ?? null;
function linkFor(f) {
  if (demo) return { demo: true };
  const l = f[0] === 0x8e ? links.main : stripLink();
  return l?.chr ? l : null;
}

// Write queue. Same key replaces the queued frame, so a slider's or a fast tap's last value always goes out
// (the original app silently dropped writes inside its 100 ms window).
const pending = new Map();
let pumping = false;
function send(frame, key, quiet) {
  if (!P.isSafe(frame)) { log("err", "Blocked by safety lock: " + P.hex(frame)); return false; }
  const link = linkFor(frame);
  if (!link) {
    if (!quiet) log("err", frame[0] === 0x8e ? "Handle lights are not connected" : "LED strips are not connected");
    return false;
  }
  pending.set(key ?? Symbol(), { frame, link });
  pump();
  return true;
}
function dropPending(prefix) { for (const k of pending.keys()) if (typeof k === "string" && k.startsWith(prefix)) pending.delete(k); }
async function pump() {
  if (pumping) return;
  pumping = true;
  while (pending.size) {
    const [k, { frame, link }] = pending.entries().next().value;
    pending.delete(k);
    try {
      if (!link.demo) {
        if (!link.chr) throw Error("connection lost");
        if (link.chr.properties.writeWithoutResponse) await link.chr.writeValueWithoutResponse(frame);
        else await link.chr.writeValueWithResponse(frame);
      }
      log("tx", P.hex(frame));
    } catch (e) { log("info", "Not sent (" + e.message + "): " + P.hex(frame)); }
    await sleep(+$("#gap").value);
  }
  pumping = false;
}

// ponytail: retries forever, capped at 15 s. The controller is powered with the car, so "in range again" is the normal case.
const retryDelay = attempt => Math.min(1000 * 2 ** attempt, 15000);

async function pickDevice() {
  if (!navigator.bluetooth) return log("err", "This browser can't use Bluetooth. Use Chrome on Android with Bluetooth and Location on.");
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: P.PREFIXES.map(namePrefix => ({ namePrefix })), optionalServices: [P.SVC] });
  } catch (e) {
    if (e.name === "NotFoundError") log("info", "Nothing picked. Is the old app or another phone still connected to the lights?");
    else log("err", e.message);
    return;
  }
  if (!P.isSupported(device.name || "")) return log("err", `${device.name} is not a supported light controller`);
  attach(device);
}
function attach(device) {
  const name = device.name || "", role = P.isStripCtl(name) ? "strip" : "main";
  if (links[role]?.device === device) return keepConnected(links[role]);
  if (links[role]) { links[role].manual = true; links[role].device.gatt.disconnect(); }
  const link = links[role] = { device, name, role, twoInOne: P.isTwoInOne(name), chr: null, state: "connecting" };
  device.addEventListener("gattserverdisconnected", () => onDrop(link));
  demo = false;
  store.set("lastDevice", name);
  render();
  keepConnected(link);
}
async function open(link) {
  const gatt = await Promise.race([link.device.gatt.connect(), sleep(10000).then(() => { throw Error("timed out"); })]);
  const chr = await (await gatt.getPrimaryService(P.SVC)).getCharacteristic(P.WRITE);
  if (links[link.role] !== link || link.manual) { link.device.gatt.disconnect(); return; } // disconnected meanwhile
  await sleep(100); // ELKDeviceManager waits 100 ms before using fff3
  if (chr.properties.read) {
    try {
      const v = await chr.readValue(), b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), end = b.indexOf(0);
      link.fw = String.fromCharCode(...b.slice(0, end < 0 ? b.length : end));
      log("rx", `${link.name} firmware ${link.fw}`);
    } catch {}
  }
  link.chr = chr; link.state = "on";
  log("info", `Connected to ${link.name}` + (link.twoInOne ? " (handle lights and LED strips)" : link.role === "strip" ? " (LED strips)" : " (handle lights)"));
  await sleep(200);
  if (link.role === "main") send(P.MAIN.sync(), "sync-m", true); // the app never clock-syncs strip controllers
  reapply(link);
  render();
}
async function keepConnected(link) {
  if (link.looping) return;
  link.looping = true;
  for (let attempt = 0; links[link.role] === link && !link.manual && !link.chr; attempt++) {
    try { await open(link); }
    catch (e) {
      if (links[link.role] !== link || link.manual) break;
      link.state = "reconnecting"; render();
      if (attempt === 0) log("info", `${link.name}: ${e.message}. Retrying until it is back in range.`);
      try { link.device.gatt.disconnect(); } catch {}
      await sleep(retryDelay(attempt));
    }
  }
  link.looping = false;
}
function onDrop(link) {
  link.chr = null;
  if (link.manual || links[link.role] !== link) return;
  log("info", `${link.name} disconnected, reconnecting`);
  link.state = "reconnecting";
  stopFx(); render();
  keepConnected(link);
}
// After any (re)connect, put back what the driver last chose: power, brightness and the active look.
function reapply(link) {
  const roles = link.role === "strip" ? ["strip"] : link.twoInOne ? ["main", "strip"] : ["main"];
  const look = activeLook();
  for (const r of roles) {
    S.waiting.delete(r);
    const D = r === "main" ? P.MAIN : P.STRIP;
    if (!S.power) { send(D.power(false, P.ZONE.all), "power-" + r, true); continue; }
    send(D.bright(S.level, P.ZONE.all), "bright-" + r, true);
    if (look) lookFrames(look)[r].forEach((f, i) => send(f, `look-${r}-${i}`, true));
  }
}
async function autoConnect() {
  if (!navigator.bluetooth?.getDevices) return; // needs Chrome's persistent Bluetooth permissions
  try { (await navigator.bluetooth.getDevices()).filter(d => P.isSupported(d.name || "")).forEach(attach); } catch {}
}
function disconnectAll() {
  stopFx(); demo = false;
  for (const k of Object.keys(links)) {
    const l = links[k];
    if (l) { l.manual = true; l.device.gatt.connected && l.device.gatt.disconnect(); }
    links[k] = null;
  }
  render();
}

/* ---------- looks and drive state ---------- */
const S = {
  looks: store.get("looks", null) || structuredClone(SEED),
  active: store.get("active", null),
  level: store.get("level", 75),
  power: store.get("power", true),
  waiting: new Set(), // roles the active look still has to reach
};
const saveLooks = () => store.set("looks", S.looks);
const activeLook = () => S.looks.find(l => l.id === S.active);
const pinned = () => S.looks.filter(l => l.pinned);
function forgetActive() { if (S.active) { S.active = null; store.set("active", null); renderDrive(); } }

function applyLook(look, preview) {
  stopFx();
  dropPending("look-");
  if (!S.power) setPower(true);
  const f = lookFrames(look);
  S.waiting.clear();
  for (const r of ["main", "strip"]) {
    if (!f[r].length) continue;
    if (can(r)) f[r].forEach((fr, i) => send(fr, `look-${r}-${i}`));
    else S.waiting.add(r);
  }
  if (look.fx) startFx(look.fx);
  if (!preview) { S.active = look.id; store.set("active", look.id); }
  render();
}
function setPower(on) {
  S.power = on; store.set("power", on);
  if (!on) stopFx();
  if (can("main")) send(P.MAIN.power(on, P.ZONE.all), "power-main");
  if (can("strip")) send(P.STRIP.power(on), "power-strip");
  render();
}
function setLevel(v) {
  S.level = v; store.set("level", v);
  if (can("main")) send(P.MAIN.bright(v, P.ZONE.all), "bright-main");
  if (can("strip")) send(P.STRIP.bright(v), "bright-strip");
  render();
}

/* ---------- drive screen ---------- */
function setChip(node, cls, text) { node.className = "chip " + cls; node.lastElementChild.textContent = text; node.hidden = false; }
function chipFor(node, label, link, role) {
  if (!link && !S.waiting.has(role)) return (node.hidden = true);
  if (!link) return setChip(node, "off", label + ": not connected");
  if (link.chr) return setChip(node, "", label);
  setChip(node, "warn", `${label}: ${link.state}`);
}
function tile(look, enabled) {
  const active = S.active === look.id && S.power;
  const wait = active && S.waiting.size
    ? (S.waiting.size === 2 ? "Waiting to connect" : S.waiting.has("strip") ? "Strips will follow" : "Handles will follow") : null;
  const kind = kindOf(look);
  return el("button", {
    class: "tile" + (wait ? " waiting" : ""), "aria-pressed": String(active), disabled: !enabled,
    "aria-label": `${look.name}, ${kind}` + (active ? (wait ? `, ${wait.toLowerCase()}` : ", on now") : ""),
    onclick: () => applyLook(look),
  },
  el("span", { class: "sw", style: "background:" + stripe(swatchOf(look)) },
    el("span", { class: "kind" }, icon(kind)),
    active ? el("span", { class: "badge" + (wait ? " wait" : "") }, ...(wait ? [wait] : [icon("check"), "On"])) : null),
  el("span", { class: "name", text: look.name }));
}
function renderDrive() {
  const on = anyLink(), pb = $("#power");
  pb.classList.toggle("connect", !on);
  if (on) pb.setAttribute("aria-pressed", S.power); else pb.removeAttribute("aria-pressed");
  const last = store.get("lastDevice", "");
  $("#powerLabel").textContent = !on ? "Connect lights" : S.power ? "Lights on" : "Lights off";
  $("#powerHint").textContent = !on ? (last ? "Last used: " + last : "Find your controller") : S.power ? "Tap to turn off" : "Tap to turn on";
  $$("#levels button").forEach(b => { b.setAttribute("aria-pressed", +b.dataset.level === S.level); b.disabled = !on; });

  const cm = $("#chipMain"), cs = $("#chipStrip");
  if (demo) { setChip(cm, "demo", "Demo mode: nothing is sent"); cs.hidden = true; }
  else if (!on) { setChip(cm, "off", "Not connected. Bluetooth on, old app closed?"); cs.hidden = true; }
  else { chipFor(cm, "Handle lights", links.main, "main"); chipFor(cs, "LED strips", stripLink(), "strip"); }

  const tiles = pinned().slice(0, MAX_PINNED).map(l => tile(l, on));
  if (tiles.length < MAX_PINNED) tiles.push(el("a", { class: "tile empty", href: "#manage" }, "Add a look"));
  while (tiles.length < MAX_PINNED) tiles.push(el("span", { "aria-hidden": "true" }));
  $("#tiles").replaceChildren(...tiles);
}
$("#power").onclick = () => (anyLink() ? setPower(!S.power) : pickDevice());
$$("#levels button").forEach(b => (b.onclick = () => setLevel(+b.dataset.level)));

/* ---------- manage looks ---------- */
function row(look, i, n) {
  const pin = !!look.pinned;
  return el("li", { class: "lrow" },
    pin ? el("span", { class: "moves" },
      el("button", { type: "button", class: "icon", "data-f": look.id + "-1", "aria-label": `Move ${look.name} up`, disabled: i === 0, onclick: () => move(look, -1) }, icon("up")),
      el("button", { type: "button", class: "icon", "data-f": look.id + "1", "aria-label": `Move ${look.name} down`, disabled: i === n - 1, onclick: () => move(look, 1) }, icon("down"))) : null,
    el("span", { class: "sw", style: "background:" + stripe(swatchOf(look)) }),
    el("a", { class: "lname", href: "#edit/" + look.id }, el("b", { text: look.name }), el("small", { text: describe(look) })),
    el("button", {
      type: "button", class: "icon", "data-f": look.id + "p", "aria-pressed": String(pin),
      "aria-label": pin ? `Remove ${look.name} from the drive screen` : `Pin ${look.name} to the drive screen`,
      onclick: () => togglePin(look),
    }, icon(pin ? "star" : "starO")));
}
function renderManage(focus) {
  const pins = pinned(), rest = S.looks.filter(l => !l.pinned);
  $("#pinCount").textContent = `${pins.length} of ${MAX_PINNED}`;
  $("#pinnedList").replaceChildren(...(pins.length ? pins.map((l, i) => row(l, i, pins.length)) : [el("li", { class: "hint", text: "Pin looks below to show them while driving." })]));
  $("#savedList").replaceChildren(...(rest.length ? rest.map(l => row(l)) : [el("li", { class: "hint", text: "Looks you take off the drive screen stay here." })]));
  if (focus) document.querySelector(`[data-f="${focus}"]:not(:disabled)`)?.focus();
}
function move(look, d) {
  const pins = pinned(), other = pins[pins.indexOf(look) + d];
  const a = S.looks.indexOf(look), b = S.looks.indexOf(other);
  [S.looks[a], S.looks[b]] = [S.looks[b], S.looks[a]];
  saveLooks(); renderManage(look.id + d);
}
function togglePin(look) {
  if (!look.pinned && pinned().length >= MAX_PINNED) return toast(`The drive screen holds ${MAX_PINNED} looks. Remove one first.`);
  look.pinned = !look.pinned;
  saveLooks(); renderManage(look.id + "p");
}
P.PRESETS.forEach((p, i) => $("#presetAdd").append(el("button", {
  type: "button", class: "btn", onclick: () => {
    const look = { id: newId(), name: p.name, pinned: pinned().length < MAX_PINNED, main: { type: "preset", value: i }, strip: { type: "mode", value: p.strip } };
    S.looks.push(look); saveLooks(); renderManage();
    toast(`Added ${p.name}` + (look.pinned ? " to the drive screen" : ""));
  },
}, p.name)));

/* ---------- edit look ---------- */
const E = id => document.getElementById(id);
let editing = null;
const stripModes = sn => (sn && !P.hasExtraModes(sn) ? P.STRIP_MODES : [...P.STRIP_MODES, ...P.STRIP_MODES_EXTRA]);
const scenes = sn => (sn ? P.scenesFor(sn) : P.SCENES);
function fillSelect(sel, groups) {
  const keep = sel.value;
  sel.replaceChildren(...groups.filter(([, opts]) => opts.length).flatMap(([label, opts]) => {
    const os = opts.map(([v, t]) => new Option(t, v));
    return label ? [el("optgroup", { label }, ...os)] : os;
  }));
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}
function setSelect(sel, value) {
  value = String(value);
  if (![...sel.options].some(o => o.value === value)) sel.append(new Option("Saved setting " + value, value));
  sel.value = value;
}
let gatedFor;
function fillGatedSelects() {
  const sn = stripName();
  if (sn === gatedFor && $("#symMode").options.length) return;
  gatedFor = sn;
  fillSelect(E("eStripFx"), [["Animations", stripModes(sn).map(([v, n]) => ["m:" + v, n])], ["Scenes", scenes(sn).map(([v, n]) => ["c:" + v, n])]]);
  fillSelect($("#symMode"), [[null, stripModes(sn).map(([v, n]) => [v, n])]]);
  fillSelect($("#symScene"), [[null, scenes(sn).map(([v, n]) => [v, n])]]);
}
fillSelect(E("eMainFx"), [
  ["Effects", P.MODES.map(([v, n]) => ["m:" + v, n])],
  ["Presets (dashboard and doors differ)", P.PRESETS.map((p, i) => ["p:" + i, p.name])],
  ["Two-zone strobes", SPLITS.map(([v, n]) => ["s:" + v.join(","), n])],
]);
fillSelect(E("eMainMic"), [[null, P.MIC_MAIN.map(([v, n]) => [v, n])]]);
fillSelect(E("eStripMic"), [[null, P.MIC_STRIP.map(([v, n]) => [v, n])]]);

function openEditor(id) {
  const isNew = id === "new";
  const src = isNew
    ? { id: newId(), name: "", pinned: pinned().length < MAX_PINNED, main: { type: "color", value: "#ff2020", zones: P.ZONE.all }, strip: { type: "color", value: "#ff2020" } }
    : S.looks.find(l => l.id === id);
  if (!src) { location.hash = "#manage"; return; }
  editing = { id: src.id, pinned: src.pinned };
  fillGatedSelects();
  const m = src.main, s = src.strip, z = m?.zones || P.ZONE.all;
  E("editTitle").textContent = isNew ? "New look" : "Edit look";
  E("eDelete").hidden = isNew;
  E("eName").value = src.name;
  E("eMain").checked = !!m || !!src.fx;
  E("eStrip").checked = !!s;
  E("eDash").checked = !!(z & P.ZONE.dash); E("eDoors").checked = !!(z & P.ZONE.doors); E("eRear").checked = !!(z & P.ZONE.rear);
  const type = src.fx ? "pattern" : [m?.type, s?.type].includes("mic") ? "music" : [m, s].filter(Boolean).every(p => p.type === "color") ? "color" : "effect";
  $(`[name=eType][value=${type}]`).checked = true;
  E("eColor").value = [m, s].find(p => p?.type === "color")?.value ?? "#ff2020";
  setSelect(E("eMainFx"), m?.type === "preset" ? "p:" + m.value : m?.type === "split" ? "s:" + m.value.join(",") : "m:" + (m?.type === "mode" ? m.value : 0x8a));
  setSelect(E("eStripFx"), s?.type === "scene" ? "c:" + s.value : "m:" + (s?.type === "mode" ? s.value : 0));
  setSelect(E("eMainMic"), m?.type === "mic" ? m.value : 0x80);
  setSelect(E("eStripMic"), s?.type === "mic" ? s.value : 0x80);
  E("ePattern").value = src.fx ?? "double";
  E("eSpeed").value = src.speed ?? 50;
  E("eKeepBright").checked = src.bright == null;
  E("eBright").value = src.bright ?? S.level;
  E("eError").textContent = "";
  syncEditor();
}
function readEditor() {
  const type = $("[name=eType]:checked").value;
  const look = { id: editing.id, name: E("eName").value.trim(), pinned: editing.pinned };
  if (type === "pattern") look.fx = E("ePattern").value;
  else {
    const zones = (E("eDash").checked ? P.ZONE.dash : 0) | (E("eDoors").checked ? P.ZONE.doors : 0) | (E("eRear").checked ? P.ZONE.rear : 0);
    const color = E("eColor").value;
    if (E("eMain").checked) {
      if (type === "color") look.main = { type: "color", value: color, zones };
      else if (type === "music") look.main = { type: "mic", value: +E("eMainMic").value, zones };
      else {
        const [k, v] = E("eMainFx").value.split(":");
        look.main = k === "p" ? { type: "preset", value: +v } : k === "s" ? { type: "split", value: v.split(",").map(Number) } : { type: "mode", value: +v, zones };
      }
    }
    if (E("eStrip").checked) {
      if (type === "color") look.strip = { type: "color", value: color };
      else if (type === "music") look.strip = { type: "mic", value: +E("eStripMic").value };
      else { const [k, v] = E("eStripFx").value.split(":"); look.strip = { type: k === "c" ? "scene" : "mode", value: +v }; }
    }
    if (type === "effect") look.speed = +E("eSpeed").value;
  }
  if (!E("eKeepBright").checked) look.bright = +E("eBright").value;
  return look;
}
function problem(look) {
  if (!look.fx && !look.main && !look.strip) return "Pick at least one: Handle + foot or LED strips.";
  if (look.main?.zones === 0) return "Pick at least one zone: Dashboard, Doors or Rear.";
  return "";
}
function syncEditor() {
  const type = $("[name=eType]:checked").value, main = E("eMain").checked, strip = E("eStrip").checked;
  $$("[data-type]").forEach(d => (d.hidden = d.dataset.type !== type));
  E("eTargets").hidden = type === "pattern";
  const zonesMatter = main && !(type === "effect" && /^[ps]:/.test(E("eMainFx").value)); // presets set their own zones
  E("eZones").hidden = !zonesMatter;
  E("eMainFxL").hidden = E("eMainMicL").hidden = !main;
  E("eStripFxL").hidden = E("eStripMicL").hidden = !strip;
  E("eBrightRow").hidden = E("eKeepBright").checked;
  E("eSpeedOut").textContent = E("eSpeed").value;
  E("eBrightOut").textContent = E("eBright").value + "%";
  const look = readEditor();
  E("ePreview").style.background = stripe(swatchOf({ ...look, name: look.name || " " }));
}
E("editForm").addEventListener("input", syncEditor);
E("editForm").addEventListener("change", syncEditor);
E("editForm").onsubmit = e => {
  e.preventDefault();
  const look = readEditor();
  const err = !look.name ? "Give the look a name." : problem(look);
  E("eError").textContent = err;
  if (err) return !look.name && E("eName").focus();
  const i = S.looks.findIndex(l => l.id === look.id);
  if (i < 0) S.looks.push(look); else S.looks[i] = look;
  saveLooks(); toast("Saved " + look.name);
  location.hash = "#manage";
};
E("eTry").onclick = () => {
  const look = readEditor(), err = problem(look);
  E("eError").textContent = err;
  if (err) return;
  if (!anyLink()) return toast("Connect the lights first: Lights and devices › Connections", true);
  applyLook(look, true);
};
E("eDelete").onclick = () => {
  const look = S.looks.find(l => l.id === editing.id);
  if (!look || !confirm(`Delete "${look.name}"? This can't be undone.`)) return;
  S.looks = S.looks.filter(l => l !== look);
  if (S.active === look.id) forgetActive();
  saveLooks(); location.hash = "#manage";
};
["#ff2020", "#ff8a2a", "#ffd000", "#20e060", "#20e0ff", "#2050ff", "#a020ff", "#ff20a0", "#ffffff"].forEach(c =>
  E("eSwatches").append(el("button", { type: "button", class: "swatch-btn", style: "background:" + c, "aria-label": "Colour " + c, onclick: () => { E("eColor").value = c; syncEditor(); } })));

/* ---------- routing: #manage, #edit/<id>, #tools; Android back = history back ---------- */
function route() {
  const [view, arg] = location.hash.slice(1).split("/");
  const name = ["manage", "edit", "tools"].includes(view) ? view : "drive";
  $$(".view").forEach(v => (v.hidden = v.dataset.view !== name));
  if (name === "manage") renderManage();
  if (name === "edit") openEditor(arg || "new");
  if (name === "drive") renderDrive();
  scrollTo(0, 0);
}
addEventListener("hashchange", route);

function renderDevices() {
  const items = Object.values(links).filter(Boolean).map(l => el("li", {},
    el("span", { class: "dot", style: l.chr ? "" : "background:var(--warn)" }),
    el("span", { text: l.name + (l.twoInOne ? " (handles + strips)" : l.role === "strip" ? " (LED strips)" : " (handle lights)") }),
    el("span", { class: "mono", text: l.chr ? "connected" + (l.fw ? " · " + l.fw : "") : l.state })));
  $("#devList").replaceChildren(...(items.length ? items : [el("li", { text: demo ? "Demo mode: commands only go to the log" : "No controller connected" })]));
}
function render() { renderDrive(); renderDevices(); fillGatedSelects(); }

/* ---------- tools: connections ---------- */
$("#btnConnect").onclick = pickDevice;
$("#btnDisconnect").onclick = disconnectAll;
$("#btnDemo").onclick = () => { demo = true; render(); log("info", "Demo mode: commands only show in the log"); toast("Demo mode: nothing is sent"); };

/* ---------- tools: manual control ---------- */
const useMain = () => $("#tMain").checked;
const useStrip = () => $("#tStrip").checked;
const zone = () => ($("#zDash").checked ? P.ZONE.dash : 0) | ($("#zDoors").checked ? P.ZONE.doors : 0) | ($("#zRear").checked ? P.ZONE.rear : 0);
// Send one action to every ticked group (MAIN builders take the zone as last argument, STRIP ignores it).
function both(action, key, ...args) {
  if (!useMain() && !useStrip()) return log("err", "Tick Handle + foot or LED strips first");
  forgetActive();
  if (useMain()) send(P.MAIN[action](...args, zone()), key + "-m");
  if (useStrip()) send(P.STRIP[action](...args), key + "-s");
}
function bindSlider(id, fn, fmt = v => v) {
  const input = $("#" + id), out = $("#" + id + "Out");
  input.value = store.get("slider." + id, input.value);
  out.textContent = fmt(input.value);
  input.addEventListener("input", () => { out.textContent = fmt(input.value); store.set("slider." + id, +input.value); fn?.(+input.value); });
}
bindSlider("bright", v => both("bright", "bright", v));
bindSlider("speed", v => both("speed", "speed", v));
// MikeFragment: two-in-one controllers get sensitivity as E1 only
bindSlider("sens", v => (links.main?.twoInOne && !links.strip ? send(P.STRIP.sens(v), "sens-s") : both("sens", "sens", v)));
bindSlider("gap", null, v => v + " ms");
bindSlider("tempo", null, v => v + "%");
$("#tMain").onchange = () => ($("#zoneSub").hidden = !useMain());
$("#btnOn").onclick = () => both("power", "power", true);
$("#btnOff").onclick = () => { stopFx(); both("power", "power", false); };
$("#btnSync").onclick = () => send(P.MAIN.sync(), "sync-m");
$("#color").addEventListener("input", e => both("color", "color", P.hexToRgb(e.target.value)));
["#ff0000", "#ff7a00", "#ffd000", "#00ff40", "#00e5ff", "#0040ff", "#a000ff", "#ff00a0", "#ffffff"].forEach(c =>
  $("#swatches").append(el("button", { class: "swatch-btn", style: "background:" + c, "aria-label": "Colour " + c, onclick: () => { $("#color").value = c; both("color", "color", P.hexToRgb(c)); } })));
const btn = (label, onclick) => el("button", { class: "btn", onclick }, label);
P.MODES.forEach(([id, n]) => $("#modes").append(btn(n, () => { forgetActive(); send(P.MAIN.mode(id, zone())); })));
P.PRESETS.forEach(p => $("#presets").append(btn(p.name, () => {
  forgetActive();
  P.presetFrames(p).forEach(f => send(f));
  if (useStrip() && can("strip")) send(P.STRIP.mode(p.strip), "stripmode");
})));
P.MIC_MAIN.forEach(([id, n]) => $("#micModes").append(btn(n, () => { forgetActive(); send(P.MAIN.mic(id, zone())); })));
P.MIC_STRIP.forEach(([id, n]) => $("#micE1").append(btn(n, () => { forgetActive(); send(P.STRIP.mic(id)); })));
const playSym = () => { forgetActive(); send(P.STRIP.mode(+$("#symMode").value), "stripmode"); };
$("#btnSymMode").onclick = playSym;
$("#symPrev").onclick = () => { const s = $("#symMode"); s.selectedIndex = Math.max(0, s.selectedIndex - 1); playSym(); };
$("#symNext").onclick = () => { const s = $("#symMode"); s.selectedIndex = Math.min(s.options.length - 1, s.selectedIndex + 1); playSym(); };
$("#btnSymScene").onclick = () => { forgetActive(); send(P.STRIP.scene(+$("#symScene").value), "stripscene"); };

/* ---------- tools: DIY colour sequence (CommonUtils.getSendDiyCommand) ---------- */
let diy = store.get("diy", ["#ff0000", "#0000ff", "#ffffff"]);
function renderDiy() {
  $("#diyColors").replaceChildren(...diy.map((c, i) => el("input", {
    type: "color", value: c, "aria-label": "Sequence colour " + (i + 1),
    oninput: e => { diy[i] = e.target.value; store.set("diy", diy); },
  })));
}
renderDiy();
$("#diyAdd").onclick = () => { if (diy.length < 16) { diy.push("#00ff00"); store.set("diy", diy); renderDiy(); } };
$("#diyDel").onclick = () => { if (diy.length > 1) { diy.pop(); store.set("diy", diy); renderDiy(); } };
$("#diySend").onclick = () => {
  forgetActive();
  P.MAIN.diy(diy.map(P.hexToRgb), { bright: +$("#bright").value, speed: +$("#speed").value, mode: +$("#diyMode").value }, zone()).forEach(f => send(f));
};

/* ---------- tools: find separate lights ----------
   Each test sends the normal "set colour red" with one hidden byte changed:
   handle lights = the zone byte; LED strips = the colour-type byte. */
const TESTS = {
  E2: [0x20, 0x01, 0x02, 0x04, 0x08, 0x03, 0x0c, 0x05, 0x0a, 0x0f, 0x21, 0x22, 0x24, 0x28, 0x80, 0x30, 0x50],
  E1: [0x10, 0x00, 0x01, 0x02, 0x03, 0x04, 0x11, 0x12, 0x13, 0x14, 0x18, 0x0f, 0x20],
};
const redWith = (fam, v) => (fam === "E2" ? P.e2(0x05, [3, 255, 0, 0, 0x10], v) : P.e1(0x05, [3, 255, 0, 0, v]));
const allOff = fam => (fam === "E2" ? P.e2(0x05, [3, 0, 0, 0, 0x10], P.ZONE.all) : P.e1(0x05, [3, 0, 0, 0, 0x10]));
const ANSWERS = {
  E2: [["none", "Nothing"], ["all", "Everything"], ["dash", "Dashboard"], ["doors", "All 4 doors"], ["lf", "Front-left door"], ["rf", "Front-right door"],
    ["lr", "Rear-left door"], ["rr", "Rear-right door"], ["left", "Both left doors"], ["right", "Both right doors"], ["rear", "Rear / trunk"], ["other", "Something else"]],
  E1: [["none", "Nothing"], ["sall", "All LED strips"], ["sdash", "Dashboard strip"], ["sdoors", "Door strips only"], ["sleft", "Left side strips"],
    ["sright", "Right side strips"], ["spart", "Part of a strip"], ["other", "Something else"]],
};
const answer = (fam, k) => ANSWERS[fam].find(a => a[0] === k);
let finder = { fam: "E2", i: -1 };
let results = store.get("results", []).filter(r => answer(r.fam, r.answer)); // {fam, v, answer}
function renderAnswers() {
  $("#fAnswers").replaceChildren(...ANSWERS[finder.fam].map(([key, label]) => btn(label, () => {
    const v = TESTS[finder.fam][finder.i];
    if (v == null) return;
    results = results.filter(r => !(r.fam === finder.fam && r.v === v));
    results.push({ fam: finder.fam, v, answer: key });
    store.set("results", results);
    renderResults(); fillSides();
    finder.i++;
    setTimeout(flash, 350);
  })));
}
async function flash() {
  const v = TESTS[finder.fam][finder.i];
  if (v == null) { $("#fRun").hidden = true; toast("Test done. See Results."); return; }
  $("#fRun").hidden = false;
  $("#fStep").textContent = `Test ${finder.i + 1} of ${TESTS[finder.fam].length}`;
  $("#fAsk").textContent = finder.i === 0 ? `Check test: all ${finder.fam === "E2" ? "handle lights" : "LED strips"} should be red. What turned red?` : "What turned red?";
  if (!send(allOff(finder.fam))) return;
  await sleep(500);
  send(redWith(finder.fam, v));
}
function startFinder(fam) { stopFx(); forgetActive(); finder = { fam, i: 0 }; renderAnswers(); flash(); }
$("#fStartMain").onclick = () => startFinder("E2");
$("#fStartStrip").onclick = () => startFinder("E1");
$("#fAgain").onclick = () => { if (finder.i >= 0) flash(); };
$("#fSkip").onclick = () => { if (finder.i >= 0) { finder.i++; flash(); } };
$("#fBack").onclick = () => { if (finder.i > 0) { finder.i--; flash(); } };
$("#fEnd").onclick = () => { finder.i = -1; $("#fRun").hidden = true; };
function renderResults() {
  $("#fFound").replaceChildren(...(results.length ? results.map(r => el("div", {},
    el("span", { text: answer(r.fam, r.answer)[1] }),
    el("span", { class: "code", text: (r.fam === "E2" ? "handles " : "strips ") + hx(r.v) }))) : [el("p", { class: "hint", text: "Nothing tested yet." })]));
}
renderResults();
$("#fCopy").onclick = () => copyText(JSON.stringify(results.map(r => ({ group: r.fam === "E2" ? "handles" : "strips", code: hx(r.v), lit: answer(r.fam, r.answer)[1] }))));
$("#fClear").onclick = () => { results = []; store.set("results", results); renderResults(); fillSides(); };

/* ---------- tools: cop patterns (phone-timed) ---------- */
// A "light" is one colour-command target. Built-ins are the known zones; finder results add more.
function lights() {
  const list = [
    { id: "e2-10", label: "Dashboard lights", fam: "E2", v: 0x10 },
    { id: "e2-20", label: "Door handle and foot lights", fam: "E2", v: 0x20 },
    { id: "e2-40", label: "Rear lights", fam: "E2", v: 0x40 },
    { id: "e2-70", label: "All handle and foot lights", fam: "E2", v: 0x70 },
    { id: "e1-10", label: "All LED strips", fam: "E1", v: 0x10 },
  ];
  results.filter(r => !["none", "all", "sall", "other", "spart"].includes(r.answer)).forEach(r => {
    const id = r.fam.toLowerCase() + "-" + hx(r.v);
    if (!list.some(l => l.id === id)) list.push({ id, label: answer(r.fam, r.answer)[1] + " (found)", fam: r.fam, v: r.v });
  });
  return list;
}
const lightFrame = (l, [r, g, b]) => (l.fam === "E2" ? P.e2(0x05, [3, r, g, b, 0x10], l.v) : P.e1(0x05, [3, r, g, b, l.v]));
const SIDES = ["sideA", "sideB", "sideC", "sideD"];
function fillSides() {
  const ls = lights(), saved = store.get("sides", {});
  const defaults = { sideA: "e2-20", sideB: "e1-10", sideC: "", sideD: "" };
  SIDES.forEach(id => {
    const sel = $("#" + id), want = sel.value || saved[id] || defaults[id];
    sel.replaceChildren(...(id === "sideC" || id === "sideD" ? [new Option("Not used", "")] : []), ...ls.map(l => new Option(l.label, l.id)));
    sel.value = ls.some(l => l.id === want) ? want : sel.options[0].value;
  });
}
SIDES.forEach(id => $("#" + id).addEventListener("change", () => store.set("sides", Object.fromEntries(SIDES.map(k => [k, $("#" + k).value])))));

// Each step: one colour per side (A, B, …) then milliseconds.
const R = [255, 0, 0], B = [0, 40, 255], W = [255, 255, 255], O = [0, 0, 0];
const flashes = (c1, c2, n, on, off) => Array.from({ length: n }, () => [[c1, c2, on], [O, O, off]]).flat();
const PATTERNS = {
  swap: { name: "Swap (A red, B blue, then flip)", steps: [[R, B, 280], [B, R, 280]] },
  wigwag: { name: "Wig-wag", steps: [[R, O, 160], [O, B, 160]] },
  double: { name: "Double strobe", steps: [...flashes(R, O, 2, 55, 45), [O, O, 90], ...flashes(O, B, 2, 55, 45), [O, O, 90]] },
  triple: { name: "Triple strobe", steps: [...flashes(R, O, 3, 40, 40), [O, O, 80], ...flashes(O, B, 3, 40, 40), [O, O, 80]] },
  takedown: { name: "Takedown", steps: [...flashes(W, W, 3, 45, 45), [R, B, 300], [B, R, 300]] },
  combo: { name: "Pursuit combo", steps: [
    ...Array(3).fill([...flashes(R, O, 2, 55, 45), [O, O, 90], ...flashes(O, B, 2, 55, 45), [O, O, 90]]).flat(),
    ...Array(4).fill([[R, B, 140], [B, R, 140]]).flat(),
    ...flashes(W, W, 4, 35, 45),
    ...Array(4).fill([...flashes(R, O, 3, 35, 35), ...flashes(O, B, 3, 35, 35)]).flat(),
  ] },
  orbit: { name: "Orbit (needs 4 sides)", steps: [[R, O, O, B, 110], [B, R, O, O, 110], [O, B, R, O, 110], [O, O, B, R, 110]] },
};
for (const sel of [$("#pattern"), E("ePattern")]) Object.entries(PATTERNS).forEach(([k, p]) => sel.append(new Option(p.name, k)));
$("#pattern").value = store.get("pattern", "double");
$("#pattern").onchange = () => { $("#sideCD").hidden = $("#pattern").value !== "orbit"; store.set("pattern", $("#pattern").value); };
$("#sideCD").hidden = $("#pattern").value !== "orbit";

let fxTimer = null, wakeLock = null;
// Stops everything the phone animates itself: cop patterns and music sync.
function stopFx() {
  clearTimeout(fxTimer); fxTimer = null;
  dropPending("fx");
  stopMusic();
  wakeLock?.release().catch(() => {}); wakeLock = null;
}
async function startFx(key = $("#pattern").value) {
  stopFx();
  const p = PATTERNS[key];
  if (!p) return log("err", "Unknown pattern " + key);
  const n = p.steps[0].length - 1, ls = lights();
  const sides = SIDES.slice(0, n).map(id => ls.find(l => l.id === $("#" + id).value));
  if (sides.some(s => !s)) return log("err", `${p.name} needs ${n} sides picked under Cop patterns`);
  for (const s of sides) if (!linkFor(lightFrame(s, O))) return log("err", `"${s.label}" is not connected`);
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  const shortest = Math.min(...p.steps.map(s => s[n])) * 100 / +$("#tempo").value;
  $("#fxHint").textContent = `Fastest step ${Math.round(shortest)} ms; ${n} lights need about ${n * +$("#gap").value} ms per step at the current spacing. Too fast and some flashes are skipped, never delayed.`;
  let i = 0;
  const last = [];
  const tick = () => {
    const st = p.steps[i++ % p.steps.length];
    for (let k = 0; k < n; k++) {
      if (last[k] === st[k]) continue; // only send what changed
      last[k] = st[k];
      send(lightFrame(sides[k], st[k]), "fx" + k);
    }
    fxTimer = setTimeout(tick, st[n] * 100 / +$("#tempo").value);
  };
  tick();
}
$("#fxStart").onclick = () => { forgetActive(); startFx(); };
$("#fxStop").onclick = stopFx;

/* ---------- tools: phone music sync (MusicsFragment + CommonUtils.getMusicColor) ----------
   Loudness of the low FFT bins sets brightness; one random channel nudges up each frame so the hue drifts.
   ponytail: plain sum of bins 0-32 instead of the app's averageFilter + cubicSmooth7; add smoothing if it flickers. */
let music = null;
function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  music.stream.getTracks().forEach(t => t.stop());
  music.ctx.close();
  music = null;
  dropPending("music");
}
async function startMusic() {
  stopFx(); forgetActive(); // stopFx also stops a running music sync
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { return log("err", "Microphone not available: " + e.message); }
  const ctx = new AudioContext(), an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const bins = new Uint8Array(an.frequencyBinCount), rgb = [255, 40, 40];
  const timer = setInterval(() => {
    an.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = 0; i < 33; i++) sum += bins[i];
    const level = Math.min(1, (sum / (33 * 255)) * +$("#musicGain").value / 100);
    const up = Math.floor(Math.random() * 3);
    rgb.forEach((v, i) => (rgb[i] = Math.max(0, Math.min(255, v + (i === up ? 4 : -2)))));
    const top = Math.max(...rgb) || 1, out = rgb.map(c => Math.round((c / top) * level * 255)); // same hue, value = loudness
    if (can("main")) send(P.MAIN.color(out, P.ZONE.all, true), "music-m", true);
    if (can("strip")) send(P.STRIP.color(out), "music-s", true);
  }, 100);
  music = { stream, ctx, timer };
  toast("Listening. Stop under Phone music sync, or tap any look.");
}
bindSlider("musicGain", null, v => v + "%");
$("#musicStart").onclick = startMusic;
$("#musicStop").onclick = stopMusic;

/* ---------- log ---------- */
$("#logClear").onclick = () => $("#log").replaceChildren();
$("#logCopy").onclick = () => copyText($("#log").innerText);

/* ---------- start ---------- */
fillSides();
route();
render();
autoConnect();
if ("serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
