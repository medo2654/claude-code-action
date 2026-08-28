import { downloadCommentImages } from "./src/github/utils/image-downloader.ts";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";

const downloadsDir = "/tmp/github-images";
const guid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const originalFetch = globalThis.fetch;

function attachmentUrl(n: number) {
  return `https://github.com/user-attachments/assets/${guid(n)}`;
}
function signedUrl(n: number) {
  return `https://private-user-images.githubusercontent.com/1/file-${guid(n)}.png?jwt=fixture-${n}`;
}
function bodyFor(start: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    `![fixture-${start + i}](${attachmentUrl(start + i)})`,
  ).join("\n");
}
function htmlFor(start: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    `<img src="${signedUrl(start + i)}">`,
  ).join("");
}

async function runCase(counts: { pr: number; issue: number; review: number }, size: number) {
  rmSync(downloadsDir, { recursive: true, force: true });
  let fetchCalls = 0;
  let arrayBufferCalls = 0;
  let bytesObserved = 0;
  const events: string[] = [];

  const allCount = counts.pr + counts.issue + counts.review;
  const apiBodies = new Map<string, string>([
    ["pr", htmlFor(1, counts.pr)],
    ["issue", htmlFor(1 + counts.pr, counts.issue)],
    ["review", htmlFor(1 + counts.pr + counts.issue, counts.review)],
  ]);

  const octokits = {
    rest: {
      issues: {
        getComment: async () => ({ data: { body_html: apiBodies.get("issue") } }),
        get: async () => ({ data: { body_html: apiBodies.get("issue") } }),
      },
      pulls: {
        getReviewComment: async () => ({ data: { body_html: apiBodies.get("review") } }),
        getReview: async () => ({ data: { body_html: apiBodies.get("review") } }),
        get: async () => ({ data: { body_html: apiBodies.get("pr") } }),
      },
    },
  } as any;

  globalThis.fetch = (async () => {
    fetchCalls++;
    events.push("FETCH_START");
    const body = new Uint8Array(size);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => {
        events.push("FETCH_COMPLETE");
        arrayBufferCalls++;
        bytesObserved += body.byteLength;
        events.push("ARRAYBUFFER_COMPLETE");
        return body.buffer;
      },
    } as Response;
  }) as typeof fetch;

  try {
    const comments = [
      ...(counts.pr > 0 ? [{
        type: "pr_body" as const,
        id: "7",
        pullNumber: "7",
        body: bodyFor(1, counts.pr),
      }] : []),
      ...(counts.issue > 0 ? [{
        type: "issue_comment" as const,
        id: "8",
        body: bodyFor(1 + counts.pr, counts.issue),
      }] : []),
      ...(counts.review > 0 ? [{
        type: "review_comment" as const,
        id: "9",
        body: bodyFor(1 + counts.pr + counts.issue, counts.review),
      }] : []),
    ];
    const result = await downloadCommentImages(octokits, "owner", "repo", comments, { timeoutMs: 1000 });
    const files = existsSync(downloadsDir) ? readdirSync(downloadsDir) : [];
    const writtenBytes = files.reduce((sum, name) => sum + statSync(`${downloadsDir}/${name}`).size, 0);
    return {
      requested: allCount,
      extractedAndDownloaded: result.size,
      fetchCalls,
      arrayBufferCalls,
      bytesObserved,
      writtenFiles: files.length,
      writtenBytes,
      eventsPrefix: events.slice(0, 6),
      hasConfiguredBudget: false,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const matrix: unknown[] = [];
  for (const count of [1, 10, 25, 50]) {
    matrix.push({ count, ...(await runCase({ pr: count, issue: 0, review: 0 }, 1024)) });
  }
  matrix.push({
    sourceCase: "PR_BODY+ISSUE_COMMENT+REVIEW_COMMENT",
    ...(await runCase({ pr: 4, issue: 3, review: 3 }, 1024)),
  });
  for (const size of [4096, 16384, 65536, 262144]) {
    matrix.push({ size, ...(await runCase({ pr: 1, issue: 1, review: 1 }, size)) });
  }
  console.log(JSON.stringify({
    REAL_FETCHER_FUNCTION: true,
    USER_CONTROLLED_ATTACHMENT_SOURCES: ["PR_BODY", "ISSUE_COMMENT", "REVIEW_COMMENT"],
    NO_PRODUCTION: true,
    MAX_IMAGES: "not present in implementation; fixture stayed bounded",
    MAX_DOWNLOADS: "not present in implementation; fixture stayed bounded",
    MAX_TOTAL_BYTES: "not present in implementation; fixture stayed bounded",
    matrix,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
