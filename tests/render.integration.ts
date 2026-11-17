import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, readdir, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  newScene,
  newObject,
  newCamera,
  presets,
  canonical,
} from "../src/domain/model.ts";
import { renderIntegrity } from "../src/render/build-integrity.ts";
const digest = (b: any) => createHash("sha256").update(b).digest("hex");
test(
  "真实无窗口共享渲染器：18素材、机位像素、运动序列、MP4及GLB",
  { timeout: 600000 },
  async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hetu-stage-pixels-"));
    t.diagnostic(dir);
    const packageDirectory=path.join(dir,"package");
    await cp("dist",packageDirectory,{recursive:true});
    const s = newScene("布景全素材验收");
    s.timeline = { fps: 10, duration_frames: 6 };
    s.environment.grid = false;
    s.cameras[0] = {
      ...newCamera(),
      position: [13, 12, 17],
      target: [0, 1, 1],
      focal_length_mm: 32,
    };
    s.cameras.push({
      ...newCamera("close"),
      position: [-3, 2, 6],
      target: [-3, 1, 0],
    });
    s.objects = presets.map((p, i) => {
      const o = newObject(p, "o" + i);
      o.transform.position = [
        ((i % 6) - 2.5) * 2,
        0,
        Math.floor(i / 6) * 3 - 3,
      ];
      return o;
    });
    s.tracks = [
      {
        id: "walk",
        target_kind: "object",
        target_id: "o1",
        property: "position",
        interpolation: "linear",
        keyframes: [
          { frame: 0, value: [-3, 0, 0] },
          { frame: 5, value: [0, 0, 0] },
        ],
      },
    ];
    s.shots = [
      { id: "wide", camera_id: "camera-1", start: 0, end: 3 },
      { id: "close", camera_id: "close", start: 3, end: 6 },
    ];
    s.shots[1].blocking=[{object_id:"o0",transform:{...structuredClone(s.objects[0].transform),position:[-3,0,0]},end_transform:{...structuredClone(s.objects[0].transform),position:[-2,0,0]}}];
    const payload = {
      format: "hetu.director-stage.render",
      renderer: renderIntegrity,
      version: 1,
      plugin_id: "org.wordflowlab.director-stage",
      project_ref: {
        object_id: "ext_test",
        revision: 1,
        sha256: "a".repeat(64),
      },
      work_ref: {
        workspace_id: "workspace_test",
        kind: "video",
        object_id: "video_test",
      },
      source_refs: [],
      scene: s,
      render: {
        mode: "cameras",
        camera_ids: ["camera-1", "close"],
        frame: 0,
        start_frame: 0,
        end_frame: 6,
        width: 640,
        height: 360,
        fps: 10,
      },
    };
    const plan = path.join(dir, "plan.json");
    const run = async (mode: string, format: string) => {
      payload.render.mode = mode;
      await writeFile(
        plan,
        JSON.stringify({ ...payload, plan_sha256: digest(canonical(payload)) }),
      );
      const output = path.join(dir, mode + "-" + format);
      const args = [
        "scripts/render-stage.mjs",
        plan,
        "--package",
        packageDirectory,
        "--output",
        output,
        "--format",
        format,
      ];
      if (format === "mp4") {
        const resolve = spawnSync(
          "uv",
          [
            "run",
            "--with",
            "imageio-ffmpeg",
            "python",
            "-c",
            "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())",
          ],
          { encoding: "utf8" },
        );
        assert.equal(resolve.status, 0, resolve.stderr);
        args.push("--ffmpeg", resolve.stdout.trim());
      }
      const r = spawnSync(process.execPath, args, {
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(r.status, 0, r.stderr);
      return {
        output,
        report: JSON.parse(
          await readFile(path.join(output, "manifest.json"), "utf8"),
        ),
      };
    };
    const still = await run("cameras", "png");
    assert.equal(still.report.files.length, 2);
    assert.notEqual(still.report.files[0].sha256, still.report.files[1].sha256);
    const pixels = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pillow",
        "python",
        "-c",
        "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB'); assert im.size==(640,360); colors=im.getcolors(1000000); assert len(colors)>100; print(len(colors))",
        path.join(still.output, "camera-01.png"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(pixels.status, 0, pixels.stderr);
    const sequence = await run("sequence", "mp4");
    assert.equal(sequence.report.files.length, 7);
    assert.notEqual(
      sequence.report.files[0].sha256,
      sequence.report.files[1].sha256,
    );
    const ffmpeg = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "imageio-ffmpeg",
        "python",
        "-c",
        "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())",
      ],
      { encoding: "utf8" },
    );
    assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
    const decoded = spawnSync(
      ffmpeg.stdout.trim(),
      [
        "-v",
        "error",
        "-i",
        path.join(sequence.output, "previs.mp4"),
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    assert.equal(decoded.status, 0, decoded.stderr);
    const glb = await run("glb", "glb");
    const b = await readFile(path.join(glb.output, "scene.glb"));
    assert.equal(b.toString("ascii", 0, 4), "glTF");
    assert.equal(b.readUInt32LE(8), b.length);
    const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    assert.equal(json.cameras.length, 2);
    assert.ok(json.animations.length);
    assert.ok(json.meshes.length > 30);
    const personIndex=json.nodes.findIndex((n:any)=>n.name==="o0");
    const animation=json.animations[0];
    const channel=animation.channels.find((c:any)=>c.target.node===personIndex&&c.target.path==="translation");
    assert.ok(channel,"GLB必须包含仅由局部调度驱动的变换");
    const accessor=json.accessors[animation.samplers[channel.sampler].output],view=json.bufferViews[accessor.bufferView];
    const binary=20+b.readUInt32LE(12)+8,offset=binary+(view.byteOffset??0)+(accessor.byteOffset??0);
    assert.equal(b.readFloatLE(offset+3*3*4),-3);
    assert.equal(b.readFloatLE(offset+5*3*4),-2);
    const validPlan = await readFile(plan, "utf8");
    const tampered = JSON.parse(validPlan);
    tampered.renderer.render_js_sha256 = "0".repeat(64);
    delete tampered.plan_sha256;
    tampered.plan_sha256 = digest(canonical(tampered));
    const badPlan = path.join(dir, "tampered-plan.json");
    await writeFile(badPlan, JSON.stringify(tampered));
    const rejected = spawnSync(
      process.execPath,
      [
        "scripts/render-stage.mjs",
        badPlan,
        "--package",
        packageDirectory,
        "--output",
        path.join(dir, "tampered"),
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /渲染器字节与固定计划不一致/);
    const occupied = spawnSync(
      process.execPath,
      [
        "scripts/render-stage.mjs",
        plan,
        "--package",
        packageDirectory,
        "--output",
        still.output,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(occupied.status, 0);
    assert.match(occupied.stderr, /输出目录必须为空/);
    const missing = path.join(dir, "missing-browser");
    const failed = spawnSync(
      process.execPath,
      [
        "scripts/render-stage.mjs",
        plan,
        "--package",
        packageDirectory,
        "--output",
        missing,
        "--browser",
        path.join(dir, "absent-chromium"),
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.notEqual(failed.status, 0);
    assert.equal(
      JSON.parse(await readFile(path.join(missing, "failure.json"), "utf8"))
        .status,
      "failed",
    );
    await mkdir("output", { recursive: true });
    await writeFile(
      "output/render-acceptance.json",
      JSON.stringify(
        {
          recorded_at: new Date().toISOString(),
          status: "passed",
          directory: dir,
          platform: process.platform,
          presets: presets.length,
          cameras: 2,
          non_uniform_pixel_colors: Number(pixels.stdout.trim()),
          frames: 6,
          full_decode: true,
          negative_checks: [
            "renderer_integrity",
            "occupied_output",
            "missing_browser_receipt",
          ],
          glb_cameras: json.cameras.length,
          glb_animations: json.animations.length,
          media_bytes: (
            await readFile(path.join(sequence.output, "previs.mp4"))
          ).length,
        },
        null,
        2,
      ),
    );
  },
);
