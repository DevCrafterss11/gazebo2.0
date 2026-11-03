# 实验3多任务并发调度架构设计

## 概述

实验3的五种任务（区域巡逻、目标搜索、定点监测、物资运输、应急救援）改造为真正并发执行，支持最多5个活动任务同时运行，每种任务类型最多1个运行实例。

## 核心设计原则

1. **独立运行时**：每个任务执行拥有独立的 TaskRun 实例，包含独立的状态、时钟、事件流和评价
2. **原子资源分配**：通过 DroneLease 机制管理无人机资源，支持资格检查、租赁和释放
3. **纯函数调度**：调度器使用纯函数实现，保证可测试性和可预测性
4. **空域安全**：自动检测垂直间隔冲突，支持起降错峰
5. **持久化恢复**：支持页面刷新后恢复运行状态，处理异常情况

## 架构组件

### 1. 类型定义 (`src/types/concurrentTasks.ts`)

#### TaskRun - 任务运行实例
```typescript
interface TaskRun {
  id: string;                    // 全局唯一运行ID
  groupId: string;               // 关联的 TaskGroup
  taskType: TaskType;            // 任务类型
  status: 'queued' | 'deploying' | 'running' | 'paused' | 'completing' | 'completed' | 'failed' | 'cancelled';
  lifecycle: 'pending' | 'armed' | 'airborne' | 'returning' | 'finished';
  
  leases: DroneLease[];          // 租赁的无人机资源
  plan: MissionPlan;             // 任务规划
  execution: TaskExecution;      // 执行状态
  
  // 独立时钟
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  pausedAt: number | null;
  pausedDuration: number;
  
  // 独立事件流
  events: TaskEvent[];
  
  // 结果评价
  outcome: 'success' | 'failure' | 'cancelled' | null;
  evaluation: EvaluationResult | null;
  
  // 空域分配
  altitudeBand: [number, number];
  conflictChecksum: string;
}
```

#### DroneLease - 无人机租赁
```typescript
interface DroneLease {
  droneId: string;
  runId: string;
  taskType: TaskType;
  role: string;
  
  // 资格验证
  requiredType: DroneType;
  requiredPayload: DronePayload | null;
  
  // 租赁状态
  status: 'reserved' | 'armed' | 'flying' | 'returning' | 'released';
  acquiredAt: number;
  releasedAt: number | null;
  
  batteryAtAcquire: number;
  connectionAtAcquire: 'CONNECTED' | 'DISCONNECTED' | 'STALE';
}
```

#### SchedulerState - 全局调度状态
```typescript
interface SchedulerState {
  version: number;
  timestamp: number;
  
  activeRuns: TaskRun[];         // 活动的任务运行实例
  queuedRequests: ScheduleRequest[]; // 待处理的调度请求
  archivedRuns: TaskRun[];       // 已归档的运行记录
  activeLeases: DroneLease[];    // 全局租赁表
  
  stats: {
    totalStarted: number;
    totalCompleted: number;
    totalFailed: number;
    totalCancelled: number;
    currentConcurrency: number;
    maxConcurrencySeen: number;
  };
}
```

### 2. 纯函数调度器 (`src/domain/taskScheduler.ts`)

#### 核心常量
- `MAX_CONCURRENT_TASKS = 5`：最大并发任务数
- `MAX_PER_TYPE = 1`：每种任务类型最多运行数
- `MIN_TAKEOFF_INTERVAL = 8s`：最小起飞间隔（错峰）
- `SAFE_VERTICAL_SEPARATION = 15m`：空域安全垂直间隔

#### 核心函数

**checkDroneEligibility()**
- 检查无人机是否满足任务角色要求
- 验证状态、电量、连接、类型、载荷
- 检查是否已被其他任务租赁

**detectAirspaceConflicts()**
- 检测新任务与现有任务的空域冲突
- 基于垂直间隔判断冲突严重程度
- 返回冲突描述和调整建议

**calculateTakeoffDelay()**
- 计算建议的起飞延迟时间
- 实现起降错峰，避免同时起飞

