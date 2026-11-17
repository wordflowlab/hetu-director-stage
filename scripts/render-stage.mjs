import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  mkdtemp,
  rm,
  access,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
const argv = process.argv.slice(2),
  flags = new Map();
const input = argv.shift();
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined)
    throw new Error("参数必须使用 --name value。");
  flags.set(argv[i], argv[i + 1]);
}
const help =
  "用法：node render-stage.mjs plan.json --package /plugin --output /new-output [--browser /chromium] [--format png|glb|mp4] [--ffmpeg /ffmpeg]";
if (!input || !flags.has("--package") || !flags.has("--output"))
  throw new Error(help);
const canonical = (v) =>
  JSON.stringify(
    (function normalize(v) {
      return Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, normalize(v[k])]),
            )
          : v;
    })(v),
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plan = JSON.parse(await readFile(input, "utf8")),
  digest = plan.plan_sha256;
const { plan_sha256, ...payload } = plan;
if (
  plan.format !== "hetu.director-stage.render" ||
  plan.version !== 1 ||
  sha(canonical(payload)) !== digest
)
  throw new Error("固定渲染计划摘要或格式不一致。");
const pkg = path.resolve(flags.get("--package")),
  output = path.resolve(flags.get("--output"));
const manifest = JSON.parse(
  await readFile(path.join(pkg, "plugin.json"), "utf8"),
);
if (manifest.id !== plan.plugin_id)
  throw new Error("运行包与固定插件身份不一致。");
if (manifest.version !== plan.renderer?.version)
  throw new Error("渲染器版本与固定计划不一致。");
for (const [file, key] of [
  ["render.js", "render_js_sha256"],
  ["render.html", "render_html_sha256"],
])
  if (sha(await readFile(path.join(pkg, file))) !== plan.renderer[key])
    throw new Error("渲染器字节与固定计划不一致：" + file);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error("输出目录必须为空，避免覆盖已有成果。");
