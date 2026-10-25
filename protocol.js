// BLE frame builders for the ELK controllers used by Magic CarLight (net.ylzk.lightcontrol).
// Pure functions, no DOM: tested by protocol.test.mjs (`node --test web/`). See ../PROTOCOL.md.
//   E2 "8E LEN CMD payload ZONE" = handle/foot light modules (HRS-MBLEM, MELK-QA, MHRS-QA)
//   E1 "7E LEN CMD p0..p4 EF"    = addressable LED strips ("symphony", MELK-O)

export const SVC = 0xfff0, WRITE = 0xfff3, NOTIFY = 0xfff4;
export const PREFIXES = ["HRS-MBLEM", "MELK-QA", "MHRS-QA", "MELK-O"];
export const isStripCtl = name => name.startsWith("MELK-O");
// ELKSymphonyDeviceManager ignores strip controllers whose name contains W
export const isSupported = name => PREFIXES.some(p => name.startsWith(p)) && !(isStripCtl(name) && name.includes("W"));
export const isTwoInOne = name => name.startsWith("MELK-QA") || name.startsWith("MHRS-QA");

export const ZONE = { dash: 0x10, doors: 0x20, rear: 0x40, all: 0x70 };

export function e2(cmd, payload, zone) {
  const body = zone == null ? payload : [...payload, zone];
  return Uint8Array.from([0x8e, body.length + 1, cmd, ...body]);
}
export function e1(cmd, payload, len = 7) {
  const f = [0x7e, len, cmd, 0xff, 0xff, 0xff, 0xff, 0x00, 0xef];
  payload.slice(0, 5).forEach((b, i) => (f[3 + i] = b));
  return Uint8Array.from(f);
}

// Safety lock: every frame passes here before it can be written. Display-only commands;
// 87 reset, 81 wiring order, 55 door trigger, 88/8C/8F host pairing, D0-D6 module setup are refused.
const SAFE = {
  0x8e: new Set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0a, 0x83]),
  0x7e: new Set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x31]), // the app never sends an E1 clock sync
};
export function isSafe(f) {
  if (!SAFE[f[0]]?.has(f[2])) return false;
  if (f.some(b => b > 0xff)) return false;
  if (f[0] === 0x8e && f[1] !== f.length - 2) return false;            // length byte must match
  if (f[0] === 0x7e && (f.length !== 9 || f[8] !== 0xef)) return false;
  if (f[2] === 0x01 && f[3] === 0) return false;                       // original app never sends brightness 0
  return true;
}

const clock = (d = new Date()) => [d.getHours(), d.getMinutes(), d.getSeconds(), d.getDay(), 0];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

export const MAIN = {
  power: (on, z) => e2(0x04, [on ? 1 : 0, 0], z),
  bright: (v, z) => e2(0x01, [clamp(v, 1, 100)], z),
  speed: (v, z) => e2(0x02, [clamp(v, 0, 100)], z),
  color: ([r, g, b], z, music) => e2(0x05, [3, r, g, b, music ? 0x20 : 0x10], z), // 0x20 = music-colour flag (MusicsFragment)
  mode: (m, z) => e2(0x03, [m, 3], z),
  mic: (m, z) => e2(0x03, [m, 4], z),
  sens: (v, z) => e2(0x06, [clamp(v, 0, 100)], z),
  sync: d => e2(0x83, clock(d), null),
  // CommonUtils.getSendDiyCommand: header phase 1, one frame per colour, then phase 2 and 3
  diy(colors, { bright, speed, mode }, z) {
    const head = phase => e2(0x0a, [0, 1, clamp(bright, 1, 100), clamp(speed, 0, 100), mode, phase], z);
    return [head(1), ...colors.map((c, i) => e2(0x0a, [i + 1, ...c], z)), head(2), head(3)];
  },
};
export const STRIP = {
  power: on => e1(0x04, [on ? 1 : 0, 0]),
  bright: v => e1(0x01, [clamp(v, 1, 100)], 4),
  speed: v => e1(0x02, [clamp(v, 0, 100)]),
  color: ([r, g, b]) => e1(0x05, [3, r, g, b, 0x10]),
  mode: m => e1(0x03, [m, 6]),
  mic: m => e1(0x03, [m, 4]),
  sens: v => e1(0x06, [clamp(v, 0, 100)]),
  scene: s => e1(0x31, [s, 7]),
};

