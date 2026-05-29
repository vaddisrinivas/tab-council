import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_PROVIDER_CASES } from "../test/fixtures/fake-provider-cases.mjs";

const port = Number(process.env.PORT || 4173);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "test", "fixtures");
const providerRoutes = new Set(FAKE_PROVIDER_CASES.map((provider) => provider.id));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  const filename = filenameForPath(pathname);
  const filePath = filename ? resolve(root, filename) : "";

  if (!filePath || !filePath.startsWith(`${root}${sep}`)) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  response.setHeader("Content-Type", contentTypes[extname(filePath)] || "text/plain; charset=utf-8");
  createReadStream(filePath)
    .on("error", () => {
      response.statusCode = 404;
      response.end("Not found");
    })
    .pipe(response);
});

server.listen(port, () => {
  console.log(`Fake AI page: http://localhost:${port}/`);
});

function filenameForPath(pathname) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "fake-ai.html";

  const [firstSegment] = trimmed.split("/");
  if (providerRoutes.has(firstSegment)) return "fake-ai.html";

  return trimmed;
}
