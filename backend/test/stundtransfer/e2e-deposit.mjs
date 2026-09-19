// StundTransfer: end-to-end test of the deposit API against a running backend.
//
// Needs a backend started with STUNDTRANSFER_TRANSFER_DIR set, and two reverse
// shares in its database: TOKEN (valid, remaining uses >= 2, max size >= 20 MB)
// and EXHAUSTED_TOKEN (remaining uses = 0).
//
//   BASE_URL=http://localhost:8089/api TRANSFER_DIR=/path/to/transfer \
//   [DB_PATH=/path/to/pingvin-share.db] node test/stundtransfer/e2e-deposit.mjs
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8089/api";
const TOKEN = process.env.TOKEN ?? "depot-test";
const EXHAUSTED_TOKEN = process.env.EXHAUSTED_TOKEN ?? "lien-epuise";
const TRANSFER = process.env.TRANSFER_DIR;
const STAGING =
  process.env.STAGING_DIR ?? path.join(path.dirname(TRANSFER ?? "."), "en-cours");
const DB_PATH = process.env.DB_PATH;
if (!TRANSFER) throw new Error("TRANSFER_DIR is required");

const MTIME = Date.UTC(2026, 0, 2, 3, 4, 5);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const exists = (p) => access(p).then(() => true, () => false);
let step = 0;
const ok = (label) => console.log(`  ✔ ${++step}. ${label}`);

