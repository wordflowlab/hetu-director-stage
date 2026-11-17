# 场景推进与数据

先阅读已有剧本或视频的确切WorkRef，不强制创建空上游。每个场景包含format_version=1、title、description、objects、cameras、environment、timeline、tracks、shots、notes；数据kind为director_stage_scene。实际字段Schema从当前capabilities读取。

对象：id、name、preset、transform、visible、locked、source_index。transform使用position／rotation／scale三元数组；米、Y向上、Euler XYZ度。18种preset见当前Schema。白模ID与宿主人物ID分开，来源可引用固定人物、正文或素材，不靠名字建立身份。

Camera保存position、target、focal_length_mm、sensor_width_mm、near、far。位置不能等于目标。帧时间为整数，默认25FPS，区间[start,end)。Track按目标类型、ID和property绑定，关键帧严格递增且在duration_frames内，linear或step插值；相同属性不建重复轨道。Shot引用存在机位，区间不重叠；无Shot使用默认机位。

已有source_refs只能追加，已有索引不能移向新版。每个写动作一次Core权威保存。单场景512KiB／200对象／24机位，超出时按固定来源拆分场景，不扩大单次传输。

作者提出“让两人隔着桌子站立”时，先读取已有场景与机位，使用put_object或transform_objects；“镜头晚半秒切近景”时按FPS调整set_shots并读取旧新render_plan。变更前保留固定revision和原键，保存成功后实际回读，而非只输出建议。