let browser = flags.get("--browser") ?? process.env.HETU_CHROME;
if (!browser) {
  const installed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  const candidates = [];
  const cache =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Caches/ms-playwright")
      : process.platform === "win32"
        ? path.join(
            process.env.LOCALAPPDATA ??
              path.join(os.homedir(), "AppData/Local"),
            "ms-playwright",
          )
        : path.join(os.homedir(), ".cache/ms-playwright");
  try {
    const names = (await readdir(cache)).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    for (const name of names.filter((name) =>
      name.startsWith("chromium_headless_shell-"),
    ))
      for (const suffix of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-headless-shell-linux64/chrome-headless-shell",
        "chrome-headless-shell-win64/chrome-headless-shell.exe",
      ])
        candidates.push(path.join(cache, name, suffix));
    for (const name of names) {
      if (name.startsWith("chromium-"))
        for (const suffix of [
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-linux/chrome",
          "chrome-linux64/chrome",
          "chrome-win64/chrome.exe",
        ])
          candidates.push(path.join(cache, name, suffix));
    }
  } catch {}
  candidates.push(...installed);
  for (const candidate of candidates)
    try {
      await access(candidate);
      browser = candidate;
      break;
    } catch {}
}
if (!browser) throw new Error("没有发现Chromium，请通过--browser指定。");
const profile = await mkdtemp(path.join(os.tmpdir(), "hetu-stage-render-"));
let proc, ws, server, spawnError;
let stderr = "";
try {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const name = { "/": "render.html", "/render.js": "render.js" }[pathname];
    if (!name) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader(
        "Content-Type",
        name.endsWith(".html") ? "text/html" : "text/javascript",
      );
      res.end(await readFile(path.join(pkg, name)));
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  proc = spawn(
    browser,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--no-proxy-server",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  proc.stderr.on("data", (b) => (stderr = (stderr + b).slice(-8000)));
  proc.on("error", (error) => {
    spawnError = error;
  });
  let debugPort;
  for (let n = 0; n < 200; n++) {
    if (spawnError) throw spawnError;
    if (proc.exitCode !== null) throw new Error("Chromium退出：" + stderr);
    try {
      debugPort = Number(
        (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
      if (debugPort) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!debugPort) throw new Error("Chromium CDP启动超时：" + stderr);
  // 启动页可能包含Chrome内部页面；创建专用页，避免依赖目标列表顺序。
  const response = await fetch(
    "http://127.0.0.1:" + debugPort + "/json/new?about:blank",
    { method: "PUT" },
  );
  if (!response.ok) throw new Error("无法创建Chromium渲染页。");
  const target = await response.json();
  if (target.type !== "page" || target.url !== "about:blank")
    throw new Error("Chromium渲染页身份无效。");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const p = pending.get(data.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(data.id);
        data.error
          ? p.reject(new Error(JSON.stringify(data.error)))
          : p.resolve(data.result);
      }
    }
  };
  ws.onclose = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("渲染连接已关闭。"));
    }
    pending.clear();
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, {
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.delete(key);
          reject(new Error("CDP调用超时：" + method));
        }, 90000),
      });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result?.value;
  };
  await call("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
  let ready = false;
  for (let n = 0; n < 200; n++) {
    if (await evaluate("!!window.stageRender")) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw new Error("同包渲染器加载超时。");
  await evaluate("window.fixedPlan=" + JSON.stringify(plan));
  const format =
    flags.get("--format") ?? (plan.render.mode === "glb" ? "glb" : "png");
  if (!["png", "glb", "mp4"].includes(format))
    throw new Error("未知导出格式。");
  const tasks = [];
  const r = plan.render;
  if (format === "glb")
    tasks.push({ format: "glb", frame: 0, name: "scene.glb" });
  else if (r.mode === "sequence" || format === "mp4") {
    for (let f = r.start_frame; f < r.end_frame; f++)
      tasks.push({
        format: "png",
        frame: f,
        name: "frame-" + String(f - r.start_frame).padStart(5, "0") + ".png",
      });
  } else
    for (const [index, camera_id] of (r.mode === "cameras"
      ? r.camera_ids
      : [r.camera_ids[0]]
    ).entries())
      tasks.push({
        format: "png",
        frame: r.frame,
        camera_id,
        name: "camera-" + String(index + 1).padStart(2, "0") + ".png",
      });
  const files = [];
  for (const task of tasks) {
    const result = await evaluate(
      "window.stageRender.render(window.fixedPlan," +
        JSON.stringify(task) +
        ")",
    );
    const bytes = Buffer.from(result.base64, "base64");
    if (bytes.length !== result.bytes || bytes.length < 20)
      throw new Error("渲染结果缺少字节。");
    await writeFile(path.join(output, task.name), bytes);
    files.push({
      path: task.name,
      sha256: sha(bytes),
      size_bytes: bytes.length,
      frame: task.frame,
      camera_id: task.camera_id ?? null,
    });
  }
  if (format === "mp4") {
    const ffmpeg = flags.get("--ffmpeg") ?? "ffmpeg";
    const result = spawnSync(
      ffmpeg,
      [
        "-nostdin",
        "-n",
        "-framerate",
        String(r.fps),
        "-i",
        path.join(output, "frame-%05d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        path.join(output, "previs.mp4"),
      ],
      { encoding: "utf8", timeout: 120000 },
    );
    if (result.status !== 0)
      throw new Error("FFmpeg编码失败：" + (result.stderr ?? result.error));
    const bytes = await readFile(path.join(output, "previs.mp4"));
    files.push({
      path: "previs.mp4",
      sha256: sha(bytes),
      size_bytes: bytes.length,
    });
  }
  const report = {
    format: "hetu.director-stage.render-output",
    version: 1,
    plan_sha256: digest,
    project_ref: plan.project_ref,
    source_refs: plan.source_refs,
    render: r,
    files,
    representation: "程序白模预演；无音轨；不代表最终画面或作者认可。",
  };
  await writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    path.join(output, "render-plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "succeeded",
      output,
      files: files.length,
      plan_sha256: digest,
    }),
  );
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { status: "failed", message: String(error), stderr, plan_sha256: digest },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  ws?.close();
  if (proc && proc.exitCode === null) {
    proc.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => proc.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }).catch(() => {});
}
