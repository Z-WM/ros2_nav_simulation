import React from 'react';
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva';
import { Waypoint, ZoneRule, REFEREE_FIELD_TYPES, REFEREE_TARGET_ACTION, REFEREE_TARGET_ACTION_LABEL } from '../types';
import { ComparisonOperator } from '../types';

interface DecisionTreeNode {
    id: string;
    type: 'condition' | 'action' | 'param' | 'zone';
    x: number;
    y: number;
    data: any;
    children: string[];
}

interface CanvasDecisionTreeProps {
    waypoints: Waypoint[];
    zones?: ZoneRule[];
    onZonesChange?: (zones: ZoneRule[]) => void;
    onNodesChange?: (nodes: DecisionTreeNode[]) => void;
}

// 可用的 ROS 变量类型
const AVAILABLE_TYPES = ['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32', 'float32', 'float64', 'bool'];

const OPERATORS: ComparisonOperator[] = ['>', '<', '==', '!=', '>=', '<='];

const STORAGE_KEY_NODES = 'decisionTree_nodes';
const STORAGE_KEY_FIELDS = 'decisionTree_customFields';

// Custom field: name + ROS type
interface CustomField {
    name: string;
    type: string;
}

// Default fields from Referee.msg
const DEFAULT_FIELDS: CustomField[] = Object.entries(REFEREE_FIELD_TYPES).map(
    ([name, type]) => ({ name, type })
);