/* ---------- tables copied from the APK (AppConstant / arrays.xml) ---------- */
export const MODES = [[0x8a, "7-colour breathe"], [0xa2, "7-colour + red breathe"], [0x95, "7-colour strobe"], [0xa1, "Tricolour strobe"],
  [0x8c, "Green gradient"], [0x8d, "Blue gradient"], [0x8e, "Yellow gradient"], [0x90, "Purple gradient"], [0x91, "White gradient"], [0x94, "Green-blue gradient"],
  [0x96, "Red strobe"], [0x97, "Green strobe"], [0x98, "Blue strobe"], [0x99, "Yellow strobe"], [0x9a, "Cyan strobe"], [0x9b, "Purple strobe"], [0x9c, "White strobe"],
  [0xa3, "Yellow-white fade"], [0xb1, "White-blue fade"], [0xb2, "Yellow-purple-red jump"]];
export const MIC_MAIN = ["Classic", "Soft", "Dynamic", "Disco"].map((n, i) => [0x80 + i, n]);
export const MIC_STRIP = ["Energy 1", "Rhythm 1", "Spectrum 1", "Rolling 1", "Energy 2", "Rhythm 2", "Spectrum 2", "Rolling 2"].map((n, i) => [0x80 + i, n]); // AppConstant.irNums

const PRESET_NAMES = ["Ocean Blue", "Fire Red", "Red Moon", "Purple Sky", "Dawn Blue", "Sun Yellow", "Jungle Green", "Lucky Purple", "Rainbow Shine", "Dancing Bar", "Blue Night", "Golden Time", "Coffee Time", "Flaming Cyan", "Purple Shine", "Yellow Step", "Color life", "Green rise", "Cloud cover", "Dance Purple", "Latin show", "Blue Eye", "Sunset light", "Danger love", "Accumulation of emotions"];
const CENTRAL = [130, 128, 134, 133, 141, 163, 152, 144, 162, 149, 141, 178, 142, 131, 149, 163, 177, 140, 156, 154, 149, 178, 153, 161, 145];
const DOORS = [129, 132, 128, 129, 132, 177, 140, 153, 162, 149, 141, 178, 142, 177, 144, 178, 138, 151, 153, 155, 150, 148, 152, 162, 129];
// item_mode_car_door_symphony_cmd_array: the strip animation the app pairs with each preset
const PRESET_STRIP = [0, 2, 193, 57, 59, 61, 3, 5, 7, 39, 41, 43, 143, 145, 147, 23, 25, 27, 89, 93, 97, 90, 94, 98, 222];
export const PRESETS = PRESET_NAMES.map((name, i) => ({ name, central: CENTRAL[i], doors: DOORS[i], strip: PRESET_STRIP[i] }));
// A preset sets dashboard and doors(+rear) separately, like the original app.
export const presetFrames = p => p.central === p.doors
  ? [e2(0x03, [p.central, 3], ZONE.all)]
  : [e2(0x03, [p.central, 3], ZONE.dash), e2(0x03, [p.doors, 3], ZONE.doors | ZONE.rear)];

