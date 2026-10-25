// Saved "looks": what one drive-screen tile does. Pure data -> frames, no DOM. Tested in protocol.test.mjs.
//   look = { id, name, pinned, main?, strip?, fx?, speed?, bright? }
//   main:  { type: "color" (hex) | "mode" | "preset" (PRESETS index) | "split" ([central, doors]) | "mic", value, zones }
//   strip: { type: "color" (hex) | "mode" | "scene" | "mic", value }
//   fx:    cop pattern key, flashed by the phone (app.js PATTERNS)
import { MAIN, STRIP, ZONE, PRESETS, MODES, MIC_MAIN, MIC_STRIP, STRIP_MODES, STRIP_MODES_EXTRA, SCENES, presetFrames, hexToRgb } from "./protocol.js";

export const MAX_PINNED = 6;
export const SPLITS = [[[0x96, 0x98], "Dashboard red, doors blue strobe"], [[0x98, 0x96], "Dashboard blue, doors red strobe"]];

export function lookFrames(look) {
  const out = { main: [], strip: [] };
  const m = look.main, s = look.strip, z = m?.zones || ZONE.all;
  if (m) {
    if (m.type === "color") out.main.push(MAIN.color(hexToRgb(m.value), z));
    if (m.type === "mode") out.main.push(MAIN.mode(m.value, z));
    if (m.type === "mic") out.main.push(MAIN.mic(m.value, z));
    if (m.type === "preset") out.main.push(...presetFrames(PRESETS[m.value]));
    if (m.type === "split") out.main.push(...presetFrames({ central: m.value[0], doors: m.value[1] }));
    if (look.speed != null) out.main.push(MAIN.speed(look.speed, z));
    if (look.bright != null) out.main.push(MAIN.bright(look.bright, z));
  }
  if (s) {
    if (s.type === "color") out.strip.push(STRIP.color(hexToRgb(s.value)));
    if (s.type === "mode") out.strip.push(STRIP.mode(s.value));
    if (s.type === "scene") out.strip.push(STRIP.scene(s.value));
    if (s.type === "mic") out.strip.push(STRIP.mic(s.value));
    if (look.speed != null) out.strip.push(STRIP.speed(look.speed));
    if (look.bright != null) out.strip.push(STRIP.bright(look.bright));
  }
  return out;
}

const nameIn = (list, v) => list.find(([id]) => id === v)?.[1];
function partName(p, main) {
  if (!p) return null;
  if (p.type === "color") return null;
  if (p.type === "preset") return PRESETS[p.value]?.name;
  if (p.type === "split") return nameIn(SPLITS.map(([v, n]) => [v.join(), n]), p.value.join());
  if (p.type === "mic") return nameIn(main ? MIC_MAIN : MIC_STRIP, p.value);
  if (p.type === "scene") return nameIn(SCENES, p.value);
  return main ? nameIn(MODES, p.value) : nameIn(STRIP_MODES, p.value) ?? nameIn(STRIP_MODES_EXTRA, p.value);
}
export const effectName = look => partName(look.main, true) ?? partName(look.strip, false) ?? "";

export function kindOf(look) {
  if (look.fx) return "strobe";
  const types = [look.main?.type, look.strip?.type].filter(Boolean);
  if (types.includes("mic")) return "music";
  if (types.length && types.every(t => t === "color")) return "static";
  return /strobe|jump|flash|alarm|lightning/i.test(effectName(look)) || look.main?.type === "split" ? "strobe" : "flow";
}

const HUES = { red: "#f04848", orange: "#f28a3a", yellow: "#f2c230", gold: "#f2c230", green: "#36d17a", cyan: "#22d3e6", blue: "#1f4fff", purple: "#8f3ff0", pink: "#e8329a", white: "#d6e1ea" };
const RAINBOW = ["#f04848", "#f2c230", "#36d17a", "#1aa7f0", "#8f3ff0"];
function colorsFromName(name) {
  const n = name.toLowerCase();
  if (/7-colou?r|seven|colou?rful|rainbow|iridescen|auto loop|disco|energy|rhythm|spectrum|rolling|classic|soft|dynamic|party/.test(n)) return RAINBOW;
  if (/\brgb\b/.test(n)) return [HUES.red, HUES.green, HUES.blue];
  if (/\bybp\b/.test(n)) return [HUES.yellow, HUES.blue, HUES.purple];
  const found = Object.entries(HUES).filter(([w]) => n.includes(w)).map(([, c]) => c);
  return found.length ? found : ["#1aa7f0", "#8f3ff0"];
}
export function swatchOf(look) {
  if (look.fx || look.main?.type === "split") return [HUES.red, HUES.blue];
  const cols = [look.main, look.strip].filter(p => p?.type === "color").map(p => p.value);
  if (cols.length) return [...new Set(cols)];
  return colorsFromName(effectName(look) || look.name);
}
// Hard colour stops, not a blend: each colour reads as its own band at a glance.
export const stripe = cols => cols.length === 1 ? cols[0]
  : `linear-gradient(90deg, ${cols.map((c, i) => `${c} ${(i * 100 / cols.length).toFixed(1)}% ${((i + 1) * 100 / cols.length).toFixed(1)}%`).join(", ")})`;

export function describe(look) {
  if (look.fx) return "Phone pattern";
  const kind = { static: "Steady colour", flow: effectName(look) || "Effect", strobe: effectName(look) || "Strobe", music: "Music" }[kindOf(look)];
  const where = look.main && look.strip ? "handles and strips" : look.main ? "handles" : "strips";
  return `${kind} · ${where}${look.bright != null ? ` · ${look.bright}%` : ""}`;
}

export const newId = () => Math.random().toString(36).slice(2, 10);
const stripModeId = name => STRIP_MODES.find(([, n]) => n === name)[0];

export const SEED = [
  { id: "ocean", name: "Ocean Blue", pinned: true, main: { type: "preset", value: 0 }, strip: { type: "color", value: "#1aa7f0" } },
  { id: "warm", name: "Warm night", pinned: true, main: { type: "color", value: "#ff8a2a", zones: ZONE.all }, strip: { type: "color", value: "#ff8a2a" } },
  { id: "party", name: "Party", pinned: true, main: { type: "mic", value: 0x83, zones: ZONE.all }, strip: { type: "mic", value: 0x80 } },
  { id: "cop", name: "Cop", pinned: true, main: { type: "split", value: [0x96, 0x98] }, strip: { type: "scene", value: 28 } },
  { id: "rainbow", name: "Rainbow flow", pinned: true, main: { type: "mode", value: 0x8a, zones: ZONE.all }, strip: { type: "mode", value: stripModeId("Positive Colorful Running Water") }, speed: 60 },
  { id: "white", name: "Ice white", pinned: true, main: { type: "color", value: "#ffffff", zones: ZONE.all }, strip: { type: "color", value: "#ffffff" } },
];
