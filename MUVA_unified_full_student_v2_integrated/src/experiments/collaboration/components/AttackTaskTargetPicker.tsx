import { useState } from 'react';
import type { Mission } from '../../../types/collaboration';
import styles from './AttackTaskTargetPicker.module.css';

export function AttackTaskTargetPicker({ mission, initialGroupId, selectedIds, onToggle }: {
  mission: Mission;
  initialGroupId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [groupId, setGroupId] = useState(initialGroupId);

  return <section className={styles.picker} aria-label="单项演示目标无人机">
    <h3>目标无人机</h3>
    <div className={styles.groups}>
      <button type="button" onClick={() => [...new Set(mission.groups.flatMap(g => g.drones))].filter(id => !selectedIds.includes(id)).forEach(onToggle)}>全选所有任务无人机</button>
      <button type="button" onClick={() => selectedIds.forEach(onToggle)}>清空选择</button>
    </div>
    <div className={styles.groups} aria-label="选择攻击任务">
      {mission.groups.map((group, index) => {
        const task = mission.tasks.find(item => item.id === group.taskId);
        const expanded = groupId === group.id;
        const drones = group.drones.flatMap(id => {
          const drone = mission.drones.find(item => item.id === id);
          return drone ? [drone] : [];
        });
        return <div key={group.id} className={styles.group}>
          <button type="button" className={styles.groupButton} aria-label={`选择任务 ${task?.type ?? group.name}`} aria-expanded={expanded}
            onClick={() => setGroupId(group.id)}>
            <span><i style={{ background: group.color }} />{index + 1}. {task?.type ?? group.name}</span>
            <small>{group.drones.length} 架 · 已选 {group.drones.filter(id => selectedIds.includes(id)).length}</small>
          </button>
          {expanded && <div className={styles.members}>
            {!!drones.length && <button type="button" onClick={() => drones.filter(d => !selectedIds.includes(d.id)).forEach(d => onToggle(d.id))}>全选本任务</button>}
            {drones.length ? drones.map(drone => <label key={drone.id}>
              <input type="checkbox" aria-label={`攻击目标 ${drone.id}`} checked={selectedIds.includes(drone.id)} onChange={() => onToggle(drone.id)} />
              <b>{drone.id}</b>
              <span>{group.roles[drone.id] || drone.currentRole || '编组成员'}</span>
              <small>{drone.instanceStatus === 'FLYING' ? '飞行中' : drone.instanceStatus === 'RETURNING' ? '返航中' : '未飞行'}</small>
            </label>) : <p>此任务尚未编组，请先在任务编组中添加无人机。</p>}
          </div>}
        </div>;
      })}
    </div>
    <p className={styles.selection}>已选攻击目标：{selectedIds.length ? selectedIds.join('、') : '未选择'}</p>
  </section>;
}
