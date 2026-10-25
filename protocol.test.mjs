// npm test  (from web/)
import test from "node:test";
import assert from "node:assert/strict";
import { e1, e2, isSafe, hex, MAIN, STRIP, STRIP_MODES, PRESETS, presetFrames, ZONE, MIC_STRIP, isSupported, scenesFor, hasExtraModes } from "./protocol.js";

test("frames match bytes copied from the decompiled app", () => {
  assert.equal(hex(MAIN.mode(0x8a, ZONE.all)), "8E 04 03 8A 03 70");          // CommonUtils.getModeCommand
  assert.equal(hex(MAIN.color([255, 0, 0], ZONE.all)), "8E 07 05 03 FF 00 00 10 70");
  assert.equal(hex(MAIN.color([1, 2, 3], ZONE.all, true)), "8E 07 05 03 01 02 03 20 70"); // phone music sync
  assert.equal(hex(MAIN.sync(new Date(2026, 0, 4, 1, 2, 3))), "8E 06 83 01 02 03 00 00"); // Sunday = 0
  assert.equal(hex(e1(0x88, [0, 0xff, 0xff, 0xff, 0])), "7E 07 88 00 FF FF FF 00 EF"); // switchHost()
  assert.equal(hex(STRIP.mode(0x07)), "7E 07 03 07 06 FF FF 00 EF");
  assert.equal(hex(STRIP.scene(28)), "7E 07 31 1C 07 FF FF 00 EF");
});

test("DIY burst: header, one frame per colour, close", () => {
  const f = MAIN.diy([[255, 0, 0], [0, 0, 255]], { bright: 80, speed: 50, mode: 2 }, ZONE.all).map(hex);
  assert.deepEqual(f, [
    "8E 08 0A 00 01 50 32 02 01 70",
    "8E 06 0A 01 FF 00 00 70",
    "8E 06 0A 02 00 00 FF 70",
    "8E 08 0A 00 01 50 32 02 02 70",
    "8E 08 0A 00 01 50 32 02 03 70",
  ]);
});

test("safety lock passes display commands, blocks setup commands", () => {
  for (const f of [MAIN.color([1, 2, 3], ZONE.all), STRIP.scene(5), MAIN.bright(0, ZONE.all), ...presetFrames(PRESETS[1])])
    assert.ok(isSafe(f), hex(f));
  for (const f of [
    e2(0x87, [], 0x70),                 // factory reset
    e2(0x81, [1, 2, 3], 0xf0),          // wiring order
    e1(0x88, [0, 0xff, 0xff, 0xff, 0]), // switch host
    e1(0xd0, [80, 40, 40, 40, 40]),     // LED counts
    e1(0xd5, [1, 2]),                   // group recognition
    e2(0x01, [0], 0x70),                // brightness 0
    e2(0x05, [3, 1, 2], 0x70).slice(0, 5), // truncated
  ]) assert.ok(!isSafe(f), hex(f));
});

test("sliders are clamped into the range the app sends", () => {
  assert.equal(hex(MAIN.bright(0, ZONE.all)), "8E 03 01 01 70");
  assert.equal(hex(STRIP.speed(250)), "7E 07 02 64 FF FF FF 00 EF");
});

test("tables are aligned", () => {
  assert.equal(STRIP_MODES.length, 213);
  assert.ok(STRIP_MODES.every(([id, n]) => Number.isInteger(id) && n));
  assert.equal(new Set(STRIP_MODES.map(m => m[0])).size, STRIP_MODES.length);
  assert.ok(PRESETS.every(p => p.central && p.doors && p.strip != null));
});

test("seed looks build safe frames for the right controller", async () => {
  const { SEED, lookFrames, kindOf, swatchOf } = await import("./looks.js");
  for (const look of SEED) {
    const f = lookFrames(look);
    assert.ok(f.main.length && f.strip.length, look.name);
    assert.ok(f.main.every(x => x[0] === 0x8e && isSafe(x)) && f.strip.every(x => x[0] === 0x7e && isSafe(x)), look.name);
    assert.ok(swatchOf(look).length >= 1);
  }
  const cop = lookFrames(SEED.find(l => l.id === "cop"));
  assert.deepEqual([...cop.main, ...cop.strip].map(hex), ["8E 04 03 96 03 10", "8E 04 03 98 03 60", "7E 07 31 1C 07 FF FF 00 EF"]);
  assert.deepEqual(SEED.map(kindOf), ["flow", "static", "music", "strobe", "flow", "static"]);
});

test("device-name rules mirror the APK", () => {
  assert.deepEqual([MIC_STRIP[0][0], MIC_STRIP.at(-1)[0]], [0x80, 0x87]); // AppConstant.irNums
  assert.ok(isSupported("MELK-QA21") && isSupported("MELK-O81") && !isSupported("MELK-OW81") && !isSupported("JBL"));
  assert.equal(scenesFor("MELK-O81").length, 16);
  assert.equal(scenesFor("MELK-QPA25").length, 22);
  assert.equal(scenesFor("MELK-OP25").length, 0);
  assert.ok(hasExtraModes("MELK-QA21") && !hasExtraModes("MELK-QA19") && !hasExtraModes("HRS-MBLEM30"));
  assert.ok(!isSafe(e1(0x83, [1, 2, 3, 0, 0])));                         // no E1 clock sync
});