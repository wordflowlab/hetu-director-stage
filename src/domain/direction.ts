import {
  sample,
  type Scene,
  type Entity,
  type Vec,
  type Camera,
  type Shot,
} from "./model.ts";

/** 程序白模的保守边界；不是最终演员或素材的识别结果。 */
export const dimensions: Record<string, Vec> = {
  "person-standing": [0.65, 1.8, 0.4],
  "person-walking": [0.65, 1.8, 0.8],
  "person-light": [0.65, 1.8, 0.4],
  table: [1.5, 0.825, 0.85],
  chair: [0.48, 1.01, 0.48],
  sofa: [2.3, 0.97, 0.98],
  bed: [1.65, 1, 2.1],
  rug: [2.4, 0.03, 1.6],
  "floor-lamp": [0.6, 1.9, 0.6],
  plant: [1, 1.75, 1],
  "wall-3m": [3, 2.7, 0.15],
  "wall-5m": [5, 2.7, 0.15],
  "door-wall": [3, 2.7, 0.15],
  steps: [1.5, 0.54, 1.2],
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [0.9, 1, 0.9],
  plane: [2, 0.035, 2],
};
const sub = (a: Vec, b: Vec): Vec => a.map((v, i) => v - b[i]) as Vec;
const dot = (a: Vec, b: Vec) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec): Vec => {
  const n = Math.hypot(...v);
  return n < 1e-9 ? [0, 0, 0] : (v.map((x) => x / n) as Vec);
};
export function rotate(v: Vec, r: Vec): Vec {
  const [x, y, z] = r.map((v) => (v * Math.PI) / 180),
    [cx, cy, cz] = [Math.cos(x), Math.cos(y), Math.cos(z)],
    [sx, sy, sz] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  // Three.js Euler XYZ: R = Rx * Ry * Rz。
  const a = v[0] * cz - v[1] * sz,
    b = v[0] * sz + v[1] * cz;
  const c = a * cy + v[2] * sy,
    d = -a * sy + v[2] * cy;
  return [c, b * cx - d * sx, b * sx + d * cx];
}
function localPoint(o: Entity, v: Vec): Vec {
  return rotate(
    v.map((n, i) => n * o.transform.scale[i]) as Vec,
    o.transform.rotation,
  ).map((n, i) => n + o.transform.position[i]) as Vec;
}
export function projectPoint(c: Camera, point: Vec, aspect = 16 / 9) {
  const forward = unit(sub(c.target, c.position));
  const right = unit(
      cross(forward, Math.abs(forward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0]),
    ),
    up = cross(right, forward);
  const relative = sub(point, c.position),
    depth = dot(relative, forward),
    tangent = c.sensor_width_mm / (2 * c.focal_length_mm);
  const x = dot(relative, right) / (depth * tangent),
    y = dot(relative, up) / ((depth * tangent) / aspect);
  return {
    x,
    y,
    depth,
    visible:
      depth >= c.near && depth <= c.far && Math.abs(x) <= 1 && Math.abs(y) <= 1,
  };
}
function intersects(o: Entity, origin: Vec, target: Vec) {
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec[]
  ).map((v) => rotate(v, o.transform.rotation));
  const relative = sub(origin, o.transform.position),
    ray = sub(target, origin);
  const start = axes.map(
    (a, i) => dot(relative, a) / o.transform.scale[i],
  ) as Vec;
  const delta = axes.map((a, i) => dot(ray, a) / o.transform.scale[i]) as Vec;
  const d = dimensions[o.preset];
  const boxes =
    o.preset === "door-wall"
      ? [
          [
            [-1.5, 0, -0.075],
            [-0.55, 2.7, 0.075],
          ],
          [
            [0.55, 0, -0.075],
            [1.5, 2.7, 0.075],
          ],
          [
            [-0.55, 2.2, -0.075],
            [0.55, 2.7, 0.075],
          ],
        ]
      : [
          [
            [-d[0] / 2, 0, -d[2] / 2],
            [d[0] / 2, d[1], d[2] / 2],
          ],
        ];
  return boxes.some(([lo, hi]) => {
    let near = 0,
      far = 0.999;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(delta[i]) < 1e-9) {
        if (start[i] < lo[i] || start[i] > hi[i]) return false;
      } else {
        const a = (lo[i] - start[i]) / delta[i],
          b = (hi[i] - start[i]) / delta[i];
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    return near <= far && far > 0;
  });
}
export function speechEstimate(text: string, rate = 4) {
  const units = (
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu,
    ) ?? []
  ).length;
  return {
    units,
    rate,
    seconds: Math.round((units / rate) * 10) / 10,
    estimated: true as const,
  };
}
export type Finding = { code: string; text: string; object_id?: string };
export function shotReport(
  p: Scene,
  shot: Shot,
  frame = shot.start,
  aspect = 16 / 9,
) {
  if (frame < shot.start || frame >= shot.end)
    throw new Error("检查帧不在当前镜头内。");
  const s = sample(p, frame),
    c = s.cameras.find((c) => c.id === shot.camera_id)!;
  const findings: Finding[] = [];
  const actors = s.objects
    .filter((o) => o.visible && o.preset.startsWith("person-"))
    .map((o) => {
      const head = localPoint(o, [0, 1.64, 0]),
        body = localPoint(o, [0, 1.1, 0]),
        lower = localPoint(o, [0, 0.5, 0]),
        projected = projectPoint(c, body, aspect);
      const direction = rotate([0, 0, 1], o.transform.rotation),
        toward = unit(sub(c.position, body)),
        facingDot = dot(direction, toward);
      const facing =
        facingDot > 0.5
          ? "正面对镜头"
          : facingDot < -0.5
            ? "背对镜头"
            : "侧面对镜头";
      const position =
        projected.x < -0.33
          ? "画面左侧"
          : projected.x > 0.33
            ? "画面右侧"
            : "画面中间";
      const blockers = s.objects.filter(
        (b) =>
          b.id !== o.id &&
          b.visible &&
          b.preset !== "rug" &&
          b.preset !== "plane",
      );
      const headBlockers = blockers.filter((b) =>
          intersects(b, c.position, head),
        ),
        bodyBlockers = blockers.filter((b) => intersects(b, c.position, body)),
        lowerBlockers = blockers.filter((b) =>
          intersects(b, c.position, lower),
        );
      const inFrame =
        projected.visible || projectPoint(c, head, aspect).visible;
      if (!inFrame)
        findings.push({
          code: "out_of_frame",
          object_id: o.id,
          text: o.name + "可能位于画面外。",
        });
      if (
        inFrame &&
        (headBlockers.length || bodyBlockers.length || lowerBlockers.length)
      )
        findings.push({
          code: "possible_occlusion",
          object_id: o.id,
          text:
            o.name +
            "的" +
            (headBlockers.length
              ? "头部"
              : bodyBlockers.length
                ? "躯干"
                : "下半身") +
            "可能被" +
            (headBlockers[0] ?? bodyBlockers[0] ?? lowerBlockers[0]).name +
            "遮挡（白模包围盒估算）。",
        });
      return {
        object_id: o.id,
        name: o.name,
        marker: o.marker ?? "blue",
        position,
        facing,
        in_frame: inFrame,
        screen_x: projected.x,
        screen_y: projected.y,
        head_blockers: headBlockers.map((o) => o.id),
        body_blockers: bodyBlockers.map((o) => o.id),
        lower_blockers: lowerBlockers.map((o) => o.id),
      };
    })
    .sort((a, b) => a.screen_x - b.screen_x);
  const seconds = (shot.end - shot.start) / p.timeline.fps,
    speech = speechEstimate(shot.dialogue?.text ?? "", p.speech_rate ?? 4);
  if (speech.seconds > seconds)
    findings.push({
      code: "dialogue_duration",
      text: `台词估计需${speech.seconds}秒，当前镜头${Number(seconds.toFixed(2))}秒（按每秒${speech.rate}字词估算）。`,
    });
  if (
    shot.dialogue?.speaker_id &&
    !actors.some((a) => a.object_id === shot.dialogue!.speaker_id && a.in_frame)
  )
    findings.push({
      code: "speaker_offscreen",
      text: "说话人未在画面中，检查是否为有意的画外对白。",
    });
  const previous = [...p.shots]
    .filter((x) => x.end <= shot.start)
    .sort((a, b) => b.end - a.end)[0];
  let axis_side: number | null = null;
  if (p.dialogue_axis) {
    const side = (state: Scene, camera: Camera) => {
      const a = state.objects.find((o) => o.id === p.dialogue_axis!.from_id)!
          .transform.position,
        b = state.objects.find((o) => o.id === p.dialogue_axis!.to_id)!
          .transform.position;
      const cross =
        (b[0] - a[0]) * (camera.position[2] - a[2]) -
        (b[2] - a[2]) * (camera.position[0] - a[0]);
      return Math.abs(cross) < 0.05 ? 0 : Math.sign(cross);
    };
    axis_side = side(s, c);
    if (previous) {
      const state = sample(p, previous.end - 1),
        cam = state.cameras.find((c) => c.id === previous.camera_id)!;
      if (axis_side * side(state, cam) < 0)
        findings.push({
          code: "axis_crossing",
          text: "当前机位与上一镜位于对话轴线两侧，检查是否有意跨轴。",
        });
    }
  }
  const label =
      shot.label || "镜头 " + (p.shots.findIndex((x) => x.id === shot.id) + 1),
    speaker =
      p.objects.find((o) => o.id === shot.dialogue?.speaker_id)?.name ??
      "未指定";
  const description =
    `${label}（${c.name}，${c.focal_length_mm}mm，${Number(seconds.toFixed(2))}秒）：` +
    (actors.length
      ? actors
          .map(
            (a) =>
              `${a.name}${a.in_frame ? "在" + a.position : "可能在画外"}，${a.facing}`,
          )
          .join("；")
      : "无可见人物") +
    "。" +
    (shot.dialogue?.text ? ` ${speaker}：“${shot.dialogue.text}”` : "");
  return {
    shot_id: shot.id,
    label,
    camera_id: c.id,
    camera_name: c.name,
    focal_length_mm: c.focal_length_mm,
    frame,
    aspect,
    start: shot.start,
    end: shot.end,
    seconds,
    actors,
    speech,
    axis_side,
    findings,
    description,
  };
}
export function sceneReports(p: Scene, aspect = 16 / 9) {
  return [...p.shots]
    .sort((a, b) => a.start - b.start)
    .map((s) => shotReport(p, s, s.start, aspect));
}
