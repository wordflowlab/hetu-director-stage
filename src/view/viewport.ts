import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { StageWorld, renderer, THREE, setCamera } from "../render/scene.ts";
import {
  clone,
  sample,
  type Scene,
  type Transform,
  type Camera,
  type Vec,
} from "../domain/model.ts";
export class Viewport {
  r: THREE.WebGLRenderer;
  world?: StageWorld;
  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
  orbit: OrbitControls;
  transform: TransformControls;
  helper: THREE.Object3D;
  box = new THREE.BoxHelper(new THREE.Object3D(), 0x29a383);
  resize: ResizeObserver;
  selected: string | null = null;
  view = "free";
  mode: "translate" | "rotate" | "scale" = "translate";
  snap = false;
  value?: Scene;
  frame = 0;
  down?: {
    x: number;
    y: number;
    id: string;
    position: THREE.Vector3;
    hit: THREE.Vector3;
    dragged: boolean;
  };
  constructor(
    public canvas: HTMLCanvasElement,
    public onSelect: (id: string | null) => void,
    public onTransform: (id: string, t: Transform) => void,
    public onError: (message: string) => void,
  ) {
    this.r = renderer(canvas);
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.position.set(8, 6, 10);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = false;
    this.orbit.update();
    this.transform = new TransformControls(this.camera, canvas);
    this.helper = this.transform.getHelper();
    this.transform.addEventListener("dragging-changed", (e: any) => {
      this.orbit.enabled = !e.value && this.view === "free";
    });
    this.transform.addEventListener("mouseUp", () => {
      const o = this.transform.object;
      if (o && this.selected) this.emit(this.selected, o);
    });
    this.resize = new ResizeObserver(() => this.size());
    this.resize.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerUp);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.r.setAnimationLoop(() => {
      if (!this.world) return;
      this.box.visible =
        !!this.selected && !!this.world.groups.get(this.selected);
      if (this.box.visible)
        this.box.setFromObject(this.world.groups.get(this.selected!)!);
      this.r.render(this.world.scene, this.camera);
    });
    this.size();
  }
  contextLost = (e: Event) => {
    e.preventDefault();
    this.onError("三维上下文已丢失，场景数据仍保留；请保存或返回重开。");
  };
  size() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (w < 1 || h < 1) return;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.view !== "free") this.setView(this.view);
  }
  setScene(value: Scene) {
    this.value = clone(value);
    this.transform.detach();
    if (this.world) {
      this.helper.removeFromParent();
      this.box.removeFromParent();
      this.world.dispose();
    }
    this.world = new StageWorld(value, this.frame);
    this.world.scene.add(this.helper, this.box);
    this.select(this.selected);
    if (this.view !== "free") this.setView(this.view);
  }
  select(id: string | null) {
    this.selected = id;
    const group = id ? this.world?.groups.get(id) : undefined;
    const item = this.value?.objects.find((x) => x.id === id);
    if (
      group &&
      item?.visible &&
      !item.locked &&
      this.view === "free" &&
      !this.down
    ) {
      this.transform.attach(group);
      this.transform.setMode(this.mode);
    } else this.transform.detach();
  }
  setMode(mode: "translate" | "rotate" | "scale", snap: boolean) {
    this.mode = mode;
    this.snap = snap;
    this.transform.setMode(mode);
    this.transform.setTranslationSnap(snap ? 0.25 : null);
    this.transform.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    this.transform.setScaleSnap(snap ? 0.1 : null);
  }
  setFrame(frame: number) {
    this.frame = frame;
    this.world?.updateFrame(frame);
    if (this.view !== "free") this.setView(this.view);
  }
  setView(view: string) {
    this.view = view;
    if (!this.value) return;
    const c = sample(this.value, this.frame).cameras.find((c) => c.id === view);
    if (c) {
      setCamera(
        this.camera,
        c,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
      this.orbit.target.fromArray(c.target);
    } else if (view === "top") {
      this.camera.position.set(0, 18, 0.001);
      this.camera.lookAt(0, 0, 0);
      this.orbit.target.set(0, 0, 0);
    } else if (view === "front") {
      this.camera.position.set(0, 4, 16);
      this.camera.lookAt(0, 1, 0);
      this.orbit.target.set(0, 1, 0);
    } else if (view === "side") {
      this.camera.position.set(16, 4, 0);
      this.camera.lookAt(0, 1, 0);
      this.orbit.target.set(0, 1, 0);
    } else if (view === "free") {
      if (!this.camera.position.length()) this.camera.position.set(8, 6, 10);
      this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
      this.orbit.update();
    }
    this.orbit.enabled = view === "free";
    this.select(this.selected);
  }
  currentCamera(id: string, name: string): Camera {
    return {
      id,
      name,
      position: this.camera.position.toArray() as Vec,
      target: this.orbit.target.toArray() as Vec,
      focal_length_mm:
        36 /
        (this.camera.aspect *
          2 *
          Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))),
      sensor_width_mm: 36,
      near: 0.05,
      far: 500,
    };
  }
  ray(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return ray;
  }
  pointerDown = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      this.transform.dragging ||
      this.view !== "free" ||
      !this.world
    )
      return;
    const objects = [...this.world.groups.values()].filter((o) => o.visible);
    const hit = this.ray(e).intersectObjects(objects, true)[0];
    if (!hit) {
      this.onSelect(null);
      return;
    }
    let group: THREE.Object3D = hit.object;
    while (group.parent && group.parent !== this.world.root)
      group = group.parent;
    const id = group.userData.entity_id;
    if (!id) return;
    this.onSelect(id);
    if (this.value?.objects.find((x) => x.id === id)?.locked) return;
    this.orbit.enabled = false;
    const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -group.position.y,
      ),
      point = this.ray(e).ray.intersectPlane(plane, new THREE.Vector3());
    if (point) {
      this.down = {
        x: e.clientX,
        y: e.clientY,
        id,
        position: group.position.clone(),
        hit: point,
        dragged: false,
      };
      this.transform.detach();
    }
    this.canvas.setPointerCapture(e.pointerId);
  };
  pointerMove = (e: PointerEvent) => {
    const d = this.down;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3 && !d.dragged) return;
    d.dragged = true;
    const o = this.world!.groups.get(d.id)!;
    if (e.shiftKey) o.position.y = d.position.y + (d.y - e.clientY) * 0.015;
    else {
      const p = this.ray(e).ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.position.y),
        new THREE.Vector3(),
      );
      if (p) o.position.copy(d.position).add(p.sub(d.hit));
    }
    if (this.snap)
      o.position
        .toArray()
        .forEach((v, i) =>
          o.position.setComponent(i, Math.round(v / 0.25) * 0.25),
        );
  };
  pointerUp = () => {
    if (this.down?.dragged) {
      const o = this.world!.groups.get(this.down.id)!;
      this.emit(this.down.id, o);
    }
    this.down = undefined;
    this.select(this.selected);
    this.orbit.enabled = this.view === "free";
  };
  emit(id: string, o: THREE.Object3D) {
    this.onTransform(id, {
      position: o.position.toArray() as Vec,
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map(
        THREE.MathUtils.radToDeg,
      ) as Vec,
      scale: o.scale.toArray().map((v) => Math.max(0.01, v)) as Vec,
    });
  }
  dispose() {
    this.r.setAnimationLoop(null);
    this.resize.disconnect();
    for (const [type, fn] of [
      ["pointerdown", this.pointerDown],
      ["pointermove", this.pointerMove],
      ["pointerup", this.pointerUp],
      ["pointercancel", this.pointerUp],
      ["webglcontextlost", this.contextLost],
    ] as const)
      this.canvas.removeEventListener(type, fn as EventListener);
    this.transform.dispose();
    this.orbit.dispose();
    this.box.geometry.dispose();
    (this.box.material as THREE.Material).dispose();
    this.world?.dispose();
    this.r.dispose();
    this.r.forceContextLoss();
  }
}
