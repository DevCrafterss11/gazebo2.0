import { useCollaborationStore } from '../../../stores/collaborationStore';
import { AlertCircle, Users } from 'lucide-react';
import styles from './ResourcePoolPanel.module.css';

export function ResourcePoolPanel() {
  const snapshot = useCollaborationStore(s => s.getResourcePoolSnapshot());
  const drones = useCollaborationStore(s => s.missionState.drones);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Users size={16} />
        <h3>资源池状态</h3>
        <span className={styles.badge}>
          {snapshot.availableDrones.length} / {snapshot.totalDrones} 可用
        </span>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.label}>活动任务</span>
          <span className={styles.value}>{snapshot.runningTasks}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>排队请求</span>
          <span className={styles.value}>{snapshot.queuedRequests}</span>
        </div>
      </div>

      <div className={styles.droneList}>
        <h4>无人机租赁状态</h4>
        {drones.map(drone => {
          const lease = snapshot.leasedDrones.find(l => l.droneId === drone.id);
          const isAvailable = snapshot.availableDrones.includes(drone.id);

          return (
            <div
              key={drone.id}
              className={`${styles.droneRow} ${lease ? styles.leased : isAvailable ? styles.available : styles.unavailable}`}
            >
              <div className={styles.droneInfo}>
                <span className={styles.droneId}>{drone.id}</span>
                <span className={styles.droneType}>{drone.droneType}</span>
              </div>

              <div className={styles.droneStatus}>
                {lease ? (
                  <>
                    <span className={styles.leasedTo}>→ {lease.runId.slice(0, 8)}</span>
                    <span className={styles.role}>{lease.role}</span>
                  </>
                ) : isAvailable ? (
                  <span className={styles.statusText}>待命 · {Math.round(drone.battery)}%</span>
                ) : (
                  <span className={styles.statusText}>
                    {drone.connectionStatus !== 'CONNECTED' ? '连接异常' :
                     drone.battery < 25 ? '电量不足' :
                     drone.instanceStatus}
                  </span>
                )}
              </div>

              {!isAvailable && !lease && (
                <AlertCircle className={styles.warningIcon} size={14} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
