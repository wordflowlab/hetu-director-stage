import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PluginBridge, ObjectResult } from "../../vendor/hetu-sdk.ts";
import { unwrap } from "../../vendor/hetu-sdk.ts";
import {
  clone,
  canonical,
  newScene,
  newObject,
  newCamera,
  names,
  presets,
  validate,
  mergeScenes,
  removeObjects,
  duplicateObjects,
  cameraAt,
  sample,
  type Scene,
  type Vec,
  type Preset,
  type Track,
} from "../domain/model.ts";
import {
  png,
  glb,
  PngSession,
  StageWorld,
  renderer,
  setCamera,
} from "../render/scene.ts";
import { zip } from "../render/zip.ts";
import { DirectionWorkspace } from "./direction-workspace.tsx";
import { Viewport } from "./viewport.ts";
import { recoverySnapshot, recoveredPending } from "./recovery.ts";
import "./style.css";
declare global {
  interface Window {
    hetu: PluginBridge;
  }
}
const api = window.hetu;
const uid = () => crypto.randomUUID();
const refOf = (r: ObjectResult) => ({
  object_id: r.object.object_id,
  revision: r.object.revision,
  sha256: r.sha256,
});
async function invoke(action: string, input: any = {}) {
  return unwrap<any>((await api.invoke(action, input)) as any);
}
function encode(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
async function sha(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function App() {
  const [list, setList] = useState<any[]>([]),
    [record, setRecord] = useState<ObjectResult>(),
    [scene, setScene] = useState<Scene>(),
    [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState("free"),
    [workspaceMode, setWorkspaceMode] = useState<"direction" | "three">("direction"),
    [mode, setMode] = useState<"translate" | "rotate" | "scale">("translate"),
    [snap, setSnap] = useState(false),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [timeline, setTimeline] = useState(false),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState<any>(),
    [history, setHistory] = useState<Scene[]>([]),
    [future, setFuture] = useState<Scene[]>([]),
    [dialog, setDialog] = useState<string>(),
    [conflict, setConflict] = useState<any>(),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [width, setWidth] = useState(1280),
    [ratio, setRatio] = useState("16:9"),
    [pip, setPip] = useState(true),
    [keyTarget, setKeyTarget] = useState(""),
    [keyProperty, setKeyProperty] = useState("position"),
    [keyValue, setKeyValue] = useState("0,0,0"),
    [noteText, setNoteText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    vp = useRef<Viewport>(),
    pipCanvas = useRef<HTMLCanvasElement>(null),
    pipRender = useRef<ReturnType<typeof renderer>>(),
    dialogEl = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null),
    latest = useRef<any>({}),
    restored = useRef(false);
  const dirty =
    !!scene &&
    (!record || canonical(scene) !== canonical(record.object.content));
  latest.current = {
    scene,
    record,
    selected,
    view,
    frame,
    pending,
    history,
    future,
    workspaceMode,
  };
  const copyDescription = (text: string) => run("复制镜头说明", async () => {
    // 用户点击期间同步复制；宿主拒绝网页的异步剪贴板权限。
    const active = document.activeElement as HTMLElement | null;
    const field = document.createElement("textarea");
    field.value = text; field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } finally { field.remove(); active?.focus(); }
    if (!copied) throw new Error("无法复制镜头说明，请通过场景导出读取同一内容。");
    setStatus("镜头说明已复制");
  });
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const refresh = async () => {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await invoke("list_scenes", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...r.objects);
      cursor = r.next_cursor ?? undefined;
    } while (cursor);
    setList(out);
    return out;
  };
  const change = (edit: (p: Scene) => void) => {
    if (latest.current.pending) {
      setError("请先回读原操作或比较版本，再继续编辑。");
      return;
    }
    const s = latest.current.scene;
    if (!s) return;
    const p = clone(s);
    try {
      edit(p);
      validate(p);
      setHistory((h) => [...h.slice(-49), clone(s)]);
      setFuture([]);
      setScene(p);
    } catch (e) {
      setError(String(e));
    }
  };
  const load = async (id: string) => {
    const r = await invoke("get_scene", { object_id: id });
    setRecord(r);
    setScene(clone(r.object.content));
    setSelected(null);
    setView("free");
    setFrame(0);
    setHistory([]);
    setFuture([]);
    setPending(undefined);
  };
  const flush = async () => {
    // 初次读取完成前不能把空状态写回，避免覆盖已有恢复稿。
    if (!restored.current) return;
    const s = latest.current;
    await api.buffer(
      recoverySnapshot({
        object_id: s.record?.object.object_id,
        baseline: s.record ? refOf(s.record) : null,
        draft: s.scene,
        selected: s.selected,
        view: s.view,
        frame: s.frame,
        pending: s.pending,
        history: s.history,
        future: s.future,
        workspaceMode: s.workspaceMode,
      }),
    );
  };
  useEffect(() => {
    let disposed = false;
    const theme = (p: any) =>
      (document.documentElement.dataset.theme =
        p.theme === "system"
          ? matchMedia("(prefers-color-scheme:dark)").matches
            ? "dark"
            : "light"
          : p.theme);
    const unsub = api.onPreferences?.(theme);
    const close = api.onBeforeClose?.(flush);
    run("读取场景", async () => {
      theme((await api.host?.("preferences", {})) ?? { theme: "light" });
      const items = await refresh();
      const b = (await api.buffer()) as any;
      if (disposed) return;
      if (b?.draft) {
        validate(b.draft);
        if (b.object_id && b.baseline) {
          const r = await invoke("get_scene", {
            object_id: b.object_id,
            revision: b.baseline.revision,
          });
          if (r.sha256 !== b.baseline.sha256)
            throw new Error("恢复稿基线摘要不一致。");
          setRecord(r);
        }
        setScene(b.draft);
        setSelected(b.selected ?? null);
        setFrame(b.frame ?? 0);
        setView(b.view ?? "free");
        setWorkspaceMode(b.workspaceMode ?? "direction");
        setPending(recoveredPending(b));
        setHistory(b.history ?? []);
        setFuture(b.future ?? []);
      } else if (items[0]) await load(items[0].object_id);
      restored.current = true;
    });
    return () => {
      disposed = true;
      unsub?.();
      close?.();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => void flush().catch((e) => setError(String(e))),
      200,
    );
    return () => clearTimeout(timer);
  }, [scene, record, selected, view, frame, pending, history, future, workspaceMode]);
  useEffect(() => {
    if (!scene || !canvas.current) return;
    try {
      const v = new Viewport(
        canvas.current,
        setSelected,
        (id, t) =>
          change((p) => {
            const o = p.objects.find((o) => o.id === id);
            if (o) o.transform = t;
          }),
        setError,
      );
      vp.current = v;
      v.setScene(scene);v.setFrame(frame);v.setView(view);v.select(selected);v.setMode(mode,snap);
      return () => {
        v.dispose();
        vp.current = undefined;
      };
    } catch (e) {
      setError("三维渲染初始化失败：" + String(e));
    }
  }, [!!scene, workspaceMode]);
  useEffect(() => {
    if (scene) vp.current?.setScene(scene);
  }, [scene]);
  useEffect(() => {
    vp.current?.select(selected);
  }, [selected]);
  useEffect(() => {
    vp.current?.setMode(mode, snap);
  }, [mode, snap]);
  useEffect(() => {
    vp.current?.setView(view);
  }, [view]);
  useEffect(() => {
    vp.current?.setFrame(frame);
    if (playing && scene) setView(cameraAt(scene, frame));
  }, [frame, playing]);
  useEffect(() => {
    if (!pip || !scene || !pipCanvas.current) return;
    let world: StageWorld | undefined;
    try {
      pipRender.current ??= renderer(pipCanvas.current);
      const r = pipRender.current;
      r.setSize(280, 158, false);
      world = new StageWorld(scene, frame);
      const camera =
        scene.cameras.find((c) => c.id === selected) ?? scene.cameras[0];
      setCamera(
        world.camera(camera.id),
        sampleCamera(scene, camera.id, frame),
        280,
        158,
      );
      world.helpers.visible = false;
      r.render(world.scene, world.camera(camera.id));
    } catch (e) {
      setError(String(e));
    } finally {
      world?.dispose();
    }
  }, [pip, scene, frame, selected]);
  useEffect(
    () => () => {
      pipRender.current?.dispose();
      pipRender.current?.forceContextLoss();
    },
    [],
  );
  useEffect(() => {
    if (!playing || !scene) return;
    const start = performance.now(),
      initial = frame;
    let raf = 0;
    const tick = () => {
      const next =
        initial +
        Math.floor(((performance.now() - start) * scene.timeline.fps) / 1000);
      if (next >= scene.timeline.duration_frames) {
        setFrame(scene.timeline.duration_frames - 1);
        setPlaying(false);
        return;
      }
      setFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => {
    if (dialog) {
      dialogEl.current?.showModal();
    } else if (dialogEl.current?.open) dialogEl.current.close();
  }, [dialog]);
  useEffect(()=>{if(scene && frame>=scene.timeline.duration_frames)setFrame(scene.timeline.duration_frames-1);},[scene?.timeline.duration_frames]);
  const undo = () => {
    const s = latest.current;
    if (!s.history.length) return;
    setFuture((f) => [clone(s.scene), ...f]);
    setScene(s.history.at(-1));
    setHistory(s.history.slice(0, -1));
  };
  const redo = () => {
    const s = latest.current;
    if (!s.future.length) return;
    setHistory((h) => [...h, clone(s.scene)]);
    setScene(s.future[0]);
    setFuture(s.future.slice(1));
  };
  const remove = () => {
    if (!selected) return;
    change((p) => {
      if (p.objects.some((o) => o.id === selected))
        removeObjects(p, [selected]);
      else {
        if (
          p.shots.some((s) => s.camera_id === selected) ||
          p.tracks.some(
            (t) => t.target_kind === "camera" && t.target_id === selected,
          )
        )
          throw new Error("机位仍被镜头或轨道引用。");
        p.cameras = p.cameras.filter((c) => c.id !== selected);
      }
    });
    setSelected(null);
  };
  const duplicate = () => {
    if (!selected) return;
    const id = uid();
    change((p) => {
      const o = p.objects.find((o) => o.id === selected);
      if (!o) return;
      duplicateObjects(
        p,
        [{ source_id: selected, new_id: id, name: o.name + " 副本" }],
        [0.5, 0, 0.5],
      );
    });
    setSelected(id);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("input,textarea,select,dialog,[contenteditable=true]") ||
        !latest.current.scene
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.code === "KeyY") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.code === "KeyD") {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        remove();
        return;
      }
      if (mod) return;
      if (e.code === "KeyW") setMode("translate");
      if (e.code === "KeyE") setMode("rotate");
      if (e.code === "KeyR") setMode("scale");
      if (e.code === "KeyX") setSnap((s) => !s);
      if (e.code === "KeyF") setView("free");
      if (e.code === "Escape") setSelected(null);
      if (/^Digit[1-9]$/.test(e.code)) {
        const c = latest.current.scene.cameras[Number(e.code.slice(-1)) - 1];
        if (c) setView(c.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);
  const save = async () => {
    if (!scene) return;
    await run("保存场景", async () => {
      const input = pending?.input ?? {
        ...(record ? { object_id: record.object.object_id } : {}),
        content: clone(scene),
        source_refs: record?.object.source_refs ?? [],
        expected_revision: record?.object.revision ?? 0,
        expected_sha256: record?.sha256 ?? "",
        operation_key: uid(),
      };
      setPending({ action: "save_scene", input });
      const r = await invoke("save_scene", input);
      setRecord(r);
      setScene(clone(r.object.content));
      setPending(undefined);
      await refresh();
      setStatus("场景已保存并回读");
    });
  };
  const compare = async () => {
    if (!record || !scene) return;
    await run("比较版本", async () => {
      const remote = await invoke("get_scene", {
        object_id: record.object.object_id,
      });
      const merged = mergeScenes(
        record.object.content as Scene,
        scene,
        remote.object.content,
      );
      setConflict({ remote, ...merged });
      setChoices({});
      setDialog("版本冲突");
    });
  };
  const acceptMerge = () => {
    const value = clone(conflict.scene);
    for (const c of conflict.conflicts) {
      if (choices[c.path] === "remote") {
        const [key, id] = c.path.split("/");
        if (id) {
          const a = (value as any)[key] as any[],
            index = a.findIndex((x) => x.id === id);
          if (index >= 0) a.splice(index, 1);
          if (c.remote) a.push(c.remote);
        } else (value as any)[key] = c.remote;
      }
    }
    try {
      validate(value);
      setRecord(conflict.remote);
      setScene(value);
      setPending(undefined);
      setHistory([]);
      setFuture([]);
      setDialog(undefined);
      setStatus("已保留选择，请保存新基线");
    } catch (e) {
      setError(String(e));
    }
  };
  const ensureSaved = () => {
    if (dirty || !record) throw new Error("请先保存场景，再导出固定成果。");
    return record;
  };
  const saveBytes = async (
    bytes: Uint8Array,
    name: string,
    media_type: string,
  ) => {
    const r = ensureSaved();
    const result: any = await api.host?.("save_artifact", {
      object_ref: refOf(r),
      suggested_name: name,
      media_type,
      base64: encode(bytes),
      sha256: await sha(bytes),
    });
    setStatus(
      result?.saved
        ? "固定成果已导出"
        : result?.cancelled
          ? "已取消导出"
          : "宿主未提供二进制导出服务",
    );
  };
  const dimensions = () => ({
    w: width,
    h: Math.round(
      width * (ratio === "9:16" ? 16 / 9 : ratio === "1:1" ? 1 : 9 / 16),
    ),
  });
  const exportImage = (batch = false) =>
    run(batch ? "批量渲染机位" : "渲染当前机位", async () => {
      ensureSaved();
      const { w, h } = dimensions();
      if (!batch) {
        const content = clone(scene!);
        let id = view;
        if (!content.cameras.some((c) => c.id === id)) {
          const c = vp.current?.currentCamera("export-view", "当前视角");
          if (!c) throw new Error("当前视角不可用。");
          content.cameras.push(c);
          id = c.id;
        }
        await saveBytes(
          await png(content, id, frame, w, h),
          "camera.png",
          "image/png",
        );
      } else {
        const files = [];
        for (const [i, c] of scene!.cameras.entries())
          files.push({
            name: "camera-" + (i + 1) + ".png",
            bytes: await png(scene!, c.id, frame, w, h),
          });
        files.push({
          name: "scene.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({
              project_ref: refOf(record!),
              scene,
              source_refs: record!.object.source_refs ?? [],
            }),
          ),
        });
        await saveBytes(zip(files), "camera-images.zip", "application/zip");
      }
    });
  const exportGlb = () =>
    run("导出GLB", async () => {
      ensureSaved();
      await saveBytes(await glb(scene!), "scene.glb", "model/gltf-binary");
    });
  const playblast = () =>
    run("导出预演序列", async () => {
      ensureSaved();
      const files: { name: string; bytes: Uint8Array }[] = [];
      let bytes = 0;
      const { w, h } = dimensions();
      const session = new PngSession(scene!, w, h);
      try {
        for (let f = 0; f < scene!.timeline.duration_frames; f++) {
          const camera =
            scene!.shots.find((s) => s.start <= f && f < s.end)?.camera_id ??
            scene!.cameras[0].id;
          const image = await session.frame(camera, f);
          bytes += image.length;
          if (bytes > 30 * 1024 * 1024)
            throw new Error(
              "预演序列超过桌面导出预算，请降低分辨率、缩短预演或让AI无窗口导出。",
            );
          files.push({
            name: "frames/frame-" + String(f).padStart(5, "0") + ".png",
            bytes: image,
          });
        }
      } finally {
        session.dispose();
      }
      files.push({
        name: "project.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            format: "hetu.director-stage.previs",
            project_ref: refOf(record!),
            source_refs: record!.object.source_refs ?? [],
            scene,
            fps: scene!.timeline.fps,
            representation: "无音轨程序白模预演",
          }),
        ),
      });
      await saveBytes(zip(files), "previs-project.zip", "application/zip");
    });
  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    await run("导入场景", async () => {
      if (chosen.size > 512 * 1024) throw new Error("场景JSON超过512KiB预算。");
      const value = JSON.parse(await chosen.text()),
        content = value.scene ?? value;
      validate(content);
      if (
        value.source_refs?.length &&
        (!record ||
          canonical(value.source_refs) !==
            canonical(record.object.source_refs ?? []))
      )
        throw new Error(
          "导入文件包含不同固定来源，请让AI核验当前作品后追加来源。",
        );
      if (scene) {
        change((p) => Object.assign(p, clone(content)));
      } else {
        setScene(clone(content));
        setRecord(undefined);
      }
      setStatus("场景已读入本地稿，请保存");
    });
  };
  const add = (preset: Preset) => {
    const id = uid();
    change((p) => {
      const o = newObject(preset, id);
      o.transform.position = [
        Math.round(((p.objects.length % 4) - 1.5) * 15) / 10,
        0,
        Math.floor(p.objects.length / 4) * 1.5,
      ];
      p.objects.push(o);
    });
    setSelected(id);
  };
  const object = scene?.objects.find((o) => o.id === selected),
    camera = scene?.cameras.find((c) => c.id === selected);
  const field = (
    label: string,
    key: "position" | "rotation" | "scale",
    value: Vec,
    onChange: (v: Vec) => void,
  ) => (
    <div className="vector">
      <span>{label}</span>
      {value.map((v, i) => (
        <input
          key={i}
          aria-label={label + " " + ["X", "Y", "Z"][i]}
          type="number"
          step={key === "rotation" ? 1 : 0.1}
          value={Number(v.toFixed(3))}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const next = [...value] as Vec;
            next[i] = n;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
  return (
    <>
      <header>
        <button
          aria-label="返回工作台"
          onClick={() =>
            run("返回", async () => {
              await flush();
              await api.host?.("close_view", {});
            })
          }
        >
          ←
        </button>
        <strong>导演布景台</strong>
        <div className="workspace-modes" aria-label="工作模式"><button aria-pressed={workspaceMode === "direction"} onClick={()=>setWorkspaceMode("direction")}>俯视调度</button><button aria-pressed={workspaceMode === "three"} onClick={()=>setWorkspaceMode("three")}>三维布景</button></div>
        <select
          aria-label="当前场景"
          value={record?.object.object_id ?? ""}
          onChange={(e) => {
            if (dirty) {
              setError("当前有未保存修改，请保存后切换。");
              return;
            }
            void run("切换场景", () => load(e.target.value));
          }}
        >
          <option value="">{scene?.title ?? "选择场景"}</option>
          {list.map((i) => (
            <option key={i.object_id} value={i.object_id}>
              {i.title}
            </option>
          ))}
        </select>
        <button onClick={() => setDialog("新建场景")}>新建</button>
        <span className="spacer" />
        <span className="muted">
          {record ? "修订 " + record.object.revision : "未保存"}
          {dirty ? " 有修改" : ""}
        </span>
        <button disabled={!dirty || !!busy || !!pending} onClick={save}>
          保存
        </button>
        <button disabled={!record || !!busy} onClick={compare}>
          比较
        </button>
        <button className="primary" onClick={() => setDialog("让 AI 处理")}>
          让 AI 处理
        </button>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button aria-label="关闭错误" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {pending && (
        <div role="region" aria-label="原操作恢复" className="recovery">
          保存状态需要回读。
          <button
            disabled={!!busy}
            onClick={() =>
              run("回读原操作", async () => {
                const r = await invoke("get_operation", {
                  operation_key: pending.input.operation_key,
                });
                setRecord(r);
                setScene(clone(r.object.content));
                setPending(undefined);
                await refresh();
                setStatus("原操作已回读");
              })
            }
          >
            回读原操作
          </button>
          <button onClick={compare}>比较当前版本</button>
        </div>
      )}
      <div role="status" className={status || busy ? "status" : "status empty"}>
        {busy || status}
        <button
          hidden={!status || !!busy}
          aria-label="关闭状态"
          onClick={() => setStatus("")}
        >
          ×
        </button>
      </div>
      {!scene ? (
        <main className="empty-state">
          <h1>开始导演布景</h1>
          <p>让 AI 依据剧本布置场景，回来查看机位和预演。</p>
          <button className="primary" onClick={() => setDialog("让 AI 处理")}>
            让 AI 处理
          </button>
          <button onClick={() => setDialog("新建场景")}>新建场景</button>
          <button onClick={() => file.current?.click()}>导入场景</button>
        </main>
      ) : (
        <>
          {workspaceMode === "three" && <nav className="toolbar" aria-label="布景工具">
            <button
              aria-label={left ? "收起素材" : "展开素材"}
              onClick={() => setLeft(!left)}
            >
              ☰
            </button>
            <select
              aria-label="视角"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="free">自由视角</option>
              <option value="top">顶视图</option>
              <option value="front">前视图</option>
              <option value="side">侧视图</option>
              {scene.cameras.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {i + 1} {c.name}
                </option>
              ))}
            </select>
            {(["translate", "rotate", "scale"] as const).map((m, i) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {["移动", "旋转", "缩放"][i]}
              </button>
            ))}
            <button aria-pressed={snap} onClick={() => setSnap(!snap)}>
              吸附{snap ? " 开" : " 关"}
            </button>
            <button
              onClick={() => {
                const id = uid();
                change((p) =>
                  p.cameras.push(
                    vp.current?.currentCamera(
                      id,
                      "机位 " + (p.cameras.length + 1),
                    ) ?? newCamera(id),
                  ),
                );
                setSelected(id);
              }}
            >
              ＋ 摄影机
            </button>
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
              实时白模
            </label>
            <label>
              <input
                type="checkbox"
                checked={pip}
                onChange={(e) => setPip(e.target.checked)}
              />
              取景画中画
            </label>
            <select
              aria-label="出图分辨率"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            >
              <option value={640}>360p</option>
              <option value={1280}>720p</option>
              <option value={1920}>1080p</option>
            </select>
            <select
              aria-label="画幅"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
            >
              <option>16:9</option>
              <option>9:16</option>
              <option>1:1</option>
            </select>
            <button disabled={dirty || !!busy} onClick={() => exportImage()}>
              当前机位出图
            </button>
            <button
              disabled={dirty || !!busy}
              onClick={() => exportImage(true)}
            >
              批量白模图
            </button>
            <button disabled={dirty || !!busy} onClick={playblast}>
              Playblast
            </button>
            <button disabled={!history.length || !!busy} onClick={undo}>
              撤销
            </button>
            <button disabled={!future.length || !!busy} onClick={redo}>
              重做
            </button>
            <button
              aria-label={right ? "收起属性" : "展开属性"}
              onClick={() => setRight(!right)}
            >
              属性
            </button>
          </nav>}
          {workspaceMode === "direction" ? <DirectionWorkspace scene={scene} selected={selected} onSelect={setSelected} frame={frame} onFrame={f=>{setPlaying(false);setFrame(f);}} change={change} onAdd={add} onRemove={remove} onDuplicate={duplicate} error={setError} copy={copyDescription} aspect={Number(ratio.split(":")[0])/Number(ratio.split(":")[1])} playing={playing} onPlay={()=>{if(frame >= scene.timeline.duration_frames-1)setFrame(0);setPlaying(!playing);}} snap={snap} onSnap={()=>setSnap(!snap)} undo={undo} redo={redo} canUndo={!!history.length&&!busy} canRedo={!!future.length&&!busy} onExport={()=>setWorkspaceMode("three")}/> : <main
            className={
              "workspace " +
              (!left ? "no-left " : "") +
              (!right ? "no-right" : "")
            }
          >
            {left && (
              <aside className="palette" aria-label="素材">
                <h2>人物</h2>
                <div className="preset-grid">
                  {presets.slice(0, 3).map((p) => (
                    <button key={p} onClick={() => add(p)}>
                      {names[p]}
                    </button>
                  ))}
                </div>
                <h2>道具与家具</h2>
                <div className="preset-grid">
                  {presets.slice(3, 10).map((p) => (
                    <button key={p} onClick={() => add(p)}>
                      {names[p]}
                    </button>
                  ))}
                </div>
                <h2>布景</h2>
                <div className="preset-grid">
                  {presets.slice(10, 14).map((p) => (
                    <button key={p} onClick={() => add(p)}>
                      {names[p]}
                    </button>
                  ))}
                </div>
                <h2>几何体</h2>
                <div className="preset-grid">
                  {presets.slice(14).map((p) => (
                    <button key={p} onClick={() => add(p)}>
                      {names[p]}
                    </button>
                  ))}
                </div>
                <details className="shortcuts">
                  <summary>快捷键与操作</summary>
                  <p>
                    W 移动 E 旋转 R 缩放 X 吸附
                    <br />
                    1–9 切机位 F 自由视角
                    <br />
                    Del 删除 Ctrl/Cmd+D 复制
                    <br />
                    Ctrl/Cmd+Z 撤销 Shift+Z 重做
                  </p>
                  <p>
                    左键选择并直接拖动物体，Shift
                    升降；拖空白旋转，右键平移，滚轮推拉。
                  </p>
                </details>
                <button onClick={() => file.current?.click()}>
                  导入场景 JSON
                </button>
              </aside>
            )}
            <section className="viewport" aria-label="三维布景">
              <canvas ref={canvas} aria-label="三维场景画布" tabIndex={0} />
              <div className="viewport-caption">
                <span>{scene.title}</span>
                <span>
                  {frame} / {scene.timeline.duration_frames - 1} 帧
                </span>
              </div>
              {pip && (
                <div className="pip">
                  <canvas ref={pipCanvas} aria-label="机位取景预览" />
                  <span>{camera?.name ?? scene.cameras[0].name}</span>
                </div>
              )}
              <button
                className="timeline-toggle"
                onClick={() => setTimeline(!timeline)}
              >
                {timeline ? "收起预演时间线" : "展开预演时间线"}
              </button>
            </section>
            {right && (
              <aside className="inspector" aria-label="场景属性">
                <h2>场景大纲</h2>
                <input
                  aria-label="搜索对象"
                  placeholder="搜索对象或机位"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="outliner" role="listbox" aria-label="场景对象">
                  {scene.objects
                    .filter((o) => o.name.includes(search))
                    .map((o) => (
                      <div
                        key={o.id}
                        className={
                          "outliner-row " +
                          (selected === o.id ? "selected" : "")
                        }
                      >
                        <button
                          aria-label={(o.visible ? "隐藏 " : "显示 ") + o.name}
                          onClick={() =>
                            change((p) => {
                              p.objects.find((x) => x.id === o.id)!.visible =
                                !o.visible;
                            })
                          }
                        >
                          {o.visible ? "◉" : "○"}
                        </button>
                        <button
                          role="option"
                          aria-selected={selected === o.id}
                          onClick={() => setSelected(o.id)}
                        >
                          {o.name}
                        </button>
                      </div>
                    ))}
                  {scene.cameras
                    .filter((c) => c.name.includes(search))
                    .map((c) => (
                      <div
                        key={c.id}
                        className={
                          "outliner-row " +
                          (selected === c.id ? "selected" : "")
                        }
                      >
                        <span>▣</span>
                        <button
                          role="option"
                          aria-selected={selected === c.id}
                          onClick={() => setSelected(c.id)}
                          onDoubleClick={() => setView(c.id)}
                        >
                          {c.name}
                        </button>
                      </div>
                    ))}
                  {!scene.objects.length && (
                    <p className="muted">添加白模，或让 AI 布景。</p>
                  )}
                </div>
                <h2>属性</h2>
                {object ? (
                  <>
                    <label className="field">
                      名称
                      <input
                        aria-label="对象名称"
                        value={object.name}
                        onChange={(e) =>
                          change((p) => {
                            p.objects.find((x) => x.id === object.id)!.name =
                              e.target.value;
                          })
                        }
                      />
                    </label>
                    {field("位置", "position", object.transform.position, (v) =>
                      change((p) => {
                        p.objects.find(
                          (x) => x.id === object.id,
                        )!.transform.position = v;
                      }),
                    )}
                    {field("旋转", "rotation", object.transform.rotation, (v) =>
                      change((p) => {
                        p.objects.find(
                          (x) => x.id === object.id,
                        )!.transform.rotation = v;
                      }),
                    )}
                    {field("比例", "scale", object.transform.scale, (v) =>
                      change((p) => {
                        p.objects.find(
                          (x) => x.id === object.id,
                        )!.transform.scale = v;
                      }),
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={object.locked}
                        onChange={(e) =>
                          change((p) => {
                            p.objects.find((x) => x.id === object.id)!.locked =
                              e.target.checked;
                          })
                        }
                      />
                      锁定变换
                    </label>
                    <div className="row">
                      <button onClick={duplicate}>复制</button>
                      <button onClick={remove}>删除</button>
                      <button
                        onClick={() => {
                          setKeyTarget(object.id);
                          setTimeline(true);
                        }}
                      >
                        添加关键帧
                      </button>
                    </div>
                  </>
                ) : camera ? (
                  <>
                    <label className="field">
                      名称
                      <input
                        aria-label="机位名称"
                        value={camera.name}
                        onChange={(e) =>
                          change((p) => {
                            p.cameras.find((c) => c.id === camera.id)!.name =
                              e.target.value;
                          })
                        }
                      />
                    </label>
                    {field("机位位置", "position", camera.position, (v) =>
                      change((p) => {
                        p.cameras.find((c) => c.id === camera.id)!.position = v;
                      }),
                    )}
                    {field("取景目标", "position", camera.target, (v) =>
                      change((p) => {
                        p.cameras.find((c) => c.id === camera.id)!.target = v;
                      }),
                    )}
                    <label className="field">
                      焦距 mm
                      <input
                        aria-label="焦距 mm"
                        type="number"
                        min="10"
                        max="200"
                        value={camera.focal_length_mm}
                        onChange={(e) =>
                          change((p) => {
                            p.cameras.find(
                              (c) => c.id === camera.id,
                            )!.focal_length_mm = Number(e.target.value);
                          })
                        }
                      />
                    </label>
                    <div className="row">
                      <button onClick={() => setView(camera.id)}>
                        通过此机位取景
                      </button>
                      <button
                        onClick={() =>
                          change((p) => {
                            Object.assign(
                              p.cameras.find((c) => c.id === camera.id)!,
                              vp.current?.currentCamera(camera.id, camera.name),
                            );
                          })
                        }
                      >
                        用当前视角更新
                      </button>
                      <button
                        disabled={scene.cameras.length === 1}
                        onClick={remove}
                      >
                        删除机位
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">选择对象或摄影机，查看并调整属性。</p>
                )}
                <h2>场景与环境</h2>
                <div className="environment">
                  {(["ground", "shadows", "grid"] as const).map((k, i) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={scene.environment[k]}
                        onChange={(e) =>
                          change((p) => {
                            p.environment[k] = e.target.checked;
                          })
                        }
                      />
                      {["地面", "阴影", "网格与坐标"][i]}
                    </label>
                  ))}
                </div>
                <h2>保存与导出</h2>
                <div className="row">
                  <button
                    disabled={!record || dirty || !!busy}
                    onClick={() =>
                      run("导出场景", async () => {
                        ensureSaved();
                        const result: any = await api.host?.("export_file", {
                          action: "export_scene",
                          input: {
                            object_id: record!.object.object_id,
                            revision: record!.object.revision,
                          },
                          suggested_name: "scene.json",
                        });
                        setStatus(
                          result?.saved ? "完整场景已导出" : "已取消导出",
                        );
                      })
                    }
                  >
                    导出场景 JSON
                  </button>
                  <button disabled={dirty || !!busy} onClick={exportGlb}>
                    导出白模 GLB
                  </button>
                  <button onClick={() => file.current?.click()}>
                    导入场景
                  </button>
                  <button onClick={() => setDialog("清空场景")}>
                    清空场景
                  </button>
                </div>
                <h2>审阅与工作记录</h2>
                <button onClick={() => setDialog("记录意见")}>
                  对固定版本提意见
                </button>
                {scene.notes.slice(-5).map((n) => (
                  <p className="note" key={n.id}>
                    <span>
                      {n.origin === "author" ? "作者意见" : "Agent 自查"} 修订
                      {n.fixed_revision} {n.frame}帧
                    </span>
                    {n.text}
                  </p>
                ))}
              </aside>
            )}
          </main>}
          {workspaceMode === "three" && timeline && (
            <section className="timeline" aria-label="预演时间线">
              <div className="row">
                <button
                  aria-label={playing ? "暂停预演" : "播放预演"}
                  onClick={() => {
                    if (frame >= scene.timeline.duration_frames - 1)
                      setFrame(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? "暂停" : "播放"}
                </button>
                <input
                  aria-label="预演帧"
                  type="range"
                  min={0}
                  max={scene.timeline.duration_frames - 1}
                  value={frame}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrame(Number(e.target.value));
                  }}
                />
                <input
                  aria-label="当前帧"
                  type="number"
                  min={0}
                  max={scene.timeline.duration_frames - 1}
                  value={frame}
                  onChange={(e) =>
                    setFrame(
                      Math.max(
                        0,
                        Math.min(
                          scene.timeline.duration_frames - 1,
                          Number(e.target.value),
                        ),
                      ),
                    )
                  }
                />
                <label>
                  FPS
                  <input
                    aria-label="帧率"
                    type="number"
                    value={scene.timeline.fps}
                    onChange={(e) =>
                      change((p) => {
                        p.timeline.fps = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  总帧数
                  <input
                    aria-label="总帧数"
                    type="number"
                    value={scene.timeline.duration_frames}
                    onChange={(e) =>
                      change((p) => {
                        p.timeline.duration_frames = Number(e.target.value);
                      })
                    }
                  />
                </label>
              </div>
              <div className="timeline-content">
                <div>
                  <h2>关键帧</h2>
                  <div className="row">
                    <select
                      aria-label="关键帧目标"
                      value={keyTarget}
                      onChange={(e) => setKeyTarget(e.target.value)}
                    >
                      <option value="">选择对象或机位</option>
                      {[...scene.objects, ...scene.cameras].map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="关键帧属性"
                      value={keyProperty}
                      onChange={(e) => setKeyProperty(e.target.value)}
                    >
                      {["position", "rotation", "scale", "target"].map(
                        (p, i) => (
                          <option key={p} value={p}>
                            {["位置", "旋转", "比例", "机位目标"][i]}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      aria-label="关键帧数值"
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                    />
                    <button
                      onClick={() =>
                        change((p) => {
                          const values = keyValue.split(",").map(Number);
                          if (
                            values.length !== 3 ||
                            values.some((x) => !Number.isFinite(x))
                          )
                            throw new Error("请输入三个逗号分隔的数值。");
                          const kind = p.objects.some((o) => o.id === keyTarget)
                            ? "object"
                            : "camera";
                          let track = p.tracks.find(
                            (t) =>
                              t.target_id === keyTarget &&
                              t.property === keyProperty,
                          );
                          if (!track) {
                            track = {
                              id: uid(),
                              target_kind: kind,
                              target_id: keyTarget,
                              property: keyProperty as Track["property"],
                              interpolation: "linear",
                              keyframes: [],
                            };
                            p.tracks.push(track);
                          }
                          track.keyframes = track.keyframes.filter(
                            (k) => k.frame !== frame,
                          );
                          track.keyframes.push({ frame, value: values as Vec });
                          track.keyframes.sort((a, b) => a.frame - b.frame);
                        })
                      }
                    >
                      记录当前帧
                    </button>
                  </div>
                  {scene.tracks.map((t) => (
                    <div key={t.id} className="track">
                      <span>
                        {
                          [...scene.objects, ...scene.cameras].find(
                            (o) => o.id === t.target_id,
                          )?.name
                        }{" "}
                        {t.property}
                      </span>
                      {t.keyframes.map((k) => (
                        <button
                          key={k.frame}
                          title={k.value.join(", ")}
                          onClick={() => setFrame(k.frame)}
                        >
                          {k.frame}帧
                        </button>
                      ))}
                      <button
                        aria-label={"删除轨道 " + t.id}
                        onClick={() =>
                          change((p) => {
                            p.tracks = p.tracks.filter((x) => x.id !== t.id);
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div>
                  <h2>镜头切换</h2>
                  <button
                    onClick={() =>
                      change((p) => {
                        const start = p.shots.at(-1)?.end ?? 0;
                        if (start >= p.timeline.duration_frames)
                          throw new Error("镜头已覆盖全部时间。");
                        p.shots.push({
                          id: uid(),
                          camera_id: p.cameras.some((c) => c.id === selected)
                            ? selected!
                            : p.cameras[0].id,
                          start,
                          end: p.timeline.duration_frames,
                        });
                      })
                    }
                  >
                    添加镜头
                  </button>
                  {scene.shots.map((s) => (
                    <div key={s.id} className="shot">
                      <select
                        aria-label={"镜头机位 " + s.id}
                        value={s.camera_id}
                        onChange={(e) =>
                          change((p) => {
                            p.shots.find((x) => x.id === s.id)!.camera_id =
                              e.target.value;
                          })
                        }
                      >
                        {scene.cameras.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {(["start", "end"] as const).map((k) => (
                        <input
                          key={k}
                          aria-label={
                            "镜头" + (k === "start" ? "起帧 " : "止帧 ") + s.id
                          }
                          type="number"
                          value={s[k]}
                          onChange={(e) =>
                            change((p) => {
                              p.shots.find((x) => x.id === s.id)![k] = Number(
                                e.target.value,
                              );
                            })
                          }
                        />
                      ))}
                      <button
                        aria-label={"删除镜头 " + s.id}
                        onClick={() =>
                          change((p) => {
                            p.shots = p.shots.filter((x) => x.id !== s.id);
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}
      <input
        type="file"
        ref={file}
        hidden
        accept=".json,application/json"
        onChange={importFile}
      />
      <dialog
        ref={dialogEl}
        aria-label={dialog}
        onCancel={(e) => {
          e.preventDefault();
          setDialog(undefined);
        }}
        onClose={() => setDialog(undefined)}
      >
        {dialog && (
          <form onSubmit={(e) => e.preventDefault()}>
            <h2>{dialog}</h2>
            {dialog === "新建场景" ? (
              <label className="field">
                场景名称
                <input
                  autoFocus
                  aria-label="场景名称"
                  name="title"
                  required
                  maxLength={200}
                />
              </label>
            ) : dialog === "让 AI 处理" ? (
              <label className="field">
                当前目标
                <textarea
                  autoFocus
                  aria-label="当前目标"
                  name="goal"
                  defaultValue="依据已有剧本和场景安排人物站位、机位与预演，保存并回读固定成果。"
                />
              </label>
            ) : dialog === "记录意见" ? (
              <label className="field">
                意见内容
                <textarea
                  autoFocus
                  aria-label="意见内容"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </label>
            ) : dialog === "清空场景" ? (
              <p>
                将对象、轨道与镜头清空为本地稿，历史修订保留；保存后才更新作品。
              </p>
            ) : dialog === "版本冲突" ? (
              <>
                <p>保留本地与远端修改，逐项选择冲突；合并后需另行保存。</p>
                {conflict.conflicts.length ? (
                  conflict.conflicts.map((c: any) => (
                    <div key={c.path} className="conflict">
                      <strong>{c.path}</strong>
                      <pre>
                        {JSON.stringify(
                          { local: c.local, remote: c.remote },
                          null,
                          2,
                        )}
                      </pre>
                      <select
                        aria-label={"选择字段版本 " + c.path}
                        value={choices[c.path] ?? "local"}
                        onChange={(e) =>
                          setChoices({ ...choices, [c.path]: e.target.value })
                        }
                      >
                        <option value="local">本地稿</option>
                        <option value="remote">当前版本</option>
                      </select>
                    </div>
                  ))
                ) : (
                  <p>两端修改可以合并，没有同项冲突。</p>
                )}
              </>
            ) : null}
            <div className="dialog-actions">
              <button type="button" onClick={() => setDialog(undefined)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={!!busy}
                onClick={async () => {
                  if (dialog === "版本冲突") {
                    acceptMerge();
                    return;
                  }
                  if (dialog === "新建场景") {
                    const title = (
                      dialogEl.current?.querySelector(
                        "input[name=title]",
                      ) as HTMLInputElement
                    )?.value.trim();
                    if (!title) return;
                    if (dirty) {
                      setError("请先保存当前场景。");
                      return;
                    }
                    setRecord(undefined);
                    setScene(newScene(title));
                    setSelected(null);
                    setHistory([]);
                    setFuture([]);
                    setPending(undefined);
                    setDialog(undefined);
                    return;
                  }
                  if (dialog === "清空场景") {
                    change((p) => {
                      p.objects = [];
                      p.tracks = [];
                      p.shots = [];
                      p.notes = p.notes.map((n) => ({ ...n, target_id: null }));
                    });
                    setSelected(null);
                    setDialog(undefined);
                    return;
                  }
                  if (dialog === "记录意见") {
                    if (!record || dirty) {
                      setError("请先保存场景，再针对固定版本提意见。");
                      return;
                    }
                    if (!noteText.trim()) return;
                    change((p) =>
                      p.notes.push({
                        id: uid(),
                        origin: "author",
                        text: noteText.trim(),
                        target_id: selected,
                        fixed_revision: record.object.revision,
                        frame,
                      }),
                    );
                    setNoteText("");
                    setDialog(undefined);
                    return;
                  }
                  if (dialog === "让 AI 处理") {
                    const goal = (
                      dialogEl.current?.querySelector(
                        "textarea[name=goal]",
                      ) as HTMLTextAreaElement
                    )?.value.trim();
                    if (!goal) return;
                    await run("准备交接", async () => {
                      if (record)
                        await invoke("prepare_handoff", {
                          object_id: record.object.object_id,
                          revision: record.object.revision,
                          goal,
                        });
                      await api.host?.("handoff", {
                        goal,
                        ...(record ? { object_ref: refOf(record) } : {}),
                      });
                      setStatus(
                        "已复制当前目标及固定范围，请在所选Agent会话中继续。",
                      );
                      setDialog(undefined);
                    });
                  }
                }}
              >
                {dialog === "版本冲突"
                  ? "以当前基线继续编辑"
                  : dialog === "让 AI 处理"
                    ? "复制并继续"
                    : "确认"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
function sampleCamera(scene: Scene, id: string, frame: number) {
  return sample(scene, frame).cameras.find(c=>c.id===id)!;
}
createRoot(document.getElementById("root")!).render(<App />);
