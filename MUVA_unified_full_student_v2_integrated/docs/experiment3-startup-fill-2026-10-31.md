# 实验三步骤2：启动工作区与步骤操作完善

## 范围

仅修改实验三步骤2的展示与步骤切换。保留原有统一 Store / Mock Runtime、15架资源映射与集群安全停止逻辑；没有修改实验一、实验二、任务指挥、真实硬件接口或顶部导航。

工作区原有未提交文件和用户文档均保留；没有清理、重置或提交。

## 本轮改动

- 新增底部「上一步：系统感知」「下一步：通信组网」，共用原有步骤状态管理。
- 下一步仅在集群运行、启动已结束、非安全停止中、15个实例全部就绪时开放；其他情况给出明确原因。按钮不启动集群、不分配任务、不解锁或起飞。
- 将启动进度标题、四阶段链路、百分比和折叠日志整理为紧凑区域，移除重复占高布局。
- 新增选中节点的 Gazebo / SITL / MAVLink 状态联动展示，直接读取统一无人机资源数据。
- 保留15架实例卡片与3×5 Home阵列的双向选择、阵列配置、缩放和停止确认；增大预览编号文字。
- 桌面高度自适应，三栏等高并利用剩余空间，底部操作可见。没有通过隐藏溢出伪装无滚动。
- 窄屏改为单列自然页面滚动，实例卡片改为3列，按钮纵向排列；没有面板内独立滚动条。主动展开详细日志时可产生页面级自然滚动，日志不裁切。

## 文件

- `src/experiments/collaboration/ClusterStartup.tsx`
- `src/experiments/collaboration/ClusterStartup.module.css`
- `src/experiments/collaboration/CollaborationExperimentPage.tsx`：仅增加步骤2专用布局类。
- `src/experiments/collaboration/Collaboration.module.css`：仅增加上述布局类的内容高度规则。
- 新增 `tests/collaboration-startup-fill-browser.cjs`。
- 本报告与 `docs/ui-verification/collaboration/startup-fill-2026-10-31/` 验证资料。

## 实际检查

运行环境：`http://127.0.0.1:5175/experiments/collaboration`，教学模拟模式。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；原有大包体积提醒仍存在 |
| `npm run test:collaboration` | 32/32通过 |
| `npm test` | 115/120通过；实验二既有5项失败仍存在（用例89–92安全间距、104暂停/返航覆盖缺口），未修改其逻辑 |
| `npm run lint` | 项目未配置lint脚本，不能报告通过 |
| 新增startup-fill浏览器测试 | 通过 |
| 原startup浏览器测试 | 通过 |
| readiness-fill回归测试 | 通过 |
| compact步骤1–3回归测试 | 通过 |

浏览器使用本机Chrome + Playwright；需使用现有运行时依赖：

```bash
export PATH=/home/vip/muva/.tools/node/bin:$PATH
export PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core
node tests/collaboration-startup-fill-browser.cjs
```

已验证：

- 2048×1152、1860×900、1600×900、1366×768、1280×800，在未启动和全部就绪状态均无页面滚动、无内容裁切。
- 1024×768、768×1024、390×844无横向溢出或面板内部滚动；390宽度实际使用底部下一步并返回。
- 启动期间下一步禁用；返回步骤1再进入时运行时继续且配置不丢失。
- 15架编号/IP映射正确；启动后全部STANDBY、未解锁、未分配任务，通信来源仍为Mock。
- 前后步骤切换不启动任务、不停止集群。
- 实例卡片与Home预览双向选择，原有阵列编辑与缩放回归通过。
- 日志展开可查看；停止取消不改变集群，确认停止后下一步重新禁用。
- 浏览器运行异常与console error均为0。

截图与逐分辨率测量：`docs/ui-verification/collaboration/startup-fill-2026-10-31/results.json`。

真实Gazebo、SITL、MAVLink与树莓派能力本轮未接入；界面显示的启动、链路与心跳仍明确为教学模拟。
