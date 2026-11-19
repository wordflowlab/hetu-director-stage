export async function managed(c: any, action: string, input: any, key: string) {
  const p = await c.ok("hetu_prepare_management_operation", {
    management_ref: c.management,
    action: "hetu." + action,
    input,
    summary: "当前用户已要求完整验收，本操作仅限隔离演示作品",
    operation_key: "prepare-" + key,
  });
  await c.ok("hetu_record_management_decision", {
    management_ref: c.management,
    proposal_id: p.proposal_id,
    proposal_sha256: p.proposal_sha256,
    expected_state_revision: p.state_revision,
    decision: "approve",
    authorization_note:
      "用户要求本批完整测试验收，当前为隔离雨港示例的固定操作；不触及真实作品，不外发，不定稿。",
    operation_key: "decide-" + key,
  });
  const result = await c.ok("hetu_execute_management_operation", {
    management_ref: c.management,
    proposal_id: p.proposal_id,
    proposal_sha256: p.proposal_sha256,
    operation_key: "execute-" + key,
  });
  return {
    ...result.result,
    ...(result.task_locator ? { task_locator: result.task_locator } : {}),
  };
}
