# 实验三步骤一至三精简验收（2026-10-31）

## 本轮范围

仅精简实验三系统感知、集群启动、通信组网及其公共顶部教学导航。沿用 MUVA 深蓝色面板、按钮、状态色与 CSS token。不改变实验一、实验二及实验三步骤四至六的业务逻辑，不修改 Runtime、Store、服务接口或真实硬件能力。

## 页面调整

- 步骤一：删除 SYSTEM READINESS 英文标题、顶部重复介绍、四块重复统计卡，以及下方资源校验、启动条件、检查记录等重复说明。将资源数量、映射结果与模拟模式操作合成紧凑工具条；保留七项检查、重新检查、检查详情、时间戳、15 条节点映射。拓扑改为横向链路。
- 步骤二：将启动、停止与运行统计集中到顶部；保留阵列参数、15 个实例、选中节点详情、Home 阵列预览和启动阶段进度；删除重复资源统计、主机资源占位区与底部重复操作；运行记录默认折叠，按需查看最近三条。
- 步骤三：保留教学平台到树莓派再到无人机的链路与 15 张节点卡片；每张卡片显示编号、完整 IP、通信与心跳状态、时间和来源。删除底部前往监控、上一步等重复导航。
- 前三步只通过顶部教学步骤切换，未满足前置条件的步骤禁用并提供原因；切换步骤回到页面顶部。手机端六步导航排列为两行。
- 删除前三步内部独立滚动区域；空间不足时仅整体页面滚动。没有通过缩小到难以阅读的字号来强行塞入所有内容。

## 涉及文件

页面及样式：

- src/experiments/collaboration/SystemReadiness.tsx
- src/experiments/collaboration/SystemReadiness.module.css
- src/experiments/collaboration/ClusterStartup.tsx
- src/experiments/collaboration/ClusterStartup.module.css
- src/experiments/collaboration/CollaborationExperimentPage.tsx
- src/experiments/collaboration/Collaboration.module.css

新增 tests/collaboration-compact-browser.cjs。原 readiness、startup、six-step、command、map-command 浏览器测试同步更新已删除按钮或标题的选择器。

## 工程检查

- npm run typecheck：通过。
- npm run build：通过；保留项目现有大 bundle 提示。
- npm run test:collaboration：22/22 通过。
- npm test：115/120 通过，5 项实验二飞行模拟用例失败：编号 89–92 的连续运动最小间距校验、104 的提前返航覆盖缺口用例。对应实现不在本轮修改范围。命令因失败未继续执行串联的实验一地图测试，不能视为全量测试通过。
- npm run lint：package.json 未配置 lint 脚本，未增设或跳过检查规则。
- git diff --check：通过。

## 浏览器验收

开发服务器：http://127.0.0.1:5175/experiments/collaboration 。启动方式：VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175。

- collaboration-compact-browser.cjs：通过。检查单一导航、模式门槛、重新检查、节点选择、阵列编辑、启动进度、15 架待命且未解锁/未分配、日志折叠、15 条完整 IP 映射、停止取消与确认，以及控制台异常。
- collaboration-readiness-browser.cjs：通过。
- collaboration-startup-browser.cjs：通过。
- collaboration-browser.cjs：完整六步回归通过，包括独立任务配置、地图编辑、单机返航、暂停继续终止、历史轨迹及评价。
- 尺寸：1829×916、1600×900、1366×768、768×1024、390×844。无水平溢出；1829 和 1600 桌面前三步默认内容无需纵向滚动，1366 与窄屏按内容整体滚动。日志手动展开后允许页面增长。
- 精简专项浏览器记录 errors=[]；已人工查看桌面步骤二、三及手机步骤一截图，确认布局与 MUVA 风格一致。

截图与 JSON：

- docs/ui-verification/collaboration/compact-steps-2026-10-31/
- docs/ui-verification/collaboration/compact-readiness-2026-10-31/
- docs/ui-verification/collaboration/compact-startup-2026-10-31/
- docs/ui-verification/collaboration/compact-six-step-regression-2026-10-31/

所有运行数据仍为明确标识的 Mock。Gazebo、SITL、树莓派和真实飞控检查/控制仍待接入。保留用户未提交内容、文档和 dump 文件，未清理工作区、提交或推送。
