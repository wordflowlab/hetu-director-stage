import type { BackendContext } from "../vendor/hetu-sdk.ts";
import { StageProject } from "./application/project.ts";
let app: StageProject | undefined;
export function apply(context: BackendContext) {
  app = new StageProject(context);
  context.effect(() => {
    app = undefined;
  });
}
export function invoke(action: string, input: unknown) {
  if (!app) throw new Error("插件未激活。");
  return app.invoke(action, input);
}
