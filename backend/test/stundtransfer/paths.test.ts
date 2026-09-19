// StundTransfer: unit tests for name sanitizing and path containment.
// Run with: npm run test:stundtransfer
import { strict as assert } from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, it } from "node:test";
import {
  MAX_NAME_FIELD_LENGTH,
  MAX_SEGMENT_BYTES,
  candidateNames,
  depositFolderName,
  findExistingFolderName,
  resolveInside,
  sanitizeRelativePath,
  sanitizeSegment,
} from "../../src/stundtransfer/paths";

describe("sanitizeSegment", () => {
  it("keeps normal camera file names untouched", () => {
    assert.equal(sanitizeSegment("A001_C003_0101AB.MP4"), "A001_C003_0101AB.MP4");
    assert.equal(sanitizeSegment("Interview été 2026 🎬.mov"), "Interview été 2026 🎬.mov");
  });

  it("replaces characters forbidden on Windows/Synology", () => {
    assert.equal(sanitizeSegment('a<b>c:d"e|f?g*h.mp4'), "a_b_c_d_e_f_g_h.mp4");
    assert.equal(sanitizeSegment("a/b\\c"), "a_b_c");
    assert.equal(sanitizeSegment("bad\u0000name\u0007.mp4"), "bad_name_.mp4");
  });

  it("collapses whitespace and trims", () => {
    assert.equal(sanitizeSegment("   Litsu   \t  Beam\nng  "), "Litsu Beam ng");
  });

  it("removes leading dots (hidden files, ..) and trailing dots/spaces", () => {
    assert.equal(sanitizeSegment(".."), "");
    assert.equal(sanitizeSegment("."), "");
    assert.equal(sanitizeSegment("...hidden"), "hidden");
    assert.equal(sanitizeSegment("clip.mp4. . "), "clip.mp4");
  });

  it("neutralises Windows and Synology reserved names", () => {
    assert.equal(sanitizeSegment("CON"), "_CON");
    assert.equal(sanitizeSegment("nul.txt"), "_nul.txt");
    assert.equal(sanitizeSegment("com1"), "_com1");
    assert.equal(sanitizeSegment("console.mp4"), "console.mp4");
    assert.equal(sanitizeSegment("@eaDir"), "_@eaDir");
    assert.equal(sanitizeSegment("#recycle"), "_#recycle");
  });

  it("normalises Unicode to NFC (macOS sends decomposed accents)", () => {
    const decomposed = "e" + String.fromCodePoint(0x301) + "te" + String.fromCodePoint(0x301) + ".mp4";
    assert.equal(sanitizeSegment(decomposed), "\xe9t\xe9.mp4");
  });

  it("truncates very long names by bytes, keeping the extension", () => {
    const long = "é".repeat(300) + ".braw";
    const result = sanitizeSegment(long);
    assert.ok(Buffer.byteLength(result, "utf8") <= MAX_SEGMENT_BYTES);
    assert.ok(result.endsWith(".braw"));
    assert.ok(!result.includes(String.fromCodePoint(0xfffd)));
  });
});

describe("sanitizeRelativePath", () => {
  it("keeps the folder structure", () => {
    assert.deepEqual(sanitizeRelativePath("Card A/CLIP/A001.MP4"), [
      "Card A",
      "CLIP",
      "A001.MP4",
    ]);
  });

  it("drops path traversal and absolute parts", () => {
    assert.deepEqual(sanitizeRelativePath("../../etc/passwd"), ["etc", "passwd"]);
    assert.deepEqual(sanitizeRelativePath("/abs/../x.mp4"), ["abs", "x.mp4"]);
    assert.deepEqual(sanitizeRelativePath("..\\..\\Windows\\win.ini"), [
      "Windows",
      "win.ini",
    ]);
    assert.deepEqual(sanitizeRelativePath("C:\\Users\\clip.mp4"), [
      "C_",
      "Users",
      "clip.mp4",
    ]);
  });

  it("never returns an empty file name", () => {
    assert.deepEqual(sanitizeRelativePath(""), ["fichier"]);
    assert.deepEqual(sanitizeRelativePath("../.."), ["fichier"]);
    assert.deepEqual(sanitizeRelativePath("dossier/..."), ["dossier", "fichier"]);
  });

  it("drops folders that are empty after cleaning", () => {
    assert.deepEqual(sanitizeRelativePath("a/.../b/c.mp4"), ["a", "b", "c.mp4"]);
  });
});

describe("depositFolderName", () => {
  it('builds "<Nom> - <Vidéo>"', () => {
    assert.equal(depositFolderName("Litsu", "Beamng"), "Litsu - Beamng");
    assert.equal(depositFolderName("  Litsu ", " Beam/ng "), "Litsu - Beam_ng");
  });

  it("rejects empty fields (even after cleaning)", () => {
    assert.throws(() => depositFolderName("", "Beamng"));
    assert.throws(() => depositFolderName("Litsu", "   "));
    assert.throws(() => depositFolderName("..", "Beamng"));
  });

  it("limits the length of each field", () => {
    const name = depositFolderName("x".repeat(500), "y".repeat(500));
    assert.equal(name, `${"x".repeat(MAX_NAME_FIELD_LENGTH)} - ${"y".repeat(MAX_NAME_FIELD_LENGTH)}`);
  });
});

describe("resolveInside", () => {
  const root = path.resolve(os.tmpdir(), "transfer-root");

  it("accepts paths inside the root", () => {
    assert.equal(
      resolveInside(root, "Litsu - Beamng", "A001.MP4"),
      path.join(root, "Litsu - Beamng", "A001.MP4"),
    );
  });

  it("rejects anything that escapes the root", () => {
    assert.throws(() => resolveInside(root, ".."));
    assert.throws(() => resolveInside(root, "..", "etc", "passwd"));
    assert.throws(() => resolveInside(root, "a", "..", "..", "b"));
    assert.throws(() => resolveInside(root, path.resolve("/etc/passwd")));
    assert.throws(() => resolveInside(root, ""));
  });

  it("rejects a sibling folder sharing the same prefix", () => {
    assert.throws(() => resolveInside(root, "..", "transfer-root-evil", "x"));
  });
});

describe("candidateNames", () => {
  it('adds " (2)", " (3)"... before the extension', () => {
    const names = candidateNames("clip.mp4");
    assert.equal(names.next().value, "clip.mp4");
    assert.equal(names.next().value, "clip (2).mp4");
    assert.equal(names.next().value, "clip (3).mp4");
  });

  it("works without extension", () => {
    const names = candidateNames("README");
    names.next();
    assert.equal(names.next().value, "README (2)");
  });
});

describe("findExistingFolderName", () => {
  it("reuses an existing folder regardless of case", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "stund-"));
    try {
      await fs.mkdir(path.join(root, "Litsu - Beamng"));
      assert.equal(await findExistingFolderName(root, "Litsu - Beamng"), "Litsu - Beamng");
      assert.equal(await findExistingFolderName(root, "litsu - BEAMNG"), "Litsu - Beamng");
      assert.equal(await findExistingFolderName(root, "Litsu - Autre"), "Litsu - Autre");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns the requested name when the root does not exist yet", async () => {
    assert.equal(
      await findExistingFolderName(path.join(os.tmpdir(), "does-not-exist-xyz"), "A - B"),
      "A - B",
    );
  });
});
