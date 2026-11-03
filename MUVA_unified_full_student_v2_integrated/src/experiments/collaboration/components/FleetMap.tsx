import { GpsAttackTrace, GpsMapLayer } from './GpsMapLayer';
import { flightStateLabel } from '../../../domain/collaborationFlight';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { describeTaskRole, droneAlert, inspectTask, instanceLabels, routeSamples } from '../../../domain/collaborationMission';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import type { Position, TaskRecord } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';
import hud from './FleetMap.module.css';
import { routeColors } from './MissionWorkflow';
import { PlannedRouteLayer } from './PlannedRouteLayer';
import { insidePolygon } from '../../../domain/collaborationPlanning';
import { AircraftAttitude } from './AircraftIcon';
import { SatelliteBasemap, type MapCameraController, type MetricCamera } from './SatelliteBasemap';
import type { CollaborationBasemapMode } from '../../../domain/collaborationBasemap';
import { collaborationMapFrame, mapMetreScale, mapPixelToLocal, mapScaleBar, mapGridLines } from '../../../domain/collaborationMap';

export type FleetMapTool = 'pan' | 'point' | 'rectangle' | 'start' | 'delivery' | 'target';

/** Independent 2D basemaps and planning layers share the runtime ENU frame; no display-only aircraft offsets. */
export function FleetMap({ global = false, locked = false, snapshot, commandIcons = false, onInspectDrone, onPopupOpen, onMapToolsOpen, taskPanelOpen, editTool, frameKey, presentation = 'task', cameraRequest, locateRequest }: { global?: boolean; locked?: boolean; snapshot?: TaskRecord; commandIcons?: boolean; onInspectDrone?: (id: string) => void; onPopupOpen?: () => void; onMapToolsOpen?: () => void; taskPanelOpen?: boolean; editTool?: FleetMapTool; frameKey?: string; presentation?: 'task' | 'live'; cameraRequest?: number; locateRequest?: number }) {
  const live = useCollaborationStore();
  const s = snapshot ? { ...live, selectedTaskGroup: snapshot.groupId, missionState: { ...live.missionState, dataSource: snapshot.dataSource, mapReference: snapshot.mapReference, groups: live.missionState.groups.map((g) => g.id === snapshot.groupId ? snapshot.group : g), drones: snapshot.drones } } : live;
  const [mapSize, setMapSize] = useState({ width: 1000, height: 650 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grid, setGrid] = useState(false);
  const [basemap, setBasemap] = useState<CollaborationBasemapMode>('vector');
  const [basemapStatus, setBasemapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const satellite = basemap === 'satellite';
  const showGrid = grid || basemap === 'coordinates' || basemapStatus === 'error';
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null);
  const [trails, setTrails] = useState(true);
  const [mapPanel, setMapPanel] = useState<'tools' | 'basemap' | 'layers' | null>(null);
  const [navigationHost, setNavigationHost] = useState<HTMLDivElement | null>(null);
  const mapController = useRef<MapCameraController | null>(null);
  const userCamera = useRef(false);
  const controllerReady = useCallback((controller: MapCameraController | null) => { mapController.current = controller; }, []);
  const [areas, setAreas] = useState(true);
  const [routes, setRoutes] = useState(true);
  const [waypoints, setWaypoints] = useState(true);
  const [allWaypointNumbers, setAllWaypointNumbers] = useState(false);
  const [onlySelectedRoutes, setOnlySelectedRoutes] = useState(false);
  const [surveyTool, setSurveyTool] = useState<'measure' | 'coordinate' | null>(null);
  const openMapPanel = (next: 'tools' | 'basemap' | 'layers' | null) => { setMapPanel(next); if (next) onMapToolsOpen?.(); };
  const [surveyPoints, setSurveyPoints] = useState<{ x: number; y: number }[]>([]);
  useEffect(() => { if (taskPanelOpen) { setMapPanel(null); setSurveyTool(null); setSurveyPoints([]); } }, [taskPanelOpen]);
  const vertexDrag = useRef<number | null>(null);
  useEffect(() => { setSurveyTool(null); setSurveyPoints([]); }, [editTool, global, live.selectedTaskGroup, snapshot?.id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && (surveyTool || mapPanel)) { event.preventDefault(); event.stopPropagation(); setSurveyTool(null); setSurveyPoints([]); setMapPanel(null); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [surveyTool, mapPanel]);
  const [localTool, setTool] = useState<FleetMapTool>('pan');
  const tool = editTool ?? localTool;
  const [rectangleAnchor, setRectangleAnchor] = useState<Position | null>(null);
  const [rectangleCursor, setRectangleCursor] = useState<Position | null>(null);
  useEffect(() => { setRectangleAnchor(null); setRectangleCursor(null); }, [tool, global, locked, live.selectedTaskGroup, snapshot?.id]);
  const liveView = presentation === 'live';
  // One metric scale in every view: map drawing, tracks and telemetry cannot drift.
  const metreScale = mapMetreScale(mapSize.width, mapSize.height);
  const changeCamera = useCallback((camera: MetricCamera) => { setZoom(camera.pixelsPerMetre / metreScale); setPan(camera.pan); }, [metreScale]);
  const sceneWidth = metreScale * 200;
  const sceneHeight = metreScale * 140;
  const scaleBar = mapScaleBar(metreScale * zoom);
  const mapFrame = collaborationMapFrame(s.missionState.mapReference);
  const [popup, setPopup] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState({ left: 12, top: 12, width: 270, maxHeight: 285 });
  const [onlyMembers, setOnlyMembers] = useState(false);
  // A map-tool or task switch must not leave an old aircraft popup intercepting drawing.
  useEffect(() => { setPopup(null); }, [tool, global, s.selectedTaskGroup]);
  const container = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState({ footer: 0, hud: 75 });
  // Measure real footer/HUD heights, including wrapped actions and runtime notices.
  // Panels, scale, credits, popup and camera use the same reserved space.
  useEffect(() => {
    const stage = container.current?.closest<HTMLElement>('[data-command-stage]');
    const footer = stage?.querySelector<HTMLElement>('[data-command-bottom]');
    const measure = () => {
      const height = footer ? Math.ceil(footer.getBoundingClientRect().height) + 28 : 0;
      const info = Math.ceil(hudRef.current?.getBoundingClientRect().height ?? 75);
      stage?.style.setProperty('--map-footer-height', `${height}px`);
      stage?.style.setProperty('--map-hud-height', `${info}px`);
      setInsets(previous => previous.footer === height && previous.hud === info ? previous : { footer: height, hud: info });
    };
    const observer = new ResizeObserver(measure);
    if (footer) observer.observe(footer);
    if (hudRef.current) observer.observe(hudRef.current);
    measure();
    return () => { observer.disconnect(); stage?.style.removeProperty('--map-footer-height'); stage?.style.removeProperty('--map-hud-height'); };
  }, []);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const lastSelected = useRef(s.selectedDrone);
  const group = s.missionState.groups.find((g) => g.id === s.selectedTaskGroup)!;
  const drones = s.missionState.drones;
  // Marker centers are exactly the supplied telemetry positions, even when colocated.
  const visibleDrones = drones.filter((d) => d.visibleOnMap && (global || !onlyMembers || group.drones.includes(d.id)));
  // Abbreviate labels in dense screen space; never move telemetry positions to separate symbols.
  const markerGaps = new Map(visibleDrones.map(d => [d.id, Math.min(...visibleDrones.filter(other => other.id !== d.id).map(other => Math.hypot(other.position.x-d.position.x, other.position.y-d.position.y)*metreScale*zoom))]));
  const details = drones.find((d) => d.id === popup);
  const selected = visibleDrones.find(d => d.id === s.selectedDrone);
  const nearest = selected ? visibleDrones.filter(d => d.id !== selected.id).sort((a, b) => Math.hypot(a.position.x - selected.position.x, a.position.y - selected.position.y) - Math.hypot(b.position.x - selected.position.x, b.position.y - selected.position.y))[0] : undefined;
  const nearDistance = selected && nearest ? Math.hypot(selected.position.x - nearest.position.x, selected.position.y - nearest.position.y) : null;
  const screenPoint = (p: { x: number; y: number }) => ({ x: mapSize.width / 2 + pan.x + p.x * metreScale * zoom, y: mapSize.height / 2 + pan.y - p.y * metreScale * zoom });
  const groups = (global ? s.activeGroupId ? s.missionState.groups.filter((g) => g.id === s.activeGroupId) : liveView && s.records.at(-1) ? [s.records.at(-1)!.group] : [] : [group]).filter((g) => g.points.length > 0);
  // Planned route, coverage region and flown trace must share one colour per aircraft: region index first, route index as fallback.
  const droneColor = (droneId: string): string => {
    for (const g of groups) {
      const region = g.plan?.regions?.findIndex(item => item.droneId === droneId) ?? -1;
      const route = g.plan?.routes.findIndex(item => item.droneId === droneId) ?? -1;
      const index = region >= 0 ? region : route;
      if (index >= 0) return routeColors[index % routeColors.length]!;
    }
    return routeColors[0]!;
  };
  const groupIndex = s.missionState.groups.findIndex(g => g.id === group.id);
  const isArea = [0, 1].includes(groupIndex);
  const region = group.points.filter(p => p.kind === 'point');
  const geometryWarning = !global && isArea && region.length > 2 ? inspectTask(s.missionState, group).geometry.find(message => message.includes('不能重合')) : undefined;
  const area = isArea && region.length > 2 ? Math.abs(region.reduce((sum, p, i) => { const next = region[(i + 1) % region.length]!; return sum + p.x * next.y - next.x * p.y; }, 0)) / 2 : null;
  const fromPointer = (clientX: number, clientY: number) => {
    const rect = container.current!.getBoundingClientRect();
    return mapPixelToLocal({ x: clientX - rect.left, y: clientY - rect.top }, { width: rect.width, height: rect.height }, pan, zoom);
  };
  const moveVertex = (index: number, clientX: number, clientY: number) => {
    if (global || locked) return;
    const p = group.points[index];
    if (!p) return;
    const point = fromPointer(clientX, clientY);
    s.updateMapPoint(index, { ...p, x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 });
  };
  const points = groups.flatMap((g) => routeSamples(g, s.missionState.groups.findIndex(item => item.id === g.id)));
  const focusFrame = () => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, width: 200, height: 140 };
    let left = 35, right = rect.width - 75, top = commandIcons ? 115 : 35, bottom = rect.height - insets.footer - insets.hud - 66;
    const stage = container.current?.closest('[data-command-stage]');
    if (stage) {
      const leftPanel = stage.querySelector('[data-map-obstruction="left"]')?.getBoundingClientRect();
      const rightPanel = stage.querySelector('[data-map-obstruction="right"]')?.getBoundingClientRect();
      if (leftPanel) left = leftPanel.right - rect.left + 30;
      if (rightPanel) right = rightPanel.left - rect.left - 30;
      stage.querySelectorAll('[data-map-top]').forEach(element => { top = Math.max(top, element.getBoundingClientRect().bottom - rect.top + 12); });
      const controls = stage.querySelector('[data-command-bottom]')?.getBoundingClientRect();
      if (controls) bottom = Math.min(bottom, controls.top - rect.top - insets.hud - 41);
      if (right - left < 180) { left = 35; right = rect.width - 75; }
    }
    return { x: (left + right - rect.width) / 2, y: (top + bottom - rect.height) / 2, width: Math.max(150, right - left), height: Math.max(80, bottom - top) };
  };
  const fit = () => {
    userCamera.current = false;
    const rect = container.current?.getBoundingClientRect(); if (!rect) return;
    const all = [...drones.filter((d) => d.visibleOnMap).map((d) => d.position), ...points];
    if (!all.length) return;
    const frame = focusFrame();
    const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
    const scaleX = mapMetreScale(rect.width, rect.height);
    const scaleY = scaleX;
    const z = Math.min(18 / scaleX, frame.width / scaleX / Math.max(30, maxX - minX + 12), frame.height / scaleY / Math.max(20, maxY - minY + 12));
    setZoom(z); setPan({ x: frame.x - (minX + maxX) / 2 * scaleX * z, y: frame.y + (minY + maxY) / 2 * scaleY * z });
  };
  useEffect(() => { fitRef.current(); }, [frameKey, snapshot?.id]);
  useEffect(() => { setOnlyMembers(false); setPopup(null); }, [global, s.selectedTaskGroup, snapshot?.id]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => { if (!userCamera.current) fitRef.current(); }, [insets.footer, insets.hud]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { setMapSize({ width: element.clientWidth, height: element.clientHeight }); });
    observer.observe(element);
    const preventPageScroll = (event: WheelEvent) => { if (!(event.target as Element).closest('[data-popup]')) event.preventDefault(); };
    element.addEventListener('wheel', preventPageScroll, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', preventPageScroll); };
  }, []);
  // Refit after React applies the measured size; do not race the map engine resize observer.
  useEffect(() => { fitRef.current(); }, [mapSize.width, mapSize.height, group.plan?.id]);
  useEffect(() => { if (cameraRequest !== undefined) fitRef.current(); }, [cameraRequest]);
  const locate = (id: string) => { const d = drones.find((item) => item.id === id), rect = container.current?.getBoundingClientRect(); if (!d || !rect) return; const frame = focusFrame(); const scaleX = mapMetreScale(rect.width, rect.height); const scaleY = scaleX; setPan({ x: frame.x - d.position.x * scaleX * zoom, y: frame.y + d.position.y * scaleY * zoom }); };
  useEffect(() => { if (s.selectedDrone !== lastSelected.current && s.selectedDrone) { locate(s.selectedDrone); lastSelected.current = s.selectedDrone; } });
  useEffect(() => { if (locateRequest && s.selectedDrone) locate(s.selectedDrone); }, [locateRequest]);
  const positionPopup = (marker: HTMLButtonElement) => {
    const map = container.current?.getBoundingClientRect();
    if (map) {
      const pin = marker.getBoundingClientRect();
      const frame = focusFrame();
      const gap = 12;
      const minX = Math.max(gap, map.width / 2 + frame.x - frame.width / 2);
      const maxX = Math.min(map.width - 60, map.width / 2 + frame.x + frame.width / 2);
      const width = Math.min(270, maxX - minX);
      const preferred = pin.right - map.left + gap;
      const left = Math.max(minX, Math.min(maxX - width, preferred));
      let minY = gap;
      container.current?.closest('[data-command-stage]')?.querySelectorAll('[data-map-top]').forEach(element => {
        const rect = element.getBoundingClientRect();
        if (rect.right > map.left + left && rect.left < map.left + left + width) minY = Math.max(minY, rect.bottom - map.top + gap);
      });
      const bottom = map.height - insets.footer - insets.hud - 28 - gap;
      const height = Math.max(60, Math.min(285, bottom - minY));
      const top = Math.max(minY, Math.min(bottom - height, pin.top - map.top));
      setPopupPosition({ width, left, top, maxHeight: Math.max(60, bottom - top) });
    }
  };
  const openPopup = (id: string, marker: HTMLButtonElement) => { onPopupOpen?.(); positionPopup(marker); setPopup(id); };
  useEffect(() => {
    const marker = popup ? container.current?.querySelector<HTMLButtonElement>(`[data-testid="marker-${popup}"]`) : null;
    if (marker) positionPopup(marker);
  }, [popup, pan.x, pan.y, zoom, insets.footer, insets.hud, mapSize.width, mapSize.height, frameKey]);
  const requestReturn = (id: string) => { if (window.confirm(`确认让 ${id} 单独模拟返航？其他无人机不会自动终止，关键角色退出可能需要降级处置。`)) s.returnDrone(id); };
  return <div className={styles.fleetMapBlock}>
    <div ref={container} data-testid="fleet-map" className={`${styles.mapCanvas} ${hud.canvas}`} data-presentation={commandIcons ? presentation : 'fleet'} data-layer={basemap} style={{ cursor: surveyTool || !locked && tool !== 'pan' ? 'crosshair' : 'grab' }}
      onWheel={(e) => { if ((e.target as Element).closest('[data-popup], [data-map-hud], [data-map-controls]')) return; userCamera.current = true; setPopup(null); const rect = e.currentTarget.getBoundingClientRect(); mapController.current?.zoomBy(Math.max(-1, Math.min(1, -e.deltaY / 300)), { x: e.clientX - rect.left, y: e.clientY - rect.top }); }}
      onPointerDown={(e) => { if ((e.target as Element).closest('button, input, select, [data-popup], [data-map-hud], [data-map-controls]')) return; userCamera.current = true; mapController.current?.stop(); setPopup(null); const rect = e.currentTarget.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); if (!rect.width) drag.current = null; }}
      onPointerMove={(e) => { if (tool === 'rectangle' && rectangleAnchor) setRectangleCursor({ ...fromPointer(e.clientX, e.clientY), z: group.config.altitude }); const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.hypot(dx, dy) > 5) d.moved = true; if (d.moved) setPan({ x: d.px + dx, y: d.py + dy }); }}
      onPointerUp={(e) => {
        const d = drag.current; drag.current = null;
        if (!d || d.moved) return;
        const point = fromPointer(e.clientX, e.clientY);
        if (surveyTool) { setSurveyPoints(previous => surveyTool === 'coordinate' || previous.length === 2 ? [point] : [...previous, point]); return; }
        if (global || locked || tool === 'pan') return;
        if (tool === 'rectangle') {
          const corner = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10, z: group.config.altitude };
          if (!rectangleAnchor) { setRectangleAnchor(corner); setRectangleCursor(corner); }
          else if (s.setRectangleArea({ ...rectangleAnchor, kind: 'point' }, { ...corner, kind: 'point' })) { setRectangleAnchor(null); setRectangleCursor(null); }
          return;
        }
        if (tool === 'target') { s.setSearchTarget({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }); return; }
        s.addMapPoint({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10, z: group.config.altitude, kind: tool });
      }} onPointerCancel={() => { drag.current = null; }}>
      <SatelliteBasemap navigationHost={navigationHost} onCameraChange={changeCamera} onControllerReady={controllerReady} reference={s.missionState.mapReference} pan={pan} pixelsPerMetre={metreScale * zoom} mode={basemap} statusHost={statusHost} onShowCoordinates={() => setBasemap('coordinates')} onStatusChange={setBasemapStatus} />
      {showGrid && <svg data-testid="coordinate-grid" className={hud.grid} width={mapSize.width} height={mapSize.height} aria-label="ENU 米制坐标网格">
        {mapGridLines(mapSize, pan, metreScale * zoom).map(line => line.axis === 'E' ? <g key={`E${line.value}`}><line x1={line.pixel} x2={line.pixel} y1="0" y2={mapSize.height} data-origin={line.value === 0} /><text x={line.pixel + 4} y={Math.max(130, mapSize.height - insets.footer - insets.hud - 40)}>E {line.value} m</text></g> : <g key={`N${line.value}`}><line y1={line.pixel} y2={line.pixel} x1="0" x2={mapSize.width} data-origin={line.value === 0} /><text x={mapSize.width - 145} y={line.pixel - 5}>N {line.value} m</text></g>)}
      </svg>}
      <div className={styles.mapScene} style={{ width: sceneWidth, height: sceneHeight, left: (mapSize.width - sceneWidth) / 2, top: (mapSize.height - sceneHeight) / 2, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className={styles.routes} viewBox="-100 -70 200 140" preserveAspectRatio="none" aria-label="任务计划航线及实际轨迹">
          {rectangleAnchor && rectangleCursor && <rect data-rectangle-preview="true" x={Math.min(rectangleAnchor.x,rectangleCursor.x)} y={-Math.max(rectangleAnchor.y,rectangleCursor.y)} width={Math.abs(rectangleAnchor.x-rectangleCursor.x)} height={Math.abs(rectangleAnchor.y-rectangleCursor.y)} fill="#51cfca" fillOpacity=".14" stroke="#73eece" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
          {groups.map((g) => <g key={g.id}>
            {areas && [0, 1].includes(s.missionState.groups.findIndex(item => item.id === g.id)) && g.points.filter(p => p.kind === 'point').length > 2 && <polygon points={g.points.filter((p) => p.kind === 'point').map((p) => `${p.x},${-p.y}`).join(' ')} fill={g.color} fillOpacity={g.areaClosed ? '.15' : '.06'} stroke={g.color} strokeWidth="1.5" strokeDasharray={g.areaClosed ? undefined : '5 4'} vectorEffect="non-scaling-stroke" />}
            {areas && g.plan?.regions?.map((r,i) => {
              const route = g.plan!.routes.find(item => item.droneId === r.droneId);
              const center = { x:r.polygon.reduce((sum,p)=>sum+p.x,0)/r.polygon.length, y:r.polygon.reduce((sum,p)=>sum+p.y,0)/r.polygon.length, z:r.polygon[0]!.z };
              // Keep the region caption near the left edge of its band: aircraft at Home
              // and dense scan rows tend to occupy the centre of the map.
              const left = Math.min(...r.polygon.map(p => p.x));
              const right = Math.max(...r.polygon.map(p => p.x));
              const inset = Math.min(60 / (metreScale * zoom), (right - left) * .42);
              const labelPoint = { ...center, x: left + inset };
              const anchor = insidePolygon(labelPoint, r.polygon) ? labelPoint : insidePolygon(center, r.polygon) ? center : route?.waypoints[Math.min(route.workStart + Math.floor((route.waypoints.length-route.workStart)/2),route.waypoints.length-1)];
              const selected = s.selectedDrone === r.droneId;
              const visible = !onlySelectedRoutes || selected || !g.plan!.routes.some(item=>item.droneId===s.selectedDrone);
              return <g key={r.droneId} data-coverage-region={r.name} data-region-drone={r.droneId} opacity={visible ? 1 : .16}>
                <polygon points={r.polygon.map(p=>`${p.x},${-p.y}`).join(' ')} fill={routeColors[i%routeColors.length]} fillOpacity={selected ? .27 : .16} stroke={routeColors[i%routeColors.length]} strokeWidth={selected ? 2 : 1.4} vectorEffect="non-scaling-stroke"><title>{r.name} · {r.droneId} · {r.area.toFixed(1)} m²</title></polygon>
                {anchor && (selected || g.plan!.regions!.length <= 6) && visible && <g transform={`translate(${anchor.x},${-anchor.y})`} pointerEvents="none">
                  <rect x={-34/(metreScale*zoom)} y={-18/(metreScale*zoom)} width={68/(metreScale*zoom)} height={36/(metreScale*zoom)} rx={4/(metreScale*zoom)} fill="#082635" fillOpacity=".91" stroke={routeColors[i%routeColors.length]} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
                  <text y={-3/(metreScale*zoom)} fontSize={11/(metreScale*zoom)} textAnchor="middle" fontWeight="bold" fill={routeColors[i%routeColors.length]}>{r.name} · {r.droneId}</text>
                  <text y={12/(metreScale*zoom)} fontSize={10/(metreScale*zoom)} textAnchor="middle" fill="#dce9ed">{r.area.toFixed(0)} m²</text>
                </g>}
              </g>;
            })}
            {(routes || waypoints) && g.plan?.routes.map((r,i) => {
              const regionIndex = g.plan?.regions?.findIndex(region=>region.droneId===r.droneId) ?? -1;
              const color = routeColors[(regionIndex >= 0 ? regionIndex : i) % routeColors.length]!, selected = r.droneId === s.selectedDrone;
              const focused = g.plan!.routes.some(route => route.droneId === s.selectedDrone);
              const workCount = r.waypoints.length - r.workStart;
              // Selected or 'all numbers': thin out long routes; otherwise number short routes fully and long ones only at both ends.
              const labelEvery = selected || allWaypointNumbers ? Math.max(1, Math.ceil(workCount / (allWaypointNumbers ? 18 : 30))) : workCount <= 12 ? 1 : Number.MAX_SAFE_INTEGER;
              return <PlannedRouteLayer key={r.droneId} route={r} color={color} selected={selected} unit={1 / (metreScale * zoom)} showRoute={routes} showPoints={waypoints} labelEvery={labelEvery}
                opacity={onlySelectedRoutes && focused && !selected ? .12 : focused && !selected ? .6 : 1} />;
            })}
            {g.taskId==='task-2' && g.plan?.routes.filter(r=>r.role==='中继机').map(r=>{const point=r.waypoints.at(-1)!;return <g key={`relay-${r.droneId}`} data-relay-station={r.droneId} aria-label={`${r.droneId} 自动规划中继点`} transform={`translate(${point.x},${-point.y})`} pointerEvents="none"><circle r={10/(metreScale*zoom)} fill="#173b64" fillOpacity=".65" stroke="#91c8ff" strokeWidth="2" vectorEffect="non-scaling-stroke"/><circle r={3/(metreScale*zoom)} fill="#c4e3ff"/><text x={12/(metreScale*zoom)} y={-10/(metreScale*zoom)} fontSize={11/(metreScale*zoom)} fontWeight="bold" fill="#e4f3ff" stroke="#102631" strokeWidth={3/(metreScale*zoom)} paintOrder="stroke">中继点 · {r.droneId}</text><title>生成航线时自动规划 · 驻留到任务收尾 · 非真实通信覆盖</title></g>})}
            {(g.plan?.searchTarget ?? (g.taskId==='task-2' && g.config.targetEast!==undefined && g.config.targetNorth!==undefined ? {x:g.config.targetEast,y:g.config.targetNorth} : undefined)) && <g data-search-target="true" aria-label="演练搜索目标" transform={`translate(${g.plan?.searchTarget?.x ?? g.config.targetEast},${-(g.plan?.searchTarget?.y ?? g.config.targetNorth!)})`}><circle r={8/(metreScale*zoom)} fill="#f3c26d" fillOpacity=".25" stroke="#ffe2a2" strokeWidth="2" vectorEffect="non-scaling-stroke"/><circle r={2/(metreScale*zoom)} fill="#ffce79"/><text x={11/(metreScale*zoom)} y={-9/(metreScale*zoom)} fontSize={11/(metreScale*zoom)} fontWeight="bold" fill="#fff0c3" stroke="#102631" strokeWidth={3/(metreScale*zoom)} paintOrder="stroke" pointerEvents="none">模拟目标</text><title>演练目标点 · 非摄像头识别</title></g>}
          </g>)}
          {routes && global && drones.filter(d => d.visibleOnMap && d.flightControl?.route.length).map(d => <g key={`manual-${d.id}`} data-manual-route={d.id}>
            <polyline points={[d.homePosition,...d.flightControl!.route].map(p => `${p.x},${-p.y}`).join(' ')} fill="none" stroke="#1687c8" strokeWidth="2" strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />
            {waypoints && d.flightControl!.route.map((p,i) => <circle key={i} cx={p.x} cy={-p.y} r=".35" fill="#eaf7ff" stroke="#1687c8" strokeWidth="1.5" vectorEffect="non-scaling-stroke"><title>{d.id} 航点 {i+1} · {p.z} m</title></circle>)}
          </g>)}
          {trails && drones.filter((d) => d.visibleOnMap && (global || group.drones.includes(d.id) && (!!snapshot || !!group.runId))).map((d) => <g key={d.id} data-testid={`trace-${d.id}`}><polyline points={d.trajectory.map((p) => `${p.x},${-p.y}`).join(' ')} fill="none" stroke="#041a26" strokeOpacity=".85" strokeWidth={s.selectedDrone === d.id ? 8 : 6.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /><polyline points={d.trajectory.map((p) => `${p.x},${-p.y}`).join(' ')} fill="none" stroke={droneColor(d.id)} strokeWidth={s.selectedDrone === d.id ? 5 : 4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /><polyline points={d.returnTrajectory.map((p) => `${p.x},${-p.y}`).join(' ')} fill="none" stroke="#041a26" strokeOpacity=".85" strokeWidth="6.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" /><polyline points={d.returnTrajectory.map((p) => `${p.x},${-p.y}`).join(' ')} fill="none" stroke="#ffbc66" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />{d.instanceStatus === 'RETURNING' && <line x1={d.position.x} y1={-d.position.y} x2={d.homePosition.x} y2={-d.homePosition.y} stroke="#ffbc66" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />}</g>)}

          {trails && visibleDrones.map(d => <GpsAttackTrace key={`gps-trace-${d.id}`} drone={d} selected={s.selectedDrone === d.id} />)}
          <GpsMapLayer drones={visibleDrones} scale={metreScale * zoom} selectedId={s.selectedDrone} />
        </svg>

        {!global && waypoints && group.points.map((p, i) => <button type="button" key={i} className={hud.vertex} aria-label={`地图顶点${i + 1}`} title={locked ? '任务点位（只读）' : '拖动调整点位；方向键微调 1m，Shift + 方向键 5m'} disabled={locked} style={{ transform: `translate(-50%, -50%) scale(${1 / zoom})`, left: `${50 + p.x / 2}%`, top: `${50 - p.y / 1.4}%` }}
          onPointerDown={e => { e.stopPropagation(); if (surveyTool) return; vertexDrag.current = i; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { e.stopPropagation(); if (vertexDrag.current === i) moveVertex(i, e.clientX, e.clientY); }}
          onPointerUp={e => { e.stopPropagation(); if (vertexDrag.current === i) moveVertex(i, e.clientX, e.clientY); vertexDrag.current = null; }} onPointerCancel={() => { vertexDrag.current = null; }}
          onKeyDown={e => { const step = e.shiftKey ? 5 : 1; const offset = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]; if (offset && !locked) { e.preventDefault(); e.stopPropagation(); s.updateMapPoint(i, { ...p, x: p.x + offset[0]!, y: p.y + offset[1]! }); } }}
        >{p.kind === 'start' ? 'S' : p.kind === 'delivery' ? 'D' : i + 1}</button>)}
      </div>
      {surveyPoints.length > 0 && <svg className={hud.surveyDrawing} width={mapSize.width} height={mapSize.height} aria-label="地图测量标记">
        {surveyPoints.map((p, i) => <circle key={i} cx={screenPoint(p).x} cy={screenPoint(p).y} r="5" />)}
        {surveyPoints.length === 2 && <line x1={screenPoint(surveyPoints[0]!).x} y1={screenPoint(surveyPoints[0]!).y} x2={screenPoint(surveyPoints[1]!).x} y2={screenPoint(surveyPoints[1]!).y} />}
      </svg>}
      {surveyTool && <section className={hud.surveyInfo} data-map-controls aria-label="地图测量结果"><header><b>{surveyTool === 'measure' ? '两点测距 · 水平距离' : '坐标拾取 · WGS84 / ENU'}</b><button type="button" aria-label="退出地图测量" onClick={() => { setSurveyTool(null); setSurveyPoints([]); }}><X size={15} /></button></header>
        {surveyTool === 'measure' ? <><p>{surveyPoints.length === 2 ? <strong>{Math.hypot(surveyPoints[1]!.x - surveyPoints[0]!.x, surveyPoints[1]!.y - surveyPoints[0]!.y).toFixed(2)} m</strong> : surveyPoints.length ? '已选起点，请点击终点' : '依次点击地图上的两个位置'}</p><small>第三次点击开始新测量 · Esc 退出</small></> : <><p>{surveyPoints[0] ? mapFrame.toGeo(surveyPoints[0]).map(v => v.toFixed(7) + '°').join(', ') : '点击地图拾取经纬度'}</p>{surveyPoints[0] && <p>E {surveyPoints[0].x.toFixed(2)} / N {surveyPoints[0].y.toFixed(2)} m</p>}<small>仅拾取位置，不改变任务点位 · Esc 退出</small></>}
      </section>}
      {selected && nearest && nearDistance !== null && <svg className={hud.measurement} width={mapSize.width} height={mapSize.height} aria-label="选中无人机近邻水平间距" data-distance-metres={nearDistance}>
        <line x1={screenPoint(selected.position).x} y1={screenPoint(selected.position).y} x2={screenPoint(nearest.position).x} y2={screenPoint(nearest.position).y} />
        <text x={(screenPoint(selected.position).x + screenPoint(nearest.position).x) / 2} y={(screenPoint(selected.position).y + screenPoint(nearest.position).y) / 2 - 12} textAnchor="middle">{nearDistance.toFixed(1)} m</text>
      </svg>}
      {/* Screen-space symbols keep a constant footprint; their centers are the exact ENU projection. */}
      {visibleDrones.map((d) => <button key={d.id} data-testid={`marker-${d.id}`} data-label-density={(markerGaps.get(d.id)??Infinity)<48?'minimal':(markerGaps.get(d.id)??Infinity)<58?'compact':'full'} data-local-x={d.position.x} data-local-y={d.position.y} data-longitude={mapFrame.toGeo(d.position)[0]} data-latitude={mapFrame.toGeo(d.position)[1]} data-heading={d.attitude[2]} data-roll={d.attitude[0]} data-pitch={d.attitude[1]} data-armed={d.armed} data-ground-speed={Math.hypot(d.velocity.x, d.velocity.y)} type="button" aria-label={`${d.id} ${d.instanceStatus}`} aria-pressed={d.id === s.selectedDrone} title={`${d.id} · ${droneAlert(d) || flightStateLabel(d)} · ${d.mode} · ${Math.round(d.battery)}%`} className={hud.aircraft} style={{ pointerEvents: !global && !locked && tool !== 'pan' ? 'none' : 'auto', zIndex: d.id === s.selectedDrone ? 4 : d.armed ? 3 : 2, left: mapSize.width / 2 + pan.x + d.position.x * metreScale * zoom, top: mapSize.height / 2 + pan.y - d.position.y * metreScale * zoom, '--aircraft-color': d.instanceStatus === 'RETURNING' ? '#dd790e' : d.instanceStatus === 'FAULT' || d.battery < 20 ? '#d12c3e' : d.connectionStatus !== 'CONNECTED' ? '#657888' : d.instanceStatus === 'FLYING' ? '#007f79' : '#176d9c' } as React.CSSProperties} onFocus={(e) => openPopup(d.id, e.currentTarget)} onClick={(e) => { e.stopPropagation(); lastSelected.current = d.id; s.selectDrone(d.id); openPopup(d.id, e.currentTarget); }}><span className={hud.airframe}><AircraftAttitude attitude={d.attitude} armed={d.armed} /></span><b>{d.id !== s.selectedDrone && (markerGaps.get(d.id)??Infinity)<58?d.id.replace(/^uav/,''):d.id}</b><small aria-hidden="true" data-state={d.instanceStatus} />{d.armed && <em>{(d.position.z - d.homePosition.z).toFixed(1)} m</em>}</button>)}
      <nav onClickCapture={(e) => { if ((e.target as Element).closest('[data-native-navigation]')) { userCamera.current = true; setPopup(null); } }} data-map-controls="true" className={hud.tools} aria-label="地图导航工具">
        <div ref={setNavigationHost} className={hud.nativeNavigation} data-native-navigation />
        <div className={hud.mapShortcuts}>
          <button title="定位选中无人机" type="button" disabled={!s.selectedDrone} onClick={() => { setPopup(null); if (s.selectedDrone) locate(s.selectedDrone); }}>定位</button>
          <button title="自动适配视野" aria-label="全机视野" type="button" onClick={() => { setPopup(null); fit(); }}>全机</button>
          <button title="地图工具" type="button" aria-expanded={mapPanel !== null} onClick={() => openMapPanel(mapPanel ? null : 'tools')}>工具</button>
        </div>
      </nav>
      {mapPanel && <section data-map-controls className={hud.layerPanel} aria-label={mapPanel === 'tools' ? '地图工具面板' : mapPanel === 'basemap' ? '地图底图切换面板' : '地图图层管理面板'}><header><b>{mapPanel === 'tools' ? '地图工具' : mapPanel === 'basemap' ? '二维底图' : '地图图层'}</b><button type="button" aria-label="关闭地图管理面板" onClick={() => setMapPanel(null)}><X size={15} /></button></header>
        {mapPanel === 'tools' ? <><p className={hud.toolHint}>视野与缩放使用右侧原生地图控件</p><div className={hud.toolOptions}>
          <button title="底图切换" type="button" onClick={() => openMapPanel('basemap')}>切换底图 <span>矢量 / 卫星 / 坐标</span></button>
          <button title="地图图层管理" type="button" onClick={() => openMapPanel('layers')}>显示图层 <span>区域 / 航线 / 轨迹</span></button>
          <button title="两点测距" type="button" aria-pressed={surveyTool === 'measure'} onClick={() => { onMapToolsOpen?.(); setMapPanel(null); setSurveyTool('measure'); setSurveyPoints([]); }}>两点测距 <span>水平距离 · 米</span></button>
          <button title="坐标拾取" type="button" aria-pressed={surveyTool === 'coordinate'} onClick={() => { onMapToolsOpen?.(); setMapPanel(null); setSurveyTool('coordinate'); setSurveyPoints([]); }}>坐标拾取 <span>WGS84 / ENU</span></button>
          <button title="切换轨迹" type="button" aria-pressed={trails} onClick={() => setTrails(!trails)}>实际轨迹 <span>{trails ? '已显示' : '已隐藏'}</span></button>
          <button title="切换网格" type="button" aria-pressed={grid} onClick={() => setGrid(!grid)}>米制网格 <span>{grid ? '已显示' : '已隐藏'}</span></button>
        </div><small>滚轮以指针位置为中心缩放 · Esc 关闭</small></> : mapPanel === 'basemap' ? <>{([['vector', '高清矢量', '道路、建筑轮廓 · 任意缩放清晰'], ['satellite', '卫星影像', '真实影像参考 · 最大原生 19 级'], ['coordinates', '米制坐标', '离线可用 · 精确相对定位']] as const).map(([mode, label, hint]) => <button className={hud.basemapOption} type="button" key={mode} aria-pressed={basemap === mode} onClick={() => setBasemap(mode)}><b>{label}</b><small>{hint}</small></button>)}</> : <>{[{ label: '任务区域填充', value: areas, set: setAreas }, { label: '计划航线', value: routes, set: setRoutes }, { label: '仅突出选中分机', value: onlySelectedRoutes, set: setOnlySelectedRoutes }, { label: '全部作业航点编号', value: allWaypointNumbers, set: setAllWaypointNumbers }, { label: '航点与顶点', value: waypoints, set: setWaypoints }, { label: '实际 / 返航轨迹', value: trails, set: setTrails }, { label: 'ENU 米制网格', value: grid, set: setGrid }].map(item => <label key={item.label}><input type="checkbox" checked={item.value} onChange={e => item.set(e.target.checked)} />{item.label}</label>)}<small>坐标底图或底图加载失败时自动保留网格。</small></>}
      </section>}
      <div ref={hudRef} data-map-hud="true" className={hud.info} style={{ bottom: insets.footer + 28 }}>
        <div ref={setStatusHost} />
        <div data-map-status="true" className={hud.status}>
          <span>{s.missionState.dataSource} 模拟遥测 · ENU 米制定位 · N ↑</span>
          <select aria-label="地图底图" value={basemap} onChange={e => setBasemap(e.target.value as CollaborationBasemapMode)}><option value="vector">高清二维矢量地图</option><option value="satellite">二维卫星地图</option><option value="coordinates">ENU 坐标图层</option></select>
          {satellite && mapFrame.camera(pan, metreScale * zoom).zoom > 19 && <small>影像原生最高 19 级；继续放大不增加影像细节</small>}
          {!global && !locked && editTool === undefined && <select aria-label="地图编辑工具" value={tool} onChange={e => { setTool(e.target.value as FleetMapTool); setPopup(null); }}><option value="pan">平移 / 选择</option><option value="point">绘制区域 / 添加航点</option>{['task-1', 'task-2'].includes(group.taskId) && <option value="rectangle">两点绘制矩形</option>}{group.taskId==='task-2'&&<option value="target">拾取演练目标点</option>}<option value="start">设置起点 / 装载点</option><option value="delivery">设置交付 / 救援目标</option></select>}
          {!global && group.points.length > 0 && <span data-region-area={area ?? undefined}>{area !== null ? `水平面积 ${area.toFixed(1)} m²` : `${group.points.length} 个任务点`}{!locked && ' · 拖动顶点编辑'}</span>}
          {geometryWarning && <small role="alert">{geometryWarning}</small>}
          {!global && <label><input type="checkbox" checked={onlyMembers} onChange={e => setOnlyMembers(e.target.checked)} />仅当前任务成员</label>}
        </div>
        <div className={hud.footer}>
          <div className={hud.scale} data-map-scale="true"><b style={{ width: scaleBar.pixels }}>{scaleBar.metres >= 1000 ? `${scaleBar.metres / 1000} km` : `${scaleBar.metres} m`}</b><span>WGS84 / ENU</span><span aria-label="当前地图级别">z {mapFrame.camera(pan, metreScale * zoom).zoom.toFixed(1)}</span></div>
          <span data-map-legend="true" className={hud.legend}>{group.plan?.regions?.length ? `${group.plan.regions.length} 区 / ${group.plan.routes.length} 机 · 色块：等面积分区 · ` : ''}细实线 + 箭头：计划作业航线 · 同色虚线：入场（Home → 作业起点） · 橙色虚线：计划返航 · 粗实线：已飞轨迹 · 粗橙线：实际返航 · 红线：GPS攻击期间实际轨迹 · 橙色空心点：欺骗定位（选中无人机查看偏移）</span>
        </div>
      </div>
      {details && <div className={styles.dronePopover} style={popupPosition} data-popup="true" role="region" aria-label={`${details.id}操作面板`}><header><b>{details.id}</b><button type="button" aria-label="关闭无人机面板" onClick={() => setPopup(null)}><X size={15} /></button></header><p>{Math.round(details.battery)}% 电量 · {details.position.z.toFixed(1)} m · {details.mode}</p><p>地速 {Math.hypot(details.velocity.x, details.velocity.y).toFixed(1)} m/s · 垂速 {details.velocity.z.toFixed(1)} m/s · 航向 {details.attitude[2].toFixed(0)}°</p><p className={styles.positionReadout}>{mapFrame.toGeo(details.position).map(v => v.toFixed(7)).join('°, ')}°<br />E {details.position.x.toFixed(1)} / N {details.position.y.toFixed(1)} / U {details.position.z.toFixed(1)} m · {s.missionState.dataSource}</p><p>{droneAlert(details) ? `${droneAlert(details)} · ` : ''}{instanceLabels[details.instanceStatus]} · {snapshot?.group.roles[details.id] || details.currentRole ? describeTaskRole(snapshot?.group.roles[details.id] || details.currentRole || '') : '无任务分工'}</p><p>{snapshot ? '历史任务' : '当前任务'}：{snapshot ? snapshot.name : details.assignedTaskId ? s.missionState.groups.find((g) => g.runId === details.assignedTaskId)?.name : '未分配'}</p><div><button type="button" onClick={() => locate(details.id)}>定位</button><button type="button" onClick={() => { s.selectDrone(details.id); if (onInspectDrone) onInspectDrone(details.id); else s.setStep(3); }}>遥测详情</button><button type="button" disabled={!!snapshot || !details.armed || details.instanceStatus === 'RETURNING'} onClick={() => requestReturn(details.id)}>单机返航</button></div></div>}
    </div>
    {!global && !locked && editTool === undefined && <details className={styles.pointEditor}><summary>区域 / 航点编辑（{group.points.length}） · 点击地图添加，展开修改坐标</summary>{group.points.map((p, index) => <div key={index}><b>{p.kind === 'point' ? `顶点 ${index + 1}` : p.kind === 'start' ? '起点' : '交付 / 目标'}</b>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis}<input aria-label={`点${index + 1}-${axis}`} type="number" value={p[axis]} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) s.updateMapPoint(index, { ...p, [axis]: e.target.valueAsNumber }); }} /></label>)}<button type="button" onClick={() => s.removeMapPoint(index)}>删除点</button></div>)}<button type="button" disabled={!group.points.length} onClick={s.clearMapPoints}>删除全部区域 / 航点</button></details>}
  </div>;
}
