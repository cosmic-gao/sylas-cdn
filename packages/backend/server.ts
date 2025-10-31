import { join, resolve, extname, basename } from "path";
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { serve } from "bun";
import { createHash } from "crypto";
import net from "net";

// ---------------- HTTP 请求带超时 ----------------
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal;
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("请求超时");
    throw err;
  }
}

// ---------------- TCP 检测 ----------------
function isTcpReachable(host: string, port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let called = false;

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      called = true;
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      if (!called) {
        called = true;
        resolve(false);
      }
    });

    socket.on("timeout", () => {
      if (!called) {
        called = true;
        resolve(false);
      }
      socket.destroy();
    });

    socket.connect(port, host);
  });
}

// ---------------- 多源配置 ----------------
const sources = [
  { name: "AWS", url: "http://dev.cdn.ai/ping.txt", origin: 'http://dev.cdn.ai' },
  { name: "Azure", url: "http://stage.cdn.ai/ping.txt", origin: 'http://stage.cdn.ai' },
];

const sourceStatus: Record<string, { status: "healthy" | "unhealthy"; lastChecked: string }> = {};
sources.forEach((s) => (sourceStatus[s.name] = { status: "unhealthy", lastChecked: "" }));

const sseClients: Set<WritableStreamDefaultWriter<string>> = new Set();

// ---------------- 定时轮询 ----------------
async function pollSources() {
  await Promise.all(
    sources.map(async (src) => {
      const url = new URL(src.url);
      const host = url.hostname;
      const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
      const now = new Date().toISOString();

      const tcpOk = await isTcpReachable(host, port, 1000);
      if (!tcpOk) {
        sourceStatus[src.name] = { status: "unhealthy", lastChecked: now };
        console.error(`❌ ${src.name} TCP 不可达: ${host}:${port}`);
        broadcastSSE();
        return;
      }

      try {
        const res = await fetchWithTimeout(src.url + "?_=" + Date.now(), { method: "GET", cache: "no-store" }, 1000);
        const healthy = res.ok && res.status === 200;
        sourceStatus[src.name] = { status: healthy ? "healthy" : "unhealthy", lastChecked: now };
        console.log(`${healthy ? "✅" : "⚠️"} ${src.name} 状态: ${healthy ? "可访问" : "返回错误状态码: " + res.status}`);
      } catch (err) {
        sourceStatus[src.name] = { status: "unhealthy", lastChecked: now };
        console.error(`❌ ${src.name} 无法访问: ${err}`);
      }

      broadcastSSE();
    })
  );
}

// 立即执行一次轮询
await pollSources();
// 每 5 秒轮询
setInterval(pollSources, 5000);

// ---------------- SSE ----------------
function broadcastSSE() {
  const data = JSON.stringify(sourceStatus);
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

// ---------------- 文件上传/管理 ----------------
const UPLOAD_DIR = resolve("../../buckets");
const MANIFEST_PATH = join(UPLOAD_DIR, "manifest.json");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

interface Rule {
  pattern: RegExp;
  critical?: boolean;
  mode?: "defer" | "sync";
  priority?: number;
}

const rules: Rule[] = [
  { pattern: /\.js$/, critical: true, mode: "defer", priority: 1 },
  { pattern: /\.css$/, critical: true, mode: "sync", priority: 1 },
  { pattern: /\.png|\.jpg|\.jpeg|\.gif$/, critical: false, mode: "sync", priority: 2 },
  { pattern: /\.html$/, critical: true, mode: "sync", priority: 1 },
];

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    // 过滤掉 ping.txt
    return manifest.filter((item: any) => item.hashed !== "ping.txt");
  } catch {
    return [];
  }
}

function saveManifest(manifest: any[]) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function generateHashFilename(originalName: string, content: Buffer): string {
  const ext = extname(originalName);
  const nameWithoutExt = basename(originalName, ext);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `${nameWithoutExt}-${hash}${ext}`;
}

function removeOldFiles(originalName: string) {
  const ext = extname(originalName);
  const nameWithoutExt = basename(originalName, ext);
  const files = readdirSync(UPLOAD_DIR);
  files.forEach((f) => {
    if (f.startsWith(nameWithoutExt + "-") && f.endsWith(ext)) {
      unlinkSync(join(UPLOAD_DIR, f));
    }
  });
}

function getFileAttributes(filename: string) {
  for (const rule of rules) {
    if (rule.pattern.test(filename)) {
      return {
        critical: rule.critical ?? false,
        mode: rule.mode ?? "defer",
        priority: rule.priority ?? 2,
      };
    }
  }
  return { critical: false, mode: "defer", priority: 2 };
}

function updateManifest() {
  const files = readdirSync(UPLOAD_DIR).filter((f) => f !== "manifest.json");
  const manifest = files.map((filename) => {
    const attrs = getFileAttributes(filename);
    return { hashed: filename, ...attrs };
  });
  saveManifest(manifest);
}

