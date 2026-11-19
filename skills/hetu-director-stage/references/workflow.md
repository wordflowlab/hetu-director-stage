# 场景推进与数据

先阅读已有剧本或视频的确切WorkRef，不强制创建空上游。每个场景包含format_version=1、title、description、objects、cameras、environment、timeline、tracks、shots、notes；数据kind为director_stage_scene。实际字段Schema从当前capabilities读取。

对象：id、name、preset、transform、visible、locked、source_index。transform使用position／rotation／scale三元数组；米、Y向上、Euler XYZ度。18种preset见当前Schema。白模ID与宿主人物ID分开，来源可引用固定人物、正文或素材，不靠名字建立身份。

Camera保存position、target、focal_length_mm、sensor_width_mm、near、far。位置不能等于目标。帧时间为整数，默认25FPS，区间[start,end)。Track按目标类型、ID和property绑定，关键帧严格递增且在duration_frames内，linear或step插值；相同属性不建重复轨道。Shot引用存在机位，区间不重叠；无Shot使用默认机位。

已有source_refs只能追加，已有索引不能移向新版。每个写动作一次Core权威保存。单场景512KiB／200对象／24机位，超出时按固定来源拆分场景，不扩大单次传输。

作者提出“让两人隔着桌子站立”时，先读取已有场景与机位，使用put_object或transform_objects；“镜头晚半秒切近景”时按FPS调整set_shots并读取旧新render_plan。变更前保留固定revision和原键，保存成功后实际回读，而非只输出建议。

## 俯视调度与逐镜推进

平面图投影同一X/Z地面坐标，人物正面为局部+Z，朝向使用rotation[1]。marker可取blue／red／green／amber／violet；它是白模身份标识，不代表正式人物服装。两种视图、PNG与GLB使用同一基础→全局轨道→当前镜头blocking采样。

Shot保留id／camera_id／start／end，增加可选label、dialogue={speaker_id,text,source_index}、blocking=[{object_id,transform,end_transform?}]。局部变换覆盖该镜头内的完整变换，end_transform按末帧采样；无该对象局部项时继续全局轨道。清空某镜头blocking恢复全局，不删除全局轨道。旧工程可直接读取，新增字段仅在显式保存后产生新修订。

典型目标：“S3女主往桌边走，其他镜头别动；这句说得完吗？”先读完整固定场景和S3；使用set_blocking，只更新S3；调用shot_report查看显式语速估算与遮挡；需要延长时按整数帧调整S3及后续镜头区间和总帧数，保留其他字段。回读S2末帧、S3首末帧及S4首帧，生成新预演后比较旧新修订。站位说明可作为后续生成参考，不能保证提供方严格复现。

独立视频脚本若保存为宿主资料，先用公开资料动作回读，再将`kind:resource`、确切`resource_id`、`revision`、`sha256`与同作品`work_ref`追加到source_refs。通过source_index引用该内容；摘要错误、缺修订和跨作品来源不降级为无来源。
