# 操作地图

执行前读取当前能力Schema。本表由构建从清单生成。

| 动作 | 用途 | 必填参数 | 效果 |
| --- | --- | --- | --- |
| `list_scenes` | 查找场景 |  | read |
| `get_scene` | 读取固定场景 | `object_id` | read |
| `save_scene` | 保存完整场景 | `content`, `expected_revision`, `expected_sha256`, `operation_key` | managed_write |
| `put_object` | 添加或修改白模对象 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `object` | managed_write |
| `transform_objects` | 修改对象变换 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `changes` | managed_write |
| `duplicate_objects` | 复制对象 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `items`, `offset` | managed_write |
| `remove_objects` | 移除对象及其轨道 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `object_ids` | managed_write |
| `set_visibility` | 设置对象显隐 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `object_ids`, `visible` | managed_write |
| `put_camera` | 添加或修改机位 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `camera` | managed_write |
| `remove_camera` | 移除无引用机位 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `camera_id` | managed_write |
| `set_environment` | 设置场景环境 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `environment` | managed_write |
| `set_timeline` | 设置预演时基与长度 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `timeline` | managed_write |
| `put_track` | 添加或修改关键帧轨道 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `track` | managed_write |
| `remove_track` | 移除关键帧轨道 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `track_id` | managed_write |
| `set_shots` | 设置镜头切换 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `shots` | managed_write |
| `add_note` | 记录固定版本意见 | `object_id`, `expected_revision`, `expected_sha256`, `operation_key`, `note` | managed_write |
| `fork_scene` | 从固定场景建立备选 | `object_id`, `revision`, `title`, `operation_key` | managed_write |
| `compare_versions` | 比较场景修订 | `object_id`, `from_revision`, `to_revision` | read |
| `check_scene` | 检查场景引用与制作准备 | `object_id` | read |
| `export_scene` | 分块导出固定场景JSON | `object_id`, `revision` | read |
| `render_plan` | 固定三维渲染计划 | `object_id`, `revision`, `mode` | read |
| `prepare_handoff` | 准备固定场景AI交接 | `object_id`, `revision`, `goal` | read |
| `get_operation` | 回读原操作结果 | `operation_key` | read |