**scheduleTask()**
- 主调度函数：接受调度请求，返回调度结果
- 检查并发限制、同类型限制
- 检查空域冲突
- 验证每架飞机资格并分配租赁
- 支持全编组或部分降级启动

**releaseLease() / releaseTaskLeases()**
- 释放单架飞机或整个任务的所有租赁
- 更新租赁状态为 `released`

**getResourcePoolSnapshot()**
- 获取当前资源池状态快照
- 显示可用飞机、已租赁飞机、运行任务数

### 3. 任务运行时管理器 (`src/domain/taskRuntime.ts`)

#### 核心函数

**createTaskRun()**
- 从 TaskGroup 创建新的 TaskRun 实例
- 初始化独立时钟和事件流
- 计算高度范围和冲突校验和

**updateTaskRunClock()**
- 更新任务运行时钟
- 处理暂停时的时间计算

**pauseTaskRun() / resumeTaskRun()**
- 暂停和恢复任务执行
- 记录暂停时长，保证时钟准确性

**cancelTaskRun()**
- 取消任务运行
- 释放所有租赁资源
- 记录取消事件

**completeTaskRun()**
- 完成任务运行（成功或失败）
- 归档运行记录
- 释放所有租赁资源
- 更新统计数据

**addTaskEvent()**
- 添加任务事件到独立事件流

**canSafelyTerminate()**
- 检查任务是否可以安全终止
- 验证所有飞机已返航或落地

**releaseSingleDrone()**
- 释放单架飞机（部分降级）
- 检查是否触发任务降级

### 4. 持久化管理器 (`src/services/schedulerPersistence.ts`)

#### 核心函数

**saveSchedulerState()**
- 保存调度器状态到 localStorage
- 自动更新时间戳

**loadSchedulerState()**
- 从 localStorage 恢复调度器状态
- 版本检查、时间检查、数据完整性检查
- 超过24小时的状态视为过期

**recoverRunningTasks()**
- 页面刷新后恢复运行中的任务
- 检测超时任务并标记为失败
- 将运行中的任务恢复为暂停状态

**cleanupArchivedRuns()**
- 清理过期的归档记录
- 保留最近100条记录

**exportSchedulerState() / importSchedulerState()**
- 导出和导入调度器状态为 JSON
- 支持备份和迁移

## 工作流程

### 任务启动流程

1. 用户在任务配置界面完成规划并点击"启动任务"
2. 系统创建 `ScheduleRequest`，包含任务信息、飞机列表、角色分配、空域需求
3. 调度器执行 `scheduleTask()`：
   - 检查并发限制（最多5个活动任务）
   - 检查同类型限制（每种任务类型最多1个）
   - 检查空域冲突（垂直间隔 ≥15m）
   - 验证每架飞机资格（状态、电量、连接、类型、载荷）
   - 分配 DroneLease
4. 如果调度成功：
   - 创建 TaskRun 实例
   - 更新全局租赁表
   - 任务进入 `queued` 状态
5. 系统应用建议的起飞延迟（错峰）
6. 任务进入 `deploying` → `running` 状态
7. 独立时钟开始计时，事件流开始记录

### 任务执行流程

1. TaskRun 拥有独立的 `execution` 状态
2. 每架飞机独立推进航点：`queued` → `takeoff` → `transit` → `working` → `returning` → `done`
3. 独立时钟持续更新 `elapsedSeconds`
4. 事件实时写入独立事件流
5. 支持暂停和恢复（时钟准确计算暂停时长）

### 单机降落释放流程

1. 飞机完成任务或故障时，执行 `releaseSingleDrone()`
2. 更新租赁状态为 `released`
3. 记录释放事件
4. 检查是否触发任务降级（剩余飞机<2架）
5. 其他飞机继续执行任务

### 任务完成流程

1. 所有飞机完成航点或任务终止
2. 执行 `completeTaskRun()`：
   - 计算任务结果（success/failure）
   - 生成 EvaluationResult
   - 释放所有租赁
   - 归档运行记录
   - 更新统计数据
