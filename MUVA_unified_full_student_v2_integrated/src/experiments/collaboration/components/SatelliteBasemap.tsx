import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { AttributionControl, NavigationControl, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collaborationBasemapSourceId, collaborationBasemapStyle, type CollaborationBasemapMode } from '../../../domain/collaborationBasemap';
import { collaborationMapFrame } from '../../../domain/collaborationMap';
import type { MapReference } from '../../../types/collaboration';
import styles from './SatelliteBasemap.module.css';

export interface MapCameraController {
  zoomBy: (levels: number, anchor?: { x: number; y: number }) => void;
  stop: () => void;
}
export interface MetricCamera { pan: { x: number; y: number }; pixelsPerMetre: number }


/** Independent experiment-3 copy of experiment-2 MapLibre initialization.
 * FleetMap owns one metric camera; imagery and vector modes never resize the scene. */
export function SatelliteBasemap({ reference, pan, pixelsPerMetre, mode, statusHost, onShowCoordinates, onStatusChange, navigationHost, onCameraChange, onControllerReady }: { navigationHost: HTMLDivElement | null; onCameraChange: (camera: MetricCamera) => void; onControllerReady: (controller: MapCameraController | null) => void; reference: MapReference; pan: { x: number; y: number }; pixelsPerMetre: number; mode: CollaborationBasemapMode; statusHost: HTMLDivElement | null; onShowCoordinates: () => void; onStatusChange: (status: 'loading' | 'ready' | 'error') => void }) {
  const enabled = mode !== 'coordinates';
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, retry] = useState(0);
  const camera = collaborationMapFrame(reference).camera(pan, pixelsPerMetre);
  const callbacks = useRef({ onCameraChange, onControllerReady });
  callbacks.current = { onCameraChange, onControllerReady };
  const emittedPans = useRef(new WeakSet<object>());
  const latestCamera = useRef(camera);
  latestCamera.current = camera;
  useEffect(() => {
    if (!host.current || !navigationHost) return;
    setStatus('loading');
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({ container: host.current, style: mode === 'coordinates' ? { version: 8, sources: {}, layers: [] } : collaborationBasemapStyle(mode), ...latestCamera.current, interactive: false, attributionControl: false, maxZoom: 24, minZoom: 0, pitch: 0, bearing: 0, maxPitch: 0, transformCameraUpdate: () => ({ bearing: 0, pitch: 0, roll: 0 }), locale: { 'NavigationControl.ZoomIn': '放大', 'NavigationControl.ZoomOut': '缩小', 'NavigationControl.ResetBearing': '正北朝上' }, canvasContextAttributes: { preserveDrawingBuffer: true } });
    } catch {
      setStatus('error');
      return;
    }
    map.current = instance;
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    // The actual MapLibre IControl, mounted in the HUD so it never resizes the map.
    // Use its public lifecycle, with matched cleanup (no imitation SVG/buttons).
    const navigation = new NavigationControl({ showZoom: true, showCompass: true });
    navigationHost.append(navigation.onAdd(instance));
    const frame = collaborationMapFrame(reference);
    const metresAtZoomZero = 2 * Math.PI * 6378137 * Math.cos(reference.origin[1] * Math.PI / 180) / 512;
    const syncCamera = () => {
      const center = instance.getCenter();
      const local = frame.toLocal([center.lng, center.lat]);
      const scale = 2 ** instance.getZoom() / metresAtZoomZero;
      const next = { pixelsPerMetre: scale, pan: { x: -local.x * scale, y: local.y * scale } };
      emittedPans.current.add(next.pan);
      callbacks.current.onCameraChange(next);
    };
    instance.on('move', syncCamera);
    callbacks.current.onControllerReady({
      zoomBy: (levels, anchor) => {
        const next = Math.max(instance.getMinZoom(), Math.min(instance.getMaxZoom(), instance.getZoom() + levels));
        instance.easeTo({ zoom: next, ...(anchor ? { around: instance.unproject([anchor.x, anchor.y]) } : {}), duration: 280 });
      },
      stop: () => { instance.stop(); },
    });
    instance.on('sourcedata', event => {
      const tile: unknown = event.tile;
      if (event.sourceId === collaborationBasemapSourceId && tile && typeof tile === 'object' && 'state' in tile && tile.state === 'loaded') setStatus('ready');
    });
    instance.on('error', () => setStatus('error'));
    // A blocked tile endpoint must not leave an infinite loading indicator.
    const timeout = window.setTimeout(() => { if (enabled) setStatus(current => current === 'loading' ? 'error' : current); }, 15000);
    const observer = new ResizeObserver(() => { instance.resize(); instance.jumpTo(latestCamera.current); });
    observer.observe(host.current);
    return () => { window.clearTimeout(timeout); observer.disconnect(); instance.off('move', syncCamera); callbacks.current.onControllerReady(null); navigation.onRemove(); map.current = null; instance.remove(); };
  }, [mode, revision, navigationHost, reference.origin[0], reference.origin[1]]);
  useEffect(() => { onStatusChange(status); }, [status, onStatusChange]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || emittedPans.current.has(pan)) return;
    const center = instance.getCenter();
    // Ignore the echo of engine move events: jumpTo here would cancel native easing.
    if (Math.abs(instance.getZoom() - camera.zoom) > 1e-6 || Math.abs(center.lng - camera.center[0]) > 1e-9 || Math.abs(center.lat - camera.center[1]) > 1e-9) instance.jumpTo(camera);
  }, [pan, camera.center[0], camera.center[1], camera.zoom]);
  return <>
    <div ref={host} className={styles.basemap} data-testid="satellite-basemap" data-camera-longitude={camera.center[0]} data-camera-latitude={camera.center[1]} data-camera-zoom={camera.zoom} data-status={enabled ? status : 'grid'} data-basemap-mode={mode} data-renderer="maplibre-2d" data-camera-min-zoom="0" data-camera-max-zoom="24" />
    {enabled && status !== 'ready' && statusHost && createPortal(<div className={styles.message} role="status" data-popup="true">{status === 'loading' ? `正在加载${mode === 'vector' ? '二维矢量' : '卫星'}底图…` : <>{mode === 'vector' ? '矢量底图不可用，已显示米制坐标网格。' : '卫星底图不可用，坐标与任务操作仍可用。'}<button type="button" onClick={() => retry(n => n + 1)}>重试</button><button type="button" onClick={onShowCoordinates}>使用坐标图层</button></>}</div>, statusHost)}
  </>;
}
