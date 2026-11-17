import { PngSession, glb } from "./scene.ts";
import { validate, cameraAt } from "../domain/model.ts";
declare global {
  interface Window {
    stageRender: {
      render: (
        plan: any,
        task: any,
      ) => Promise<{ base64: string; bytes: number }>;
    };
  }
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
let session: PngSession | undefined, activePlan: string | undefined;
window.stageRender = {
  async render(plan, task) {
    if (activePlan !== plan.plan_sha256) {
      validate(plan.scene);
      session?.dispose();
      session = new PngSession(
        plan.scene,
        plan.render.width,
        plan.render.height,
      );
      activePlan = plan.plan_sha256;
    }
    const bytes =
      task.format === "glb"
        ? await glb(plan.scene)
        : await session!.frame(
            task.camera_id ??
              cameraAt(plan.scene, task.frame, plan.render.camera_ids[0]),
            task.frame,
          );
    return { base64: base64(bytes), bytes: bytes.length };
  },
};
