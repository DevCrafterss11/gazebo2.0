# 实验三步骤3「通信组网」补全

日期：2026-10-31。范围仅限步骤3的界面与导航，不改实验一、二，不修改任务业务模型、Mock Runtime、Store 或真实硬件控制。

## 原有问题

- 只有15张静态布局的链路卡片，无法选择查看单节点完整链路。
- 未设置步骤3专属的上一步/下一步按钮（紧凑教学页面不显示通用底栏）。
- 没有通信汇总、异常筛选和缺失/过期数据提示，桌面下方空间利用不足。

## 本次实现

- 顶部4项动态统计：网络在线、5秒内有效心跳、一一映射核对、完整链路正常数量。
- 默认显示15个独立节点，保留 uav101–uav115 与 192.168.10.101–115 的编号/IP对应关系。
- 节点可点击或用键盘选择；右侧显示 MUVA → 树莓派 → 无人机/SITL 链路及最近心跳、遥测更新时间、Gazebo/SITL状态。
- 使用 Store 原有 selectedDrone，切换到步骤4后保留选中无人机。
- 「全部节点 / 需关注」筛选，显示通信中断、无心跳、数据过期、缺失节点、映射异常、转发未接入等状态。无异常及无资源时均提供明确提示。
- 底部增加「上一步：集群启动」「下一步：集群状态监控」。启动未完成或安全停止期间禁用下一步；链路异常不阻止进入监控排查。
- 不启动任务、不改变无人机分配、不新增页面模拟数据或定时器。所有心跳/遥测来自现有统一运行时。
- 延用 MUVA CSS Variables、深蓝面板、青蓝高亮和共享按钮。1366×768、1600×900、1860×900默认完整显示页面及底部按钮，无需滚动；768×1024、390×844采用单一页面纵向滚动，无面板内滚动条、横向裁切或重叠。
- 当前数据源明确为 Mock；实际网络检测、树莓派与 MAVLink 真实接入仍未开放。

## 文件

新增：
- `src/experiments/collaboration/CommunicationNetwork.tsx`
- `src/experiments/collaboration/CommunicationNetwork.module.css`
- `tests/collaboration-communication-browser.cjs`
- 本报告及对应验证截图。

修改：
- `src/experiments/collaboration/CollaborationExperimentPage.tsx`：抽出原有步骤3内联展示，接入新组件，添加仅步骤3使用的布局类。
- `src/experiments/collaboration/Collaboration.module.css`：追加步骤3专属内容填充规则，不改变其他步骤布局。

未修改其他已有业务文件；工作区原有未提交内容与用户文档保留。

## 验证

运行环境：已有开发服务器 `http://127.0.0.1:5175/experiments/collaboration`，Mock 模式。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；仍有既有的大体积 chunk 提示 |
| `npm run test:collaboration` | 32/32 通过 |
| `node tests/collaboration-communication-browser.cjs` | 通过；5种尺寸，15映射、键盘选择、实时心跳、异常/过期/缺失/空资源状态、映射冲突、安全停止禁用、上下步数据保持、不会自动启动任务 |
| `node tests/collaboration-compact-browser.cjs` | 通过；步骤1–3回归 |
| `node tests/collaboration-readiness-fill-browser.cjs` | 通过；步骤1回归 |
| `node tests/collaboration-startup-fill-browser.cjs` | 通过；步骤2回归 |
| `npm test` | 115/120通过，5项实验二失败，与前轮 `/tmp/collab-startup-fill-alltest.log` 的失败项一致 |
| `npm run test:experiment1-map` | 17/19通过；两项镜头测试期望缩放值18，但现有 `initialFlightMapView` 为17.2；相关实现和测试均未在本次修改 |
| `npm run lint` | 项目未配置 lint 脚本，不能报告为通过 |
| `git diff --check` | 通过 |

浏览器检查无 console error / pageerror。异常数据通过测试中的受控 Store fixture 验证，仅用于测试展示分支，没有为页面引入伪造的真实连接或网络重检能力。

### 截图与日志

截图目录：`docs/ui-verification/collaboration/communication-2026-10-31/`

- `03-network-1860.png`：完整桌面布局。
- `03-network-1600.png`：中等桌面布局。
- `03-network-1366.png`：小桌面；15节点和上下步按钮完整可见。
- `03-network-768.png`：平板布局。
- `03-network-390.png`：手机首屏。
- `03-network-mobile-footer.png`：手机链路详情和底部上下步操作。
- `03-attention.png`：通信中断/过期筛选。
- `result.json`：尺寸、滚动、裁切、重叠检测结果。
- `regression-*`：步骤1、2及紧凑流程回归截图。

工程与浏览器日志位于 `/tmp/collab-communication-*.log`。
