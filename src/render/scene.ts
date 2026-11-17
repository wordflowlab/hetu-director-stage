import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  sample,
  cameraAt,
  type Scene,
  type Entity,
  type Camera,
  type Vec,
} from "../domain/model.ts";
export { THREE };
const radians = (v: number) => THREE.MathUtils.degToRad(v);
function material(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0,
  });
}
function part(
  group: THREE.Group,
  shape: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  name = "",
) {
  const mesh = new THREE.Mesh(shape, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  group.add(mesh);
  return mesh;
}
export function geometry(preset: string, white = true, marker?: Entity["marker"]) {
  const g = new THREE.Group();
  const identity = {blue:0x3e63dd,red:0xe5484d,green:0x30a46c,amber:0xffc53d,violet:0x6e56cf};
  const m = material(white ? 0xb9bdc4 : preset.startsWith("person-")&&marker ? identity[marker] : 0x7e9f91),
    seat = material(white ? 0xaeb2ba : 0xc2a78b),
    light = material(white ? 0xe0e1e3 : 0xcbdcc7);
  const box = (
    w: number,
    h: number,
    d: number,
    x = 0,
    y = h / 2,
    z = 0,
    mat: THREE.Material = m,
  ) => part(g, new THREE.BoxGeometry(w, h, d), x, y, z, mat);
  const sphere = (
    r: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = m,
  ) => part(g, new THREE.SphereGeometry(r, 24, 16), x, y, z, mat);
  const cyl = (
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = m,
  ) => part(g, new THREE.CylinderGeometry(r, r, h, 20), x, y, z, mat);
  if (preset.startsWith("person-")) {
    const skin = preset === "person-light" ? light : m;
    const head = sphere(0.145, 0, 1.64, 0, skin);
    head.name = "head";
    box(0.065,0.065,0.09,0,1.64,0.15,skin);
    cyl(0.085, 0.11, 0, 1.45, 0, skin);
    box(0.35, 0.48, 0.23, 0, 1.15, 0, skin);
    box(0.3, 0.18, 0.2, 0, 0.85, 0, skin);
    for (const [side, x] of [
      ["left", -0.105],
      ["right", 0.105],
    ] as const) {
      const leg = new THREE.Group();
      leg.name = side + "-leg";
      leg.position.set(x, 0.78, 0);
      const limb = part(
        leg,
        new THREE.CapsuleGeometry(0.065, 0.57, 5, 12),
        0,
        -0.36,
        0,
        skin,
      );
      part(
        leg,
        new THREE.BoxGeometry(0.14, 0.09, 0.27),
        0,
        -0.735,
        0.055,
        skin,
      );
      g.add(leg);
      const arm = new THREE.Group();
      arm.name = side + "-arm";
      arm.position.set(x < 0 ? -0.24 : 0.24, 1.37, 0);
      part(
        arm,
        new THREE.CapsuleGeometry(0.05, 0.48, 5, 12),
        0,
        -0.29,
        0,
        skin,
      );
      g.add(arm);
    }
  } else if (preset === "table") {
    box(1.5, 0.09, 0.85, 0, 0.78, 0, seat);
    for (const x of [-0.65, 0.65])
      for (const z of [-0.32, 0.32]) box(0.07, 0.73, 0.07, x, 0.365, z);
  } else if (preset === "chair") {
    box(0.48, 0.07, 0.48, 0, 0.47, 0, seat);
    box(0.48, 0.5, 0.06, 0, 0.76, -0.21, seat);
    for (const x of [-0.19, 0.19])
      for (const z of [-0.19, 0.19]) box(0.055, 0.44, 0.055, x, 0.22, z);
  } else if (preset === "sofa") {
    box(2.15, 0.35, 0.88, 0, 0.35, 0, seat);
    box(2.15, 0.7, 0.18, 0, 0.62, -0.4, seat);
    box(0.18, 0.58, 0.9, -1.02, 0.46, 0, seat);
    box(0.18, 0.58, 0.9, 1.02, 0.46, 0, seat);
    for (const x of [-0.8, 0.8])
      for (const z of [-0.3, 0.3]) box(0.09, 0.18, 0.09, x, 0.09, z);
  } else if (preset === "bed") {
    box(1.6, 0.3, 2.05, 0, 0.25, 0, m);
    box(1.55, 0.2, 2, 0, 0.5, 0, light);
    box(1.65, 0.9, 0.09, 0, 0.55, -1.02, seat);
    box(0.6, 0.1, 0.36, -0.4, 0.65, -0.72, light);
    box(0.6, 0.1, 0.36, 0.4, 0.65, -0.72, light);
  } else if (preset === "rug") box(2.4, 0.025, 1.6, 0, 0.015, 0, seat);
  else if (preset === "floor-lamp") {
    cyl(0.23, 0.05, 0, 0.025, 0);
    cyl(0.025, 1.7, 0, 0.88, 0);
    part(
      g,
      new THREE.CylinderGeometry(0.2, 0.3, 0.38, 24, 1, true),
      0,
      1.7,
      0,
      light,
    );
  } else if (preset === "plant") {
    part(g, new THREE.CylinderGeometry(0.22, 0.16, 0.38, 24), 0, 0.19, 0, seat);
    cyl(0.035, 1.05, 0, 0.8, 0);
    for (const [x, y, z, r] of [
      [0, 1.35, 0, 0.4],
      [-0.23, 1.15, 0.08, 0.27],
      [0.25, 1.15, -0.08, 0.29],
    ])
      sphere(r, x, y, z, light);
  } else if (preset === "wall-3m" || preset === "wall-5m")
    box(preset === "wall-3m" ? 3 : 5, 2.7, 0.15);
  else if (preset === "door-wall") {
    box(0.95, 2.7, 0.15, -1.025, 1.35, 0);
    box(0.95, 2.7, 0.15, 1.025, 1.35, 0);
    box(1.1, 0.5, 0.15, 0, 2.45, 0);
  } else if (preset === "steps") {
    for (let i = 0; i < 3; i++)
      box(1.5, 0.18 * (i + 1), 0.4, 0, 0.09 * (i + 1), -0.4 * i);
  } else if (preset === "sphere") sphere(0.5, 0, 0.5, 0);
  else if (preset === "cylinder") cyl(0.45, 1, 0, 0.5, 0);
  else if (preset === "plane") box(2, 0.035, 2);
  else box(1, 1, 1);
  return g;
}
export function setTransform(group: THREE.Object3D, e: Entity) {
  group.position.fromArray(e.transform.position);
  group.rotation.set(...(e.transform.rotation.map(radians) as Vec));
  group.scale.fromArray(e.transform.scale);
  group.visible = e.visible;
}
export function setCamera(
  c: THREE.PerspectiveCamera,
  value: Camera,
  width: number,
  height: number,
) {
  c.position.fromArray(value.position);
  c.aspect = width / height;
  c.fov = THREE.MathUtils.radToDeg(
    2 *
      Math.atan(value.sensor_width_mm / c.aspect / (2 * value.focal_length_mm)),
  );
  c.near = value.near;
  c.far = value.far;
  c.lookAt(new THREE.Vector3(...value.target));
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
}
export class StageWorld {
  scene = new THREE.Scene();
  root = new THREE.Group();
  groups = new Map<string, THREE.Group>();
  cameras = new Map<string, THREE.PerspectiveCamera>();
  helpers = new THREE.Group();
  ground?: THREE.Mesh;
  constructor(
    public value: Scene,
    public frame = 0,
  ) {
    this.root.name = "DirectorStage";
    this.scene.add(this.root);
    const state = sample(value, frame);
    for (const e of state.objects) {
      const g = geometry(e.preset, value.environment.white_model, e.marker);
      g.name = e.id;
      g.userData = {
        entity_id: e.id,
        preset: e.preset,
        source_index: e.source_index,
      };
      setTransform(g, e);
      if (e.preset === "person-walking")
        this.walk(g, frame / value.timeline.fps);
      this.groups.set(e.id, g);
      this.root.add(g);
    }
    for (const c of state.cameras) {
      const cam = new THREE.PerspectiveCamera();
      cam.name = c.id;
      setCamera(cam, c, 1280, 720);
      this.cameras.set(c.id, cam);
      this.root.add(cam);
    }
    const env = value.environment;
    this.scene.background = new THREE.Color(
      env.background === "studio" ? 0xf0f1f3 : 0x24282d,
    );
    this.root.add(new THREE.HemisphereLight(0xffffff, 0x858c91, 2));
    const sun = new THREE.DirectionalLight(0xfffaf2, 3);
    const az = radians(env.sun_azimuth),
      el = radians(env.sun_elevation);
    sun.position.set(
      Math.cos(az) * Math.cos(el) * 12,
      Math.sin(el) * 12,
      Math.sin(az) * Math.cos(el) * 12,
    );
    sun.castShadow = env.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -15,
      right: 15,
      top: 15,
      bottom: -15,
      near: 0.1,
      far: 60,
    });
    sun.shadow.normalBias = 0.03;
    this.root.add(sun);
    if (env.ground) {
      this.ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        material(0xc8cbd0),
      );
      this.ground.name = "stage-ground";
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.y = -0.015;
      this.ground.receiveShadow = true;
      this.root.add(this.ground);
    }
    if (env.grid) {
      const grid = new THREE.GridHelper(30, 30, 0x808a90, 0xaeb5b9);
      grid.position.y = 0.003;
      this.helpers.add(grid);
    }
    this.scene.add(this.helpers);
  }
  walk(g: THREE.Group, time: number) {
    const phase = Math.sin(time * 2 * Math.PI) * 0.5;
    for (const side of ["left", "right"]) {
      const sign = side === "left" ? 1 : -1;
      g.getObjectByName(side + "-leg")!.rotation.x = sign * phase;
      g.getObjectByName(side + "-arm")!.rotation.x = -sign * phase;
    }
  }
  updateFrame(frame: number) {
    this.frame = frame;
    const p = sample(this.value, frame);
    for (const e of p.objects) {
      const g = this.groups.get(e.id)!;
      setTransform(g, e);
      if (e.preset === "person-walking") this.walk(g, frame / p.timeline.fps);
    }
    for (const c of p.cameras) setCamera(this.cameras.get(c.id)!, c, 1280, 720);
  }
  camera(id?: string) {
    const c = this.cameras.get(id ?? cameraAt(this.value, this.frame));
    if (!c) throw new Error("机位不存在。");
    return c;
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          materials.add(m);
      if (o instanceof THREE.DirectionalLight) o.shadow.dispose();
    });
    geometries.forEach((x) => x.dispose());
    materials.forEach((x) => x.dispose());
  }
}
export function renderer(canvas?: HTMLCanvasElement) {
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  r.setPixelRatio(1);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1;
  return r;
}
// 同一固定场景复用GPU资源，逐帧更新；单图与无窗口预演共用这一实现。
export class PngSession {
  world: StageWorld;
  r: THREE.WebGLRenderer;
  constructor(
    public value: Scene,
    public width: number,
    public height: number,
  ) {
    this.world = new StageWorld(value);
    this.r = renderer();
    this.r.setSize(width, height, false);
    this.world.helpers.visible = false;
  }
  async frame(cameraId: string, frame: number): Promise<Uint8Array> {
    this.world.updateFrame(frame);
    const c = sample(this.value, frame).cameras.find((c) => c.id === cameraId);
    if (!c) throw new Error("机位不存在。");
    const camera = this.world.camera(cameraId);
    setCamera(camera, c, this.width, this.height);
    this.r.render(this.world.scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.r.domElement.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG编码失败。"))),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }
  dispose() {
    this.world.dispose();
    this.r.dispose();
    this.r.forceContextLoss();
  }
}
export async function png(
  value: Scene,
  cameraId: string,
  frame: number,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const session = new PngSession(value, width, height);
  try {
    return await session.frame(cameraId, frame);
  } finally {
    session.dispose();
  }
}
export async function glb(value: Scene): Promise<Uint8Array> {
  const w = new StageWorld(value, 0);
  try {
    w.root.userData = {format:"hetu.director-stage",timeline:value.timeline,shots:value.shots};
    w.helpers.removeFromParent();
    const times = Array.from(
        { length: value.timeline.duration_frames },
        (_, i) => i / value.timeline.fps,
      ),
      tracks: THREE.KeyframeTrack[] = [];
    const states = times.map((_,f)=>sample(value,f));
    for (const e of value.objects) {
      const g = w.groups.get(e.id)!;
      for (const [property, out] of [
        ["position", "position"],
        ["rotation", "quaternion"],
        ["scale", "scale"],
      ] as const) {
        if (
          !value.shots.some(s=>s.blocking?.some(b=>b.object_id===e.id)) && !value.tracks.some(
            (t) =>
              t.target_kind === "object" &&
              t.target_id === e.id &&
              t.property === property,
          )
        )
          continue;
        const values: number[] = [];
        for (let f = 0; f < times.length; f++) {
          const t = states[f].objects.find(
            (x) => x.id === e.id,
          )!.transform;
          if (property === "rotation")
            values.push(
              ...new THREE.Quaternion()
                .setFromEuler(
                  new THREE.Euler(...(t.rotation.map(radians) as Vec)),
                )
                .toArray(),
            );
          else values.push(...t[property]);
        }
        tracks.push(
          property === "rotation"
            ? new THREE.QuaternionKeyframeTrack(
                g.uuid + "." + out,
                times,
                values,
              )
            : new THREE.VectorKeyframeTrack(g.uuid + "." + out, times, values),
        );
      }
      if (e.preset === "person-walking")
        for (const side of ["left", "right"])
          for (const limb of ["arm", "leg"]) {
            const joint = g.getObjectByName(side + "-" + limb)!;
            const values: number[] = [];
            for (const t of times)
              values.push(
                ...new THREE.Quaternion()
                  .setFromEuler(
                    new THREE.Euler(
                      Math.sin(t * 2 * Math.PI) *
                        0.5 *
                        (side === "left" ? 1 : -1) *
                        (limb === "arm" ? -1 : 1),
                      0,
                      0,
                    ),
                  )
                  .toArray(),
              );
            tracks.push(
              new THREE.QuaternionKeyframeTrack(
                joint.uuid + ".quaternion",
                times,
                values,
              ),
            );
          }
    }
    for (const cam of value.cameras) {
      if (
        !value.tracks.some(
          (t) => t.target_kind === "camera" && t.target_id === cam.id,
        )
      )
        continue;
      const positions: number[] = [],
        quaternions: number[] = [];
      const c = w.cameras.get(cam.id)!;
      for (let f = 0; f < times.length; f++) {
        const state = states[f].cameras.find((x) => x.id === cam.id)!;
        setCamera(c, state, 1280, 720);
        positions.push(...c.position.toArray());
        quaternions.push(...c.quaternion.toArray());
      }
      setCamera(c, cam, 1280, 720);
      tracks.push(
        new THREE.VectorKeyframeTrack(c.uuid + ".position", times, positions),
        new THREE.QuaternionKeyframeTrack(
          c.uuid + ".quaternion",
          times,
          quaternions,
        ),
      );
    }
    const animations = tracks.length
      ? [new THREE.AnimationClip("previs", -1, tracks)]
      : [];
    const buffer = await new GLTFExporter().parseAsync(w.root, {
      binary: true,
      onlyVisible: false,
      animations,
    });
    if (!(buffer instanceof ArrayBuffer)) throw new Error("GLB导出失败。");
    return new Uint8Array(buffer);
  } finally {
    w.dispose();
  }
}
