# 无窗口渲染

`render_plan`返回data含scene、project_ref、source_refs、render和plan_sha256。将完整data保存到本机计划文件，保持字段不变。通过已安装包目录或固定发行包取得`render.js`及`render.html`，脚本支持`--package`指向该运行包；不下载不明渲染网页。

```bash
node render-stage.mjs render-plan.json --package /path/to/plugin-package --output /path/to/new-output --browser /path/to/chromium
```

脚本通过本机HTTP和CDP运行同包渲染器，默认生成PNG、批量机位或序列，由固定计划mode选择；`--format glb`导出GLB，`--format mp4 --ffmpeg /path/to/ffmpeg`编码无音轨白模视频。输出目录必须为空，清单含每文件摘要及固定计划。脚本优先发现本机已有Playwright headless shell，再尝试Chromium与系统Chrome；使用独立渲染页并绕过代理访问回环地址。明确指定的浏览器失败时保留回执，不静默改用另一环境。Chromium也可由`HETU_CHROME`指定；脚本会尝试常见系统Chrome和已安装Playwright Chromium。WebGL初始化、图像或编码失败时非零退出，保存失败证据。

PNG和GLB可用于构图或工程参考，模型是否理解及遵循另行验证。预演不默认添加音乐或对白，MP4无音轨需明确说明。导入河图仍使用公开素材合同，不绕过Core直写受管文件。