async function api(method, url, { body, secret, raw } = {}) {
  const headers = {};
  if (secret) headers["x-deposit-secret"] = secret;
  if (raw !== undefined) headers["content-type"] = "application/octet-stream";
  else if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(BASE + url, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

function file(filePath, size) {
  return { path: filePath, data: randomBytes(size), lastModified: MTIME };
}

async function startDeposit(uploaderName, videoName, files) {
  const created = await api("POST", "/stundtransfer/deposits", {
    body: {
      token: TOKEN,
      uploaderName,
      videoName,
      fileCount: files.length,
      totalSize: files.reduce((s, f) => s + f.data.length, 0),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const { depositId, secret, chunkSize } = created.json;
  const registered = await api("POST", `/stundtransfer/deposits/${depositId}/files`, {
    secret,
    body: {
      files: files.map((f) => ({ path: f.path, size: f.data.length, lastModified: f.lastModified })),
    },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.json));
  const ids = new Map(registered.json.files.map((f) => [f.path, f.id]));
  return { depositId, secret, chunkSize, files: files.map((f) => ({ ...f, id: ids.get(f.path) })) };
}

function chunkJobs(deposit, skip = () => false) {
  const jobs = [];
  for (const f of deposit.files) {
    const total = Math.max(1, Math.ceil(f.data.length / deposit.chunkSize));
    for (let index = 0; index < total; index++) {
      if (skip(f, index, total)) continue;
      jobs.push({ f, index });
    }
  }
  // Random order on purpose: the server must accept chunks in any order
  return jobs.sort(() => Math.random() - 0.5);
}

async function uploadJobs(deposit, jobs, parallel = 4) {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (queue.length) {
        const { f, index } = queue.shift();
        const data = f.data.subarray(index * deposit.chunkSize, (index + 1) * deposit.chunkSize);
        const r = await api(
          "PUT",
          `/stundtransfer/deposits/${deposit.depositId}/files/${f.id}/chunks/${index}`,
          { secret: deposit.secret, raw: data },
        );
        assert.equal(r.status, 200, `chunk ${f.path}#${index}: ${JSON.stringify(r.json)}`);
      }
    }),
  );
}

async function waitForFile(p, timeoutMs = 10000) {
  const start = Date.now();
  while (!(await exists(p))) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${p}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function remainingUses() {
  if (!DB_PATH) return undefined;
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db.prepare("SELECT remainingUses FROM ReverseShare WHERE token = ?").get(TOKEN)
    .remainingUses;
}

console.log("StundTransfer e2e deposit test");
const usesBefore = await remainingUses();

// --- Link checks
let r = await api("GET", `/stundtransfer/links/${TOKEN}`);
assert.equal(r.status, 200);
assert.equal(r.json.depositMode, true);
ok(`deposit link valid (chunk size ${r.json.chunkSize} B, ${r.json.parallelUploads} parallel)`);

r = await api("GET", `/stundtransfer/links/${EXHAUSTED_TOKEN}`);
assert.equal(r.status, 404);
assert.equal(r.json.error, "stund_link_invalid");
r = await api("POST", "/stundtransfer/deposits", {
  body: { token: EXHAUSTED_TOKEN, uploaderName: "A", videoName: "B", fileCount: 1, totalSize: 1 },
});
assert.equal(r.status, 404);
ok("link with no remaining use is refused");

r = await api("GET", "/stundtransfer/links/nexiste-pas");
assert.equal(r.status, 404);
ok("unknown link is refused");

for (const [uploaderName, videoName] of [["..", "Beamng"], ["Litsu", "   "], ["", "x"]]) {
  r = await api("POST", "/stundtransfer/deposits", {
    body: { token: TOKEN, uploaderName, videoName, fileCount: 1, totalSize: 1 },
  });
  assert.ok([400].includes(r.status), `names ${uploaderName}/${videoName}: ${r.status}`);
}
ok('empty "Qui es-tu ?" / "Pour quelle vidéo ?" are refused');

r = await api("POST", "/stundtransfer/deposits", {
  body: { token: TOKEN, uploaderName: "A", videoName: "B", fileCount: 1, totalSize: 10 ** 12 },
});
assert.equal(r.status, 413);
assert.equal(r.json.error, "stund_too_large");
ok("deposit bigger than the link's max size is refused");

// --- Deposit A
const filesA = [
  file("Rushes/Card A/A001.MP4", 5_500_000),
  file("Rushes/Card A/A002.MP4", 1_000_000),
  file("../../evil.txt", 1000),
  file("empty.txt", 0),
  file("clip:bad?.mov", 2_500_000),
];
const A = await startDeposit("  Litsu ", "Beamng", filesA);
ok(`deposit A started (${A.files.length} files)`);

r = await api("POST", `/stundtransfer/deposits/${A.depositId}/files`, {
  secret: A.secret,
  body: { files: [{ path: filesA[0].path, size: filesA[0].data.length }] },
});
assert.equal(r.status, 201);
assert.equal(r.json.files[0].id, A.files[0].id);
ok("re-sending a file batch is harmless (same ids)");

r = await api("POST", `/stundtransfer/deposits/${A.depositId}/files`, {
  secret: A.secret,
  body: { files: [{ path: "extra.bin", size: 1 }] },
});
assert.equal(r.status, 400);
assert.equal(r.json.error, "stund_too_many_files");
ok("more files than announced are refused");

const a001 = A.files[0];
r = await api("PUT", `/stundtransfer/deposits/${A.depositId}/files/${a001.id}/chunks/0`, {
  secret: "wrong-secret",
  raw: a001.data.subarray(0, A.chunkSize),
});
assert.equal(r.status, 403);
r = await api("PUT", `/stundtransfer/deposits/${A.depositId}/files/${a001.id}/chunks/0`, {
  raw: a001.data.subarray(0, A.chunkSize),
});
assert.equal(r.status, 403);
ok("chunks without the right deposit key are refused");

r = await api("PUT", `/stundtransfer/deposits/${A.depositId}/files/${a001.id}/chunks/0`, {
  secret: A.secret,
  raw: a001.data.subarray(0, 10),
});
assert.equal(r.status, 400);
assert.equal(r.json.error, "stund_bad_chunk");
r = await api("PUT", `/stundtransfer/deposits/${A.depositId}/files/${a001.id}/chunks/99`, {
  secret: A.secret,
  raw: Buffer.alloc(0),
});
assert.equal(r.status, 400);
ok("truncated or out-of-range chunks are refused");

// Everything except the last chunk of A001, in random order, 4 at a time, plus a duplicate
await uploadJobs(A, chunkJobs(A, (f, index, total) => f === a001 && index === total - 1));
await uploadJobs(A, [{ f: a001, index: 1 }]);
ok("chunks accepted in random order, 4 in parallel (a duplicate chunk is harmless)");

r = await api("POST", `/stundtransfer/deposits/${A.depositId}/complete`, { secret: A.secret });
assert.equal(r.status, 409);
assert.equal(r.json.error, "stund_incomplete");
assert.deepEqual(r.json.missingFiles, [a001.id]);
ok("finishing is refused while a chunk is missing");

r = await api("GET", `/stundtransfer/deposits/${A.depositId}`, { secret: A.secret });
assert.equal(r.status, 200);
const stateA001 = r.json.files.find((f) => f.id === a001.id);
assert.equal(stateA001.status, "UPLOADING");
assert.deepEqual(stateA001.receivedChunks, [0, 1, 2, 3, 4]);
assert.ok(r.json.files.filter((f) => f.id !== a001.id).every((f) => f.status === "UPLOADED"));
ok("resume info lists exactly the chunks already received");

await uploadJobs(A, [{ f: a001, index: stateA001.totalChunks - 1 }]);
r = await api("POST", `/stundtransfer/deposits/${A.depositId}/complete`, { secret: A.secret });
assert.equal(r.status, 202);
assert.equal(r.json.status, "RECEIVED");
r = await api("POST", `/stundtransfer/deposits/${A.depositId}/complete`, { secret: A.secret });
assert.equal(r.status, 202);
ok("deposit A received (finishing twice is harmless)");

r = await api("PUT", `/stundtransfer/deposits/${A.depositId}/files/${a001.id}/chunks/0`, {
  secret: A.secret,
  raw: a001.data.subarray(0, A.chunkSize),
});
assert.equal(r.status, 409);
ok("no more chunks accepted once received");

const folderA = path.join(TRANSFER, "Litsu - Beamng");
const expectedA = [
  [filesA[0], "Rushes/Card A/A001.MP4"],
  [filesA[1], "Rushes/Card A/A002.MP4"],
  [filesA[2], "evil.txt"],
  [filesA[3], "empty.txt"],
  [filesA[4], "clip_bad_.mov"],
];
for (const [f, relative] of expectedA) {
  const target = path.join(folderA, ...relative.split("/"));
  await waitForFile(target);
  assert.equal(sha(await readFile(target)), sha(f.data), `content of ${relative}`);
  assert.equal((await stat(target)).mtime.getTime(), MTIME, `mtime of ${relative}`);
}
ok('files are in "Litsu - Beamng/" with the right names, folders, content and dates');

assert.deepEqual((await readdir(path.dirname(TRANSFER))).sort(), ["en-cours", "transfer"]);
assert.equal(await exists(path.join(STAGING, A.depositId)), false);
ok("nothing written outside the transfer folder, staging cleaned (no duplicate kept)");

// --- Deposit B: same person/video with other casing, same file name
const filesB = [file("Rushes/Card A/A001.MP4", 1_200_000)];
const B = await startDeposit("litsu", "BEAMNG", filesB);
await uploadJobs(B, chunkJobs(B));
r = await api("POST", `/stundtransfer/deposits/${B.depositId}/complete`, { secret: B.secret });
assert.equal(r.status, 202);
const renamed = path.join(folderA, "Rushes", "Card A", "A001 (2).MP4");
await waitForFile(renamed);
assert.equal(sha(await readFile(renamed)), sha(filesB[0].data));
assert.equal(
  sha(await readFile(path.join(folderA, "Rushes", "Card A", "A001.MP4"))),
  sha(filesA[0].data),
);
assert.deepEqual(await readdir(TRANSFER), ["Litsu - Beamng"]);
ok('2nd deposit "litsu"/"BEAMNG" reuses the folder, nothing overwritten ("A001 (2).MP4")');

// --- Admin routes need a signed-in user
r = await api("GET", "/stundtransfer/admin/deposits");
assert.equal(r.status, 403);
ok("deposit history is not visible without signing in");

const usesAfter = await remainingUses();
if (usesBefore !== undefined) {
  assert.equal(usesAfter, usesBefore - 2);
  ok(`link uses counted (${usesBefore} -> ${usesAfter})`);
}

console.log(`\nAll ${step} checks passed.`);