const IRID_NAMES = ["Auto loop", "Positive Iridescence", "Reverse Iridescence", "Colorful Energy", "Seven Color Jump", "RGB Jump", "YBP Jump", "Seven Color Strobe", "RGB Strobe", "YBP Strobe", "Seven Color Gradient", "RY Alternate Gradient", "RP Alternate Gradient", "GB Alternate Gradient", "GY Alternate Gradient", "BP Alternate Gradient", "R Horse Racing", "G Horse Racing", "B Horse Racing", "Y Horse Racing", "BB Horse Racing", "P Horse Racing", "W Horse Racing", "Positive Colorful Follow Light", "Reverse Colorful Follow Light", "Positive RGB Follow Light", "Reverse RGB Follow Light", "Positive YBP Follow Light", "Reverse YBP Follow Light", "Positive Colorful Float", "Reverse Colorful Float", "Positive RGB Float", "Reverse RGB Float", "Positive YBP Float", "Reverse YBP Float", "Positive Colorful Brush", "Reverse Colorful Brush", "Positive RGB Brush", "Reverse RGB Brush", "Positive YBP Brush", "Reverse YBP Brush", "Colorful Brush Closing", "Colorful Brush Draw Curtain", "RGB Brush Closing", "RGB Brush Draw Curtain", "YBP Brush Closing", "YBP Brush Draw Curtain", "Colorful Closing", "Colorful Draw Curtain", "RGB Closing", "RGB Draw Curtain", "YBP Closing", "YBP Draw Curtain", "R Closing", "R Draw Curtain", "G Closing", "G Draw Curtain", "B Closing", "B Draw Curtain", "Y Closing", "Y Draw Curtain", "BB Closing", "BB Draw Curtain", "P Closing", "P Draw Curtain", "W Closing", "W Draw Curtain", "Positive Colorful ld Trans", "Reverse Colorful ld Trans", "Positive RGB ld Trans", "Reverse RGB ld Trans", "Positive YBP ld Trans", "Reverse YBP ld Trans", "Positive Six Color ld Trans R", "Reverse Six Color ld Trans R", "Positive Six Color ld Trans G", "Reverse Six Color ld Trans G", "Positive Six Color ld Trans B", "Reverse Six Color ld Trans B", "Positive Six Color ld Trans BB", "Reverse Six Color ld Trans BB", "Positive Six Color ld Trans Y", "Reverse Six Color ld Trans Y", "Positive Six Color ld Trans P", "Reverse Six Color ld Trans P", "Positive Six Color ld Trans W", "Reverse Six color ld trans w", "Positive Colorful Running Water", "Reverse Colorful Running Water", "Positive RGB Running Water", "Reverse RGB Running Water", "Positive YBP Running Water", "Reverse YBP Running Water", "Positive RG Running Water", "Reverse RG Running Water", "Positive GB Running Water", "Reverse GB Running Water", "Positive YB Running Water", "Reverse YB Running Water", "Positive YBB Running Water", "Reverse YBB Running Water", "Positive BBP Running Water", "Reverse BBP Running Water", "Positive Black W Running Water", "Reverse Black W Running water", "Positive WRW Flow", "Reverse WRW Flow", "Positive WGW Flow", "Reverse WGW Flow", "Positive WBW Flow", "Reverse WBW Flow", "Positive WYW Flow", "Reverse WYW Flow", "Positive WBBW Flow", "Reverse WBBW Flow", "Positive WPW Flow", "Reverse WPW Flow", "Positive RWR Flow", "Reverse RWR Flow", "Positive GWG Flow", "Reverse GWG Flow", "Positive BWB Flow", "Reverse BWB Flow", "Positive YWY Flow", "Reverse YWY Flow", "Positive BBWBB Flow", "Reverse BBWBB Flow", "Positive PWP Flow", "Reverse PWP Flow", "Positive Colorful Tailing", "Reverse Colorful Tailing", "Positive R Tailing", "Reverse R Tailing", "Positive G Tailing", "Reverse G Tailing", "Positive B Tailing", "Reverse B Tailing", "Positive Y Tailing", "Reverse Y Tailing", "Positive BB Tailing", "Reverse BB Tailing", "Positive P Tailing", "Reverse P Tailing", "Positive W Tailing", "Reverse W Tailing", "Positive R Running", "Positive G Running", "Positive B Running", "Positive Y Running", "Positive BB Running", "Positive P Running", "Positive W Running", "Positive Colorful Running", "Positive RGB Running", "Positive YBP Running", "Positive BPBY Running", "Positive BGBY Running", "Positive WR Running", "Positive RG Running", "Positive GB Running", "Positive BY Running", "Positive YBB Running", "Positive BBP Running", "Positive PW Running", "Positive RW Running", "Positive R Colorful Running", "Positive G Colorful Running", "Positive B Colorful Running", "Positive Y Colorful Running", "BB Colorful Running", "P Colorful Running", "W Colorful Running", "BG Running", "RRG Running", "BR Running", "YYBB Running", "PY Running", "YW Running", "WY Running", "Reverse R Running", "Reverse G Running", "Reverse B Running", "Reverse Y running", "Reverse BB Running", "Reverse P Running", "Reverse W Running", "Reverse Colorful Running", "Reverse RGB Running", "Reverse YBP Running", "Reverse BPBBY Running", "Reverse BGBBY Running", "Reverse WR Running", "Reverse RG Running", "Reverse GB Running", "Reverse BY Running", "Reverse YBB Running", "Reverse BBP Running", "Reverse PW Running", "Reverse RW Running", "Reverse R Colorful Running", "Reverse G Colorful Running", "Reverse B Colorful Running", "Reverse Y Colorful Running", "Reverse BB Colorful Running", "Reverse P Colorful Running", "Reverse W Colorful Running", "Reverse BG Running", "Reverse RRG Running", "Reverse BR Running", "Reverse YYBB Running", "Reverse PY Running", "Reverse YW Running", "Reverse WY Running"];
const IRID_CMDS = [0, 1, 2, 212, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 89, 91, 93, 95, 97, 99, 101, 103, 105, 107, 109, 111, 113, 115, 117, 119, 121, 123, 125, 127, 129, 131, 133, 135, 137, 139, 141, 167, 169, 171, 173, 175, 177, 179, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 142, 168, 170, 172, 174, 176, 178, 180];
export const STRIP_MODES = IRID_NAMES.map((n, i) => [IRID_CMDS[i], n]);
// ModeFragment.otherSymphonyCMDs (213-233), names from item_mode_car_door_symphony_other_cmd_array
const EXTRA_NAMES = ["Special seven-color opening at 25 point", "Orange red dark bright dark filtered running water", "Yellow green dark bright dark filtered running water", "Green dark bright dark filtered running water", "Green blue dark bright dark filtered running water", "Blue dark bright dark filtered running water", "Purple dark light dark filtered running water", "Red dark bright dark filtered running water", "Seven-color stacking", "Orange stacking", "Yellow-green stacking", "Green stacking", "Cyan-blue stacking", "Blue stacking", "Purple stacking", "Red stacking", "Colorful gradient", "Colorful transition", "Red-purple transition", "Yellow-white transition", "Yellow-orange transition"];
export const STRIP_MODES_EXTRA = EXTRA_NAMES.map((n, i) => [213 + i, n]);
// ELKDevice.isSupportedOtherSpecialMode: MELK/MHRS name whose first two digits are >= 21
export const hasExtraModes = name => /^(MELK|MHRS)/.test(name) && +name.replace(/\D/g, "").slice(0, 2) >= 21;
export const SCENES = [[1, "Sunrise"], [2, "Sunset"], [3, "Birthday"], [4, "Candlelight"], [5, "Fireworks"], [7, "Dating"], [8, "Starry Sky"], [9, "Romantic"], [10, "Disco"], [11, "Rainbow"],
  [13, "Christmas Eve"], [14, "Running Water"], [16, "Ocean"], [17, "Forest"], [18, "Read"], [20, "Colorful"], [21, "Soft"], [22, "Wedding Anniversary"], [23, "Snowflake"], [24, "Flame"],
  [25, "Lightning"], [26, "Valentine Day"], [28, "Alarm"], [150, "Time Machine"], [152, "Time Machine Two"], [154, "Meteor"], [155, "Meteor Two"], [156, "Fireworks Show"]];
// ModeFragment.getSymphonySceneArray: no P in name = normal list, P and Q = "Q" list, P only = none
const SCENES_NORMAL = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 20, 21, 22, 24, 26, 28]);
const SCENES_Q = new Set([4, 5, 8, 9, 10, 13, 14, 16, 17, 18, 20, 21, 22, 23, 24, 25, 28, 150, 152, 154, 155, 156]);
export function scenesFor(name) {
  const set = !/p/i.test(name) ? SCENES_NORMAL : /q/i.test(name) ? SCENES_Q : null;
  return set ? SCENES.filter(([id]) => set.has(id)) : [];
}

export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
