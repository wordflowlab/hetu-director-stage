import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import manifest from "../contracts/plugin-manifest.json" with { type: "json" };
import { newScene, newObject, newCamera, clone } from "../src/domain/model.ts";
import { start } from "./support/machine.ts";
let n = 0;
const base = (r: any) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: "stage-" + ++n,
});
test(
  "真实MCP全动作、Skill、固定渲染计划、CLI互读、热插拔与数据恢复",
  { timeout: 600000 },
  async (t) => {
    const c = await start();
    t.diagnostic(c.directory);
    try {
      assert.equal(c.cap.actions.length, manifest.contributions.actions.length);
      assert.equal(c.cap.access_mode, "open");
      assert.deepEqual(
        (await c.client.listTools()).tools.map((x: any) => x.name),
        c.tools,
      );
      const skill = manifest.contributions.skills[0];
      for (const resource of [
        undefined,
        "references/workflow.md",
        "references/operations.md",
        "references/rendering.md",
        "scripts/render-stage.mjs",
      ]) {
        const r = await c.invoke("skills.read", {
          skill_id: skill.id,
          ...(resource ? { resource } : {}),
        });
        assert.ok(r.content.length > 100);
      }
      let p = newScene("雨港候车亭");
      p.objects.push(
        newObject("person-standing", "lin", "林溪"),
        newObject("person-walking", "chen", "陈舟"),
        newObject("table", "table"),
      );
      let r = await c.invoke("save_scene", {
        content: p,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "create",
      });
      const initial = r;
      assert.equal(
        (await c.invoke("list_scenes", { query: "雨港" })).objects.length,
        1,
      );
      assert.equal(
        (
          await c.invoke("get_scene", {
            object_id: r.object.object_id,
            revision: 1,
          })
        ).sha256,
        r.sha256,
      );
      const input = { ...base(r), object: newObject("door-wall", "door") };
      r = await c.invoke("put_object", input);
      assert.equal((await c.invoke("put_object", input)).sha256, r.sha256);
      const bad = await c.raw("put_object", {
        ...input,
        object: newObject("wall-3m", "other"),
      });
      assert.equal(
        bad.data?.result?.error?.code ?? bad.error?.code,
        "idempotency_conflict",
      );
      r = await c.invoke("transform_objects", {
        ...base(r),
        changes: [
          {
            id: "lin",
            transform: {
              position: [-1.4, 0, 0],
              rotation: [0, 45, 0],
              scale: [1, 1, 1],
            },
          },
          {
            id: "chen",
            transform: {
              position: [2, 0, 0],
              rotation: [0, -90, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      });
      r = await c.invoke("duplicate_objects", {
        ...base(r),
        items: [{ source_id: "table", new_id: "extra", name: "备选桌" }],
        offset: [0, 0, 2],
      });
      r = await c.invoke("set_visibility", {
        ...base(r),
        object_ids: ["extra"],
        visible: false,
      });
      r = await c.invoke("remove_objects", {
        ...base(r),
        object_ids: ["extra"],
      });
      r = await c.invoke("put_camera", {
        ...base(r),
        camera: {
          ...newCamera("close", "林溪近景"),
          position: [-3, 1.7, 3],
          target: [-1, 1.2, 0],
          focal_length_mm: 55,
        },
      });
      r = await c.invoke("put_camera", {
        ...base(r),
        camera: newCamera("unused"),
      });
      r = await c.invoke("remove_camera", { ...base(r), camera_id: "unused" });
      r = await c.invoke("set_environment", {
        ...base(r),
        environment: { ...r.object.content.environment, grid: false },
      });
      r = await c.invoke("set_timeline", {
        ...base(r),
        timeline: { fps: 25, duration_frames: 75 },
      });
      const track = {
        id: "walk",
        target_kind: "object",
        target_id: "chen",
        property: "position",
        interpolation: "linear",
        keyframes: [
          { frame: 0, value: [2, 0, 0] },
          { frame: 74, value: [0, 0, 0] },
        ],
      };
      r = await c.invoke("put_track", { ...base(r), track });
      r = await c.invoke("put_track", {
        ...base(r),
        track: {
          ...track,
          id: "temp",
          property: "rotation",
          keyframes: [{ frame: 0, value: [0, 0, 0] }],
        },
      });
      r = await c.invoke("remove_track", { ...base(r), track_id: "temp" });
      r = await c.invoke("set_shots", {
        ...base(r),
        shots: [
          { id: "wide", camera_id: "camera-1", start: 0, end: 40 },
          { id: "close", camera_id: "close", start: 40, end: 75 },
        ],
      });
      r = await c.invoke("add_note", {
        ...base(r),
        note: {
          id: "check",
          origin: "agent",
          text: "自查遮挡与人物运动，保留旧版。",
          target_id: "lin",
          fixed_revision: r.object.revision,
          frame: 30,
        },
      });
      const fromCli = c.cli("hetu.plugins.invoke", {
        ...c.binding,
        capabilities_sha256: c.cap.capabilities_sha256,
        action: "get_scene",
        arguments: {
          object_id: r.object.object_id,
          revision: r.object.revision,
        },
      });
      assert.equal(fromCli.data.result.data.sha256, r.sha256);
      const fixed = {
        object_id: r.object.object_id,
        revision: r.object.revision,
      };
      const plan = await c.invoke("render_plan", {
        ...fixed,
        mode: "sequence",
        width: 640,
        end_frame: 5,
      });
      assert.equal(plan.project_ref.sha256, r.sha256);
      assert.ok(
        (
          await c.invoke("compare_versions", {
            object_id: r.object.object_id,
            from_revision: 1,
            to_revision: r.object.revision,
          })
        ).changes.length,
      );
      await c.invoke("check_scene", fixed);
      let offset = 0,
        text = "";
      do {
        const chunk = await c.invoke("export_scene", {
          ...fixed,
          offset,
          max_bytes: 1024,
        });
        text += chunk.content;
        if (chunk.next_offset === null) break;
        offset = chunk.next_offset;
      } while (true);
      assert.equal(JSON.parse(text).project_ref.sha256, r.sha256);
      const fork = await c.invoke("fork_scene", {
        ...fixed,
        title: "候车亭备选",
        operation_key: "fork",
      });
      assert.notEqual(fork.object.object_id, r.object.object_id);
      assert.equal(
        (
          await c.invoke("prepare_handoff", {
            ...fixed,
            goal: "改近景并接续预演",
          })
        ).project_ref.sha256,
        r.sha256,
      );
      assert.equal(
        (await c.invoke("get_operation", { operation_key: "create" })).sha256,
        initial.sha256,
      );
      // 缺来源索引及非法轨道不得产生权威修订。
      const invalid = clone(r.object.content);
      invalid.objects[0].source_index = 0;
      const rejected = await c.raw("save_scene", {
        ...base(r),
        content: invalid,
      });
      assert.equal(rejected.data?.result?.status, "failed");
      assert.equal(
        (await c.invoke("get_scene", { object_id: r.object.object_id })).sha256,
        r.sha256,
      );
      await c.apply("disable");
      assert.notEqual(
        (await c.raw("get_scene", { object_id: r.object.object_id })).status,
        "succeeded",
      );
      await c.apply("enable");
      await c.discover();
      assert.equal((await c.invoke("get_scene", fixed)).sha256, r.sha256);
      await c.apply("uninstall");
      assert.notEqual((await c.raw("get_scene", fixed)).status, "succeeded");
      await c.apply("install");
      await c.discover();
      assert.equal((await c.invoke("get_scene", fixed)).sha256, r.sha256);
      assert.deepEqual(
        [...c.actions].filter((a) => a !== "skills.read").sort(),
        manifest.contributions.actions.map((a) => a.id).sort(),
      );
      await mkdir("output", { recursive: true });
      await writeFile(
        "output/machine-acceptance.json",
        JSON.stringify(
          {
            recorded_at: new Date().toISOString(),
            status: "passed",
            package_sha256: c.pkg.package_sha256,
            actions: [...c.actions],
            project_ref: plan.project_ref,
            platform: process.platform,
            directory: c.directory,
          },
          null,
          2,
        ),
      );
      await writeFile(
        "output/machine-render-plan.json",
        JSON.stringify(plan, null, 2),
      );
    } finally {
      await c.client.close();
    }
  },
);
