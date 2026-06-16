import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Circle, Text, Group, Line } from 'react-konva';
import { MapMetadata, Waypoint, PixelPoint, ZoneRule, rectToPoints, pointsToRect } from '../types';
import { pixelToWorld } from '../utils/coordinateCalculator';
import * as storage from '../utils/Storage';

const STORAGE_KEY_IMAGE = 'mapEditor_imageData';
const STORAGE_KEY_METADATA = 'mapEditor_metadata';
const STORAGE_KEY_WAYPOINTS = 'mapEditor_waypoints';

// Distinct colors per zone (cycling)
const ZONE_COLORS = [
    '#4ecdc4', '#ff6b6b', '#feca57', '#a29bfe', '#fd79a8',
    '#00b894', '#e17055', '#0984e3', '#6c5ce7', '#fdcb6e'
];

interface MapEditorProps {
    onWaypointsChange: (waypoints: Waypoint[]) => void;
    onMapMetadataChange: (metadata: MapMetadata) => void;
    zones: ZoneRule[];
    onZonesChange: (zones: ZoneRule[]) => void;
}

type EditorMode = 'none' | 'set_origin' | 'add_waypoint' | 'draw_zone';

export const MapEditor: React.FC<MapEditorProps> = ({
    onWaypointsChange,
    onMapMetadataChange,
    zones,
    onZonesChange
}) => {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [metadata, setMetadata] = useState<MapMetadata>({
        imagePath: '',
        resolution: 0.05,
        widthPixels: 0,
        heightPixels: 0,
        originPixel: null
    });
    const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
    const [mode, setMode] = useState<EditorMode>('none');
    const [scale, setScale] = useState(1);
    const [iconSize, setIconSize] = useState(12);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // Zone drawing state (polygon mode)
    const [polygonPoints, setPolygonPoints] = useState<number[]>([]); // accumulated vertices [x1,y1, x2,y2, ...]
    const [polygonPreview, setPolygonPreview] = useState<{ x: number; y: number } | null>(null); // live cursor position

    const fileInputRef = useRef<HTMLInputElement>(null);
    const stageRef = useRef<any>(null);
    const initializedRef = useRef(false);

    // ---- Save helpers ----
    const saveImageData = useCallback(async (dataUrl: string) => {
        try {
            await storage.setItem(STORAGE_KEY_IMAGE, dataUrl);
        } catch (e) {
            console.error('Failed to save image to IndexedDB:', e);
        }
    }, []);

    const saveMetadata = useCallback((m: MapMetadata) => {
        localStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(m));
    }, []);

    const saveWaypoints = useCallback((wps: Waypoint[]) => {
        localStorage.setItem(STORAGE_KEY_WAYPOINTS, JSON.stringify(wps));
    }, []);

    // ---- Restore on mount ----
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        const restore = async () => {
            const savedImageData = await storage.getItem<string>(STORAGE_KEY_IMAGE);
            const savedMeta = localStorage.getItem(STORAGE_KEY_METADATA);
            const savedWps = localStorage.getItem(STORAGE_KEY_WAYPOINTS);

            if (savedImageData && savedMeta) {
                const parsedMeta: MapMetadata = JSON.parse(savedMeta);
                const img = new window.Image();
                img.onload = () => {
                    setImage(img);
                    setMetadata(parsedMeta);
                    onMapMetadataChange(parsedMeta);

                    if (savedWps) {
                        const parsedWps: Waypoint[] = JSON.parse(savedWps);
                        setWaypoints(parsedWps);
                        onWaypointsChange(parsedWps);
                    }
                };
                img.src = savedImageData;
            }
        };

        restore();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 智能缩放：让地图完整显示在可视区域内，不需要滚动
    React.useEffect(() => {
        if (image) {
            const containerWidth = window.innerWidth - 80;
            const containerHeight = window.innerHeight - 200;
            const scaleX = containerWidth / image.width;
            const scaleY = containerHeight / image.height;
            setScale(Math.min(scaleX, scaleY));
        }
    }, [image]);

    // Handle image upload
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new window.Image();
            img.onload = () => {
                setImage(img);
                const newMetadata: MapMetadata = {
                    imagePath: file.name,
                    resolution: metadata.resolution,
                    widthPixels: img.width,
                    heightPixels: img.height,
                    originPixel: null
                };
                setMetadata(newMetadata);
                onMapMetadataChange(newMetadata);
                setWaypoints([]);
                saveImageData(event.target?.result as string);
                saveMetadata(newMetadata);
                saveWaypoints([]);
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    // Handle resolution change
    const handleResolutionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const resolution = parseFloat(e.target.value);
        if (isNaN(resolution) || resolution <= 0) return;

        const newMetadata = { ...metadata, resolution };
        setMetadata(newMetadata);
        onMapMetadataChange(newMetadata);
        saveMetadata(newMetadata);

        if (metadata.originPixel) {
            const updatedWaypoints = waypoints.map(wp => ({
                ...wp,
                world: pixelToWorld(wp.pixel, metadata.originPixel!, resolution)
            }));
            setWaypoints(updatedWaypoints);
            onWaypointsChange(updatedWaypoints);
            saveWaypoints(updatedWaypoints);
        }
    };

    // Handle mouse wheel zoom
    const handleWheel = (e: any) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const oldScale = scale;
        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        setScale(newScale);
    };

    // Convert stage pointer position → pixel coordinate in image space
    const pointerToPixel = (stage: any): PixelPoint => {
        const pos = stage.getPointerPosition();
        return {
            u: (pos.x - stagePos.x) / scale,
            v: (pos.y - stagePos.y) / scale
        };
    };

    // Finish polygon drawing and create zone
    const finishPolygon = () => {
        if (polygonPoints.length < 6) return; // need at least 3 vertices

        const name = prompt('请输入区域名称:');
        if (!name) {
            setPolygonPoints([]);
            setPolygonPreview(null);
            return;
        }

        const origin = metadata.originPixel;
        const res = metadata.resolution;

        // Compute worldPoints
        const worldPoints: number[] = [];
        for (let i = 0; i < polygonPoints.length; i += 2) {
            const u = polygonPoints[i];
            const v = polygonPoints[i + 1];
            if (origin) {
                worldPoints.push(parseFloat(((u - origin.u) * res).toFixed(3)));
                worldPoints.push(parseFloat(((origin.v - v) * res).toFixed(3)));
            } else {
                worldPoints.push(0, 0);
            }
        }

        // Compute bounding rect for backward compat
        const rect = pointsToRect(polygonPoints);
        const worldRect = origin ? pointsToRect(worldPoints) : { x1: 0, y1: 0, x2: 0, y2: 0 };

        const newZone: ZoneRule = {
            id: `zone-${Date.now()}`,
            name,
            rect,
            worldRect,
            points: polygonPoints,
            worldPoints,
            conditions: [],
            action: null,
            params: [],
            priority: zones.length + 1
        };

        onZonesChange([...zones, newZone]);
        setPolygonPoints([]);
        setPolygonPreview(null);
        setMode('none');
    };

    // Mouse handlers for zone drawing (polygon mode)
    const handleMouseDown = (e: any) => {
        if (mode !== 'draw_zone' || !image) return;
        const stage = e.target.getStage();
        const px = pointerToPixel(stage);

        // Check if click is near the first vertex (within 8px) to close the polygon
        if (polygonPoints.length >= 6) { // at least 3 vertices
            const firstX = polygonPoints[0];
            const firstY = polygonPoints[1];
            const dist = Math.sqrt((px.u - firstX) ** 2 + (px.v - firstY) ** 2);
            if (dist < 8) {
                finishPolygon();
                return;
            }
        }

        // Add vertex
        setPolygonPoints(prev => [...prev, px.u, px.v]);
    };

    const handleMouseMove = (e: any) => {
        if (mode !== 'draw_zone' || polygonPoints.length === 0) return;
        const stage = e.target.getStage();
        const px = pointerToPixel(stage);
        setPolygonPreview({ x: px.u, y: px.v });
    };

    // Double-click to close polygon
    const handleStageDblClick = (_e: any) => {
        if (mode === 'draw_zone' && polygonPoints.length >= 6) {
            finishPolygon();
        }
    };

    // Escape key to cancel polygon drawing
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && mode === 'draw_zone' && polygonPoints.length > 0) {
                setPolygonPoints([]);
                setPolygonPreview(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mode, polygonPoints]);

    // Handle canvas click (for origin/waypoint modes)
    const handleStageClick = (e: any) => {
        if (!image || !e.target.getStage()) return;
        if (mode === 'draw_zone') return; // handled by handleMouseDown

        const stage = e.target.getStage();
        const px = pointerToPixel(stage);

        if (mode === 'set_origin') {
            const newMetadata = { ...metadata, originPixel: px };
            setMetadata(newMetadata);
            onMapMetadataChange(newMetadata);
            saveMetadata(newMetadata);
            setMode('none');

            const updatedWaypoints = waypoints.map(wp => ({
                ...wp,
                world: pixelToWorld(wp.pixel, px, metadata.resolution)
            }));
            setWaypoints(updatedWaypoints);
            onWaypointsChange(updatedWaypoints);
            saveWaypoints(updatedWaypoints);
        } else if (mode === 'add_waypoint') {
            if (!metadata.originPixel) {
                alert('请先设置原点！');
                return;
            }

            const name = prompt('请输入导航点名称:');
            if (!name) return;

            const worldCoord = pixelToWorld(px, metadata.originPixel, metadata.resolution);
            const newWaypoint: Waypoint = { name, pixel: px, world: worldCoord };

            const updatedWaypoints = [...waypoints, newWaypoint];
            setWaypoints(updatedWaypoints);
            onWaypointsChange(updatedWaypoints);
            saveWaypoints(updatedWaypoints);
            setMode('none');
        }
    };

    // Delete waypoint
    const handleDeleteWaypoint = (name: string) => {
        const updatedWaypoints = waypoints.filter(wp => wp.name !== name);
        setWaypoints(updatedWaypoints);
        onWaypointsChange(updatedWaypoints);
        saveWaypoints(updatedWaypoints);
    };

    // Handle manual origin coordinate input
    const handleManualOriginChange = (axis: 'x' | 'y', e: React.ChangeEvent<HTMLInputElement>) => {
        if (!image) return;
        const value = parseFloat(e.target.value);
        const validValue = isNaN(value) ? 0 : value;

        const currentU = metadata.originPixel ? metadata.originPixel.u : 0;
        const currentV = metadata.originPixel ? metadata.originPixel.v : 0;

        const newPixel = {
            u: axis === 'x' ? validValue / metadata.resolution : currentU,
            v: axis === 'y' ? validValue / metadata.resolution : currentV
        };

        const newMetadata = { ...metadata, originPixel: newPixel };
        setMetadata(newMetadata);
        onMapMetadataChange(newMetadata);
        saveMetadata(newMetadata);

        const updatedWaypoints = waypoints.map(wp => ({
            ...wp,
            world: pixelToWorld(wp.pixel, newPixel, metadata.resolution)
        }));
        setWaypoints(updatedWaypoints);
        onWaypointsChange(updatedWaypoints);
        saveWaypoints(updatedWaypoints);
    };

    const hasSidebar = waypoints.length > 0 || zones.length > 0;

    return (
        <div className="map-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                padding: '1rem',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '8px',
                flexShrink: 0,
                flexWrap: 'wrap',
                alignItems: 'center'
            }}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        background: 'white', color: '#667eea', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    📁 上传地图
                </button>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: 'rgba(255,255,255,0.2)', padding: '0.5rem 1rem', borderRadius: '6px'
                }}>
                    <label style={{ color: 'white', fontSize: '0.9rem', fontWeight: 500 }}>
                        分辨率:
                        <input
                            type="number" step="0.001" value={metadata.resolution}
                            onChange={handleResolutionChange} disabled={!image}
                            style={{ marginLeft: '0.5rem', width: '80px', padding: '0.3rem', borderRadius: '4px', border: 'none' }}
                        />
                        <span style={{ marginLeft: '0.3rem', fontSize: '0.85rem' }}>m/px</span>
                    </label>
                </div>

                <button
                    onClick={() => setMode('set_origin')} disabled={!image}
                    style={{
                        background: mode === 'set_origin' ? 'white' : 'rgba(255,255,255,0.2)',
                        color: mode === 'set_origin' ? '#667eea' : 'white',
                        border: 'none', padding: '0.5rem 1rem', borderRadius: '6px',
                        fontWeight: 600, cursor: image ? 'pointer' : 'not-allowed', opacity: image ? 1 : 0.5
                    }}
                >
                    🎯 设置原点
                </button>

                <button
                    onClick={() => setMode('add_waypoint')} disabled={!image || !metadata.originPixel}
                    style={{
                        background: mode === 'add_waypoint' ? 'white' : 'rgba(255,255,255,0.2)',
                        color: mode === 'add_waypoint' ? '#667eea' : 'white',
                        border: 'none', padding: '0.5rem 1rem', borderRadius: '6px',
                        fontWeight: 600,
                        cursor: (image && metadata.originPixel) ? 'pointer' : 'not-allowed',
                        opacity: (image && metadata.originPixel) ? 1 : 0.5
                    }}
                >
                    📍 添加导航点
                </button>

                <button
                    onClick={() => setMode('draw_zone')} disabled={!image}
                    style={{
                        background: mode === 'draw_zone' ? 'white' : 'rgba(255,255,255,0.2)',
                        color: mode === 'draw_zone' ? '#764ba2' : 'white',
                        border: mode === 'draw_zone' ? '2px solid #764ba2' : '2px solid transparent',
                        padding: '0.5rem 1rem', borderRadius: '6px',
                        fontWeight: 600, cursor: image ? 'pointer' : 'not-allowed', opacity: image ? 1 : 0.5
                    }}
                >
                    ✏️ 绘制区域
                </button>

                {image && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(255,255,255,0.2)', padding: '0.4rem 0.8rem', borderRadius: '6px'
                    }}>
                        <label style={{ color: 'white', fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
                            图标大小:
                            <input
                                type="range" min="4" max="40" value={iconSize}
                                onChange={(e) => setIconSize(Number(e.target.value))}
                                style={{ marginLeft: '0.5rem', width: '80px', cursor: 'pointer' }}
                            />
                        </label>
                    </div>
                )}

                {image && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(255,255,255,0.2)', padding: '0.4rem 0.8rem', borderRadius: '6px'
                    }}>
                        <label style={{ color: 'white', fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
                            原点 X(m):
                            <input
                                type="number" step="0.01"
                                value={metadata.originPixel ? Math.round(metadata.originPixel.u * metadata.resolution * 1000) / 1000 : ''}
                                onChange={(e) => handleManualOriginChange('x', e)} disabled={!image}
                                style={{ marginLeft: '0.5rem', width: '70px', padding: '0.3rem', borderRadius: '4px', border: 'none' }}
                            />
                        </label>
                        <label style={{ color: 'white', fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center', marginLeft: '0.5rem' }}>
                            Y(m):
                            <input
                                type="number" step="0.01"
                                value={metadata.originPixel ? Math.round(metadata.originPixel.v * metadata.resolution * 1000) / 1000 : ''}
                                onChange={(e) => handleManualOriginChange('y', e)} disabled={!image}
                                style={{ marginLeft: '0.5rem', width: '70px', padding: '0.3rem', borderRadius: '4px', border: 'none' }}
                            />
                        </label>
                    </div>
                )}

                {image && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(255,255,255,0.2)', padding: '0.5rem',
                        borderRadius: '6px', marginLeft: 'auto'
                    }}>
                        <button
                            onClick={() => setScale(s => s + 0.2)}
                            style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '4px', cursor: 'pointer', fontSize: '1.2rem' }}
                        >+</button>
                        <span style={{ color: 'white', fontWeight: 600, minWidth: '60px', textAlign: 'center', fontSize: '0.9rem' }}>
                            {(scale * 100).toFixed(0)}%
                        </span>
                        <button
                            onClick={() => setScale(s => Math.max(s - 0.2, 0.1))}
                            style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '4px', cursor: 'pointer', fontSize: '1.2rem' }}
                        >−</button>
                        <button
                            onClick={() => {
                                const cw = window.innerWidth;
                                const ch = window.innerHeight - 90;
                                const sx = (cw - 40) / metadata.widthPixels;
                                const sy = (ch - 40) / metadata.heightPixels;
                                const ns = Math.min(sx, sy) * 0.8;
                                const scaledW = metadata.widthPixels * ns;
                                const scaledH = metadata.heightPixels * ns;
                                setScale(ns);
                                setStagePos({ x: (cw - scaledW) / 2, y: (ch - scaledH) / 2 });
                            }}
                            style={{ background: 'white', color: '#667eea', border: 'none', padding: '0.5rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                        >
                            适应
                        </button>
                    </div>
                )}
            </div>

            {image && (
                <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    <Stage
                        ref={stageRef}
                        width={window.innerWidth - (hasSidebar ? 280 : 0)}
                        height={window.innerHeight - 90}
                        onClick={handleStageClick}
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onDblClick={handleStageDblClick}
                        style={{
                            cursor: mode === 'set_origin' || mode === 'add_waypoint'
                                ? 'crosshair'
                                : mode === 'draw_zone' ? 'crosshair' : 'grab',
                            background: '#fafafa'
                        }}
                    >
                        <Layer>
                            <Group
                                x={stagePos.x}
                                y={stagePos.y}
                                scaleX={scale}
                                scaleY={scale}
                                draggable={mode === 'none'}
                                onDragEnd={(e: any) => {
                                    setStagePos({ x: e.target.x(), y: e.target.y() });
                                }}
                            >
                                <KonvaImage image={image} />

                                {/* Draw Zones */}
                                {zones.map((zone, idx) => {
                                    const color = ZONE_COLORS[idx % ZONE_COLORS.length];
                                    const pts = zone.points && zone.points.length >= 6
                                        ? zone.points
                                        : rectToPoints(zone.rect); // backward compat
                                    return (
                                        <React.Fragment key={zone.id}>
                                            <Line
                                                points={pts}
                                                fill={color}
                                                opacity={0.25}
                                                stroke={color}
                                                strokeWidth={2 / scale}
                                                dash={[8 / scale, 4 / scale]}
                                                closed
                                            />
                                            <Text
                                                x={pts[0] + 4 / scale}
                                                y={pts[1] + 4 / scale}
                                                text={zone.name}
                                                fontSize={Math.max(10, iconSize * 1.2) / scale}
                                                fill={color}
                                                fontStyle="bold"
                                            />
                                        </React.Fragment>
                                    );
                                })}

                                {/* Polygon preview while drawing */}
                                {polygonPoints.length >= 2 && (
                                    <>
                                        {/* Draw the polygon so far */}
                                        <Line
                                            points={polygonPoints}
                                            stroke="#764ba2"
                                            strokeWidth={2 / scale}
                                            dash={[6 / scale, 3 / scale]}
                                            tension={0}
                                        />
                                        {/* Live preview line from last vertex to cursor */}
                                        {polygonPreview && (
                                            <Line
                                                points={[
                                                    polygonPoints[polygonPoints.length - 2],
                                                    polygonPoints[polygonPoints.length - 1],
                                                    polygonPreview.x,
                                                    polygonPreview.y
                                                ]}
                                                stroke="#764ba2"
                                                strokeWidth={1.5 / scale}
                                                dash={[4 / scale, 4 / scale]}
                                            />
                                        )}
                                        {/* Preview line from cursor back to first vertex (close hint) */}
                                        {polygonPreview && polygonPoints.length >= 4 && (
                                            <Line
                                                points={[
                                                    polygonPreview.x,
                                                    polygonPreview.y,
                                                    polygonPoints[0],
                                                    polygonPoints[1]
                                                ]}
                                                stroke="rgba(118,75,162,0.4)"
                                                strokeWidth={1 / scale}
                                                dash={[3 / scale, 3 / scale]}
                                            />
                                        )}
                                        {/* Vertex circles */}
                                        {Array.from({ length: polygonPoints.length / 2 }).map((_, i) => (
                                            <Circle
                                                key={i}
                                                x={polygonPoints[i * 2]}
                                                y={polygonPoints[i * 2 + 1]}
                                                radius={4 / scale}
                                                fill={i === 0 ? '#00ff00' : '#764ba2'} // first vertex is green
                                                stroke="white"
                                                strokeWidth={1 / scale}
                                            />
                                        ))}
                                    </>
                                )}

                                {/* Draw Origin */}
                                {metadata.originPixel && (
                                    <>
                                        <Circle
                                            x={metadata.originPixel.u} y={metadata.originPixel.v}
                                            radius={iconSize} fill="red" stroke="white" strokeWidth={2}
                                        />
                                        <Text
                                            x={metadata.originPixel.u + iconSize + 2}
                                            y={metadata.originPixel.v - iconSize - 2}
                                            text={`原点 (${(metadata.originPixel.u * metadata.resolution).toFixed(2)}, ${(metadata.originPixel.v * metadata.resolution).toFixed(2)})`}
                                            fontSize={Math.max(12, iconSize * 1.2)}
                                            fill="red" fontStyle="bold"
                                        />
                                    </>
                                )}

                                {/* Draw Waypoints */}
                                {waypoints.map((wp, idx) => (
                                    <React.Fragment key={idx}>
                                        <Circle
                                            x={wp.pixel.u} y={wp.pixel.v}
                                            radius={iconSize} fill="#FF5F15" stroke="white" strokeWidth={2}
                                        />
                                        <Text
                                            x={wp.pixel.u + iconSize + 2} y={wp.pixel.v - iconSize - 2}
                                            text={wp.name}
                                            fontSize={Math.max(12, iconSize * 1.5)}
                                            fill="#FF5F15" fontStyle="bold"
                                        />
                                    </React.Fragment>
                                ))}
                            </Group>
                        </Layer>
                    </Stage>

                    {/* Drawing mode hint */}
                    {mode === 'draw_zone' && (
                        <div style={{
                            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(118,75,162,0.9)', color: 'white', padding: '8px 16px',
                            borderRadius: '6px', zIndex: 20, fontSize: '0.9rem', fontWeight: 600,
                            pointerEvents: 'none'
                        }}>
                            {polygonPoints.length === 0
                                ? '点击地图添加顶点，双击或点击起点闭合多边形'
                                : `已添加 ${polygonPoints.length / 2} 个顶点，双击或点击绿色起点闭合 | Esc 取消`
                            }
                        </div>
                    )}

                    {/* Sidebar */}
                    {hasSidebar && (
                        <div style={{
                            position: 'absolute', top: 0, right: 0, bottom: 0, width: '280px',
                            background: 'rgba(255,255,255,0.97)',
                            borderLeft: '2px solid #e0e0e0',
                            padding: '1rem', overflowY: 'auto', zIndex: 10
                        }}>
                            {waypoints.length > 0 && (
                                <>
                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.6rem', color: '#333' }}>
                                        📍 导航点 ({waypoints.length})
                                    </div>
                                    {waypoints.map((wp) => (
                                        <div key={wp.name} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '0.5rem 0.4rem', borderBottom: '1px solid #eee', fontSize: '0.9rem'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 600, color: '#333' }}>{wp.name}</div>
                                                <div style={{ color: '#888', fontSize: '0.82rem' }}>
                                                    ({wp.world.x.toFixed(2)}, {wp.world.y.toFixed(2)})
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteWaypoint(wp.name)}
                                                style={{ background: '#fde8e8', border: '1px solid #e74c3c', color: '#e74c3c', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem 0.45rem', borderRadius: '4px', lineHeight: 1 }}
                                                title={`删除 ${wp.name}`}
                                            >✕</button>
                                        </div>
                                    ))}
                                </>
                            )}

                            {zones.length > 0 && (
                                <>
                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', margin: '1rem 0 0.6rem', color: '#333' }}>
                                        🗂️ 区域 ({zones.length})
                                    </div>
                                    {zones.map((zone, idx) => {
                                        const color = ZONE_COLORS[idx % ZONE_COLORS.length];
                                        return (
                                            <div key={zone.id} style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '0.5rem 0.4rem', borderBottom: '1px solid #eee', fontSize: '0.9rem'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <div style={{ width: 12, height: 12, background: color, borderRadius: 3, flexShrink: 0 }} />
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: '#333' }}>{zone.name}</div>
                                                        <div style={{ color: '#888', fontSize: '0.78rem' }}>
                                                            优先级 {zone.priority} · {zone.points && zone.points.length >= 6 ? `${zone.points.length / 2}顶点` : '矩形'} · {zone.conditions.length}条件
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => onZonesChange(zones.filter(z => z.id !== zone.id))}
                                                    style={{ background: '#fde8e8', border: '1px solid #e74c3c', color: '#e74c3c', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem 0.45rem', borderRadius: '4px', lineHeight: 1, flexShrink: 0 }}
                                                    title={`删除 ${zone.name}`}
                                                >✕</button>
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
