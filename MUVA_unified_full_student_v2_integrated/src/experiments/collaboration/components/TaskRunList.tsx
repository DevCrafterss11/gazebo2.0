import { useCollaborationStore } from '../../../stores/collaborationStore';
import { TaskRunCard } from './TaskRunCard';
import { List, AlertCircle } from 'lucide-react';
import styles from './TaskRunList.module.css';

export function TaskRunList() {
  const activeRuns = useCollaborationStore(s => s.getActiveTaskRuns());
  const concurrentMode = useCollaborationStore(s => s.concurrentMode);
  const pauseTask = useCollaborationStore(s => s.pauseTaskRun);
  const resumeTask = useCollaborationStore(s => s.resumeTaskRun);
  const cancelTask = useCollaborationStore(s => s.cancelTaskRun);

  if (!concurrentMode) {
    return (
      <div className={styles.disabled}>
        <AlertCircle size={32} />
        <p>多任务并发模式未启用</p>
        <button onClick={() => useCollaborationStore.getState().toggleConcurrentMode()}>
          启用并发模式
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <List size={16} />
        <h3>活动任务</h3>
        <span className={styles.count}>{activeRuns.length} / 5</span>
      </div>

      {activeRuns.length === 0 ? (
        <div className={styles.empty}>
          <p>当前无活动任务</p>
          <small>通过任务配置页面提交任务到调度器</small>
        </div>
      ) : (
        <div className={styles.list}>
          {activeRuns.map(run => (
            <TaskRunCard
              key={run.id}
              run={run}
              onPause={pauseTask}
              onResume={resumeTask}
              onCancel={cancelTask}
            />
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <small>最多同时运行 5 个任务，每种类型最多 1 个</small>
      </div>
    </div>
  );
}
