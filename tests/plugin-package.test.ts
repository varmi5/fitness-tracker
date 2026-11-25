import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("download package check rejects stale OAuth compatibility and old site artwork without rewriting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "fitness-package-"));
  const check = () => spawnSync("python3", ["scripts/build-plugin.py", "--check"], { cwd: root, encoding: "utf8" });
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "lib"));
    await mkdir(join(root, "public"));
    await cp("plugins", join(root, "plugins"), { recursive: true });
    await cp("scripts/build-plugin.py", join(root, "scripts/build-plugin.py"));
    await cp("lib/mcp-tools.ts", join(root, "lib/mcp-tools.ts"));
    await cp("skills", join(root, "skills"), { recursive: true });
    for (const file of ["icon-512.png", "icon.svg", "fitnesstrackr-plugin.zip"]) await cp(join("public", file), join(root, "public", file));
    const archive = join(root, "public/fitnesstrackr-plugin.zip");
    const originalZip = await readFile(archive);
    assert.equal(check().status, 0);
    assert.deepEqual(await readFile(archive), originalZip, "check mode must be read-only");

    const compatibility = join(root, "plugins/mcp-logger/.mcp.json");
    const originalCompatibility = await readFile(compatibility);
    const oldScopes = JSON.parse(originalCompatibility.toString());
    oldScopes.mcpServers["mcp-logger"].extensions["com.openai"].auth.baseScopes = ["fitness:read"];
    await writeFile(compatibility, JSON.stringify(oldScopes));
    assert.notEqual(check().status, 0, "read-only legacy config must not ship with meal logging");
    assert.deepEqual(await readFile(archive), originalZip, "a failed check must not repair or overwrite source");
    await writeFile(compatibility, originalCompatibility);

    // Simulate a changed site asset to catch a package retaining previous branding.
    const artwork = await readFile(join(root, "public/icon-512.png"));
    const different = Buffer.from(artwork);
    different[different.length - 1] ^= 1;
    await writeFile(join(root, "public/icon-512.png"), different);
    assert.notEqual(check().status, 0, "the ZIP and source must not silently retain old site branding");
    assert.deepEqual(await readFile(archive), originalZip);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
