import { recoverySnapshot, recoveredPending } from "../src/view/recovery.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newScene,
  newObject,
  newCamera,
  validate,
  sample,
  cameraAt,
  removeObjects,
  duplicateObjects,
  mergeScenes,
  clone,
  type Track,
} from "../src/domain/model.ts";
import { memoryCore } from "./support/memory-core.ts";
const base = (r: any, key: string) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: key,
});
const track = (): Track => ({
  id: "move",
  target_kind: "object",
  target_id: "lin",
  property: "position",
  interpolation: "linear",
  keyframes: [
    { frame: 0, value: [0, 0, 0] },
    { frame: 100, value: [5, 0, 0] },
  ],
});
test("默认场景与全部程序素材数据可用", () => {
  const s = newScene("站台");
  s.objects.push(newObject("person-standing", "lin"));
  validate(s);
  assert.equal(s.timeline.duration_frames, 150);
});
test("重复及悬空ID、相机退化、非法数值与比例拒绝", () => {
  for (const edit of [
    (s: any) =>
      s.objects.push(newObject("table", "lin"), newObject("chair", "lin")),
    (s: any) => (s.cameras[0].target = s.cameras[0].position),
    (s: any) => (s.cameras[0].near = 50),
    (s: any) =>
      s.objects.push({
        ...newObject("box", "a"),
        transform: {
          position: [Infinity, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      }),
    (s: any) =>
      s.objects.push({
        ...newObject("box", "a"),
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0, 1, 1],
        },
      }),
    (s: any) => s.tracks.push(track()),
  ]) {
    const s = newScene("站台");
    edit(s);
    assert.throws(() => validate(s));
  }
});
test("关键帧插值、钳制及阶跃保留原场景", () => {
  const s = newScene("站台");
  s.objects.push(newObject("person-walking", "lin"));
  s.tracks.push(track());
  validate(s);
  assert.equal(sample(s, 50).objects[0].transform.position[0], 2.5);
  assert.equal(sample(s, 149).objects[0].transform.position[0], 5);
  assert.equal(s.objects[0].transform.position[0], 0);
  s.tracks[0].interpolation = "step";
  assert.equal(sample(s, 50).objects[0].transform.position[0], 0);
});
test("关键帧顺序、重复通道、相机属性与动画退化拒绝", () => {
  for (const edit of [
    (s: any) => s.tracks[0].keyframes.reverse(),
    (s: any) => s.tracks.push({ ...track(), id: "duplicate" }),
    (s: any) => (s.tracks[0].keyframes[1].frame = 150),
    (s: any) =>
      Object.assign(s.tracks[0], {
        target_kind: "camera",
        target_id: "camera-1",
        property: "rotation",
      }),
    (s: any) =>
      Object.assign(s.tracks[0], {
        target_kind: "camera",
        target_id: "camera-1",
        keyframes: [{ frame: 0, value: [0, 1, 0] }],
      }),
  ]) {
    const s = newScene("站台");
    s.objects.push(newObject("person-standing", "lin"));
    s.tracks = [track()];
    edit(s);
    assert.throws(() => validate(s));
  }
});
test("镜头区间采用半开规则且不重叠", () => {
  const s = newScene("站台");
  s.cameras.push(newCamera("cam2"));
  s.shots = [
    { id: "a", camera_id: "camera-1", start: 0, end: 50 },
    { id: "b", camera_id: "cam2", start: 50, end: 150 },
  ];
  validate(s);
  assert.equal(cameraAt(s, 49), "camera-1");
  assert.equal(cameraAt(s, 50), "cam2");
  s.shots[1].start = 49;
  assert.throws(() => validate(s));
});
test("删除对象清理轨道并保留意见文本，锁定对象拒绝", () => {
  const s = newScene("站台");
  s.objects.push(newObject("person-standing", "lin"));
  s.tracks = [track()];
  s.notes = [
    {
      id: "n",
      origin: "agent",
      text: "核对站位",
      target_id: "lin",
      fixed_revision: 1,
      frame: 0,
    },
  ];
  removeObjects(s, ["lin"]);
  validate(s);
  assert.equal(s.tracks.length, 0);
  assert.equal(s.notes[0].target_id, null);
  s.objects = [{ ...newObject("table", "x"), locked: true }];
  assert.throws(() => removeObjects(s, ["x"]));
});
test("复制保持独立ID、来源与偏移", () => {
  const s = newScene("站台");
  s.objects = [newObject("table", "a")];
  duplicateObjects(
    s,
    [{ source_id: "a", new_id: "b", name: "桌子副本" }],
    [1, 0, 2],
  );
  assert.deepEqual(s.objects[1].transform.position, [1, 0, 2]);
  s.objects[1].transform.position[0] = 3;
  assert.equal(s.objects[0].transform.position[0], 0);
  assert.throws(() =>
    duplicateObjects(
      s,
      [{ source_id: "a", new_id: "b", name: "冲突" }],
      [0, 0, 0],
    ),
  );
});
test("三方合并保留独立实体改动并显式报告冲突", () => {
  const b = newScene("站台");
  b.objects = [newObject("table", "a"), newObject("chair", "b")];
  const l = clone(b),
    r = clone(b);
  l.objects[0].name = "本地桌子";
  r.objects[1].name = "远端椅子";
  let m = mergeScenes(b, l, r);
  assert.equal(m.conflicts.length, 0);
  assert.equal(m.scene.objects[0].name, "本地桌子");
  assert.equal(m.scene.objects[1].name, "远端椅子");
  r.objects[0].name = "远端桌子";
  m = mergeScenes(b, l, r);
  assert.equal(m.conflicts[0].path, "objects/a");
});
test("对象预算及多余Schema字段拒绝", () => {
  const s = newScene("站台");
  s.objects = Array.from({ length: 201 }, (_, i) => newObject("box", "o" + i));
  assert.throws(() => validate(s));
  const p = newScene("站台") as any;
  p.unknown = true;
  assert.throws(() => validate(p));
});
test("应用单次保存、原键恢复、CAS冲突与固定历史", async () => {
  const c = memoryCore();
  let r = (
    await c.invoke("save_scene", {
      content: newScene("旧站"),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    })
  ).data;
  const input = { ...base(r, "add"), object: newObject("table", "table") };
  r = (await c.invoke("put_object", input)).data;
  assert.equal(c.writes, 2);
  assert.equal((await c.invoke("put_object", input)).data.sha256, r.sha256);
  assert.equal(c.writes, 2);
  assert.equal(
    (
      await c.invoke("put_object", {
        ...input,
        object: newObject("chair", "chair"),
      })
    ).error!.code,
    "idempotency_conflict",
  );
  assert.equal(
    (await c.invoke("put_object", { ...input, operation_key: "stale" })).error!
      .code,
    "revision_conflict",
  );
  assert.equal(
    (
      await c.invoke("get_scene", {
        object_id: r.object.object_id,
        revision: 1,
      })
    ).data.object.content.objects.length,
    0,
  );
});
test("提交后丢回执沿原键恢复，无二次写入", async () => {
  const c = memoryCore();
  c.failAfterWrite = true;
  const input = {
    content: newScene("旧站"),
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "unknown",
  };
  assert.equal((await c.invoke("save_scene", input)).status, "failed");
  assert.equal(c.writes, 1);
  const r = await c.invoke("save_scene", input);
  assert.equal(r.status, "succeeded");
  assert.equal(c.writes, 1);
});
test("来源只追加且未知查询阻止写入", async () => {
  const c = memoryCore();
  let r = (
    await c.invoke("save_scene", {
      content: newScene("旧站"),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    })
  ).data;
  c.unknown = true;
  const result = await c.invoke("put_object", {
    ...base(r, "unknown"),
    object: newObject("table", "x"),
  });
  assert.equal(result.error!.code, "unknown");
  assert.equal(c.writes, 1);
});
test("被镜头引用机位不可删除，空机位不可保存", async () => {
  const c = memoryCore();
  const s = newScene("旧站");
  s.cameras.push(newCamera("two"));
  s.shots = [{ id: "s", camera_id: "two", start: 0, end: 150 }];
  const r = (
    await c.invoke("save_scene", {
      content: s,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    })
  ).data;
  assert.equal(
    (
      await c.invoke("remove_camera", {
        ...base(r, "remove"),
        camera_id: "two",
      })
    ).status,
    "failed",
  );
  assert.equal(c.writes, 1);
});
test("渲染计划绑定修订与摘要并拒绝非法机位或时间", async () => {
  const c = memoryCore();
  const r = (
    await c.invoke("save_scene", {
      content: newScene("旧站"),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    })
  ).data;
  const fixed = {
    object_id: r.object.object_id,
    revision: 1,
    mode: "sequence",
  };
  const p = (await c.invoke("render_plan", fixed)).data;
  assert.equal(p.project_ref.sha256, r.sha256);
  assert.equal(p.plan_sha256.length, 64);
  assert.equal(
    (await c.invoke("render_plan", { ...fixed, camera_ids: ["missing"] }))
      .status,
    "failed",
  );
  assert.equal(
    (await c.invoke("render_plan", { ...fixed, end_frame: 151 })).status,
    "failed",
  );
});
test("JSON按UTF8分块完整导出中文与emoji", async () => {
  const c = memoryCore();
  const s = newScene("雨港🪷");
  s.description = "中文🪷".repeat(500);
  const r = (
    await c.invoke("save_scene", {
      content: s,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    })
  ).data;
  let text = "",
    offset = 0;
  do {
    const out = await c.invoke("export_scene", {
      object_id: r.object.object_id,
      revision: 1,
      offset,
      max_bytes: 256,
    });
    assert.equal(out.status, "succeeded");
    text += out.data.content;
    if (out.data.next_offset === null) break;
    offset = out.data.next_offset;
  } while (true);
  assert.deepEqual(JSON.parse(text).scene, s);
});
test("固定来源追加核验，不能替换旧索引或跨作品伪造", async () => {
  const c = memoryCore();
  const ref = {
    kind: "work",
    work_ref: c.work,
    sha256: "a".repeat(64),
    revision_ref: { revision: 1 },
  };
  c.sources.set(JSON.stringify(ref), {});
  const { canonical } = await import("../src/domain/model.ts");
  c.sources.set(canonical(ref), { work: { title: "旧站" } });
  const p = newScene("旧站");
  p.objects.push({ ...newObject("table", "table"), source_index: 0 });
  const created = await c.invoke("save_scene", {
    content: p,
    source_refs: [ref],
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "source",
  });
  assert.equal(created.status, "succeeded");
  const r = created.data;
  const other = { ...ref, sha256: "b".repeat(64) };
  c.sources.set(canonical(other), {});
  assert.equal(
    (
      await c.invoke("save_scene", {
        ...base(r, "replace"),
        content: p,
        source_refs: [other],
      })
    ).status,
    "failed",
  );
  assert.equal(
    (
      await c.invoke("save_scene", {
        ...base(r, "remove-source"),
        content: p,
        source_refs: [],
      })
    ).status,
    "failed",
  );
  assert.equal(c.writes, 1);
});
test("生成ZIP包含可读取CRC及UTF8名称，拒绝目录穿越", async () => {
  const { zip } = await import("../src/render/zip.ts");
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "hetu-stage-zip-"));
  const file = path.join(dir, "out.zip");
  await writeFile(
    file,
    zip([
      { name: "机位/第一张.txt", bytes: new TextEncoder().encode("雨港🪷") },
    ]),
  );
  const r = spawnSync(
    "python3",
    [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read('机位/第一张.txt').decode()=='雨港🪷'",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.throws(() => zip([{ name: "../escape", bytes: new Uint8Array(1) }]));
});

test("大场景恢复稿保留原请求和当前稿，裁剪撤销栈而不超过宿主预算", () => {
  const draft = newScene("大场景");
  for (let i = 0; i < 50; i++)
    draft.notes.push({
      id: "n" + i,
      origin: "agent",
      text: "评".repeat(2600),
      target_id: null,
      fixed_revision: 1,
      frame: 0,
    });
  const input = {
    operation_key: "unknown-original",
    content: draft,
    expected_revision: 1,
    expected_sha256: "a".repeat(64),
  };
  const snapshot = recoverySnapshot({
    draft,
    pending: { action: "save_scene", input },
    history: Array.from({ length: 20 }, () => clone(draft)),
    future: [],
  });
  assert.ok(
    new TextEncoder().encode(JSON.stringify(snapshot)).length <= 900 * 1024,
  );
  assert.ok(snapshot.history.length < 20);
  assert.equal(snapshot.pending.input.content, undefined);
  assert.deepEqual(recoveredPending(snapshot).input, input);
  assert.deepEqual(snapshot.draft, draft);
});