export const CanvasDecisionTree = React.forwardRef<any, CanvasDecisionTreeProps>(({ waypoints, zones = [], onNodesChange }, ref) => {

    const [nodes, setNodes] = React.useState<DecisionTreeNode[]>(() => {
        const saved = localStorage.getItem(STORAGE_KEY_NODES);
        if (saved) {
            try { return JSON.parse(saved); } catch (_) { }
        }
        return []; // Use new default if storage empty
    });
    const [customFields, setCustomFields] = React.useState<CustomField[]>(() => {
        const saved = localStorage.getItem(STORAGE_KEY_FIELDS);
        if (saved) {
            try { return JSON.parse(saved); } catch (_) { }
        }
        return DEFAULT_FIELDS;
    });
    const [showFieldManager, setShowFieldManager] = React.useState(false);
    const [newFieldName, setNewFieldName] = React.useState('');
    const [newFieldType, setNewFieldType] = React.useState('uint16');
    const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
    const [connectMode, setConnectMode] = React.useState(false);
    const [sourceNodeId, setSourceNodeId] = React.useState<string | null>(null);
    const [canvasSize, setCanvasSize] = React.useState({ width: 1200, height: 650 });
    const [stageScale, setStageScale] = React.useState(1);
    const [stagePos, setStagePos] = React.useState({ x: 0, y: 0 });
    const [isDraggingStage, setIsDraggingStage] = React.useState(false);

    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 90;

    const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

    const formatActionLabel = (action: string) => {
        if (action === 'STOP') return '🛑 停止';
        if (action === REFEREE_TARGET_ACTION) return `📡 ${REFEREE_TARGET_ACTION_LABEL}`;
        return `📍 ${action}`;
    };

    const renderActionOptions = (includePrefix: boolean = true) => (
        <>
            <option value="STOP">🛑 停止导航</option>
            <option value={REFEREE_TARGET_ACTION}>📡 {REFEREE_TARGET_ACTION_LABEL}</option>
            {waypoints.map(wp => (
                <option key={wp.name} value={wp.name}>{includePrefix ? `📍 前往 ${wp.name}` : wp.name}</option>
            ))}
        </>
    );

    const defaultAction = () => waypoints.length > 0 ? waypoints[0].name : 'STOP';

    // Auto-save nodes to localStorage on every change
    React.useEffect(() => {
        localStorage.setItem(STORAGE_KEY_NODES, JSON.stringify(nodes));
        if (onNodesChange) onNodesChange(nodes);
    }, [nodes, onNodesChange]);

    // Auto-save custom fields to localStorage
    React.useEffect(() => {
        localStorage.setItem(STORAGE_KEY_FIELDS, JSON.stringify(customFields));
    }, [customFields]);

    // Field management
    const addCustomField = () => {
        const trimmed = newFieldName.trim();
        if (!trimmed) return;
        if (customFields.some(f => f.name === trimmed)) {
            alert('字段名已存在');
            return;
        }
        setCustomFields([...customFields, { name: trimmed, type: newFieldType }]);
        setNewFieldName('');
    };

    const removeCustomField = (fieldName: string) => {
        setCustomFields(customFields.filter(f => f.name !== fieldName));
    };

    const updateFieldType = (fieldName: string, newType: string) => {
        setCustomFields(customFields.map(f =>
            f.name === fieldName ? { ...f, type: newType } : f
        ));
    };

    const getFieldType = (fieldName: string): string => {
        const field = customFields.find(f => f.name === fieldName);
        return field ? field.type : 'uint16';
    };

    // Expose getNodes and loadNodes methods via ref
    React.useImperativeHandle(ref, () => ({
        getNodes: () => nodes,
        loadNodes: (newNodes: DecisionTreeNode[]) => setNodes(newNodes)
    }), [nodes]);

    // 响应式画布大小
    React.useEffect(() => {
        const updateSize = () => {
            setCanvasSize({
                width: window.innerWidth - 450,
                height: window.innerHeight - 200
            });
        };

        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Handle wheel zoom
    const handleWheel = (e: any) => {
        e.evt.preventDefault();

        const scaleBy = 1.1;
        const stage = e.target.getStage();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        const clampedScale = Math.max(0.1, Math.min(3, newScale));

        setStageScale(clampedScale);
        setStagePos({
            x: pointer.x - mousePointTo.x * clampedScale,
            y: pointer.y - mousePointTo.y * clampedScale,
        });
    };

    // 添加节点
    const addNode = (type: DecisionTreeNode['type'], zoneId?: string) => {
        let data: any;
        if (type === 'condition') {
            data = { field: customFields[0]?.name || 'own_robot_hp', value_type: customFields[0]?.type || 'uint16', operator: '<', threshold: 500, priority: nodes.filter(n => n.type === 'condition').length + 1 };
        } else if (type === 'action') {
            data = { action: defaultAction(), duration: 0 };
        } else if (type === 'param') {
            data = { node_name: '/serial_interfaces', param_name: 'alpha1', param_value: '0.2', param_type: 'double' };
        } else if (type === 'zone') {
            const zone = zones.find(z => z.id === zoneId);
            if (!zone) return;
            data = {
                zone_id: zone.id,
                zone_name: zone.name,
                priority: zone.priority,
                conditions: [],
                action: null,
                params: []
            };
        }
        const newNode: DecisionTreeNode = {
            id: `node-${Date.now()}`,
            type,
            x: 400 + Math.random() * 200,
            y: 100 + (nodes.length % 5) * 120,
            data,
            children: []
        };
        setNodes([...nodes, newNode]);
        setSelectedNodeId(newNode.id);
    };

    // 连接节点
    const connectNodes = (childId: string) => {
        if (!sourceNodeId) return;

        setNodes(nodes.map(n => {
            if (n.id === sourceNodeId) {
                return { ...n, children: [...n.children, childId] };
            }
            return n;
        }));

        setSourceNodeId(null);
        setConnectMode(false);
    };

    // 更新节点数据
    const updateNodeData = (nodeId: string, data: any) => {
        setNodes(nodes.map(n => n.id === nodeId ? { ...n, data } : n));
    };

    // 删除节点
    const deleteNode = (nodeId: string) => {
        const updatedNodes = nodes
            .filter(n => n.id !== nodeId)
            .map(n => ({
                ...n,
                children: n.children.filter(c => c !== nodeId)
            }));
        setNodes(updatedNodes);
        setSelectedNodeId(null);
    };

    // 渲染单个节点
    const renderNode = (node: DecisionTreeNode) => {
        const isSelected = selectedNodeId === node.id;
        const isSource = sourceNodeId === node.id;

        let fillColor = '#fff';
        let strokeColor = '#667eea';
        let label = '';
        const nodeH = node.type === 'zone' ? 110 : NODE_HEIGHT;

        if (node.type === 'condition') {
            fillColor = isSelected ? '#d1d8ff' : '#e3e8ff';
            strokeColor = '#667eea';
            label = `⚡ 优先级 ${node.data.priority}\n${node.data.field} ${node.data.operator} ${node.data.threshold}`;
        } else if (node.type === 'action') {
            fillColor = isSelected ? '#ffd1e3' : '#ffe3f0';
            strokeColor = '#f5576c';

            if (node.data.actions && node.data.actions.length > 0) {
                const count = node.data.actions.length;
                const loopIcon = node.data.loop ? ' 🔄' : '';
                const firstAction = node.data.actions[0];
                if (count > 1) {
                    label = `🚀 动作组 (${count})${loopIcon}\n1. ${formatActionLabel(firstAction)}...`;
                } else {
                    label = `🎯 ${formatActionLabel(firstAction)}${loopIcon}`;
                }
            } else {
                label = `🎯 ${formatActionLabel(node.data.action)}`;
            }
        } else if (node.type === 'zone') {
            fillColor = isSelected ? '#c3f0ea' : '#e0faf6';
            strokeColor = '#00b4a6';
            const condCount = node.data.conditions?.length ?? 0;
            const actName = node.data.action?.action ? formatActionLabel(node.data.action.action) : '未设置';
            const paramCount = node.data.params?.length ?? 0;
            label = `🗺️ ${node.data.zone_name}\n▸ ${condCount}条件 · ${actName} · ${paramCount}参数`;
        } else {
            // Param node
            fillColor = isSelected ? '#d1fae5' : '#ecfdf5';
            strokeColor = '#10b981';
            label = `🔧 参数\n${node.data.param_name}: ${node.data.param_value}`;
        }

        return (
            <Group
                key={node.id}
                x={node.x}
                y={node.y}
                draggable
                onDragStart={(e) => {
                    e.cancelBubble = true;
                    setIsDraggingStage(true);
                }}
                onDragEnd={(e) => {
                    e.cancelBubble = true;
                    setIsDraggingStage(false);
                    const updatedNodes = nodes.map(n =>
                        n.id === node.id ? { ...n, x: e.target.x(), y: e.target.y() } : n
                    );
                    setNodes(updatedNodes);
                }}
                onClick={() => {
                    if (connectMode && sourceNodeId && sourceNodeId !== node.id) {
                        connectNodes(node.id);
                    } else {
                        setSelectedNodeId(node.id);
                    }
                }}
            >
                <Rect
                    x={0}
                    y={0}
                    width={NODE_WIDTH}
                    height={nodeH}
                    fill={fillColor}
                    stroke={isSource ? '#ff0000' : strokeColor}
                    strokeWidth={isSelected ? 4 : isSource ? 3 : 2}
                    cornerRadius={node.type === 'zone' ? 14 : 10}
                    shadowBlur={isSelected ? 12 : 6}
                    shadowColor="rgba(0,0,0,0.3)"
                    perfectDrawEnabled={false}
                />
                {/* Zone: colored top bar */}
                {node.type === 'zone' && (
                    <Rect
                        x={0} y={0}
                        width={NODE_WIDTH} height={22}
                        fill={isSelected ? '#00b4a6' : '#1ecfc0'}
                        cornerRadius={[14, 14, 0, 0]}
                        perfectDrawEnabled={false}
                        listening={false}
                    />
                )}
                <Text
                    x={10}
                    y={node.type === 'zone' ? 28 : 25}
                    width={NODE_WIDTH - 20}
                    text={label}
                    fontSize={node.type === 'zone' ? 12 : 14}
                    fontFamily="Arial"
                    fontStyle="bold"
                    fill="#333"
                    align="center"
                    perfectDrawEnabled={false}
                />
                {node.type === 'zone' && (
                    <Text
                        x={0} y={5}
                        width={NODE_WIDTH}
                        text="区域规则"
                        fontSize={11}
                        fontFamily="Arial"
                        fill="white"
                        align="center"
                        perfectDrawEnabled={false}
                        listening={false}
                    />
                )}
            </Group>
        );
    };


    // 渲染曲线连接
    const renderConnections = () => {
        const connections: JSX.Element[] = [];

        nodes.forEach(node => {
            node.children.forEach(childId => {
                const child = nodes.find(n => n.id === childId);
                if (child) {
                    // 起点：节点底部中心
                    const startX = node.x + NODE_WIDTH / 2;
                    const startY = node.y + NODE_HEIGHT;

                    // 终点：子节点顶部中心
                    const endX = child.x + NODE_WIDTH / 2;
                    const endY = child.y;

                    // 贝塞尔曲线控制点
                    const controlOffset = Math.abs(endY - startY) / 2;
                    const cp1X = startX;
                    const cp1Y = startY + controlOffset;
                    const cp2X = endX;
                    const cp2Y = endY - controlOffset;

                    connections.push(
                        <React.Fragment key={`${node.id}-${childId}`}>
                            {/* 曲线 */}
                            <Line
                                points={[startX, startY, cp1X, cp1Y, cp2X, cp2Y, endX, endY]}
                                stroke="#667eea"
                                strokeWidth={3}
                                hitStrokeWidth={15}
                                bezier
                                listening={true}
                                perfectDrawEnabled={false}
                                onMouseEnter={(e: any) => {
                                    const container = e.target.getStage()?.container();
                                    if (container) container.style.cursor = 'pointer';
                                    e.target.stroke('#ff4d4f');
                                    e.target.strokeWidth(4);
                                }}
                                onMouseLeave={(e: any) => {
                                    const container = e.target.getStage()?.container();
                                    if (container) container.style.cursor = 'default';
                                    e.target.stroke('#667eea');
                                    e.target.strokeWidth(3);
                                }}
                                onClick={(e: any) => {
                                    e.cancelBubble = true;
                                    if (window.confirm('确定要断开这两个节点的连接吗？')) {
                                        setNodes(nodes.map(n => n.id === node.id ? { ...n, children: n.children.filter(id => id !== childId) } : n));
                                    }
                                }}
                            />
                            {/* 箭头 */}
                            <Line
                                points={[
                                    endX, endY,
                                    endX - 8, endY - 12,
                                    endX + 8, endY - 12,
                                    endX, endY
                                ]}
                                fill="#667eea"
                                stroke="#667eea"
                                strokeWidth={1}
                                closed
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        </React.Fragment>
                    );
                }
            });
        });

        return connections;
    };

    return (
        <div className="canvas-decision-tree">
            <div className="canvas-toolbar">
                <h3>🌲 节点工具</h3>
                <button onClick={() => addNode('condition')} className="toolbar-btn condition-btn">
                    ⚡ 条件节点
                </button>
                <button onClick={() => addNode('action')} className="toolbar-btn action-btn">
                    🎯 动作节点
                </button>
                <button onClick={() => addNode('param')} className="toolbar-btn param-btn">
                    🔧 参数节点
                </button>

                {/* Zone node picker */}
                {zones.length > 0 && (
                    <div style={{ marginTop: '0.3rem' }}>
                        <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.25rem' }}>地图区域节点:</div>
                        <select
                            defaultValue=""
                            className="zone-node-picker"
                            onChange={(e) => {
                                if (e.target.value) {
                                    addNode('zone', e.target.value);
                                    e.target.value = '';
                                }
                            }}
                        >
                            <option value="">🗺️ 添加区域节点…</option>
                            {zones.map(z => (
                                <option key={z.id} value={z.id}>{z.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                {zones.length === 0 && (
                    <div style={{ fontSize: '0.78rem', color: '#bbb', padding: '0.3rem', background: '#f8f8f8', borderRadius: '5px', textAlign: 'center' }}>
                        🗺️ 暂无地图区域<br/>请先在地图编辑中绘制区域
                    </div>
                )}

                <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid #ddd' }} />

                <button
                    onClick={() => {
                        if (selectedNodeId) {
                            setSourceNodeId(selectedNodeId);
                            setConnectMode(true);
                        } else {
                            alert('请先选择一个节点作为起点');
                        }
                    }}
                    className="toolbar-btn connect-btn"
                    disabled={!selectedNodeId}
                >
                    🔗 连接节点
                </button>

                <button onClick={() => { setNodes([]); localStorage.removeItem(STORAGE_KEY_NODES); }} className="toolbar-btn clear-btn">
                    🗑️ 清空画布
                </button>

                <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid #ddd' }} />

                <div className="zoom-info">
                    <span>缩放: {(stageScale * 100).toFixed(0)}%</span>
                    <button onClick={() => { setStageScale(1); setStagePos({ x: 0, y: 0 }); }}>
                        重置视图
                    </button>
                </div>

                {connectMode && (
                    <div className="connect-hint">
                        <p>👆 点击目标节点</p>
                        <button onClick={() => {
                            setConnectMode(false);
                            setSourceNodeId(null);
                        }}>取消</button>
                    </div>
                )}

                <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid #ddd' }} />

                <button onClick={() => setShowFieldManager(!showFieldManager)} className="toolbar-btn">
                    📋 变量管理 {showFieldManager ? '▲' : '▼'}
                </button>

                {showFieldManager && (
                    <div className="field-manager">
                        <div className="field-manager-list">
                            {customFields.map(f => (
                                <div key={f.name} className="field-item">
                                    <span className="field-name" title={f.name}>{f.name}</span>
                                    <select
                                        value={f.type}
                                        onChange={(e) => updateFieldType(f.name, e.target.value)}
                                    >
                                        {AVAILABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <button
                                        onClick={() => removeCustomField(f.name)}
                                        className="field-delete-btn"
                                        title="删除"
                                    >✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="field-add-row">
                            <input
                                type="text"
                                value={newFieldName}
                                onChange={(e) => setNewFieldName(e.target.value)}
                                placeholder="变量名"
                                onKeyDown={(e) => e.key === 'Enter' && addCustomField()}
                            />
                            <select
                                value={newFieldType}
                                onChange={(e) => setNewFieldType(e.target.value)}
                            >
                                {AVAILABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <button onClick={addCustomField}>+</button>
                        </div>
                    </div>
                )}
            </div>

            <Stage
                width={canvasSize.width}
                height={canvasSize.height}
                className="decision-canvas"
                scaleX={stageScale}
                scaleY={stageScale}
                x={stagePos.x}
                y={stagePos.y}
                onWheel={handleWheel}
                draggable={!isDraggingStage}
                onDragEnd={(e) => {
                    setStagePos({
                        x: e.target.x(),
                        y: e.target.y()
                    });
                }}
            >
                <Layer>
                    {/* 背景网格 - 优化：使用更大间距减少元素数量 */}
                    {Array.from({ length: Math.ceil(canvasSize.height / 60) }).map((_, i) => (
                        <Line
                            key={`h-${i}`}
                            points={[0, i * 60, canvasSize.width, i * 60]}
                            stroke="#f0f0f0"
                            strokeWidth={1}
                            listening={false}
                            perfectDrawEnabled={false}
                        />
                    ))}
                    {Array.from({ length: Math.ceil(canvasSize.width / 60) }).map((_, i) => (
                        <Line
                            key={`v-${i}`}
                            points={[i * 60, 0, i * 60, canvasSize.height]}
                            stroke="#f0f0f0"
                            strokeWidth={1}
                            listening={false}
                            perfectDrawEnabled={false}
                        />
                    ))}

                    {/* 连线 */}
                    {renderConnections()}

                    {/* 节点 */}
                    {nodes.map(renderNode)}
                </Layer>
            </Stage>

            {/* 节点编辑面板 */}
            {selectedNode && (
                <div className="node-editor-panel">
                    <h4>📝 编辑节点</h4>

                    {selectedNode.type === 'condition' && (
                        <>
                            <div className="input-group">
                                <label>优先级:</label>
                                <input
                                    type="number"
                                    value={selectedNode.data.priority}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, priority: Number(e.target.value) })}
                                    min="1"
                                />
                            </div>

                            <div className="input-group">
                                <label>字段:</label>
                                <select
                                    value={selectedNode.data.field}
                                    onChange={(e) => {
                                        const fieldName = e.target.value;
                                        const fieldType = getFieldType(fieldName);
                                        updateNodeData(selectedNode.id, { ...selectedNode.data, field: fieldName, value_type: fieldType });
                                    }}
                                >
                                    {customFields.map((f: CustomField) => <option key={f.name} value={f.name}>{f.name}</option>)}
                                </select>
                            </div>

                            <div className="input-group">
                                <label>类型:</label>
                                <select
                                    value={selectedNode.data.value_type || getFieldType(selectedNode.data.field)}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, value_type: e.target.value })}
                                >
                                    {AVAILABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>

                            <div className="input-group">
                                <label>比较符:</label>
                                <select
                                    value={selectedNode.data.operator}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, operator: e.target.value })}
                                >
                                    {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                                </select>
                            </div>

                            <div className="input-group">
                                <label>阈值:</label>
                                <input
                                    type="number"
                                    value={selectedNode.data.threshold}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, threshold: Number(e.target.value) })}
                                />
                            </div>

                            <div className="input-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!selectedNode.data.loop}
                                        onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, loop: e.target.checked })}
                                    />
                                    🔄 循环执行该序列
                                </label>
                            </div>
                        </>
                    )}

                    {selectedNode.type === 'action' && (
                        <>
                            <div style={{ marginBottom: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!selectedNode.data.actions}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                // Convert to multi-step: initialize with current action
                                                updateNodeData(selectedNode.id, {
                                                    ...selectedNode.data,
                                                    actions: [selectedNode.data.action],
                                                    loop: false
                                                });
                                            } else {
                                                // Revert to single step: take first action or default
                                                const firstAction = selectedNode.data.actions?.[0] || 'STOP';
                                                const { actions, loop, ...rest } = selectedNode.data;
                                                updateNodeData(selectedNode.id, {
                                                    ...rest,
                                                    action: firstAction
                                                });
                                            }
                                        }}
                                    />
                                    🚀 启用多动作组 (Action Group)
                                </label>
                            </div>

                            {!selectedNode.data.actions ? (
                                // Legacy Single Action Mode
                                <div className="input-group">
                                    <label>目标动作:</label>
                                    <select
                                        value={selectedNode.data.action}
                                        onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, action: e.target.value })}
                                    >
                                        {renderActionOptions(true)}
                                    </select>
                                </div>
                            ) : (
                                // Multi-step Mode
                                <div className="multi-action-editor" style={{ border: '2px solid #e8ecf1', padding: '12px', borderRadius: '10px', marginBottom: '10px', background: '#fafbfc' }}>
                                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem', color: '#334155' }}>动作序列:</label>
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {selectedNode.data.actions.map((act: string, idx: number) => (
                                            <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                <span style={{ width: '20px', lineHeight: '1', fontSize: '0.85rem', fontWeight: 600, color: '#64748b', flexShrink: 0, textAlign: 'right' }}>{idx + 1}.</span>
                                                <select
                                                    value={act}
                                                    onChange={(e) => {
                                                        const newActions = [...selectedNode.data.actions];
                                                        newActions[idx] = e.target.value;
                                                        const update: any = { actions: newActions };
                                                        if (idx === 0) update.action = e.target.value;
                                                        updateNodeData(selectedNode.id, { ...selectedNode.data, ...update });
                                                    }}
                                                    style={{ flex: 1 }}
                                                >
                                                    {renderActionOptions(false)}
                                                </select>
                                                <button
                                                    onClick={() => {
                                                        const newActions = selectedNode.data.actions.filter((_: any, i: number) => i !== idx);
                                                        const update: any = { actions: newActions };
                                                        if (idx === 0) {
                                                            update.action = newActions.length > 0 ? newActions[0] : 'STOP';
                                                        }
                                                        updateNodeData(selectedNode.id, { ...selectedNode.data, ...update });
                                                    }}
                                                    className="remove-item-btn"
                                                >✕</button>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => {
                                            const newActions = [...selectedNode.data.actions, defaultAction()];
                                            updateNodeData(selectedNode.id, { ...selectedNode.data, actions: newActions });
                                        }}
                                        className="add-sub-btn add-sub-action"
                                        style={{ width: '100%' }}
                                    >
                                        + 添加动作
                                    </button>

                                    <div className="input-group" style={{ marginTop: '10px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={!!selectedNode.data.loop}
                                                onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, loop: e.target.checked })}
                                            />
                                            🔄 组内循环执行
                                        </label>
                                    </div>
                                </div>
                            )}

                            <div className="input-group">
                                <label>任务时间 (秒, 0=无限):</label>
                                <input
                                    type="number"
                                    value={selectedNode.data.duration ?? 0}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, duration: Number(e.target.value) })}
                                    min="0"
                                    step="1"
                                />
                            </div>

                            <hr style={{ margin: '0.75rem 0 0.5rem', border: 'none', borderTop: '1px solid #e0e0e0' }} />

                            <div className="input-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!selectedNode.data.exit_condition}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                updateNodeData(selectedNode.id, {
                                                    ...selectedNode.data,
                                                    exit_condition: {
                                                        field: customFields[0]?.name || 'current_hp',
                                                        value_type: customFields[0]?.type || 'uint16',
                                                        operator: '>=',
                                                        threshold: 600
                                                    }
                                                });
                                            } else {
                                                const { exit_condition, ...rest } = selectedNode.data;
                                                updateNodeData(selectedNode.id, rest);
                                            }
                                        }}
                                    />
                                    🔒 退出条件（锁定直到满足）
                                </label>
                            </div>

                            {selectedNode.data.exit_condition && (
                                <>
                                    <div className="input-group">
                                        <label>退出字段:</label>
                                        <select
                                            value={selectedNode.data.exit_condition.field}
                                            onChange={(e) => {
                                                const fieldName = e.target.value;
                                                const fieldType = getFieldType(fieldName);
                                                updateNodeData(selectedNode.id, {
                                                    ...selectedNode.data,
                                                    exit_condition: { ...selectedNode.data.exit_condition, field: fieldName, value_type: fieldType }
                                                });
                                            }}
                                        >
                                            {customFields.map((f: CustomField) => <option key={f.name} value={f.name}>{f.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label>退出比较符:</label>
                                        <select
                                            value={selectedNode.data.exit_condition.operator}
                                            onChange={(e) => updateNodeData(selectedNode.id, {
                                                ...selectedNode.data,
                                                exit_condition: { ...selectedNode.data.exit_condition, operator: e.target.value }
                                            })}
                                        >
                                            {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label>退出阈值:</label>
                                        <input
                                            type="number"
                                            value={selectedNode.data.exit_condition.threshold}
                                            onChange={(e) => updateNodeData(selectedNode.id, {
                                                ...selectedNode.data,
                                                exit_condition: { ...selectedNode.data.exit_condition, threshold: Number(e.target.value) }
                                            })}
                                        />
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {selectedNode.type === 'param' && (
                        <>
                            <div className="input-group">
                                <label>目标节点 (例如 /serial_interfaces):</label>
                                <input
                                    type="text"
                                    value={selectedNode.data.node_name}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, node_name: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>参数名:</label>
                                <input
                                    type="text"
                                    value={selectedNode.data.param_name}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, param_name: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>参数类型:</label>
                                <select
                                    value={selectedNode.data.param_type}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, param_type: e.target.value })}
                                >
                                    <option value="double">Double (浮点数)</option>
                                    <option value="int">Int (整数)</option>
                                    <option value="bool">Bool (布尔值)</option>
                                    <option value="string">String (字符串)</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label>参数值:</label>
                                <input
                                    type="text"
                                    value={selectedNode.data.param_value}
                                    onChange={(e) => updateNodeData(selectedNode.id, { ...selectedNode.data, param_value: e.target.value })}
                                />
                            </div>
                        </>
                    )}

                    {selectedNode.type === 'zone' && (() => {
                        const zd = selectedNode.data;
                        const allFields = Object.keys(REFEREE_FIELD_TYPES);
                        const ops = ['>', '<', '>=', '<=', '==', '!='];
                        const paramTypes = ['string', 'int', 'double', 'bool'];
                        const upd = (patch: any) => updateNodeData(selectedNode.id, { ...zd, ...patch });

                        return (
                            <div className="zone-node-editor">
                                {/* Zone info info */}
                                <div className="zone-info-badge">
                                    <span style={{ fontSize: '1.2rem' }}>🗺️</span>
                                    <div>
                                        <strong>{zd.zone_name}</strong>
                                        {zones.find((z: ZoneRule) => z.id === zd.zone_id)?.worldRect && (() => {
                                            const wr = zones.find((z: ZoneRule) => z.id === zd.zone_id)!.worldRect;
                                            return <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>世界坐标: ({wr.x1.toFixed(2)}, {wr.y1.toFixed(2)}) ➜ ({wr.x2.toFixed(2)}, {wr.y2.toFixed(2)})</div>;
                                        })()}
                                    </div>
                                </div>

                                {/* Priority */}
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <label>🔥 优先级 (数值越小越优先):</label>
                                    <input type="number" min={1} value={zd.priority}
                                        onChange={e => upd({ priority: Number(e.target.value) })} />
                                </div>

                                {/* ── Conditions Card ── */}
                                <div className="config-group-card">
                                    <div className="config-group-header header-condition">
                                        <span>🔍 触发条件 (AND)</span>
                                        <button
                                            className="add-sub-btn add-sub-condition"
                                            onClick={() => upd({ conditions: [...(zd.conditions || []), { type: 'Condition', field: 'own_robot_hp', value_type: 'uint16', operator: '<', threshold: 0 }] })}
                                        >+ 添加</button>
                                    </div>
                                    <div className="config-group-content">
                                        {(!zd.conditions || zd.conditions.length === 0) ? (
                                            <div style={{ color: '#bbb', fontSize: '0.8rem', textAlign: 'center', padding: '0.5rem' }}>无条件限制（始终触发）</div>
                                        ) : (
                                            (zd.conditions || []).map((cond: any, ci: number) => (
                                                <div key={ci} className="config-item-row">
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <select value={cond.field} style={{ flex: '1 1 90px', minWidth: 0 }}
                                                            onChange={e => {
                                                                const f = e.target.value; const vt = (REFEREE_FIELD_TYPES as any)[f] || 'uint16';
                                                                const cs = zd.conditions.map((c: any, i: number) => i === ci ? { ...c, field: f, value_type: vt } : c);
                                                                upd({ conditions: cs });
                                                            }}>
                                                            {allFields.map(f => <option key={f} value={f}>{f}</option>)}
                                                        </select>
                                                        <select value={cond.operator} style={{ width: '52px', flexShrink: 0 }}
                                                            onChange={e => { const cs = zd.conditions.map((c: any, i: number) => i === ci ? { ...c, operator: e.target.value } : c); upd({ conditions: cs }); }}>
                                                            {ops.map(op => <option key={op} value={op}>{op}</option>)}
                                                        </select>
                                                        <input type="number" value={cond.threshold} style={{ width: '68px', flexShrink: 0 }}
                                                            onChange={e => { const cs = zd.conditions.map((c: any, i: number) => i === ci ? { ...c, threshold: Number(e.target.value) } : c); upd({ conditions: cs }); }} />
                                                        <button onClick={() => upd({ conditions: zd.conditions.filter((_: any, i: number) => i !== ci) })}
                                                            className="remove-item-btn">✕</button>
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4, paddingLeft: 4 }}>数据类型: {cond.value_type}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* ── Action Card ── */}
                                <div className="config-group-card">
                                    <div className="config-group-header header-action">
                                        <span>⚡ 执行动作</span>
                                        {!zd.action && (
                                            <button
                                                className="add-sub-btn add-sub-action"
                                                onClick={() => upd({ action: { type: 'Action', action: defaultAction(), loop: false, duration: 0 } })}
                                            >+ 设置</button>
                                        )}
                                    </div>
                                    <div className="config-group-content">
                                        {!zd.action ? (
                                            <div style={{ color: '#bbb', fontSize: '0.8rem', textAlign: 'center', padding: '0.5rem' }}>未配置区域动作</div>
                                        ) : (
                                            <div className="config-item-row" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                                                <div style={{ marginBottom: '0.5rem' }}>
                                                    <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>目标位置:</label>
                                                    <select className="zone-action-select" value={zd.action.action}
                                                        onChange={e => upd({ action: { ...zd.action, action: e.target.value } })}>
                                                        {renderActionOptions(false)}
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.78rem' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                                            <input type="checkbox" checked={!!zd.action.loop}
                                                                onChange={e => upd({ action: { ...zd.action, loop: e.target.checked } })} />
                                                            🔄 循环
                                                        </label>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            ⏱️ 时长:
                                                            <input type="number" min={0} step={0.5} value={zd.action.duration ?? 0}
                                                                className="zone-inline-input"
                                                                style={{ width: '52px' }}
                                                                onChange={e => upd({ action: { ...zd.action, duration: Number(e.target.value) } })} />
                                                            s
                                                        </label>
                                                    </div>
                                                    <button onClick={() => upd({ action: null })}
                                                        className="remove-item-btn" style={{ padding: '2px 6px' }}>移除</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* ── Params Card ── */}
                                <div className="config-group-card" style={{ marginBottom: '0.5rem' }}>
                                    <div className="config-group-header header-param">
                                        <span>🔧 参数设置</span>
                                        <button
                                            className="add-sub-btn add-sub-param"
                                            onClick={() => upd({ params: [...(zd.params || []), { type: 'Param', node_name: '', param_name: '', param_value: '', param_type: 'string' }] })}
                                        >+ 添加</button>
                                    </div>
                                    <div className="config-group-content">
                                        {(!zd.params || zd.params.length === 0) ? (
                                            <div style={{ color: '#bbb', fontSize: '0.8rem', textAlign: 'center', padding: '0.5rem' }}>无参数调整需求</div>
                                        ) : (
                                            (zd.params || []).map((param: any, pi: number) => (
                                                <div key={pi} className="config-item-row">
                                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '0.35rem' }}>
                                                        <input type="text" placeholder="节点名" value={param.node_name} className="zone-inline-input" style={{ flex: 1, minWidth: 50 }}
                                                            onChange={e => { const ps = zd.params.map((p: any, i: number) => i === pi ? { ...p, node_name: e.target.value } : p); upd({ params: ps }); }} />
                                                        <span style={{ color: '#94a3b8', fontSize: '0.8rem', flexShrink: 0 }}>/</span>
                                                        <input type="text" placeholder="参数名" value={param.param_name} className="zone-inline-input" style={{ flex: 1, minWidth: 50 }}
                                                            onChange={e => { const ps = zd.params.map((p: any, i: number) => i === pi ? { ...p, param_name: e.target.value } : p); upd({ params: ps }); }} />
                                                        <button onClick={() => upd({ params: zd.params.filter((_: any, i: number) => i !== pi) })}
                                                            className="remove-item-btn">✕</button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                        <select value={param.param_type} style={{ width: 70, flexShrink: 0 }}
                                                            onChange={e => { const ps = zd.params.map((p: any, i: number) => i === pi ? { ...p, param_type: e.target.value } : p); upd({ params: ps }); }}>
                                                            {paramTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                        <span style={{ color: '#cbd5e1', fontSize: '0.8rem', flexShrink: 0 }}>=</span>
                                                        <input type="text" placeholder="值" value={String(param.param_value)} className="zone-inline-input" style={{ flex: 1 }}
                                                            onChange={e => { const ps = zd.params.map((p: any, i: number) => i === pi ? { ...p, param_value: e.target.value } : p); upd({ params: ps }); }} />
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    <hr style={{ margin: '1.25rem 0', border: 'none', borderTop: '1px solid #f1f5f9' }} />
                    <div className="node-connections">
                        <strong style={{ fontSize: '0.95rem', color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>🔗 决策链路关系</strong>
                        
                        {/* 该节点的父节点 */}
                        {nodes.filter(n => n.children.includes(selectedNode.id)).length > 0 && (
                            <div style={{ marginTop: '0.75rem' }}>
                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem' }}>上级依赖节点:</div>
                                <div className="connection-list">
                                    {nodes.filter(n => n.children.includes(selectedNode.id)).map(parent => (
                                        <div key={parent.id} className="connection-item">
                                            <span className="connection-label" title={parent.type === 'zone' ? parent.data.zone_name : parent.type === 'action' ? formatActionLabel(parent.data.action) : parent.type === 'condition' ? `⚡ 条件 (优先:${parent.data.priority})` : '🔧 参数'}>
                                                {parent.type === 'zone' ? `🗺️ ${parent.data.zone_name}` :
                                                 parent.type === 'action' ? formatActionLabel(parent.data.action) :
                                                 parent.type === 'condition' ? `⚡ 条件 (优先:${parent.data.priority})` : '🔧 参数'}
                                            </span>
                                            <button 
                                                className="disconnect-btn"
                                                onClick={() => {
                                                    setNodes(nodes.map(n => n.id === parent.id ? { ...n, children: n.children.filter(id => id !== selectedNode.id) } : n));
                                                }}
                                            >
                                                断开
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* 该节点的子节点 */}
                        {selectedNode.children.length > 0 && (
                            <div style={{ marginTop: '0.75rem' }}>
                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem' }}>下级执行节点:</div>
                                <div className="connection-list">
                                    {selectedNode.children.map(childId => {
                                        const child = nodes.find(n => n.id === childId);
                                        if (!child) return null;
                                        return (
                                            <div key={childId} className="connection-item">
                                                <span className="connection-label" title={child.type === 'zone' ? child.data.zone_name : child.type === 'action' ? formatActionLabel(child.data.action) : child.type === 'condition' ? `⚡ 条件 (优先:${child.data.priority})` : '🔧 参数'}>
                                                    {child.type === 'zone' ? `🗺️ ${child.data.zone_name}` :
                                                     child.type === 'action' ? formatActionLabel(child.data.action) :
                                                     child.type === 'condition' ? `⚡ 条件 (优先:${child.data.priority})` : '🔧 参数'}
                                                </span>
                                                <button 
                                                    className="disconnect-btn"
                                                    onClick={() => {
                                                        setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, children: n.children.filter(id => id !== childId) } : n));
                                                    }}
                                                >
                                                    断开
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {nodes.filter(n => n.children.includes(selectedNode.id)).length === 0 && selectedNode.children.length === 0 && (
                            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic', textAlign: 'center', background: '#f8fafc', padding: '0.6rem', borderRadius: '8px', border: '1px dashed #e2e8f0' }}>该节点当前无连接关系</div>
                        )}
                    </div>

                    <div className="panel-actions">
                        <button onClick={() => deleteNode(selectedNode.id)} className="delete-btn">
                            🗑️ 删除节点
                        </button>
                        <button onClick={() => setSelectedNodeId(null)} className="close-panel-btn">
                            关闭
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

