# 导演布景台功能地图

本插件自维护专业功能；宿主只提供公共服务和稳定发现入口。实际参数以运行时capabilities为准。

| 动作 | 用途 | 效果 |
| --- | --- | --- |
| `list_scenes` | 查找场景 | read |
| `get_scene` | 读取固定场景 | read |
| `save_scene` | 保存完整场景 | managed_write |
| `put_object` | 添加或修改白模对象 | managed_write |
| `transform_objects` | 修改对象变换 | managed_write |
| `duplicate_objects` | 复制对象 | managed_write |
| `remove_objects` | 移除对象及其轨道 | managed_write |
| `set_visibility` | 设置对象显隐 | managed_write |
| `put_camera` | 添加或修改机位 | managed_write |
| `remove_camera` | 移除无引用机位 | managed_write |
| `set_environment` | 设置场景环境 | managed_write |
| `set_timeline` | 设置预演时基与长度 | managed_write |
| `put_track` | 添加或修改关键帧轨道 | managed_write |
| `remove_track` | 移除关键帧轨道 | managed_write |
| `set_shots` | 设置镜头切换 | managed_write |
| `add_note` | 记录固定版本意见 | managed_write |
| `fork_scene` | 从固定场景建立备选 | managed_write |
| `compare_versions` | 比较场景修订 | read |
| `check_scene` | 检查场景引用与制作准备 | read |
| `export_scene` | 分块导出固定场景JSON | read |
| `render_plan` | 固定三维渲染计划 | read |
| `prepare_handoff` | 准备固定场景AI交接 | read |
| `get_operation` | 回读原操作结果 | read |

同包Skill：hetu-director-stage。18种程序白模、三维编辑、机位、关键帧、镜头、PNG／GLB／序列及可选MP4由专业层提供。文件与媒体不代表作者认可。