3. TaskRun 从 `activeRuns` 移到 `archivedRuns`
4. 资源池释放，其他排队任务可以启动

### 刷新恢复流程

1. 页面加载时调用 `loadSchedulerState()`
2. 执行 `recoverRunningTasks()`：
   - 检测超时任务（>预计时间3倍+5分钟）
   - 将超时任务标记为失败
   - 将运行中的任务恢复为暂停状态
3. 显示恢复摘要，让用户手动恢复或终止

## 并发限制策略

### 全局并发限制
- 最多5个活动任务（`deploying` 或 `running` 状态）
- 超过限制的任务进入队列，等待资源释放

### 同类型限制
- 每种任务类型最多1个运行实例
- 防止同类型任务冲突（例如两个区域巡逻任务覆盖相同区域）

### 资源独占
- 每架飞机同时只能被一个任务租赁
- 租赁状态：`reserved` → `armed` → `flying` → `returning` → `released`
- 禁止自动抢占，必须等待释放

### 起降错峰
- 最小起飞间隔：8秒
- 调度器自动计算建议延迟
- 避免多个任务同时起飞造成空域拥挤

### 空域冲突检测
- 垂直间隔 ≥15米
- 基于 `altitudeBand` 快速检测
- 冲突分级：`warning`（接近）/ `critical`（严重）
- 严重冲突拒绝调度，提供调整建议

## 前端集成指南

### Store 改造（待实现）

当前 `collaborationStore` 需要改造为多任务调度模式：

```typescript
interface CollaborationStore {
  // 调度器状态
  schedulerState: SchedulerState;
  
  // 当前查看的任务运行实例
  activeRunId: string | null;
  
  // 操作
  submitTask: (request: ScheduleRequest) => Promise<ScheduleResult>;
  pauseTask: (runId: string) => void;
  resumeTask: (runId: string) => void;
  cancelTask: (runId: string) => void;
  
  // 查询
  getActiveRuns: () => TaskRun[];
  getRunById: (runId: string) => TaskRun | null;
  getResourcePool: () => ResourcePoolSnapshot;
  
  // 持久化
  saveState: () => void;
  loadState: () => void;
  recoverAfterRefresh: () => void;
}
```

### 指挥台改造（待实现）

**多任务地图叠加**
- 同时显示所有活动任务的航线和飞机
- 每个任务使用独立颜色和图层
- 支持切换任务视图
- 支持单独控制每个任务的地图可见性

**资源管理面板**
- 显示所有无人机的租赁状态
- 显示可用飞机列表
- 显示活动租赁详情（任务、角色、状态）

**调度队列面板**
- 显示排队中的任务
- 显示拒绝原因和建议延迟
- 支持手动重试或取消排队

**任务卡片列表**
- 显示所有活动任务的卡片
- 每个卡片显示：任务名称、类型、状态、进度、飞机数、经过时间
- 支持暂停、恢复、取消操作
- 支持切换到任务详情视图

**确认收件箱**
- 显示需要人工确认的事件（例如侦察确认、结果确认）
- 支持批量确认或独立确认
- 显示等待确认的任务数量徽章

**独立操作控制**
- 每个任务卡片有独立的操作按钮
- 支持暂停/恢复、取消、查看详情
- 支持部分降级（释放单架飞机）

### UI 组件设计（待实现）

**TaskRunCard**
- 任务运行卡片，显示状态、进度、操作
- 紧凑模式：列表视图
- 详细模式：包含飞机状态、事件流

**ResourcePoolPanel**
- 资源池面板，显示飞机租赁状态
- 表格或卡片布局
- 支持筛选：可用 / 已租赁

**ScheduleQueuePanel**
- 调度队列面板，显示排队任务
- 显示拒绝原因和建议
- 支持手动操作

**TaskEventTimeline**
- 任务事件时间线
- 独立事件流展示
- 支持按级别筛选

**MultiTaskMapLayer**
- 多任务地图叠加层
- 每个任务独立图层
- 支持切换显示/隐藏

