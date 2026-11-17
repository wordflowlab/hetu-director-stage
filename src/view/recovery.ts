import { canonical, clone } from "../domain/model.ts";

/** 当前稿与未知请求优先；撤销栈按恢复服务预算裁剪。 */
export function recoverySnapshot(value: any) {
  const snapshot = clone(value);
  if (
    snapshot.pending?.input?.content &&
    canonical(snapshot.pending.input.content) === canonical(snapshot.draft)
  ) {
    delete snapshot.pending.input.content;
    snapshot.pending.content_from_draft = true;
  }
  const bytes = () => new TextEncoder().encode(JSON.stringify(snapshot)).length;
  while (bytes() > 900 * 1024) {
    if (snapshot.history?.length) snapshot.history.shift();
    else if (snapshot.future?.length) snapshot.future.pop();
    else throw new Error("恢复稿超过预算，请先回读原操作并保存当前稿。");
  }
  return snapshot;
}

export function recoveredPending(snapshot: any) {
  if (!snapshot.pending) return undefined;
  const pending = clone(snapshot.pending);
  if (pending?.content_from_draft) {
    pending.input.content = clone(snapshot.draft);
    delete pending.content_from_draft;
  }
  return pending;
}
