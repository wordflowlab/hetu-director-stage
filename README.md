# 导演布景台

> 河图洛书的三维白模布景插件，让作者与外部Agent围绕同一场景布置空间、安排机位并接续预演。

## 简介

人物、家具、墙体和几何体组成可编辑场景；机位、时间线与关键帧形成可重复渲染的工程。场景通过河图Core保存，支持固定版本、冲突检查和原操作恢复。

## 角色分流

- 使用插件 → [使用与流程](docs/05-用户故事与业务流程.md)
- 通过Agent操作 → [功能地图](CAPABILITIES.md)及同包Skill
- 开发维护 → [文档目录](docs/README.md)

## 快速上手

### 前置条件

源码开发使用Node.js 25、npm及0.11.2以上、支持Host API 1和`save_artifact`的河图。独立无窗口渲染需要Chromium或Chrome，MP4编码需要FFmpeg。开发测试另使用本机河图源码构建的CLI、MCP及Electron。

### 安装步骤

下载GitHub Release固定运行包，核对归档和解压包摘要，由外部Agent通过河图的`plugins.inspect_package`及`plugins.apply`安装。安装河图插件不等于安装Codex插件。

### 运行启动

```bash
npm ci
npm run build
npm run check
npm run test:unit
npm run test:machine
npm run test:render
npm run test:ui
npm run package
```

## 配置 / 参数

测试使用`HETU_SOURCE`指定河图源码目录，默认相对本仓库为`../../limecloud/hetu`。无窗口渲染通过`--browser`指定Chromium可执行文件，`--ffmpeg`指定FFmpeg；完整参数见[开发与发行](docs/09-开发发布与上架.md)。

## 边界

白模验证构图、空间与节奏；最终形象、表演、材质、音轨与作者认可独立判断。插件不内置Agent、付费生成或发布投放，不保存第二份正式剧本。浏览器恢复稿不能替代Core已保存成果。

## 协作方式

功能与验收随合同一起维护，专业能力见本包`CAPABILITIES.md`。问题反馈使用GitHub Issues；发行包保持同一版本字节不可变。