## 测试策略

### 单元测试
- 调度器纯函数：资格检查、冲突检测、延迟计算
- 运行时管理器：时钟更新、暂停恢复、取消完成
- 持久化：保存加载、恢复清理

### 集成测试
- 完整调度流程：提交 → 调度 → 执行 → 完成
- 并发场景：5个任务同时运行
- 资源竞争：多个任务竞争相同飞机
- 空域冲突：高度重叠检测
- 刷新恢复：状态持久化和恢复

### 端到端测试
- 用户启动多个任务
- 查看多任务地图叠加
- 暂停/恢复/取消操作
- 页面刷新后恢复

## 后续工作清单

### Phase 1: Store 改造
- [ ] 改造 `collaborationStore` 集成调度器
- [ ] 实现 `submitTask()` 调度流程
- [ ] 实现任务运行时钟更新
- [ ] 实现暂停/恢复/取消操作
- [ ] 集成持久化管理器

### Phase 2: UI 改造
- [ ] 创建 TaskRunCard 组件
- [ ] 创建 ResourcePoolPanel 组件
- [ ] 创建 ScheduleQueuePanel 组件
- [ ] 创建 MultiTaskMapLayer 组件
- [ ] 改造指挥台布局支持多任务视图

### Phase 3: 运行时集成
- [ ] 改造 Mock Runtime 支持多任务并发
- [ ] 实现单机降落释放逻辑
- [ ] 实现任务评价和归档
- [ ] 实现刷新恢复流程

### Phase 4: 测试验证
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 端到端测试
- [ ] 性能和稳定性测试

## 技术细节

### 冲突校验和算法
```typescript
const conflictChecksum = `${taskId}-${minAlt.toFixed(0)}-${maxAlt.toFixed(0)}`;
```
- 简单高效的冲突快速检测
- 基于任务ID和高度范围
- 后续可以扩展为更精细的空域网格

### 时钟计算
```typescript
elapsedSeconds = (now - startedAt - pausedDuration) / 1000;
```
- 准确计算经过时间，排除暂停时长
- 支持多次暂停和恢复
- 独立于浏览器 `requestAnimationFrame`

### 租赁状态机
```
reserved → armed → flying → returning → released
```
- 原子状态转换
- 不可回退（除了 released）
- 支持中途释放（降级）

### 持久化策略
- localStorage 存储，版本化
- 24小时过期
- 超时任务自动标记失败
- 恢复后暂停，让用户决定

## 性能考虑

- 调度器使用纯函数，可以在 Web Worker 中运行（可选优化）
- 冲突检测时间复杂度：O(n)，n = 活动任务数（最多5）
- 资格检查时间复杂度：O(m)，m = 飞机数（最多15）
- 持久化：仅在状态变更时保存，避免频繁写入

## 安全性

- 禁止自动抢占：任务不能强制释放其他任务的飞机
- 原子租赁：一次性分配全部资源或全部失败（可选部分降级）
- 空域隔离：强制垂直间隔，防止碰撞
- 起降错峰：避免同时起飞造成混乱

## 扩展性

- 支持自定义优先级策略（当前基于 priority 字段）
- 支持更复杂的空域网格检测（当前仅垂直间隔）
- 支持飞机动态加入和退出
- 支持跨任务协同（例如中继机共享）

## 总结

这个架构实现了实验3的真正并发多任务调度，满足以下目标：

✅ 五种任务可以同时运行（最多5个活动任务）
✅ 每种任务类型同时最多1个运行实例
✅ 独立的任务运行时（TaskRun）：独立状态、时钟、事件流
✅ 全局资源租赁（DroneLease）：原子分配、资格检查、释放
✅ 纯函数调度器：优先级排队、起降错峰、空域冲突检测
✅ 单机安全降落释放资源
✅ 多任务地图叠加支持（待实现 UI）
✅ 持久化和刷新恢复
✅ 异常处理和超时检测

当前已完成核心领域逻辑和类型定义，类型检查全部通过。后续需要集成到 Store 和 UI 层。
