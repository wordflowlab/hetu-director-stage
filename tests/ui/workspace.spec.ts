import { test, expect, _electron as electron } from "@playwright/test";
import * as THREE from "three";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { start, host } from "../support/machine.ts";
import {
  newScene,
  newObject,
  newCamera,
  type Scene,
} from "../../src/domain/model.ts";
const base = (r: any) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: crypto.randomUUID(),
});
async function launch(c: any) {
  const app = await electron.launch({
    executablePath:
      process.env.HETU_PACKAGED_APP ??
      createRequire(path.join(host, "package.json"))("electron"),
    args: process.env.HETU_PACKAGED_APP
      ? []
      : [path.join(host, "apps/desktop")],
    env: c.env,
  });
  if (process.env.HETU_PACKAGED_APP) {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe("0.11.2");
  }
  await app.evaluate(({ dialog, clipboard }: any, workspace: string) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [workspace],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
    let copied = "";
    clipboard.writeText = (value: string) => {
      copied = value;
    };
    clipboard.readText = () => copied;
  }, c.workspace);
  const shell = await app.firstWindow();
  await shell
    .getByRole("button", { name: "打开作品", exact: true })
    .first()
    .click();
  await shell
    .getByRole("button", { name: "布景台视频验收", exact: false })
    .first()
    .click();
  const open = async () => {
    await shell
      .getByRole("button", { name: "导演布景台", exact: true })
      .click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((p: any) => p.url().startsWith("hetu-plugin:")),
      )
      .toBe(true);
    return app
      .context()
      .pages()
      .find((p: any) => p.url().startsWith("hetu-plugin:"))!;
  };
  return { app, shell, open };
}
function seed() {
  const p = newScene("雨港旧站 候车亭");
  p.description = "Agent布置，作者可在三维画布中审阅和调整。";
  const items: [any, string, string, number[], number?][] = [
    ["person-standing", "lin", "林溪", [-1.5, 0, 0.5], 30],
    ["person-walking", "chen", "陈舟", [1.7, 0, 0.4], -90],
    ["table", "table", "旧站桌子", [0, 0, 0]],
    ["chair", "chair", "木椅", [-0.6, 0, 1]],
    ["sofa", "sofa", "长椅", [2, 0, -2]],
    ["wall-5m", "wall", "候车亭后墙", [0, 0, -3]],
    ["plant", "tree", "站台植物", [-3, 0, -2]],
    ["floor-lamp", "lamp", "路灯", [3, 0, -1.4]],
    ["rug", "rug", "地垫", [0, 0, 0.2]],
  ];
  for (const [preset, id, name, pos, rotation] of items) {
    const o = newObject(preset, id, name);
    o.transform.position = pos as any;
    if (rotation) o.transform.rotation[1] = rotation;
    p.objects.push(o);
  }
  p.cameras[0] = {
    ...newCamera(),
    position: [8, 6, 10],
    target: [0, 1, -0.2],
    focal_length_mm: 38,
  };
  p.cameras.push({
    ...newCamera("close", "林溪近景"),
    position: [-3, 1.8, 4],
    target: [-1.2, 1.1, 0.5],
    focal_length_mm: 50,
  });
  p.timeline = { fps: 10, duration_frames: 6 };
  p.tracks = [
    {
      id: "walk",
      target_kind: "object",
      target_id: "chen",
      property: "position",
      interpolation: "linear",
      keyframes: [
        { frame: 0, value: [1.7, 0, 0.4] },
        { frame: 5, value: [0.8, 0, 0.4] },
      ],
    },
  ];
  p.shots = [
    { id: "wide", camera_id: "camera-1", start: 0, end: 3 },
    { id: "close", camera_id: "close", start: 3, end: 6 },
  ];
  return p;
}
test("真实Electron布景、机位、动画、导出、恢复、并发比较和停用", async ({}, info) => {
  test.setTimeout(600000);
  const c = await start();
  let app: any;
  try {
    let saved = await c.invoke("save_scene", {
      content: seed(),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "ui-create",
    });
    const ui = await launch(c);
    app = ui.app;
    let page: any = await ui.open();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await expect(
      page
        .getByRole("listbox", { name: "场景对象" })
        .getByRole("option", { name: "林溪", exact: true }),
    ).toBeVisible();
    await expect(ui.shell.locator(".workbench-topbar")).toHaveCount(0);
    expect((await ui.shell.locator(".surface").boundingBox())!.x).toBe(0);
    await expect(page.locator(".error")).toHaveCount(0);
    const metrics = await page.evaluate(() => ({
      header: document.querySelector("header")!.getBoundingClientRect().height,
      background: getComputedStyle(document.body).backgroundImage,
      border: getComputedStyle(document.querySelector("header")!)
        .borderBottomWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      canvas: document.querySelector("canvas")!.getBoundingClientRect().width,
    }));
    expect(metrics.header).toBeLessThanOrEqual(50);
    expect(metrics.background).toContain("gradient");
    expect(metrics.overflow).toBe(false);
    expect(metrics.canvas).toBeGreaterThan(850);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: info.outputPath("light-wide.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "人物 站姿", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "对象名称" })).toHaveValue(
      "人物 站姿",
    );
    await page
      .getByRole("spinbutton", { name: "位置 X", exact: true })
      .fill("-2.5");
    await page
      .getByRole("spinbutton", { name: "旋转 Y", exact: true })
      .fill("45");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "旋转 Y", exact: true }),
    ).toHaveValue("0");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "旋转 Y", exact: true }),
    ).toHaveValue("45");
    await page.getByRole("textbox", { name: "对象名称" }).focus();
    await page.keyboard.press("w");
    await expect(
      page.getByRole("button", { name: "移动", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "对象名称" }).fill("站台旅客");
    await page.locator('canvas[aria-label="三维场景画布"]').focus();
    await page.keyboard.press("e");
    await expect(
      page.getByRole("button", { name: "旋转", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("w");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("场景已保存");
    let current = await c.invoke("get_scene", {
      object_id: saved.object.object_id,
    });
    expect(
      current.object.content.objects.some((o: any) => o.name === "站台旅客"),
    ).toBe(true);
    // 真实画布点选与拖动，按程序投影位置附近取人物躯干。
    await page
      .getByRole("listbox", { name: "场景对象" })
      .getByRole("option", { name: "林溪", exact: true })
      .click();
    const before = await page
      .getByRole("spinbutton", { name: "位置 X", exact: true })
      .inputValue();
    const beforeY = await page
      .getByRole("spinbutton", { name: "位置 Y", exact: true })
      .inputValue();
    const canvas = page.locator('canvas[aria-label="三维场景画布"]');
    const box = await canvas.boundingBox();
    const cam = new THREE.PerspectiveCamera(
      45,
      box.width / box.height,
      0.05,
      1000,
    );
    cam.position.set(8, 6, 10);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld();
    const point = new THREE.Vector3(-1.5, 1.25, 0.5).project(cam);
    const x = box.x + ((point.x + 1) * box.width) / 2,
      y = box.y + ((1 - point.y) * box.height) / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 5, { steps: 8 });
    await page.mouse.up();
    await expect(
      page.getByRole("spinbutton", { name: "位置 Y", exact: true }),
    ).not.toHaveValue(beforeY);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "位置 Y", exact: true }),
    ).toHaveValue(beforeY);
    await canvas.focus();
    await page.keyboard.press("Escape");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 5, { steps: 8 });
    await page.mouse.up();
    await expect(
      page.getByRole("spinbutton", { name: "位置 X", exact: true }),
    ).not.toHaveValue(before);
    await page
      .getByRole("combobox", { name: "视角", exact: true })
      .selectOption("close");
    await page.screenshot({
      path: info.outputPath("camera-view.png"),
      scale: "css",
    });
    await page
      .getByRole("combobox", { name: "视角", exact: true })
      .selectOption("free");
    await page.getByRole("button", { name: "展开预演时间线" }).click();
    await page.getByRole("button", { name: "播放预演", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByRole("spinbutton", { name: "当前帧", exact: true })
          .inputValue(),
      )
      .toBe("5");
    await page
      .getByRole("spinbutton", { name: "当前帧", exact: true })
      .fill("0");
    await page.screenshot({
      path: info.outputPath("timeline.png"),
      scale: "css",
    });
    // 在返回期间保留本地变更，远端修改另外的描述；三方比较保留两者。
    await page
      .getByRole("listbox", { name: "场景对象" })
      .getByRole("option", { name: "林溪", exact: true })
      .click();
    await page
      .getByRole("spinbutton", { name: "位置 X", exact: true })
      .fill("-2");
    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
    current = await c.invoke("get_scene", {
      object_id: saved.object.object_id,
    });
    const remote = structuredClone(current.object.content);
    remote.description = "远端补充的剧本约束";
    saved = await c.invoke("save_scene", { ...base(current), content: remote });
    page = await ui.open();
    await expect(
      page.getByRole("spinbutton", { name: "位置 X", exact: true }),
    ).toHaveValue("-2");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "原操作恢复" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "比较当前版本", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "版本冲突" })).toBeVisible();
    await page.getByRole("button", { name: "以当前基线继续编辑" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("场景已保存");
    current = await c.invoke("get_scene", {
      object_id: saved.object.object_id,
    });
    expect(current.object.content.description).toBe("远端补充的剧本约束");
    expect(
      current.object.content.objects.find((o: any) => o.id === "lin").transform
        .position[0],
    ).toBe(-2);
    const choose = async (filename: string) =>
      app.evaluate(
        ({ dialog }: any, target: string) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: target,
          });
        },
        path.join(c.directory, filename),
      );
    await page
      .getByRole("combobox", { name: "出图分辨率" })
      .selectOption("640");
    await choose("camera.png");
    await page
      .getByRole("button", { name: "当前机位出图", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("固定成果已导出");
    expect(
      (await readFile(path.join(c.directory, "camera.png")))
        .subarray(0, 8)
        .toString("hex"),
    ).toBe("89504e470d0a1a0a");
    await choose("cameras.zip");
    await page.getByRole("button", { name: "批量白模图", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("固定成果已导出");
    expect(
      (await readFile(path.join(c.directory, "cameras.zip")))
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");
    await choose("scene.glb");
    await page
      .getByRole("button", { name: "导出白模 GLB", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("固定成果已导出");
    expect(
      (await readFile(path.join(c.directory, "scene.glb")))
        .subarray(0, 4)
        .toString(),
    ).toBe("glTF");
    await choose("scene.json");
    await page
      .getByRole("button", { name: "导出场景 JSON", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("完整场景已导出");
    expect(
      JSON.parse(await readFile(path.join(c.directory, "scene.json"), "utf8"))
        .project_ref.sha256,
    ).toBe(current.sha256);
    await choose("previs.zip");
    await page.getByRole("button", { name: "Playblast", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("固定成果已导出");
    expect(
      (await readFile(path.join(c.directory, "previs.zip")))
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");
    await page.getByRole("button", { name: "让 AI 处理", exact: true }).click();
    await page.getByRole("button", { name: "复制并继续" }).click();
    await expect(
      page.getByRole("dialog", { name: "让 AI 处理" }),
    ).not.toBeVisible();
    const clipboard = await app.evaluate(({ clipboard }: any) =>
      clipboard.readText(),
    );
    expect(clipboard).toContain("plugin_connection");
    expect(clipboard).toContain("management_ref");
    expect(clipboard).toContain(current.sha256);
    await app.evaluate(({ webContents }: any) =>
      webContents
        .getAllWebContents()
        .find((w: any) => w.getURL().startsWith("hetu-plugin:"))
        ?.send("plugin:preferences", { theme: "dark", language: "zh-CN" }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: info.outputPath("dark-wide.png"),
      scale: "css",
    });
    await page.setViewportSize({ width: 720, height: 800 });
    await page.getByRole("button", { name: "收起素材", exact: true }).click();
    await page.getByRole("button", { name: "收起属性", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("dark-narrow.png"),
      scale: "css",
    });
    expect(errors).toEqual([]);
    await c.apply("disable");
    await expect(ui.shell.locator(".workbench-topbar")).toBeVisible();
    await writeFile(
      info.outputPath("acceptance.json"),
      JSON.stringify(
        {
          package_sha256: c.pkg.package_sha256,
          executable: process.env.HETU_PACKAGED_APP ?? "development",
          host_version: await app.evaluate(({ app }: any) => app.getVersion()),
          platform: process.platform,
          checks: [
            "real_electron_core",
            "full_width",
            "shared_gradient",
            "actual_webgl",
            "palette",
            "transform",
            "undo_redo",
            "input_shortcuts",
            "camera",
            "animation",
            "buffer_return_reopen",
            "CAS_merge",
            "PNG",
            "batch_ZIP",
            "GLB",
            "JSON",
            "Playblast_ZIP",
            "trusted_handoff",
            "light_dark",
            "narrow",
            "hot_disable",
          ],
          directory: c.directory,
          metrics,
        },
        null,
        2,
      ),
    );
  } finally {
    await app?.close();
    await c.client.close();
  }
});
test("首次使用、空状态、取消与新场景机器回读", async ({}, info) => {
  const c = await start();
  let app: any;
  try {
    const ui = await launch(c);
    app = ui.app;
    const page: any = await ui.open();
    await expect(
      page.getByRole("heading", { name: "开始导演布景" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("first-use.png"),
      scale: "css",
    });
    await page.getByRole("button", { name: "新建场景", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建场景" });
    await dialog.getByRole("textbox", { name: "场景名称" }).fill("取消的场景");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect((await c.invoke("list_scenes", {})).objects.length).toBe(0);
    await page.getByRole("button", { name: "新建场景", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "场景名称" })
      .fill("独立布景工程");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("场景已保存");
    expect((await c.invoke("list_scenes", {})).objects.length).toBe(1);
  } finally {
    await app?.close();
    await c.client.close();
  }
});

test("导入校验、显隐、复制删除、固定意见和取消导出", async ({}, info) => {
  const c = await start();
  let app: any;
  try {
    const first = await c.invoke("save_scene", {
      content: seed(),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "import-seed",
    });
    const ui = await launch(c);
    app = ui.app;
    const page = await ui.open();
    const objects = page.getByRole("listbox", { name: "场景对象" });
    await expect(
      objects.getByRole("option", { name: "林溪", exact: true }),
    ).toBeVisible();
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from("{broken"),
      });
    await expect(page.getByRole("alert")).toBeVisible();
    expect(
      (await c.invoke("get_scene", { object_id: first.object.object_id }))
        .sha256,
    ).toBe(first.sha256);
    const content = seed();
    content.title = "导入的候车亭";
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "stage.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ scene: content })),
      });
    await expect(page.getByRole("status")).toContainText("场景已读入本地稿");
    await page.getByRole("button", { name: "隐藏 林溪", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "显示 林溪", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "显示 林溪", exact: true }).click();
    await objects.getByRole("option", { name: "林溪", exact: true }).click();
    await page.getByRole("button", { name: "复制", exact: true }).click();
    await expect(
      objects.getByRole("option", { name: "林溪 副本", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(
      objects.getByRole("option", { name: "林溪 副本", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("场景已保存");
    await objects.getByRole("option", { name: "林溪", exact: true }).click();
    await page
      .getByRole("button", { name: "对固定版本提意见", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "意见内容" })
      .fill("此处请保持人物在桌子左侧。");
    await page
      .getByRole("dialog", { name: "记录意见" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("场景已保存");
    const saved = await c.invoke("get_scene", {
      object_id: first.object.object_id,
    });
    expect(saved.object.content.title).toBe("导入的候车亭");
    expect(saved.object.content.notes.at(-1)).toMatchObject({
      origin: "author",
      target_id: "lin",
      fixed_revision: 2,
    });
    await app.evaluate(({ dialog }: any) => {
      dialog.showSaveDialog = async () => ({
        canceled: true,
        filePath: undefined,
      });
    });
    await page
      .getByRole("combobox", { name: "出图分辨率" })
      .selectOption("640");
    await page
      .getByRole("button", { name: "当前机位出图", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("已取消导出");
    expect(
      (await c.invoke("get_scene", { object_id: first.object.object_id }))
        .sha256,
    ).toBe(saved.sha256);
    await page.screenshot({
      path: info.outputPath("review-and-cancel.png"),
      scale: "css",
    });
  } finally {
    await app?.close();
    await c.client.close();
  }
});
