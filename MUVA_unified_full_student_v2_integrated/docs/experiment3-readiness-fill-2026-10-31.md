# 实验三步骤1：内容铺满与下一步操作

## 范围与问题

仅调整步骤1“系统感知”。原界面左右面板高度不一致，内容区按内容自然收缩，导致底部大面积空白；只有顶部教学导航，没有明确的下一步按钮。

保留现有深蓝 MUVA 面板、青色选中态、公共按钮和设计 token，不调整实验一、二及实验三其他步骤的业务逻辑。不接入真实硬件。

## 本次改动

- 步骤1独立布局类使内容区填满教学工作区。左右面板等高，环境检查行和3×5节点阵列随空间适配，而非增加无意义说明卡片。
- 资源详情补充实例状态、实际任务占用、Home X/Y、阵列与行列间距；均来自统一 Store，不在页面生成模拟状态。
- 任务名称通过 `taskGroupId` 查找；`assignedTaskId` 是执行批次ID，不能误当任务组ID。
- 新增底部“下一步：集群启动”。仅当15架资源与15条IP映射完整且已选择教学模拟时可用，并明确显示尚未满足的条件。
- 下一步仅调用现有 `setStep(1)`。不会自动启动集群、解锁或执行任务；运行中返回步骤1也不会重置资源。
- 桌面不设面板内滚动条，低高度视口缩减辅助说明与装饰图标，不缩小主要操作文字。窄屏纵向排列、保留一个页面滚动面，避免用隐藏溢出裁掉内容。
- Gazebo、World、SITL、CPU/内存、树莓派网络和MAVLink真实检测仍标注“接口待接入”；模拟在线仍明确标为Mock。

## 文件

修改（相对于本次开始时的工作区）：

- `src/experiments/collaboration/SystemReadiness.tsx`
- `src/experiments/collaboration/SystemReadiness.module.css`
- `src/experiments/collaboration/CollaborationExperimentPage.tsx`：仅增加步骤1专属类名。
- `src/experiments/collaboration/Collaboration.module.css`：仅追加步骤1内容区布局规则。

新增：

- `tests/collaboration-readiness-fill-browser.cjs`
- 本文档及 `docs/ui-verification/collaboration/readiness-fill-2026-10-31/` 下的截图、测量结果。

原有未提交文件、用户文档与dump文件保留；未提交或推送。

## 验证

### 工程检查

- `npm run typecheck`：通过。
- `npm run build`：通过，已有bundle体积警告。
- `npm run test:collaboration`：32/32通过。
- `npm test`：115/120通过；既有实验二测试89–92（连续入场/返航安全间距）与104（暂停/返航覆盖缺口）失败，与本次步骤1 UI改动无关。主测试失败使串联的实验一地图测试未在该命令中执行，未宣称全量通过。
- `npm run lint`：项目未配置该脚本，无法运行lint；未新增关闭检查的配置。
- `git diff --check`：通过。

### 浏览器检查

使用已有Vite服务 `http://127.0.0.1:5175/experiments/collaboration`，Chrome + Playwright实际操作。

```bash
export PATH=/home/vip/muva/.tools/node/bin:$PATH
export PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core
node tests/collaboration-readiness-fill-browser.cjs
node tests/collaboration-readiness-browser.cjs
node tests/collaboration-compact-browser.cjs
```

三个脚本均通过，无浏览器pageerror或console.error。

新测试覆盖：

- 15个节点按钮、IP映射、单节点详情、Home坐标与实例/任务占用信息。
- 所有7个检查说明分别展开后仍不造成桌面溢出。
- 未选择模拟时下一步禁用，选择模拟后启用；IP配置异常时再次禁用。
- 下一步不启动集群或任务；手动启动后15架均待命、未解锁、未分配任务。
- 集群运行时返回步骤1正确反映状态，再点下一步不修改无人机状态。
- 2048×1152、1860×980、1860×900、1600×900、1366×768：左右面板等高，根容器scrollHeight=clientHeight，无桌面纵向滚动；底部预留2px而无大片留白。
- 1024×768、768×1024、390×844：无横向溢出和独立面板滚动，下一步可在单一页面滚动后访问并正常跳转。
- 原步骤1回归与步骤1–3回归通过，涵盖重新检查、通信映射、集群启动与确认停止。

截图：`docs/ui-verification/collaboration/readiness-fill-2026-10-31/`。

主要截图：
- `01-readiness-1860x980.png`：桌面初始状态。
- `02-simulation-selected-1366x768.png`：模拟已选、下一步可用。
- `04-revisit-running-1366x768.png`：集群运行后返回步骤1。
- `06-next-action-390.png`：窄屏底部资源详情与下一步操作。

## 使用

沿用 `npm run dev -- --host 127.0.0.1 --port 5175` 启动；本次使用现有开发服务，没有重复启动新服务。

操作：系统感知 → 进入教学模拟模式 → 下一步：集群启动 → 手动启动集群。
