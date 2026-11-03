# 实验三步骤2「集群启动」界面验收

日期：2026-10-30。仅调整步骤2的前端展示，未修改 Store、Mock Runtime、任务模型、共享样式或其他教学步骤。保留当前工作区既有修改与用户文档。

## 布局与交互

- 左侧启动配置：资源规模、3×5阵列、中心坐标、行列间距、初始高度。继续调用既有 setArrayLayout，实例运行期间锁定。
- 中央15张独立实例卡片：编号、树莓派 IP 后缀、实例状态、电量、解锁状态。桌面按3×5排列；窄屏按3列自然换行。
- 右侧交互阵列：真实 DOM / SVG 绘制 Home 位置，统一坐标比例，支持卡片/标记双向选择、键盘选择、缩放、适配；地图下显示选中资源的完整 Home 坐标。
- 下方启动阶段及日志：阶段读取既有 bootProgress；日志读取统一运行时 events，不创建页面计时器或伪造服务日志。
- 资源概况：由当前 Store 计算实例就绪、在线节点、心跳节点与就绪率。主机 CPU、内存明确显示未接入。
- 启动、停止、二次确认、页面导航与任务安全收尾沿用既有实现。启动完成15架无人机待命、未解锁、无任务分配。
- 复用 MUVA 设计 Token、CSS Modules、Lucide 图标、共享操作按钮。较小桌面把阵列移到下方，避免压缩实例卡片；窄屏按纵向排列。

## 文件

新增：
- src/experiments/collaboration/ClusterStartup.tsx
- src/experiments/collaboration/ClusterStartup.module.css
- tests/collaboration-startup-browser.cjs
- 本验收说明与 startup-2026-10-30 下的截图/验证记录

修改：
- src/experiments/collaboration/CollaborationExperimentPage.tsx：步骤2渲染新展示组件，移除该步骤旧内联 JSX 及仅供旧展示使用的图标导入。

## 实际验证

- `npm run typecheck`：通过。
- `npm run build`：通过；仍有现有主 bundle 超过500kB警告。
- `npm run test:collaboration`：22/22通过。
- `npm test`：115/120通过；现有实验二测试89–92连续运动安全间距、104提前返航失败，与本次步骤2展示变更无关。未改动实验二。
- `npm run lint`：项目未定义此脚本，无法执行 lint，未新增或关闭检查配置。
- `node tests/collaboration-startup-browser.cjs`：通过，2048/1829/1600/1280/768/390视口；检查15实例/15地图标记、阵列配置、地图联动、键盘、缩放、启动中状态、待命无任务、切换保留状态、停止取消/确认、重启、页面无横向溢出、控制台无错误。
- 既有 `tests/collaboration-browser.cjs` 完整回归：通过。执行时仅在临时副本修改截图输出目录，原测试文件未改动。六步流程、独立任务、地图编辑、返航、暂停/继续/终止、历史与评价通过。

截图：`docs/ui-verification/collaboration/startup-2026-10-30/`，包含启动前、启动中、待命、停止后、各尺寸阵列/资源概况及完整流程回归。

## 运行

开发服务器：http://127.0.0.1:5175/experiments/collaboration

```bash
export PATH=/home/vip/muva/.tools/node/bin:$PATH
VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175
```

Playwright命令前设置：
```bash
export PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core
node tests/collaboration-startup-browser.cjs
```

本次没有接入真实 Gazebo / SITL / 树莓派 / MAVLink 指令或主机资源监测。
