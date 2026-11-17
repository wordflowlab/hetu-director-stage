import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  sample,
  clone,
  type Scene,
  type Vec,
  type Transform,
} from "../domain/model.ts";
import { dimensions } from "../domain/direction.ts";

export function PlanCanvas({
  scene,
  frame,
  selected,
  cameraId,
  onSelect,
  onObject,
  onCamera,
  snap,
}: {
  scene: Scene;
  frame: number;
  selected: string | null;
  cameraId: string;
  onSelect: (id: string | null) => void;
  onObject: (id: string, t: Transform) => void;
  onCamera: (id: string, position: Vec, target: Vec) => void;
  snap: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<any>();
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState([0, 0]),
    [preview, setPreview] = useState<any>();
  const [pixels, setPixels] = useState(600);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setPixels(
        Math.max(
          1,
          Math.min(entry.contentRect.width, entry.contentRect.height),
        ),
      ),
    );
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const state = useMemo(() => sample(scene, frame), [scene, frame]);
  const points = [
    ...state.objects.map((o) => o.transform.position),
    ...state.cameras.flatMap((c) => [c.position, c.target]),
  ];
  const minX = Math.min(-4, ...points.map((p) => p[0])) - 2,
    maxX = Math.max(4, ...points.map((p) => p[0])) + 2;
  const minZ = Math.min(-4, ...points.map((p) => p[2])) - 2,
    maxZ = Math.max(4, ...points.map((p) => p[2])) + 2;
  const extent = Math.max(maxX - minX, maxZ - minZ),
    size = extent / zoom;
  const box = [
    (minX + maxX - size) / 2 + pan[0],
    (minZ + maxZ - size) / 2 + pan[1],
    size,
    size,
  ];
  const at = (e: React.PointerEvent) => {
    const matrix = svg.current!.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return [p.x, p.y];
  };
  const begin = (e: React.PointerEvent, id: string, type: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onSelect(id);
    const o = state.objects.find((o) => o.id === id);
    if (o?.locked) return;
    drag.current = {
      id,
      type,
      start: at(e),
      object: o ? clone(o) : null,
      camera: clone(state.cameras.find((c) => c.id === id) ?? null),
      pan: [...pan],
      matrix: svg.current!.getScreenCTM()!.inverse(),
    };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = at(e),
      dx = q[0] - d.start[0],
      dz = q[1] - d.start[1],
      round = (n: number) =>
        snap ? Math.round(n * 4) / 4 : Math.round(n * 100) / 100;
    if (d.type === "pan") {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(d.matrix);
      setPan([d.pan[0] - (pt.x - d.start[0]), d.pan[1] - (pt.y - d.start[1])]);
      return;
    }
    if (d.object) {
      const t = clone(d.object.transform);
      if (d.type === "facing")
        t.rotation[1] =
          (Math.atan2(q[0] - t.position[0], q[1] - t.position[2]) * 180) /
          Math.PI;
      else {
        t.position[0] = round(t.position[0] + dx);
        t.position[2] = round(t.position[2] + dz);
      }
      d.preview = { id: d.id, transform: t };
      setPreview(d.preview);
    } else {
      const c = clone(d.camera);
      if (d.type === "target") {
        c.target[0] = round(q[0]);
        c.target[2] = round(q[1]);
      } else {
        c.position[0] = round(c.position[0] + dx);
        c.position[2] = round(c.position[2] + dz);
        c.target[0] = round(c.target[0] + dx);
        c.target[2] = round(c.target[2] + dz);
      }
      d.preview = { id: d.id, camera: c };
      setPreview(d.preview);
    }
  };
  const finish = (e: React.PointerEvent) => {
    const d = drag.current,
      p = d?.preview;
    if (p) {
      if (p.transform) onObject(d.id, p.transform);
      else onCamera(d.id, p.camera.position, p.camera.target);
    }
    drag.current = null;
    setPreview(undefined);
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
  };
  const cameras = state.cameras.map((c) =>
    preview?.id === c.id && preview.camera ? preview.camera : c,
  );
  const active = cameras.find((c) => c.id === cameraId)!;
  const frustum = (c: any) => {
    const dx = c.target[0] - c.position[0],
      dz = c.target[2] - c.position[2],
      len = Math.hypot(dx, dz);
    if (len < 0.001) return "";
    const range = Math.min(extent, len * 1.5),
      half = (range * c.sensor_width_mm) / (2 * c.focal_length_mm);
    const ux = dx / len,
      uz = dz / len;
    return `${c.position[0]},${c.position[2]} ${c.position[0] + ux * range - uz * half},${c.position[2] + uz * range + ux * half} ${c.position[0] + ux * range + uz * half},${c.position[2] + uz * range - ux * half}`;
  };
  return (
    <section className="plan-panel" aria-label="俯视调度">
      <div className="plan-actions">
        <button
          onClick={() => setZoom((z) => Math.min(5, z * 1.25))}
          aria-label="放大平面图"
        >
          ＋
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
          aria-label="缩小平面图"
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan([0, 0]);
          }}
        >
          适配场景
        </button>
        <span className="muted">拖动对象或方向手柄</span>
      </div>
      <svg
        ref={svg}
        aria-label="米制场景平面图"
        role="group"
        viewBox={box.join(" ")}
        style={
          { "--plan-font": `${(12 * size) / pixels}px` } as React.CSSProperties
        }
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(undefined);
        }}
        onPointerDown={(e) => {
          if (e.button === 0) {
            onSelect(null);
            drag.current = {
              type: "pan",
              start: at(e),
              pan: [...pan],
              matrix: svg.current!.getScreenCTM()!.inverse(),
            };
            svg.current!.setPointerCapture(e.pointerId);
          }
        }}
      >
        <defs>
          <pattern
            id="metre-grid"
            width="1"
            height="1"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 1 0 L 0 0 0 1" fill="none" className="grid-line" />
          </pattern>
        </defs>
        <rect
          x={box[0]}
          y={box[1]}
          width={size}
          height={size}
          fill="url(#metre-grid)"
        />
        {active && (
          <polygon points={frustum(active)} className="camera-frustum" />
        )}
        {scene.dialogue_axis &&
          (() => {
            const a = state.objects.find(
                (o) => o.id === scene.dialogue_axis!.from_id,
              )!,
              b = state.objects.find(
                (o) => o.id === scene.dialogue_axis!.to_id,
              )!;
            return (
              <line
                className="dialogue-axis"
                x1={a.transform.position[0]}
                y1={a.transform.position[2]}
                x2={b.transform.position[0]}
                y2={b.transform.position[2]}
              />
            );
          })()}
        {[...state.objects]
          .sort(
            (a, b) =>
              Number(a.preset.startsWith("person-")) -
              Number(b.preset.startsWith("person-")),
          )
          .filter((o) => o.visible)
          .map((o) => {
            const t =
                preview?.id === o.id && preview.transform
                  ? preview.transform
                  : o.transform,
              d = dimensions[o.preset],
              actor = o.preset.startsWith("person-"),
              [x, , z] = t.position,
              yaw = t.rotation[1],
              chosen = selected === o.id;
            return (
              <g
                key={o.id}
                data-object-id={o.id}
                role="button"
                tabIndex={0}
                aria-label={"平面对象 " + o.name}
                className={`plan-object marker-${o.marker ?? "blue"} ${chosen ? "selected" : ""} ${actor ? "actor" : "furniture"}`}
                transform={`translate(${x} ${z})`}
                onPointerDown={(e) => begin(e, o.id, "object")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(o.id);
                  }
                  if (
                    !o.locked &&
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    const next = clone(t);
                    next.position[
                      e.key === "ArrowLeft" || e.key === "ArrowRight" ? 0 : 2
                    ] +=
                      (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) *
                      (snap ? 0.25 : 0.1);
                    onObject(o.id, next);
                  }
                }}
              >
                <g transform={`rotate(${-yaw})`}>
                  {actor ? (
                    <>
                      <circle r=".27" />
                      <path
                        className="facing-arrow"
                        d="M -.12 .1 L 0 .32 L .12 .1"
                      />
                    </>
                  ) : (
                    <rect
                      x={(-d[0] * t.scale[0]) / 2}
                      y={(-d[2] * t.scale[2]) / 2}
                      width={d[0] * t.scale[0]}
                      height={d[2] * t.scale[2]}
                    />
                  )}
                  {chosen && actor && (
                    <>
                      <line
                        x1="0"
                        y1=".3"
                        x2="0"
                        y2=".8"
                        className="direction-line"
                      />
                      <circle
                        r=".1"
                        cy=".8"
                        className="direction-handle"
                        aria-label={"朝向手柄 " + o.name}
                        onPointerDown={(e) => begin(e, o.id, "facing")}
                      />
                    </>
                  )}
                </g>
                <text y={actor ? 0.57 : 0} className="object-label">
                  {o.name}
                </text>
              </g>
            );
          })}
        {cameras.map((c) => {
          const yaw =
            (Math.atan2(
              c.target[0] - c.position[0],
              c.target[2] - c.position[2],
            ) *
              180) /
            Math.PI;
          return (
            <g
              key={c.id}
              className={"plan-camera " + (c.id === cameraId ? "active" : "")}
              data-camera-id={c.id}
              role="button"
              tabIndex={0}
              aria-label={"平面机位 " + c.name}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(c.id);
              }}
            >
              <line
                x1={c.position[0]}
                y1={c.position[2]}
                x2={c.target[0]}
                y2={c.target[2]}
              />
              <path
                transform={`translate(${c.position[0]} ${c.position[2]}) rotate(${-yaw})`}
                d="M 0 .3 L -.22 -.22 L .22 -.22 Z"
                onPointerDown={(e) => begin(e, c.id, "camera")}
              />
              <text x={c.position[0]} y={c.position[2] - 0.42}>
                {c.name} {c.focal_length_mm}mm
              </text>
              {selected === c.id && (
                <circle
                  cx={c.target[0]}
                  cy={c.target[2]}
                  r=".12"
                  className="direction-handle"
                  aria-label={"取景目标手柄 " + c.name}
                  onPointerDown={(e) => begin(e, c.id, "target")}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="plan-scale">1 格 = 1 米</div>
    </section>
  );
}
