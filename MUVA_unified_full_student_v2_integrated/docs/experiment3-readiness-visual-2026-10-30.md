# 实验三步骤1：系统感知页面完善

本次范围仅为步骤1。保留现有六步导航、平台外壳、步骤2–6、统一 Store 和 Mock Runtime；未修改任务指挥布局、任务规则或真实服务接入。

## 页面调整

- 四项概览：独立无人机资源、唯一节点映射、待接入真实能力、独立任务类型。
- 运行环境检查：保留 Gazebo、World、无人机配置、SITL、主机资源、树莓派网络和 MAVLink 七项检查；可点击说明按钮查看能力边界。
- 集群资源与数据链路：展示平台 → 通信适配层 → 15 个节点的结构示意；点击任一节点查看对应无人机型号、完整树莓派 IP、通信状态与数据来源。结构示意不表示真实连接成功。
- 配置校验：基于同一 Store 中的无人机和节点数据校验固定编号、数量、唯一 IP 与一一对应关系；进度条表示配置校验数量，不表示真实网络性能。
- 启动条件：区分资源配置、教学模拟选择及集群启动状态；返回步骤1时读取已有运行状态。
- 检查记录：显示最近一次本地校验的时间与结果，以及真实的教学模拟选择事件。没有生成假网络日志或 CPU / 吞吐量数据。
- 启动引导：模拟模式选择不启动集群或任务，下一步仍沿用原有教学导航；未选择时保持入口校验。

独立 CSS Module 使用现有全局颜色、字体、圆角和间距 Token。桌面采用双主面板与下方三分区，窄屏按顺序堆叠，可滚动查看，不改变其他步骤的样式。

## 文件

- 新增 `src/experiments/collaboration/SystemReadiness.tsx`
- 新增 `src/experiments/collaboration/SystemReadiness.module.css`
- 修改 `src/experiments/collaboration/CollaborationExperimentPage.tsx`：步骤1替换为独立组件并调整对应 imports，保留其他步骤。
- 新增 `tests/collaboration-readiness-browser.cjs`
- 新增本报告与 `docs/ui-verification/collaboration/readiness-2026-10-30/` 验证产物。

仓库已有大量未提交修改。本次未 reset、checkout、清理、提交或推送，未改动用户已有文档与 ArduCopter dump 文件。

## 实际验证

- `npm run typecheck`：通过。
- `npm run test:collaboration`：22/22 通过。
- `npm run build`：通过；保留已有的大 bundle 提示。
- `npm run lint`：项目没有 lint script，未宣称通过，也未增加配置。
- `git diff --check`：通过。
- 步骤1专项 Playwright：15个节点点选、完整 IP、检查说明、重新检查、模拟模式前置条件、选择模式不启动任务、步骤切换、返回后的模式保持、运行中状态观察均通过。
- 浏览器视口：1829×1050、1600×1000、1280×900、768×1024、390×844；无页面横向溢出、无浏览器控制台错误。保存页面上部及下部截图。
- 原有完整浏览器脚本 `tests/collaboration-browser.cjs` 在单独输出目录中回归：六步、15资源、五种独立任务、地图编辑、单机返航、暂停继续终止、历史与评价通过。运行时没有改动该测试文件，只使用临时副本将输出目录改到本轮 `regression/`，避免覆盖之前的截图。

截图与机器可读结果：`docs/ui-verification/collaboration/readiness-2026-10-30/`，含 `result.json`、`build.log` 与 `regression/browser-result.json`。

## 运行

```bash
cd /home/vip/muva/MUVA_unified_full_student_v2_integrated
PATH=/home/vip/muva/.tools/node/bin:$PATH VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175
```

地址：`http://127.0.0.1:5175/experiments/collaboration`。

真实 Gazebo、SITL、CPU/内存采集、树莓派可达性和 MAVLink 状态检测仍为接口待接入；本次未启用真实控制。