async function handleFileUpload(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) return new Response("❌ 未选择文件", { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());

    removeOldFiles(file.name);
    const hashedName = generateHashFilename(file.name, buffer);
    writeFileSync(join(UPLOAD_DIR, hashedName), buffer);

    const critical = formData.get("critical") === "true";
    const mode: "defer" | "sync" = formData.get("mode") === "sync" ? "sync" : "defer";
    const priority = parseInt(formData.get("priority") as string) || 2;

    const manifest = loadManifest();
    const filtered = manifest.filter((item: any) => !item.hashed.startsWith(file.name.split(".")[0] + "-"));
    filtered.push({ hashed: hashedName, critical, mode, priority });
    saveManifest(filtered);

    return new Response(
      `<p>✅ 文件上传成功！新文件名：<a href="/files/${hashedName}">${hashedName}</a></p><a href="/">返回</a>`,
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return new Response(`❌ 上传失败: ${err}`, { status: 500 });
  }
}

async function handleFileDelete(req: Request) {
  try {
    const formData = await req.formData();
    const filename = formData.get("filename") as string;
    if (!filename) return new Response("❌ 未指定文件名", { status: 400 });

    const filePath = join(UPLOAD_DIR, filename);
    if (!existsSync(filePath)) return new Response("❌ 文件不存在", { status: 404 });

    unlinkSync(filePath);
    updateManifest();

    return new Response(`<p>✅ 文件已删除: ${filename}</p><a href="/">返回</a>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(`❌ 删除失败: ${err}`, { status: 500 });
  }
}

function getFileList() {
  return readdirSync(UPLOAD_DIR)
    .filter((f) => f !== "manifest.json")
    .map((f) => ({ filename: f, url: `/files/${encodeURIComponent(f)}` }));
}

function getFileContent(filename: string) {
  const path = join(UPLOAD_DIR, filename);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

// ---------------- HTML 渲染 ----------------
function renderFileList(): string {
  const files = getFileList();
  return `
    <h2>📁 前端资源</h2>
    <h3>🌐 CDN源状态</h3>
    <ul id="source-status"></ul>
    <hr/>
    <ul>
      ${files.map(f => `<li>
        <a href="${f.url}">${f.filename}</a>
        <form method="POST" action="/delete" style="display:inline">
          <input type="hidden" name="filename" value="${f.filename}" />
          <button type="submit">删除</button>
        </form>
      </li>`).join("")}
    </ul>
    <hr/>
    <form method="POST" enctype="multipart/form-data">
      <input type="file" name="file" required />
      <label>
        Critical:
        <select name="critical">
          <option value="true">true</option>
          <option value="false" selected>false</option>
        </select>
      </label>
      <label>
        Mode:
        <select name="mode">
          <option value="defer" selected>defer</option>
          <option value="sync">sync</option>
        </select>
      </label>
      <label>
        Priority:
        <input type="number" name="priority" value="2" min="1" max="10" />
      </label>
      <button type="submit">上传 / 替换文件</button>
    </form>
    <hr/>
    <p><a href="/manifest.json" target="_blank">查看 manifest.json</a></p>

    <script>
      const evtSource = new EventSource("/sse");
      evtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        const ul = document.getElementById("source-status");
        ul.innerHTML = Object.keys(data).map(k => {
          const s = data[k];
          return '<li>' + k + ': ' + (s.status === "healthy" ? "✅ 可访问" : "❌ 不可访问") + 
                 ' (上次检测: ' + s.lastChecked + ')</li>';
        }).join("");
      };
    </script>
  `;
}

function corsResponse(body: BodyInit, status = 200, contentType = "text/html; charset=utf-8") {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*", // 跨域
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ---------------- 启动服务器 ----------------
serve({
  port: 3000,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/")
      return new Response(renderFileList(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });

    if (req.method === "GET" && path === "/manifest.json") {
      const manifest = loadManifest();
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (req.method === "GET" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const content = getFileContent(filename);
      if (!content) return new Response("❌ 文件不存在", { status: 404 });
      return new Response(content);
    }

    // SSE 连接
    if (req.method === "GET" && path === "/sse") {
      const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      };
      const stream = new Response(new ReadableStream({
        start(controller) {
          sseClients.add({
            write: (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk)),
            close: () => controller.close(),
          } as any);
        }
      }), { headers });
      return stream;
    }

    if (req.method === "POST") {
      if (path === "/delete") return handleFileDelete(req);
      return handleFileUpload(req);
    }

    if (req.method === "GET" && path === "/api/alive-cdn.json") {
      const firstHealthy = sources.find(
        s => sourceStatus[s.name]?.status === "healthy"
      );

      const result = firstHealthy ? firstHealthy.origin : null;

      return new Response(JSON.stringify({ url: result }), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", },
      });
    }

    if (req.method === "GET" && path === "/api/manifest.json") {
      const manifest = loadManifest();
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 CDN 文件服务器运行中: http://localhost:3000");
