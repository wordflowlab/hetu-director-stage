import { test } from "node:test";
import assert from "node:assert/strict";
import { cafe } from "./support/cafe.ts";
import {
  clone,
  validate,
  sample,
  setTransformAt,
  retimeShot,
  removeObjects,
  newScene,
} from "../src/domain/model.ts";
import {
  projectPoint,
  shotReport,
  sceneReports,
  speechEstimate,
  rotate,
} from "../src/domain/direction.ts";
import { memoryCore } from "./support/memory-core.ts";

test("旧格式不补造字段或改变字节，新调度格式可读", () => {
  const old = newScene("旧站"),
    bytes = JSON.stringify(old);
  validate(old);
  sample(old, 0);
  assert.equal(JSON.stringify(old), bytes);
  assert.equal(old.dialogue_axis, undefined);
  validate(cafe());
});
test("逐镜起止采样、半开边界、邻镜与基础保持", () => {
  const p = cafe(),
    base = clone(p.objects[0].transform),
    end = { ...clone(base), position: [3, 0, 1] as [number, number, number] };
  setTransformAt(p, "woman", base, "s3");
  setTransformAt(p, "woman", end, "s3", "end");
  validate(p);
  assert.deepEqual(sample(p, 149).objects[0].transform, base);
  assert.deepEqual(sample(p, 150).objects[0].transform, base);
  assert.deepEqual(sample(p, 199).objects[0].transform, end);
  assert.deepEqual(sample(p, 200).objects[0].transform, base);
  assert.deepEqual(p.objects[0].transform, base);
  assert.ok(sample(p, 175).objects[0].transform.position[0] > 0);
});
test("镜头局部覆盖全局轨道，清空后恢复轨道", () => {
  const p = cafe();
  p.tracks = [
    {
      id: "global",
      target_kind: "object",
      target_id: "woman",
      property: "position",
      interpolation: "linear",
      keyframes: [
        { frame: 0, value: [0, 0, 0] },
        { frame: 274, value: [10, 0, 0] },
      ],
    },
  ];
  setTransformAt(
    p,
    "woman",
    { ...clone(p.objects[0].transform), position: [-2, 0, 0] },
    "s2",
  );
  assert.equal(sample(p, 100).objects[0].transform.position[0], -2);
  p.shots[1].blocking = [];
  assert.ok(sample(p, 100).objects[0].transform.position[0] > 0);
});
test("单帧局部只用起始值且人物旋转走最短角度", () => {
  const p = cafe(),
    a = clone(p.objects[0].transform),
    b = clone(a);
  a.rotation[1] = 179;
  b.rotation[1] = -179;
  p.shots = [
    {
      id: "s",
      camera_id: "wide",
      start: 0,
      end: 3,
      blocking: [{ object_id: "woman", transform: a, end_transform: b }],
    },
  ];
  validate(p);
  assert.equal(sample(p, 1).objects[0].transform.rotation[1], 180);
  p.shots[0].end = 1;
  assert.equal(sample(p, 0).objects[0].transform.rotation[1], 179);
});
test("悬空局部、重复调度、非人物说话人与坏轴线拒绝", () => {
  for (const edit of [
    (p: any) =>
      (p.shots[0].blocking = [
        { object_id: "gone", transform: p.objects[0].transform },
      ]),
    (p: any) =>
      (p.shots[0].blocking = [1, 2].map(() => ({
        object_id: "woman",
        transform: p.objects[0].transform,
      }))),
    (p: any) => (p.shots[1].dialogue.speaker_id = "counter"),
    (p: any) => (p.dialogue_axis.to_id = "woman"),
    (p: any) => (p.objects[0].marker = "pink"),
    (p: any) => (p.speech_rate = 0),
  ]) {
    const p = cafe();
    edit(p);
    assert.throws(() => validate(p));
  }
});
test("删除人物清理轴线及局部引用，保留台词文本", () => {
  const p = cafe();
  setTransformAt(p, "woman", p.objects[0].transform, "s3");
  const text = p.shots[2].dialogue!.text;
  removeObjects(p, ["woman"]);
  validate(p);
  assert.equal(p.dialogue_axis, null);
  assert.equal(p.shots[2].dialogue!.speaker_id, null);
  assert.equal(p.shots[2].dialogue!.text, text);
  assert.deepEqual(p.shots[2].blocking, []);
});
test("锁定对象拒绝基础与局部变换", () => {
  const p = cafe();
  p.objects[0].locked = true;
  assert.throws(() => setTransformAt(p, "woman", p.objects[0].transform));
  assert.throws(() => setTransformAt(p, "woman", p.objects[0].transform, "s1"));
});
test("时长调整整体平移后镜并保留调度和台词", () => {
  const p = cafe(),
    dialogue = clone(p.shots[2].dialogue);
  retimeShot(p, "s2", 100);
  validate(p);
  assert.equal(p.shots[2].start, 175);
  assert.equal(p.shots[2].end, 225);
  assert.deepEqual(p.shots[2].dialogue, dialogue);
  assert.equal(p.timeline.duration_frames, 300);
  assert.throws(() => retimeShot(p, "s2", 0));
  retimeShot(p, "s2", 1501);
  assert.throws(() => validate(p));
});
test("透视投影与Three坐标约定一致，画外和朝向可解释", () => {
  const p = cafe(),
    c = p.cameras[0];
  assert.ok(Math.abs(projectPoint(c, c.target).x) < 1e-8);
  assert.equal(projectPoint(c, [100, 1, 0]).visible, false);
  assert.ok(projectPoint(c, [1, 1, 0]).x > 0);
  const r = shotReport(p, p.shots[0]);
  assert.equal(r.actors.find((a) => a.name === "女主")!.facing, "背对镜头");
  assert.deepEqual(
    rotate([0, 0, 1], [0, 90, 0]).map((n) => Math.round(n)),
    [1, 0, 0],
  );
});
test("几何遮挡与画外提醒明确对象且隐形物体不参与", () => {
  const p = cafe();
  p.objects[1].transform.position = [0, 0, 0];
  p.objects[3].transform.position = [0, 0, 1];
  p.objects[3].transform.scale = [4, 1.5, 0.65];
  let r = shotReport(p, p.shots[0]);
  assert.ok(
    r.findings.some(
      (f) => f.code === "possible_occlusion" && f.object_id === "clerk",
    ),
  );
  p.objects[3].visible = false;
  r = shotReport(p, p.shots[0]);
  assert.ok(
    !r.findings.some(
      (f) => f.code === "possible_occlusion" && f.object_id === "clerk",
    ),
  );
  p.objects[1].transform.position = [100, 0, 0];
  r = shotReport(p, p.shots[3]);
  assert.ok(r.findings.some((f) => f.code === "speaker_offscreen"));
});
test("门洞的空白不会被完整墙包围盒误判", () => {
  const p = cafe();
  p.objects = p.objects.filter((o) => ["clerk", "counter"].includes(o.id));
  p.dialogue_axis = null;
  p.shots = [p.shots[0]];
  p.objects[0].transform.position = [0, 0, 0];
  p.objects[1].preset = "door-wall";
  p.objects[1].transform.position = [0, 0, 1];
  p.objects[1].transform.scale = [1, 1, 1];
  const r = shotReport(p, p.shots[0]);
  assert.ok(!r.findings.some((f) => f.code === "possible_occlusion"));
});
test("显式对话轴线跨侧提示，无轴线不猜测", () => {
  const p = cafe();
  p.cameras[2].position = [2, 1.6, -4];
  let r = shotReport(p, p.shots[2]);
  assert.ok(r.findings.some((f) => f.code === "axis_crossing"));
  p.dialogue_axis = null;
  r = shotReport(p, p.shots[2]);
  assert.equal(r.axis_side, null);
  assert.ok(!r.findings.some((f) => f.code === "axis_crossing"));
});
test("中文按字、英文按词估时且标明语速，非真实声音", () => {
  assert.equal(speechEstimate("你好，世界！", 4).seconds, 1);
  assert.equal(speechEstimate("Hello, how are you?", 2).seconds, 2);
  const p = cafe(),
    r = shotReport(p, p.shots[2]);
  assert.equal(r.speech.estimated, true);
  assert.ok(r.findings.some((f) => f.code === "dialogue_duration"));
  assert.throws(() => shotReport(p, p.shots[2], 200));
  assert.equal(sceneReports(p).length, 4);
});
test("新增机器动作固定历史、CAS、原键、台词来源与报告", async () => {
  const c = memoryCore();
  let r = (
    await c.invoke("save_scene", {
      content: cafe(),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "cafe",
    })
  ).data;
  const base = (key: string) => ({
    object_id: r.object.object_id,
    expected_revision: r.object.revision,
    expected_sha256: r.sha256,
    operation_key: key,
  });
  r = (
    await c.invoke("set_direction", {
      ...base("axis"),
      dialogue_axis: { from_id: "woman", to_id: "man" },
      speech_rate: 3,
    })
  ).data;
  const input = {
    ...base("block"),
    shot_id: "s3",
    blocking: [
      {
        object_id: "woman",
        transform: {
          ...clone(r.object.content.objects[0].transform),
          position: [-2, 0, 1],
        },
      },
    ],
  };
  r = (await c.invoke("set_blocking", input)).data;
  assert.ok(r);
  assert.equal((await c.invoke("set_blocking", input)).data.sha256, r.sha256);
  const s = clone(r.object.content.shots[2]);
  s.dialogue.text = "我先到。";
  r = (await c.invoke("put_shot", { ...base("shot"), shot: s })).data;
  const report = await c.invoke("shot_report", {
    object_id: r.object.object_id,
    revision: r.object.revision,
    shot_id: "s3",
  });
  assert.equal(report.status, "succeeded");
  assert.equal(report.data.project_ref.sha256, r.sha256);
  assert.equal(report.data.reports[0].speech.rate, 3);
  assert.equal(
    (
      await c.invoke("get_scene", {
        object_id: r.object.object_id,
        revision: 1,
      })
    ).data.object.content.shots[2].blocking,
    undefined,
  );
  s.dialogue.source_index = 0;
  assert.equal(
    (await c.invoke("put_shot", { ...base("bad-source"), shot: s })).status,
    "failed",
  );
  assert.equal(
    (
      await c.invoke("shot_report", {
        object_id: r.object.object_id,
        revision: 1,
        frame: 0,
      })
    ).status,
    "failed",
  );
});

test("基础编辑拒绝动画属性覆盖，局部调度仍可调整", () => {
  const p = cafe();
  p.tracks = [
    {
      id: "global",
      target_kind: "object",
      target_id: "woman",
      property: "position",
      interpolation: "linear",
      keyframes: [{ frame: 0, value: [0, 0, 0] }],
    },
  ];
  const before = clone(p.objects[0].transform),
    moved = clone(before);
  moved.position[0] = 2;
  assert.throws(() => setTransformAt(p, "woman", moved), /全局动画/);
  assert.deepEqual(p.objects[0].transform, before);
  const turned = clone(before);
  turned.rotation[1] = 90;
  setTransformAt(p, "woman", turned);
  setTransformAt(p, "woman", moved, "s3");
  assert.equal(sample(p, 150).objects[0].transform.position[0], 2);
});
