# 实验四安全攻防工作区（第一版）

- 路由 `/experiments/security`：保留平台导航的介绍页；进入后全屏工作区。介绍页与五任务工作区提供「简易靶场」按钮，点击直接跳转到 `/experiments/security/range`。该页保留原单机 Gazebo/SITL 攻防流程，并提供返回实验四介绍的入口；与五项演示数据完全隔离。
- 五场景和示意坐标在 `src/pages/experiments/security/scenarios.ts`；场景绘制在 `SecurityScene.tsx`；演示状态转换在 `MockSecurityScenarioAdapter.ts`。默认无论全站数据源选择为何，五场景**只使用教学演示适配器**，不得声称实际下发攻击指令。
- 基线 → 攻击 → 防护；攻击或防护后可恢复基线。五场景阶段独立保留在当前页面会话中，离开路由或刷新页面则重新开始。本版不是实验三的真实任务调度和持久化记录。
- `src/services/contracts/securityScenario.ts` 预留 `SecurityScenarioAdapter` 和 `RaspberryPiSecurityGateway`：将来从服务注册表显式替换时，须先做节点认证、状态心跳、请求 ID 去重、操作确认和真实任务结果采集。**不能**因为提交 API 请求成功就报告攻击成功；离线和超时必须显示错误，不能回退到演示结果而假装设备在线。真实设备的任务指标也须由已验证的结果提供，不能继续读本文件的演示数值。
- 预留 RPI-101…503 是界面映射示例，非树莓派实际 ID。所有航线坐标为示意 SVG 坐标而非 GPS，不可作为飞控航点上传。
- 回归：`node tests/security-scenarios-browser.cjs`，在 5173 前端运行，测试五项攻击、防护、恢复、场景切换和 1920×1080／1366×768。截图在 `docs/ui-verification/security-scenarios-2026-11-02/`。
