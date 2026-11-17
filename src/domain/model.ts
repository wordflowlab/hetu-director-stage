import * as validators from "./validators.ts";
import manifest from "../../contracts/plugin-manifest.json" with { type: "json" };
import {
  requireValue as need,
  clone,
  canonical,
} from "../../vendor/project-store.ts";
export { clone, canonical };
export const PLUGIN_ID = manifest.id,
  KIND = "director_stage_scene";
export const WORK_KIND = "video" as const,
  VIDEO = true;
export type Vec = [number, number, number];
export interface Transform {
  position: Vec;
  rotation: Vec;
  scale: Vec;
}
export const presets = [
  "person-standing",
  "person-walking",
  "person-light",
  "table",
  "chair",
  "sofa",
  "bed",
  "rug",
  "floor-lamp",
  "plant",
  "wall-3m",
  "wall-5m",
  "door-wall",
  "steps",
  "box",
  "sphere",
  "cylinder",
  "plane",
] as const;
export type Preset = (typeof presets)[number];
export const names: Record<Preset, string> = {
  "person-standing": "人物 站姿",
  "person-walking": "人物 行走",
  "person-light": "人物 浅色",
  table: "桌子",
  chair: "椅子",
  sofa: "沙发",
  bed: "床",
  rug: "地毯",
  "floor-lamp": "落地灯",
  plant: "植物",
  "wall-3m": "墙 3m",
  "wall-5m": "墙 5m",
  "door-wall": "门洞墙",
  steps: "台阶",
  box: "方块",
  sphere: "球体",
  cylinder: "圆柱",
  plane: "平板",
};
export interface Entity {
  id: string;
  name: string;
  preset: Preset;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  source_index: number | null;
}
export interface Camera {
  id: string;
  name: string;
  position: Vec;
  target: Vec;
  focal_length_mm: number;
  sensor_width_mm: number;
  near: number;
  far: number;
}
export interface Track {
  id: string;
  target_kind: "object" | "camera";
  target_id: string;
  property: "position" | "rotation" | "scale" | "target";
  interpolation: "linear" | "step";
  keyframes: { frame: number; value: Vec }[];
}
export interface Shot {
  id: string;
  camera_id: string;
  start: number;
  end: number;
}
export interface Note {
  id: string;
  origin: "author" | "agent";
  text: string;
  target_id: string | null;
  fixed_revision: number;
  frame: number;
}
export interface Scene {
  format_version: 1;
  title: string;
  description: string;
  objects: Entity[];
  cameras: Camera[];
  environment: {
    ground: boolean;
    shadows: boolean;
    grid: boolean;
    white_model: boolean;
    background: "studio" | "dark";
    sun_azimuth: number;
    sun_elevation: number;
  };
  timeline: { fps: number; duration_frames: number };
  tracks: Track[];
  shots: Shot[];
  notes: Note[];
}
export function validateAction(action: string, input: unknown) {
  const v = (validators as any)[action];
  need(v, "未发现专业动作。", "not_found");
  need(v(input), "动作参数无效：" + JSON.stringify(v.errors));
}
const schemaValidator: any = validators.scene;
export function newObject(
  preset: Preset,
  id: string,
  name = names[preset],
): Entity {
  return {
    id,
    name,
    preset,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    source_index: null,
  };
}
export function newCamera(id = "camera-1", name = "机位 1"): Camera {
  return {
    id,
    name,
    position: [7, 5, 9],
    target: [0, 1, 0],
    focal_length_mm: 40,
    sensor_width_mm: 36,
    near: 0.05,
    far: 500,
  };
}
export function newScene(title: string): Scene {
  return {
    format_version: 1,
    title,
    description: "",
    objects: [],
    cameras: [newCamera()],
    environment: {
      ground: true,
      shadows: true,
      grid: true,
      white_model: true,
      background: "studio",
      sun_azimuth: 40,
      sun_elevation: 45,
    },
    timeline: { fps: 25, duration_frames: 150 },
    tracks: [],
    shots: [],
    notes: [],
  };
}
function unique(ids: string[], label: string) {
  need(ids.length === new Set(ids).size, label + "ID重复。");
}
export function validate(p: Scene) {
  need(
    schemaValidator(p),
    "场景格式无效：" + JSON.stringify(schemaValidator.errors),
  );
  unique(
    [...p.objects.map((x) => x.id), ...p.cameras.map((x) => x.id)],
    "对象与机位",
  );
  unique(
    p.tracks.map((x) => x.id),
    "轨道",
  );
  unique(
    p.shots.map((x) => x.id),
    "镜头",
  );
  unique(
    p.notes.map((x) => x.id),
    "意见",
  );
  const frames = p.timeline.duration_frames;
  for (const c of p.cameras) {
    need(c.near < c.far, "机位near必须小于far。");
    need(
      c.position.some((v, i) => Math.abs(v - c.target[i]) > 1e-6),
      "机位位置不能等于目标。",
    );
  }
  const channels = new Set<string>();
  for (const t of p.tracks) {
    const target =
      t.target_kind === "object"
        ? p.objects.find((x) => x.id === t.target_id)
        : p.cameras.find((x) => x.id === t.target_id);
    need(target, "轨道目标不存在。");
    need(
      t.target_kind === "object"
        ? t.property !== "target"
        : ["position", "target"].includes(t.property),
      "轨道属性与目标类型不一致。",
    );
    const key = t.target_kind + ":" + t.target_id + ":" + t.property;
    need(!channels.has(key), "同一属性存在重复轨道。");
    channels.add(key);
    let prev = -1;
    for (const k of t.keyframes) {
      need(
        k.frame > prev && k.frame < frames,
        "关键帧须严格递增且位于预演范围内。",
      );
      if (t.property === "scale")
        need(
          k.value.every((v) => v >= 0.01 && v <= 100),
          "关键帧比例越界。",
        );
      prev = k.frame;
    }
  }
  const sorted = [...p.shots].sort((a, b) => a.start - b.start);
  let end = 0;
  for (const s of sorted) {
    need(
      p.cameras.some((c) => c.id === s.camera_id),
      "镜头机位不存在。",
    );
    need(
      s.end > s.start && s.end <= frames && s.start >= end,
      "镜头区间无效或重叠。",
    );
    end = s.end;
  }
  for (const n of p.notes) {
    need(n.frame < frames, "意见时间超出预演范围。");
    need(
      n.target_id === null ||
        p.objects.some((x) => x.id === n.target_id) ||
        p.cameras.some((x) => x.id === n.target_id),
      "意见目标不存在。",
    );
  }
  // 同时约束相机动画，禁止中间帧出现退化取景。
  if (p.tracks.some((t) => t.target_kind === "camera"))
    for (let f = 0; f < frames; f++) {
      const state = sample(p, f);
      for (const c of state.cameras)
        need(
          c.position.some((v, i) => Math.abs(v - c.target[i]) > 1e-6),
          "机位动画包含位置与目标重合的帧。",
        );
    }
}
export function validateIndices(p: Scene, count: number) {
  for (const o of p.objects)
    need(
      o.source_index === null || o.source_index < count,
      "对象来源索引不存在。",
    );
}
export function interpolate(track: Track, frame: number): Vec {
  const keys = track.keyframes;
  if (frame <= keys[0].frame) return [...keys[0].value];
  if (frame >= keys.at(-1)!.frame) return [...keys.at(-1)!.value];
  const right = keys.findIndex((k) => k.frame > frame),
    a = keys[right - 1],
    b = keys[right];
  if (track.interpolation === "step") return [...a.value];
  const alpha = (frame - a.frame) / (b.frame - a.frame);
  return a.value.map((v, i) => v + (b.value[i] - v) * alpha) as Vec;
}
export function sample(p: Scene, frame: number): Scene {
  const s = clone(p);
  for (const t of p.tracks) {
    const target: any =
      t.target_kind === "object"
        ? s.objects.find((x) => x.id === t.target_id)?.transform
        : s.cameras.find((x) => x.id === t.target_id);
    if (target) target[t.property] = interpolate(t, frame);
  }
  return s;
}
export function cameraAt(p: Scene, frame: number, fallback?: string) {
  return (
    p.shots.find((s) => s.start <= frame && frame < s.end)?.camera_id ??
    fallback ??
    p.cameras[0].id
  );
}
export function removeObjects(p: Scene, ids: string[]) {
  unique(ids, "选择");
  for (const id of ids) {
    const o = p.objects.find((x) => x.id === id);
    need(o, "对象不存在。");
    need(!o.locked, "对象已锁定。");
  }
  p.objects = p.objects.filter((x) => !ids.includes(x.id));
  p.tracks = p.tracks.filter(
    (x) => x.target_kind !== "object" || !ids.includes(x.target_id),
  );
  p.notes = p.notes.map((n) =>
    ids.includes(n.target_id ?? "") ? { ...n, target_id: null } : n,
  );
}
export function duplicateObjects(
  p: Scene,
  items: { source_id: string; new_id: string; name: string }[],
  offset: Vec,
) {
  for (const item of items) {
    const source = p.objects.find((o) => o.id === item.source_id);
    need(source, "复制来源不存在。");
    need(
      !p.objects.some((o) => o.id === item.new_id) &&
        !p.cameras.some((c) => c.id === item.new_id),
      "新ID已存在。",
    );
    const n = clone(source);
    n.id = item.new_id;
    n.name = item.name;
    n.locked = false;
    n.transform.position = n.transform.position.map(
      (v, i) => v + offset[i],
    ) as Vec;
    p.objects.push(n);
  }
}
export function differences(
  a: unknown,
  b: unknown,
  path = "",
): { path: string; before: unknown; after: unknown }[] {
  if (canonical(a) === canonical(b)) return [];
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      differences((a as any)[k], (b as any)[k], path + "/" + k),
    );
  }
  return [{ path, before: a ?? null, after: b ?? null }];
}
/** 按顶层及实体ID三方合并；同字段同时变化留给作者选择。 */
export function mergeScenes(base: Scene, local: Scene, remote: Scene) {
  const result = clone(remote),
    conflicts: { path: string; local: unknown; remote: unknown }[] = [];
  for (const k of Object.keys(local) as (keyof Scene)[]) {
    if (["objects", "cameras", "tracks", "shots", "notes"].includes(k)) {
      const a = base[k] as any[],
        l = local[k] as any[],
        r = remote[k] as any[];
      const out: any[] = [];
      for (const id of new Set([
        ...r.map((x) => x.id),
        ...l.map((x) => x.id),
        ...a.map((x) => x.id),
      ])) {
        const av = a.find((x) => x.id === id),
          lv = l.find((x) => x.id === id),
          rv = r.find((x) => x.id === id);
        let chosen = rv;
        if (canonical(lv) === canonical(av)) chosen = rv;
        else if (
          canonical(rv) === canonical(av) ||
          canonical(lv) === canonical(rv)
        )
          chosen = lv;
        else {
          conflicts.push({
            path: k + "/" + id,
            local: lv ?? null,
            remote: rv ?? null,
          });
          chosen = lv;
        }
        if (chosen) out.push(clone(chosen));
      }
      (result as any)[k] = out;
    } else if (canonical(local[k]) !== canonical(base[k])) {
      if (
        canonical(remote[k]) !== canonical(base[k]) &&
        canonical(remote[k]) !== canonical(local[k])
      )
        conflicts.push({ path: k, local: local[k], remote: remote[k] });
      (result as any)[k] = clone(local[k]);
    }
  }
  return { scene: result, conflicts };
}
export function checks(p: Scene) {
  return {
    errors: [],
    warnings: [
      ...(!p.objects.length ? ["场景没有白模对象。"] : []),
      ...(!p.shots.length ? ["尚未安排镜头切换，预演使用默认机位。"] : []),
      ...(p.tracks.length === 0 ? ["预演没有运动轨道。"] : []),
    ],
    counts: {
      objects: p.objects.length,
      cameras: p.cameras.length,
      tracks: p.tracks.length,
      shots: p.shots.length,
    },
  };
}
