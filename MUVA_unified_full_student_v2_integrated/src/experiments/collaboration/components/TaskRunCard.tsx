import { Pause, Play, Square, AlertTriangle, Clock, CheckCircle, XCircle } from 'lucide-react';
import type { TaskRun } from '../../../types/concurrentTasks';
import styles from './TaskRunCard.module.css';

interface TaskRunCardProps {
  run: TaskRun;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onCancel?: (runId: string) => void;
  onSelect?: (runId: string) => void;
  selected?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusIcon(status: TaskRun['status']) {
  switch (status) {
    case 'running': return <Play className={styles.iconRunning} size={16} />;
    case 'paused': return <Pause className={styles.iconPaused} size={16} />;
    case 'completed': return <CheckCircle className={styles.iconCompleted} size={16} />;
    case 'failed': return <XCircle className={styles.iconFailed} size={16} />;
    case 'cancelled': return <Square className={styles.iconCancelled} size={16} />;
    default: return null;
  }
}

function statusLabel(status: TaskRun['status']): string {
  const map: Record<TaskRun['status'], string> = {
    queued: '队列中',
    deploying: '部署中',
    running: '运行中',
    paused: '已暂停',
    completing: '收尾中',
    completed: '已完成',
    failed: '已失败',
    cancelled: '已取消'
  };
  return map[status] || status;
}

export function TaskRunCard({ run, onPause, onResume, onCancel, onSelect, selected }: TaskRunCardProps) {
  const isActive = run.status === 'running' || run.status === 'paused';
  const elapsed = run.elapsedSeconds;

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''} ${styles[`status-${run.status}`]}`}
      onClick={() => onSelect?.(run.id)}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          {statusIcon(run.status)}
          <span className={styles.taskType}>{run.taskType}</span>
          <span className={styles.status}>{statusLabel(run.status)}</span>
        </div>
        <div className={styles.runId}>{run.id.slice(0, 8)}</div>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <Clock size={14} />
          <span>{formatDuration(elapsed)}</span>
          {run.pausedDuration > 0 && (
            <span className={styles.pausedTime}>
              (暂停 {formatDuration(run.pausedDuration)})
            </span>
          )}
        </div>

        {run.evaluation && (
          <div className={styles.evaluation}>
            <span className={styles.score}>
              {run.evaluation.completion.toFixed(0)}%
            </span>
            <span className={styles.grade}>{run.evaluation.status}</span>
          </div>
        )}
      </div>

      <div className={styles.drones}>
        {run.leases.map(lease => (
          <span key={lease.droneId} className={styles.droneTag}>{lease.droneId}</span>
        ))}
      </div>

      {run.events.length > 0 && (
        <div className={styles.lastEvent}>
          {run.events[run.events.length - 1]!.title}
        </div>
      )}

      {isActive && (
        <div className={styles.actions}>
          {run.status === 'running' && onPause && (
            <button onClick={(e) => { e.stopPropagation(); onPause(run.id); }} className={styles.btnPause}>
              <Pause size={14} /> 暂停
            </button>
          )}
          {run.status === 'paused' && onResume && (
            <button onClick={(e) => { e.stopPropagation(); onResume(run.id); }} className={styles.btnResume}>
              <Play size={14} /> 继续
            </button>
          )}
          {onCancel && (
            <button onClick={(e) => { e.stopPropagation(); onCancel(run.id); }} className={styles.btnCancel}>
              <Square size={14} /> 取消
            </button>
          )}
        </div>
      )}

      {run.failureReason && (
        <div className={styles.failureReason}>
          <AlertTriangle size={14} />
          <span>{run.failureReason}</span>
        </div>
      )}
    </div>
  );
}
