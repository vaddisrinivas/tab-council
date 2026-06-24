import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("manifest keeps host permissions narrow and icons present", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const origins = manifest.optional_host_permissions ?? [];

  assert.equal(origins.includes("https://*/*"), false);
  assert.equal(origins.includes("http://*/*"), false);
  assert.ok(origins.includes("https://chatgpt.com/*"));
  assert.ok(origins.includes("https://extension.getmerlin.in/*"));
  assert.ok(origins.includes("http://localhost/*"));
  assert.deepEqual(manifest.externally_connectable?.ids, ["*"]);

  for (const iconPath of Object.values(manifest.icons ?? {})) {
    await access(new URL(`../${iconPath}`, import.meta.url));
  }
});
