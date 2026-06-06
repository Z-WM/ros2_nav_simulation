import React from 'react';
import { MapEditor } from './components/MapEditor';
import { CanvasDecisionTree } from './components/CanvasDecisionTree';
import { MapMetadata, Waypoint, ZoneRule } from './types';
import { exportToYaml, downloadYaml } from './utils/YamlExporter';
import { importFromYaml } from './utils/YamlImporter';
import './index.css';

const STORAGE_KEY_ZONES = 'mapEditor_zones';

function App() {
    const [mapMetadata, setMapMetadata] = React.useState<MapMetadata>({
        imagePath: '',
        resolution: 0.05,
        widthPixels: 0,
        heightPixels: 0,
        originPixel: null
    });
    const [waypoints, setWaypoints] = React.useState<Waypoint[]>([]);
    const [zones, setZones] = React.useState<ZoneRule[]>([]);
    const [showMapModal, setShowMapModal] = React.useState(false);
    const [lastChangeTime, setLastChangeTime] = React.useState(0);
    const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const decisionTreeRef = React.useRef<any>(null);
    const yamlInputRef = React.useRef<HTMLInputElement>(null);

    // Persist zones
    const handleZonesChange = React.useCallback((newZones: ZoneRule[]) => {
        setZones(newZones);
        localStorage.setItem(STORAGE_KEY_ZONES, JSON.stringify(newZones));
        setLastChangeTime(Date.now());
    }, []);

    // Restore persisted data on mount + Sync with server
    React.useEffect(() => {
        const loadInitialData = async () => {
            // Priority 1: Load from server (cross-origin shared state)
            try {
                const response = await fetch('/api/load');
                if (response.ok) {
                    const result = await response.json();
                    if (result.metadata) setMapMetadata(result.metadata);
                    if (result.waypoints) setWaypoints(result.waypoints);
                    if (result.zones) setZones(result.zones);
                    if (result.decisionNodes && result.decisionNodes.length > 0) {
                        decisionTreeRef.current?.loadNodes(result.decisionNodes);
                    }
                    console.log('Successfully loaded state from server.');
                    return;
                }
            } catch (e) {
                console.warn('Server load failed, falling back to localStorage:', e);
            }

            // Priority 2: Fallback to localStorage
            const savedMeta = localStorage.getItem('mapEditor_metadata');
            const savedWps = localStorage.getItem('mapEditor_waypoints');
            const savedZones = localStorage.getItem(STORAGE_KEY_ZONES);
            if (savedMeta) {
                try { setMapMetadata(JSON.parse(savedMeta)); } catch (_) { }
            }
            if (savedWps) {
                try { setWaypoints(JSON.parse(savedWps)); } catch (_) { }
            }
            if (savedZones) {
                try { setZones(JSON.parse(savedZones)); } catch (_) { }
            }
        };

        loadInitialData();
    }, []);

    // Periodic auto-save to server (every 2 seconds if changes occur)
    React.useEffect(() => {
        if (lastChangeTime === 0) return;
        
        setSaveStatus('saving');
        const timer = setTimeout(() => {
            const nodes = decisionTreeRef.current?.getNodes() || [];
            if (nodes.length === 0 && waypoints.length === 0 && zones.length === 0) {
                setSaveStatus('idle');
                return;
            }

            // Generate YAML content to sync root robot config
            let yamlContent = '';
            try {
                if (mapMetadata.originPixel) {
                    yamlContent = exportToYaml(mapMetadata, waypoints, nodes, zones);
                }
            } catch (e) { /* might not be ready yet */ }

            fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadata: mapMetadata,
                    waypoints,
                    zones,
                    decisionNodes: nodes,
                    yamlContent
                })
            })
            .then(() => {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1000);
            })
            .catch(err => {
                console.error('Failed to auto-save to server:', err);
                setSaveStatus('error');
            });
        }, 1000);

        return () => clearTimeout(timer);
    }, [lastChangeTime, mapMetadata, waypoints, zones]);

    const handleExportYaml = () => {
        try {
            const nodes = decisionTreeRef.current?.getNodes() || [];
            const yamlContent = exportToYaml(mapMetadata, waypoints, nodes, zones);
            downloadYaml(yamlContent);
        } catch (error) {
            alert(`导出失败: ${(error as Error).message}`);
        }
    };

    const handleImportYaml = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const yamlContent = event.target?.result as string;
                const result = importFromYaml(yamlContent);

                setMapMetadata(result.metadata);
                setWaypoints(result.waypoints);
                handleZonesChange(result.zones);

                localStorage.setItem('mapEditor_metadata', JSON.stringify(result.metadata));
                localStorage.setItem('mapEditor_waypoints', JSON.stringify(result.waypoints));

                if (result.decisionNodes.length > 0) {
                    decisionTreeRef.current?.loadNodes(result.decisionNodes);
                }

                alert(`导入成功！加载了 ${result.waypoints.length} 个导航点、${result.zones.length} 个区域和 ${result.decisionNodes.length} 个决策节点。\n注意：地图图片需要重新上传。`);
            } catch (error) {
                alert(`导入失败: ${(error as Error).message}`);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };


    return (
        <div className="app">
            <header className="app-header">
                <div className="header-title-group">
                    <h1>🤖 RoboMaster 可视化决策编辑器</h1>
                    <div className={`save-status status-${saveStatus}`}>
                        {saveStatus === 'saving' && <span>⏳ 正在保存...</span>}
                        {saveStatus === 'saved' && <span>✅ 已自动保存</span>}
                        {saveStatus === 'error' && <span>❌ 保存失败</span>}
                        {saveStatus === 'idle' && lastChangeTime > 0 && <span style={{ opacity: 0.6 }}>云端已同步</span>}
                    </div>
                </div>
                <div className="header-buttons">
                    <button onClick={() => setShowMapModal(true)} className="map-btn">
                        🗺️ 地图编辑
                    </button>
                    <input
                        ref={yamlInputRef}
                        type="file"
                        accept=".yaml,.yml"
                        onChange={handleImportYaml}
                        style={{ display: 'none' }}
                    />
                    <button onClick={() => yamlInputRef.current?.click()} className="export-btn" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
                        📤 导入 YAML
                    </button>
                    <button onClick={handleExportYaml} className="export-btn">
                        📥 导出 YAML
                    </button>
                </div>
            </header>

            <div className="app-content-full">
                <section className="decision-section-full">
                    <h2>决策树编辑器</h2>
                    <CanvasDecisionTree
                        ref={decisionTreeRef}
                        waypoints={waypoints}
                        zones={zones}
                        onZonesChange={handleZonesChange}
                        onNodesChange={() => setLastChangeTime(Date.now())}
                    />
                </section>
            </div>

            {/* 地图编辑模态框 */}
            {showMapModal && (
                <div className="modal-overlay" onClick={() => setShowMapModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🗺️ 地图与导航点编辑</h2>
                            <button onClick={() => setShowMapModal(false)} className="close-btn">✕</button>
                        </div>
                        <div className="modal-body">
                            <MapEditor
                                onWaypointsChange={(wps) => {
                                    setWaypoints(wps);
                                    setLastChangeTime(Date.now());
                                }}
                                onMapMetadataChange={(meta) => {
                                    setMapMetadata(meta);
                                    setLastChangeTime(Date.now());
                                }}
                                zones={zones}
                                onZonesChange={handleZonesChange}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
