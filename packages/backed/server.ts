import { join } from "path";
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { serve } from "bun"

const uploadDir = "./uploads";
if (!existsSync(uploadDir)) mkdirSync(uploadDir);

// 渲染文件列表
function renderFileList() {
  const files = readdirSync(uploadDir);
  return `
    <h2>📁 文件服务器</h2>
    <ul>
      ${files.map(f => `<li><a href="/files/${f}">${f}</a></li>`).join("")}
    </ul>
    <hr/>
    <form method="POST" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">上传</button>
    </form>
  `;
}

// 启动服务器
serve({
  port: 3000,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 根目录
    if (req.method === "GET" && path === "/") {
      return new Response(renderFileList(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 访问文件
    if (req.method === "GET" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const filepath = join(uploadDir, filename);
      try {
        const file = readFileSync(filepath);
        return new Response(file);
      } catch {
        return new Response("❌ 文件不存在", { status: 404 });
      }
    }

    // 上传文件
    if (req.method === "POST") {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return new Response("未选择文件", { status: 400 });

      const arrayBuffer = await file.arrayBuffer();
      const filepath = join(uploadDir, file.name);
      writeFileSync(filepath, Buffer.from(arrayBuffer));

      return new Response(
        `<p>✅ 文件 ${file.name} 上传成功！</p><a href="/">返回</a>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 文件服务器运行中: http://localhost:3000");
