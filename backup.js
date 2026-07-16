"use strict";

/* ================= Backup: export/import all plays as a .zip =================
Shares globals with app.js (plays, save, migratePlay, migrateBall, openModal,
t, renderHome, $) and export.js (exDownload).
*/

/* ---------------- Minimal ZIP (store) writer ---------------- */

function crc32(u8) {
  if (!crc32.table) {
    const tbl = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tbl[n] = c >>> 0;
    }
    crc32.table = tbl;
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = crc32.table[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name: string, data: Uint8Array}] — entries are stored uncompressed.
function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);        // version needed
    lh.setUint16(6, 0x0800, true);    // UTF-8 names
    lh.setUint16(8, 0, true);         // method: store
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    central.push({ name, crc, size: f.data.length, offset });
    offset += 30 + name.length + f.data.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true);
    ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.name.length, true);
    ch.setUint32(42, c.offset, true);
    parts.push(new Uint8Array(ch.buffer), c.name);
    offset += 46 + c.name.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, offset - cdStart, true);
  eocd.setUint32(16, cdStart, true);
  parts.push(new Uint8Array(eocd.buffer));
  return new Blob(parts, { type: "application/zip" });
}

/* ---------------- Minimal ZIP reader ---------------- */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns [{name, bytes}]. Supports stored and deflated entries.
async function readZip(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = [];

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.slice(dataStart, dataStart + compSize);

    if (method === 0) files.push({ name, bytes: raw });
    else if (method === 8) files.push({ name, bytes: await inflateRaw(raw) });
    // other methods: skip silently

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------- Backup logic ---------------- */

// With no argument every play is exported; a subset (e.g. the plays
// selected on the home screen) can be passed explicitly.
function exportBackup(subset) {
  const list = Array.isArray(subset) && subset.length ? subset : plays;
  const json = JSON.stringify(
    { app: "playbook", version: 3, exportedAt: new Date().toISOString(), plays: list },
    null,
    2
  );
  const blob = makeZip([{ name: "playbook.json", data: new TextEncoder().encode(json) }]);
  exDownload(blob, "playbook-backup-" + new Date().toISOString().slice(0, 10) + ".zip");
}

// Import plays from a backup zip: always added as fresh copies (never
// overriding existing plays), marked with an "imported" badge in the list.
async function importBackup(buffer) {
  const entries = await readZip(buffer);
  const dec = new TextDecoder();
  let imported = null;
  for (const e of entries) {
    if (!e.name.toLowerCase().endsWith(".json")) continue;
    try {
      const data = JSON.parse(dec.decode(e.bytes));
      const list = Array.isArray(data) ? data : data.plays;
      if (Array.isArray(list)) imported = (imported || []).concat(list);
    } catch (_) { /* not one of ours — keep looking */ }
  }
  if (!imported) throw new Error("no plays found");

  let added = 0;
  for (const raw of imported) {
    if (!raw || typeof raw !== "object" || !raw.id || !raw.name ||
        !Array.isArray(raw.steps) || !raw.steps.length) continue;
    const p = normalizePassTimings(migrateBall(migratePlay(raw)));
    p.id = "play-" + Math.random().toString(36).slice(2, 10);
    p.imported = true;
    p.name = uniquePlayName(p.name);
    plays.push(p);
    added++;
  }
  save();
  return { added };
}

/* ---------------- Wiring ---------------- */

$("exportAllBtn").addEventListener("click", () => exportBackup());

$("importAllBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { added } = await importBackup(await file.arrayBuffer());
    renderHome();
    await openModal({
      title: t("importDoneTitle"),
      message: t("importDoneMsg", added),
      confirmLabel: "OK",
      noCancel: true,
    });
  } catch (_) {
    await openModal({
      title: t("importErrTitle"),
      message: t("importErrMsg"),
      confirmLabel: "OK",
      noCancel: true,
    });
  }
});
