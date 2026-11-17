import { createHash } from "node:crypto";
import type { BackendContext, ObjectResult } from "../../vendor/hetu-sdk.ts";
import {
  ProjectStore,
  requireValue as need,
  success,
  failure,
  fixed,
  ProjectError,
} from "../../vendor/project-store.ts";
import {
  PLUGIN_ID,
  KIND,
  validate,
  validateIndices,
  validateAction,
  clone,
  canonical,
  removeObjects,
  duplicateObjects,
  differences,
  checks,
  type Scene,
} from "../domain/model.ts";
import { renderIntegrity } from "../render/build-integrity.ts";
import { sceneReports, shotReport } from "../domain/direction.ts";
export const effects = new Set([
  "save_scene",
  "put_object",
  "transform_objects",
  "duplicate_objects",
  "remove_objects",
  "set_visibility",
  "put_camera",
  "remove_camera",
  "set_environment",
  "set_timeline",
  "put_track",
  "remove_track",
  "set_shots",
  "add_note",
  "fork_scene",
  "put_shot", "set_blocking", "set_direction",
]);
export class StageProject {
  readonly store: ProjectStore;
  readonly context: BackendContext;
  constructor(context: BackendContext) {
    this.context = context;
    this.store = new ProjectStore(context, PLUGIN_ID, KIND, validate);
  }
  async save(input: any, p: Scene, previous?: ObjectResult) {
    validate(p);
    const refs = input.source_refs ?? previous?.object.source_refs ?? [];
    validateIndices(p, refs.length);
    await this.store.sources(refs);
    return this.store.save(input, p, previous);
  }
  async invoke(action: string, raw: unknown) {
    try {
      validateAction(action, raw);
      const input = clone(raw) as any;
      if (effects.has(action)) {
        const recovered = await this.store.recover(input.operation_key);
        if (recovered) return recovered;
      }
      if (action === "get_operation")
        return this.store.call("hetu.extensions.operations.get", input);
      if (action === "list_scenes")
        return this.store.call(
          input.query
            ? "hetu.extensions.objects.search"
            : "hetu.extensions.objects.list",
          { ...input, kind: KIND },
        );
      if (action === "save_scene") {
        need(
          input.object_id
            ? input.expected_revision > 0 && input.expected_sha256.length === 64
            : input.expected_revision === 0 && input.expected_sha256 === "",
          "新建或更新基线无效。",
        );
        const prev = input.object_id
          ? await this.store.baseline(input)
          : undefined;
        return await this.save(input, input.content, prev);
      }
      if (action === "fork_scene") {
        const r = await this.store.get(input.object_id, input.revision),
          p = clone(r.object.content) as Scene;
        p.title = input.title;
        return await this.save(
          {
            expected_revision: 0,
            expected_sha256: "",
            operation_key: input.operation_key,
            source_refs: r.object.source_refs ?? [],
          },
          p,
        );
      }
      if (action === "compare_versions") {
        const a = await this.store.get(input.object_id, input.from_revision),
          b = await this.store.get(input.object_id, input.to_revision);
        return success({
          from_ref: fixed(a),
          to_ref: fixed(b),
          changes: differences(a.object.content, b.object.content),
        });
      }
      if (effects.has(action)) {
        const r = await this.store.baseline(input),
          p = clone(r.object.content) as Scene;
        const upsert = (key: "objects" | "cameras" | "tracks", value: any) => {
          const list = p[key] as any[];
          const i = list.findIndex((x) => x.id === value.id);
          if (i < 0) list.push(value);
          else list[i] = value;
        };
        switch (action) {
          case "put_object":
            upsert("objects", input.object);
            break;
          case "transform_objects":
            for (const c of input.changes) {
              const o = p.objects.find((x) => x.id === c.id);
              need(o, "对象不存在。");
              need(!o.locked, "对象已锁定。");
              o.transform = c.transform;
            }
            break;
          case "duplicate_objects":
            duplicateObjects(p, input.items, input.offset);
            break;
          case "remove_objects":
            removeObjects(p, input.object_ids);
            break;
          case "set_visibility":
            for (const id of input.object_ids) {
              const o = p.objects.find((x) => x.id === id);
              need(o, "对象不存在。");
              o.visible = input.visible;
            }
            break;
          case "put_camera":
            upsert("cameras", input.camera);
            break;
          case "remove_camera":
            need(
              p.cameras.some((c) => c.id === input.camera_id),
              "机位不存在。",
            );
            need(
              !p.shots.some((s) => s.camera_id === input.camera_id) &&
                !p.tracks.some(
                  (t) =>
                    t.target_kind === "camera" &&
                    t.target_id === input.camera_id,
                ),
              "机位仍被镜头或轨道引用。",
            );
            p.cameras = p.cameras.filter((c) => c.id !== input.camera_id);
            break;
          case "set_environment":
            p.environment = input.environment;
            break;
          case "set_timeline":
            p.timeline = input.timeline;
            break;
          case "put_track":
            upsert("tracks", input.track);
            break;
          case "remove_track":
            need(
              p.tracks.some((t) => t.id === input.track_id),
              "轨道不存在。",
            );
            p.tracks = p.tracks.filter((t) => t.id !== input.track_id);
            break;
          case "set_shots":
            p.shots = input.shots;
            break;
          case "put_shot": {
            const i=p.shots.findIndex(s=>s.id===input.shot.id);
            if(i<0)p.shots.push(input.shot);else p.shots[i]=input.shot;
            break;
          }
          case "set_blocking": {
            const s=p.shots.find(s=>s.id===input.shot_id);need(s,"镜头不存在。");
            for(const b of input.blocking) need(!p.objects.find(o=>o.id===b.object_id)?.locked,"对象已锁定。");
            s.blocking=input.blocking;break;
          }
          case "set_direction":
            p.dialogue_axis=input.dialogue_axis;p.speech_rate=input.speech_rate;break;
          case "add_note":
            need(
              !p.notes.some((n) => n.id === input.note.id),
              "意见ID已存在。",
            );
            need(
              input.note.fixed_revision <= r.object.revision,
              "意见不能指向未来修订。",
            );
            p.notes.push(input.note);
            break;
          default:
            throw new ProjectError("未实现写动作。", "not_found");
        }
        return await this.save(input, p, r);
      }
      const r = await this.store.get(input.object_id, input.revision),
        p = r.object.content as Scene;
      switch (action) {
        case "get_scene":
          return success(
            input.projection === "summary"
              ? {
                  project_ref: fixed(r),
                  title: p.title,
                  objects: p.objects.map((o) => ({
                    id: o.id,
                    name: o.name,
                    preset: o.preset,
                    visible: o.visible,
                  })),
                  cameras: p.cameras,
                  counts: checks(p).counts,
                  timeline: p.timeline,
                  shots: p.shots,
                }
              : r,
          );
        case "check_scene":
          return success({ project_ref: fixed(r), ...checks(p), shots: sceneReports(p) });
        case "shot_report": {
          const shots=input.shot_id?p.shots.filter(s=>s.id===input.shot_id):p.shots;
          need(shots.length,"没有找到镜头，请先安排镜头区间。");
          if(input.frame!==undefined) need(input.shot_id,"指定检查帧时需要确切shot_id。");
          return success({project_ref:fixed(r),source_refs:r.object.source_refs??[],basis:"程序白模几何与显式语速估算",reports:shots.sort((a,b)=>a.start-b.start).map(s=>shotReport(p,s,input.frame??s.start,input.aspect??16/9))});
        }
        case "prepare_handoff":
          return success({
            project_ref: fixed(r),
            work_ref: this.context.work_ref,
            goal: input.goal,
            source_refs: r.object.source_refs ?? [],
            summary: { title: p.title, ...checks(p) },
            instructions:
              "先发现实际能力与同包Skill；固定读取后修改，原键恢复；白模不代替最终画面或作者认可。",
          });
        case "export_scene": {
          const content =
            JSON.stringify(
              {
                format: "hetu.director-stage.scene",
                version: 1,
                project_ref: fixed(r),
                work_ref: this.context.work_ref,
                source_refs: r.object.source_refs ?? [],
                scene: p,
              },
              null,
              2,
            ) + "\n";
          const bytes = Buffer.from(content),
            offset = input.offset ?? 0,
            max = input.max_bytes ?? 32768;
          need(offset <= bytes.length, "导出偏移越界。");
          need(
            offset === 0 ||
              offset === bytes.length ||
              (bytes[offset] & 0xc0) !== 0x80,
            "导出偏移不是UTF-8边界。",
          );
          let end = Math.min(bytes.length, offset + max);
          while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
          const chunk = bytes.subarray(offset, end).toString();
          return success({
            project_ref: fixed(r),
            offset,
            next_offset: end === bytes.length ? null : end,
            total_bytes: bytes.length,
            media_type: "application/json",
            content: chunk,
            content_sha256: createHash("sha256").update(chunk).digest("hex"),
          });
        }
        case "render_plan": {
          const ids = input.camera_ids ?? [p.cameras[0].id];
          need(
            ids.length > 0 &&
              ids.length === new Set(ids).size &&
              ids.every((id: string) => p.cameras.some((c) => c.id === id)),
            "渲染机位无效或重复。",
          );
          const frame = input.frame ?? 0,
            start = input.start_frame ?? 0,
            end = input.end_frame ?? p.timeline.duration_frames;
          need(
            frame < p.timeline.duration_frames &&
              start < end &&
              end <= p.timeline.duration_frames,
            "渲染时间范围无效。",
          );
          const width = Number(input.width ?? "1280"),
            height = input.height ?? Math.round((width * 9) / 16);
          need(width * height <= 1920 * 2160, "渲染像素超出预算。");
          need(
            (end - start) * width * height <= 1920 * 1080 * 1500,
            "渲染序列超出预算。",
          );
          const plan = {
            format: "hetu.director-stage.render",
            renderer: renderIntegrity,
            version: 1,
            plugin_id: PLUGIN_ID,
            project_ref: fixed(r),
            work_ref: this.context.work_ref,
            source_refs: r.object.source_refs ?? [],
            scene: p,
            render: {
              mode: input.mode,
              camera_ids: ids,
              frame,
              start_frame: start,
              end_frame: end,
              width,
              height,
              fps: p.timeline.fps,
            },
          };
          return success({
            ...plan,
            plan_sha256: createHash("sha256")
              .update(canonical(plan))
              .digest("hex"),
          });
        }
        default:
          throw new ProjectError("未实现读动作。", "not_found");
      }
    } catch (e) {
      return failure(e);
    }
  }
}
