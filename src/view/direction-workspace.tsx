import React, { useEffect, useRef, useState } from "react";
import {
  clone,
  sample,
  cameraAt,
  newCamera,
  setTransformAt,
  retimeShot,
  type Scene,
  type Shot,
  type Transform,
  type Vec,
  type Preset,
} from "../domain/model.ts";
import {
  dimensions,
  shotReport,
  sceneReports,
  projectPoint,
} from "../domain/direction.ts";
import { StageWorld, renderer, setCamera } from "../render/scene.ts";
import { PlanCanvas } from "./plan-canvas.tsx";

type Edit = (fn: (p: Scene) => void) => void;
function NumberField({
  label,
  value,
  change,
  step = 0.1,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="direction-field">
      {label}
      <input
        key={value}
        aria-label={label}
        type="number"
        step={step}
        defaultValue={Number(value.toFixed(3))}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(n) && n !== value)
            change(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function CameraPreview({
  scene,
  frame,
  cameraId,
  aspect,
  error,
}: {
  scene: Scene;
  frame: number;
  cameraId: string;
  aspect: number;
  error: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    render = useRef<ReturnType<typeof renderer>>(),
    world = useRef<StageWorld>();
  useEffect(() => {
    if (!canvas.current) return;
    try {
      render.current ??= renderer(canvas.current);
      world.current?.dispose();
      world.current = new StageWorld(scene, frame);
      world.current.helpers.visible = false;
    } catch (e) {
      error("机位预览失败：" + String(e));
    }
  }, [scene]);
  useEffect(() => {
    try {
      const r = render.current,
        w = world.current;
      if (!r || !w) return;
      r.setSize(640, Math.round(640 / aspect), false);
      w.updateFrame(frame);
      const c = sample(scene, frame).cameras.find((c) => c.id === cameraId)!;
      setCamera(w.camera(cameraId), c, 640, 640 / aspect);
      r.render(w.scene, w.camera(cameraId));
    } catch (e) {
      error("机位预览失败：" + String(e));
    }
  }, [scene, frame, cameraId, aspect]);
  useEffect(
    () => () => {
      world.current?.dispose();
      render.current?.dispose();
      render.current?.forceContextLoss();
    },
    [],
  );
  const s = sample(scene, frame),
    c = s.cameras.find((c) => c.id === cameraId)!;
  return (
    <div className="direction-preview" style={{ aspectRatio: aspect }}>
      <canvas ref={canvas} aria-label="调度机位实时预览" />
      {s.objects
        .filter((o) => o.visible && o.preset.startsWith("person-"))
        .map((o) => {
          const q = projectPoint(
            c,
            [
              o.transform.position[0],
              o.transform.position[1] + 1.9 * o.transform.scale[1],
              o.transform.position[2],
            ],
            aspect,
          );
          return q.visible ? (
            <span
              key={o.id}
              className={"actor-name marker-" + (o.marker ?? "blue")}
              style={{ left: (q.x + 1) * 50 + "%", top: (1 - q.y) * 50 + "%" }}
            >
              {o.name}
            </span>
          ) : null;
        })}
    </div>
  );
}
export function DirectionWorkspace({
  scene,
  selected,
  onSelect,
  frame,
  onFrame,
  change,
  onAdd,
  onRemove,
  onDuplicate,
  copy,
  error,
  aspect,
  playing,
  onPlay,
  snap,
  onSnap,
  undo,
  redo,
  canUndo,
  canRedo,
  onExport,
}: {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  frame: number;
  onFrame: (f: number) => void;
  change: Edit;
  onAdd: (preset: Preset) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  copy: (text: string) => Promise<void>;
  error: (message: string) => void;
  aspect: number;
  playing: boolean;
  onPlay: () => void;
  snap: boolean;
  onSnap: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onExport: () => void;
}) {
  const [local, setLocal] = useState(false),
    [endpoint, setEndpoint] = useState<"start" | "end">("start"),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true);
  const shot = scene.shots.find((s) => s.start <= frame && frame < s.end),
    cameraId = scene.cameras.some((c) => c.id === selected)
      ? selected!
      : cameraAt(scene, frame);
  useEffect(() => {
    setEndpoint("start");
    if (!shot) setLocal(false);
  }, [shot?.id]);
  useEffect(() => {
    if (local && shot) onFrame(endpoint === "end" ? shot.end - 1 : shot.start);
  }, [local, endpoint, shot?.id, shot?.start, shot?.end]);
  const state = sample(scene, frame),
    object = state.objects.find((o) => o.id === selected),
    camera = state.cameras.find((c) => c.id === selected);
  const reportShot = shot ?? {
    id: "unassigned",
    camera_id: cameraId,
    start: frame,
    end: Math.min(frame + 1, scene.timeline.duration_frames),
  };
  const report = shotReport(
    scene,
    { ...reportShot, camera_id: cameraId },
    frame,
    aspect,
  );
  const transform = (id: string, t: Transform) =>
    change((p) =>
      setTransformAt(p, id, t, local ? shot?.id : undefined, endpoint),
    );
  const editCamera = (id: string, position: Vec, target: Vec) =>
    change((p) => {
      const c = p.cameras.find((c) => c.id === id)!;
      for (const t of p.tracks.filter(
        (t) => t.target_kind === "camera" && t.target_id === id,
      )) {
        const v =
          t.property === "position"
            ? position
            : t.property === "target"
              ? target
              : null;
        if (
          v &&
          JSON.stringify(v) !==
            JSON.stringify(c[t.property as "position" | "target"])
        )
          throw new Error("该机位已有全局动画，请在三维布景中修改关键帧。");
      }
      Object.assign(c, { position, target });
    });
  const addShot = () =>
    change((p) => {
      const start = Math.max(0, ...p.shots.map((s) => s.end)),
        end = start + p.timeline.fps * 3;
      if (end > 1500) throw new Error("镜头超出1500帧预算。");
      p.timeline.duration_frames = Math.max(p.timeline.duration_frames, end);
      p.shots.push({
        id: crypto.randomUUID(),
        label: "S" + (p.shots.length + 1),
        camera_id: cameraId,
        start,
        end,
      });
      onFrame(start);
    });
  const fieldTransform = local
    ? object?.transform
    : scene.objects.find((o) => o.id === selected)?.transform;
  const vector = (label: string, value: Vec, apply: (v: Vec) => void) => (
    <div className="direction-vector">
      <span>{label}</span>
      {value.map((v, i) => (
        <NumberField
          key={i}
          label={label + " " + ["X", "Y", "Z"][i]}
          value={v}
          change={(n) => {
            const next = [...value] as Vec;
            next[i] = n;
            apply(next);
          }}
        />
      ))}
    </div>
  );
  return (
    <>
      <nav className="direction-toolbar" aria-label="调度工具">
        <button
          aria-label={left ? "收起调度对象" : "展开调度对象"}
          onClick={() => setLeft(!left)}
        >
          对象
        </button>
        <label>
          <input
            aria-label="只改当前镜头站位"
            type="checkbox"
            disabled={!shot}
            checked={local && !!shot}
            onChange={(e) => {
              setLocal(e.target.checked);
              if (shot) onFrame(endpoint === "end" ? shot.end - 1 : shot.start);
            }}
          />
          只改当前镜头站位
        </label>
        {local && shot && (
          <select
            aria-label="调度端点"
            value={endpoint}
            onChange={(e) => {
              const end = e.target.value as "start" | "end";
              setEndpoint(end);
              onFrame(end === "end" ? shot.end - 1 : shot.start);
            }}
          >
            <option value="start">镜头开始</option>
            <option value="end">镜头结束</option>
          </select>
        )}
        <span className="muted">
          {local && shot ? (shot.label ?? "当前镜头") + "局部调度" : "基础布置"}
        </span>
        <button aria-pressed={snap} onClick={onSnap}>
          吸附{snap ? " 开" : " 关"}
        </button>
        <button disabled={!canUndo} onClick={undo}>
          撤销
        </button>
        <button disabled={!canRedo} onClick={redo}>
          重做
        </button>
        <button onClick={onExport}>出图与导出</button>
        <span className="spacer" />
        <button
          onClick={() => {
            setLocal(false);
            onPlay();
          }}
          aria-label={playing ? "暂停调度预演" : "播放调度预演"}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          aria-label="调度预演帧"
          type="range"
          min={0}
          max={scene.timeline.duration_frames - 1}
          value={frame}
          onChange={(e) => {
            setLocal(false);
            onFrame(Number(e.target.value));
          }}
        />
        <span className="muted">
          {frame}/{scene.timeline.duration_frames - 1} 帧
        </span>
        <button
          aria-label={right ? "收起调度预览" : "展开调度预览"}
          onClick={() => setRight(!right)}
        >
          取景
        </button>
      </nav>
      <main
        className={`direction-workspace ${left ? "" : "hide-objects"} ${right ? "" : "hide-preview"}`}
      >
        {left && (
          <aside className="direction-objects" aria-label="调度对象与属性">
            <div className="direction-add">
              <button onClick={() => onAdd("person-standing")}>＋ 人物</button>
              <button
                onClick={() => {
                  const id = crypto.randomUUID();
                  change((p) =>
                    p.cameras.push(
                      newCamera(id, "机位 " + (p.cameras.length + 1)),
                    ),
                  );
                  onSelect(id);
                }}
              >
                ＋ 机位
              </button>
              <select
                aria-label="添加家具或墙体"
                value=""
                onChange={(e) => onAdd(e.target.value as Preset)}
              >
                <option value="" disabled>
                  ＋ 家具／墙体
                </option>
                {Object.entries(dimensions)
                  .filter(([k]) => !k.startsWith("person-"))
                  .map(([k]) => (
                    <option key={k} value={k}>
                      {
                        (
                          {
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
                          } as any
                        )[k]
                      }
                    </option>
                  ))}
              </select>
              <button onClick={addShot}>＋ 镜头</button>
            </div>
            <h2>场景对象</h2>
            <div
              className="direction-list"
              role="listbox"
              aria-label="调度场景对象"
            >
              {[...scene.objects, ...scene.cameras].map((o) => (
                <button
                  key={o.id}
                  role="option"
                  aria-selected={selected === o.id}
                  className={selected === o.id ? "selected" : ""}
                  onClick={() => onSelect(o.id)}
                >
                  <span
                    className={
                      "object-dot " +
                      ("preset" in o
                        ? "marker-" + (o.marker ?? "blue")
                        : "camera-dot")
                    }
                  />
                  {"preset" in o ? o.name : "机位 " + o.name}
                </button>
              ))}
            </div>
            <h2>属性</h2>
            {object && (
              <>
                <label className="direction-field">
                  名字
                  <input
                    aria-label="调度对象名称"
                    value={object.name}
                    onChange={(e) =>
                      change((p) => {
                        p.objects.find((o) => o.id === object.id)!.name =
                          e.target.value;
                      })
                    }
                  />
                </label>
                {object.preset.startsWith("person-") && (
                  <label className="direction-field">
                    标识
                    <select
                      aria-label="人物标识色"
                      value={object.marker ?? "blue"}
                      onChange={(e) =>
                        change((p) => {
                          p.objects.find((o) => o.id === object.id)!.marker = e
                            .target.value as any;
                        })
                      }
                    >
                      {["blue", "red", "green", "amber", "violet"].map(
                        (c, i) => (
                          <option key={c} value={c}>
                            {["蓝色", "红色", "绿色", "琥珀", "紫色"][i]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {vector("站位", fieldTransform!.position, (v) =>
                  transform(object.id, { ...fieldTransform!, position: v }),
                )}
                <NumberField
                  label="朝向 °"
                  value={fieldTransform!.rotation[1]}
                  step={1}
                  change={(n) =>
                    transform(object.id, {
                      ...fieldTransform!,
                      rotation: [
                        fieldTransform!.rotation[0],
                        n,
                        fieldTransform!.rotation[2],
                      ],
                    })
                  }
                />
                <div className="dimension-fields">
                  {[0, 2, 1].map((axis, i) => (
                    <NumberField
                      key={axis}
                      label={["宽 m", "深 m", "高 m"][i]}
                      value={
                        dimensions[object.preset][axis] *
                        fieldTransform!.scale[axis]
                      }
                      change={(n) => {
                        const scale = [...fieldTransform!.scale] as Vec;
                        scale[axis] = n / dimensions[object.preset][axis];
                        transform(object.id, { ...fieldTransform!, scale });
                      }}
                    />
                  ))}
                </div>
                <div className="row">
                  <button onClick={onDuplicate}>复制对象</button>
                  <button onClick={onRemove}>删除对象</button>
                </div>
                {local &&
                  shot?.blocking?.some((b) => b.object_id === object.id) && (
                    <button
                      onClick={() =>
                        change((p) => {
                          const s = p.shots.find((s) => s.id === shot.id)!;
                          s.blocking = s.blocking!.filter(
                            (b) => b.object_id !== object.id,
                          );
                        })
                      }
                    >
                      此人物恢复全局调度
                    </button>
                  )}
              </>
            )}
            {camera && (
              <>
                <label className="direction-field">
                  名字
                  <input
                    aria-label="调度机位名称"
                    value={camera.name}
                    onChange={(e) =>
                      change((p) => {
                        p.cameras.find((c) => c.id === camera.id)!.name =
                          e.target.value;
                      })
                    }
                  />
                </label>
                {vector("机位", camera.position, (v) =>
                  editCamera(camera.id, v, camera.target),
                )}
                {vector("目标", camera.target, (v) =>
                  editCamera(camera.id, camera.position, v),
                )}
                <NumberField
                  label="调度焦距 mm"
                  value={camera.focal_length_mm}
                  step={1}
                  change={(n) =>
                    change((p) => {
                      p.cameras.find(
                        (c) => c.id === camera.id,
                      )!.focal_length_mm = n;
                    })
                  }
                />
                <button
                  disabled={scene.cameras.length === 1}
                  onClick={onRemove}
                >
                  删除机位
                </button>
              </>
            )}
            {!object && !camera && (
              <p className="muted">选择人物、家具或机位查看属性。</p>
            )}
            <details className="direction-settings">
              <summary>对话轴线与语速</summary>
              {["from_id", "to_id"].map((k, i) => (
                <label className="direction-field" key={k}>
                  {i ? "人物二" : "人物一"}
                  <select
                    aria-label={"轴线人物" + (i + 1)}
                    value={
                      scene.dialogue_axis?.[k as "from_id" | "to_id"] ?? ""
                    }
                    onChange={(e) =>
                      change((p) => {
                        const people = p.objects.filter((o) =>
                          o.preset.startsWith("person-"),
                        );
                        if (!e.target.value) {
                          p.dialogue_axis = null;
                          return;
                        }
                        const other = people.find(
                          (o) => o.id !== e.target.value,
                        );
                        if (!other) throw new Error("需要两个不同人物。");
                        p.dialogue_axis = {
                          from_id:
                            k === "from_id"
                              ? e.target.value
                              : (p.dialogue_axis?.from_id ?? other.id),
                          to_id:
                            k === "to_id"
                              ? e.target.value
                              : (p.dialogue_axis?.to_id ?? other.id),
                        };
                      })
                    }
                  >
                    <option value="">不设轴线</option>
                    {scene.objects
                      .filter((o) => o.preset.startsWith("person-"))
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <NumberField
                label="估算字词／秒"
                value={scene.speech_rate ?? 4}
                change={(n) =>
                  change((p) => {
                    p.speech_rate = n;
                  })
                }
              />
              <p className="muted">
                语速估算用于安排节奏，真实声音时长需另行核对。
              </p>
            </details>
          </aside>
        )}
        <PlanCanvas
          scene={scene}
          frame={frame}
          selected={selected}
          cameraId={cameraId}
          onSelect={onSelect}
          onObject={transform}
          onCamera={editCamera}
          snap={snap}
        />
        {right && (
          <aside className="direction-review" aria-label="机位预览与站位检查">
            <div className="preview-title">
              <strong>{shot?.label ?? "当前取景"}</strong>
              <select
                aria-label="调度预览机位"
                value={cameraId}
                onChange={(e) => onSelect(e.target.value)}
              >
                {scene.cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <CameraPreview
              scene={scene}
              frame={frame}
              cameraId={cameraId}
              aspect={aspect}
              error={error}
            />
            <h2>这一镜的站位</h2>
            <p className="shot-description" data-testid="shot-description">
              {report.description}
            </p>
            <div className="row">
              <button onClick={() => void copy(report.description)}>
                复制这一镜
              </button>
              <button
                onClick={() =>
                  void copy(
                    sceneReports(scene, aspect)
                      .map((r) => r.description)
                      .join("\n\n"),
                  )
                }
              >
                复制全部镜头
              </button>
            </div>
            <h2>检查</h2>
            {report.findings.length ? (
              report.findings.map((f, i) => (
                <p key={i} className="direction-finding" data-code={f.code}>
                  {f.text}
                </p>
              ))
            ) : (
              <p className="muted">当前帧未发现白模几何及估时问题。</p>
            )}
            <p className="muted">
              依据当前帧与白模包围盒估算；连续画面和真实表演需继续观看。
            </p>
            <label>
              <input
                type="checkbox"
                checked={scene.environment.white_model}
                onChange={(e) =>
                  change((p) => {
                    p.environment.white_model = e.target.checked;
                  })
                }
              />
              白模材质
            </label>
          </aside>
        )}
      </main>
      <ShotTable
        scene={scene}
        frame={frame}
        onFrame={onFrame}
        onSelect={(id) => onSelect(id ?? object?.id ?? null)}
        change={change}
        add={addShot}
      />
    </>
  );
}
function ShotTable({
  scene,
  frame,
  onFrame,
  onSelect,
  change,
  add,
}: {
  scene: Scene;
  frame: number;
  onFrame: (f: number) => void;
  onSelect: (id: string | null) => void;
  change: Edit;
  add: () => void;
}) {
  const shots = [...scene.shots].sort((a, b) => a.start - b.start);
  const edit = (id: string, fn: (s: Shot) => void) =>
    change((p) => fn(p.shots.find((s) => s.id === id)!));
  const reorder = (index: number, delta: number) =>
    change((p) => {
      const list = [...p.shots].sort((a, b) => a.start - b.start);
      [list[index], list[index + delta]] = [list[index + delta], list[index]];
      let start = list[0].start;
      for (const s of list) {
        const n = s.end - s.start;
        s.start = start;
        s.end = start + n;
        start = s.end;
      }
      p.shots = list;
    });
  return (
    <section className="shot-sheet" aria-label="镜头调度表">
      <div className="shot-sheet-heading">
        <strong>镜头表</strong>
        <span className="muted">{shots.length} 镜头</span>
        <span className="spacer" />
        <button onClick={add}>添加调度镜头</button>
      </div>
      <div className="shot-sheet-scroll">
        <table>
          <thead>
            <tr>
              <th>镜号</th>
              <th>机位</th>
              <th>时长（秒）</th>
              <th>谁说</th>
              <th>台词参考</th>
              <th>估时／调度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {shots.map((s, i) => {
              const active = s.start <= frame && frame < s.end,
                report = shotReport(scene, s),
                text = s.dialogue?.text ?? "";
              return (
                <tr
                  key={s.id}
                  className={active ? "active" : ""}
                  data-shot-id={s.id}
                >
                  <td>
                    <button
                      aria-label={"查看镜头 " + (s.label ?? s.id)}
                      aria-pressed={active}
                      onClick={() => {
                        onFrame(s.start);
                        onSelect(null);
                      }}
                    >
                      {s.label || "S" + (i + 1)}
                    </button>
                  </td>
                  <td>
                    <select
                      aria-label={"调度镜头机位 " + s.id}
                      value={s.camera_id}
                      onChange={(e) =>
                        edit(s.id, (s) => {
                          s.camera_id = e.target.value;
                        })
                      }
                    >
                      {scene.cameras.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberField
                      label={"镜头秒数 " + s.id}
                      value={(s.end - s.start) / scene.timeline.fps}
                      step={1 / scene.timeline.fps}
                      change={(n) =>
                        change((p) =>
                          retimeShot(p, s.id, Math.round(n * p.timeline.fps)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <select
                      aria-label={"说话人 " + s.id}
                      value={s.dialogue?.speaker_id ?? ""}
                      onChange={(e) =>
                        edit(s.id, (s) => {
                          s.dialogue = {
                            speaker_id: e.target.value || null,
                            text,
                            source_index: s.dialogue?.source_index ?? null,
                          };
                        })
                      }
                    >
                      <option value="">无台词／旁白</option>
                      {scene.objects
                        .filter((o) => o.preset.startsWith("person-"))
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={"台词参考 " + s.id}
                      value={text}
                      placeholder="这一镜的台词"
                      onChange={(e) =>
                        edit(s.id, (s) => {
                          s.dialogue = {
                            speaker_id: s.dialogue?.speaker_id ?? null,
                            text: e.target.value,
                            source_index: s.dialogue?.source_index ?? null,
                          };
                        })
                      }
                    />
                  </td>
                  <td>
                    <span
                      className={
                        report.speech.seconds > report.seconds
                          ? "duration-warning"
                          : "muted"
                      }
                    >
                      {text
                        ? "估计 " + report.speech.seconds + " 秒"
                        : "无台词"}
                    </span>
                    {!!s.blocking?.length && (
                      <span className="muted">
                        {s.blocking.length} 项局部调度
                      </span>
                    )}
                  </td>
                  <td className="shot-row-actions">
                    <button
                      aria-label={"上移镜头 " + s.id}
                      disabled={i === 0}
                      onClick={() => reorder(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={"下移镜头 " + s.id}
                      disabled={i === shots.length - 1}
                      onClick={() => reorder(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={"移除调度镜头 " + s.id}
                      onClick={() =>
                        change((p) => {
                          p.shots = p.shots.filter((x) => x.id !== s.id);
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shots.length && (
          <p className="muted">让 AI 安排镜头，或添加一个镜头开始调度。</p>
        )}
      </div>
    </section>
  );
}
