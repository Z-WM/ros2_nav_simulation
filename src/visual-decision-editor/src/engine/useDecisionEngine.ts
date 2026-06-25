import React from 'react';
import { DecisionEngine } from './DecisionEngine';
import { parseCanvasToTree } from './parseCanvasToTree';
import { useRos } from '../ros/RosContext';
import { NodeStatus } from './Status';

export interface EngineState {
    running: boolean;
    runningNodeIds: Set<string>;
    currentPathIds: string[];
    targetWaypoint: string;
    status: string;
    log: string[];
}

export function useDecisionEngine(
    canvasNodes: any[],
    zones: any[],
    waypoints: any[]
): EngineState & {
    start: () => void;
    stop: () => void;
} {
    const ros = useRos();
    const engineRef = React.useRef<DecisionEngine | null>(null);
    const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    // Keep a ref to the latest ros object so the engine's action callbacks can
    // always reach the current roslibjs client without rebuilding the engine
    // on every render (the ros value object is recreated each render).
    const rosRef = React.useRef(ros);
    rosRef.current = ros;

    const [running, setRunning] = React.useState(false);
    const [runningNodeIds, setRunningNodeIds] = React.useState<Set<string>>(new Set());
    const [currentPathIds, setCurrentPathIds] = React.useState<string[]>([]);
    const [targetWaypoint, setTargetWaypoint] = React.useState('');
    const [status, setStatus] = React.useState('idle');
    const [log, setLog] = React.useState<string[]>([]);

    const addLog = React.useCallback((msg: string) => {
        setLog((prev) => {
            const next = [...prev, msg];
            return next.length > 200 ? next.slice(next.length - 200) : next;
        });
    }, []);

    // Rebuild the tree only when the canvas config changes (NOT on every render).
    React.useEffect(() => {
        try {
            const tree = parseCanvasToTree(canvasNodes, zones, waypoints);
            engineRef.current = new DecisionEngine(
                tree.root,
                tree.waypoints,
                tree.zones,
                {
                    sendNavigationGoal: (name, pose) => {
                        rosRef.current.sendNavigationGoal(name, pose);
                        addLog(`发送导航目标: ${name}`);
                    },
                    sendNavigationGoalToPose: (x, y) => {
                        rosRef.current.sendNavigationGoalToPose(x, y, '');
                        addLog(`发送导航目标(裁判): (${x.toFixed(2)}, ${y.toFixed(2)})`);
                    },
                    cancelCurrentGoal: () => { rosRef.current.cancelCurrentGoal(); },
                    publishCmdVel: (twist) => { rosRef.current.publishCmdVel(twist); },
                    setRemoteParameter: (config) => {
                        rosRef.current.setRemoteParameter(config);
                        addLog(`设置参数 ${config.node_name}/${config.param_name}=${config.param_value}`);
                    },
                    log: (m) => addLog(m),
                }
            );
        } catch (e) {
            addLog(`构建决策树失败: ${(e as Error).message}`);
            engineRef.current = null;
        }
    }, [canvasNodes, zones, waypoints, addLog]);

    // Feed the engine the latest sensor data via refs.
    const refereeRef = React.useRef(ros.latestReferee);
    const odomRef = React.useRef(ros.latestOdom);
    React.useEffect(() => { refereeRef.current = ros.latestReferee; }, [ros.latestReferee]);
    React.useEffect(() => { odomRef.current = ros.latestOdom; }, [ros.latestOdom]);

    const tick = React.useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const ref = refereeRef.current;
        const odom = odomRef.current;
        if (ref) engine.setReferee(ref);
        if (odom) engine.setOdom(odom);

        try {
            const st = engine.tick();
            setStatus(st === NodeStatus.RUNNING ? 'running'
                : st === NodeStatus.SUCCESS ? 'success' : 'failure');
            setRunningNodeIds(new Set(engine.getRunningNodeIds()));
            setCurrentPathIds([...engine.getCurrentPathIds()]);
            setTargetWaypoint(engine.getTargetWaypoint());
        } catch (e) {
            addLog(`tick 异常: ${(e as Error).message}`);
        }
    }, [addLog]);

    const start = React.useCallback(() => {
        if (timerRef.current) return;
        if (rosRef.current.state !== 'connected') {
            addLog('未连接 rosbridge，无法运行');
            return;
        }
        if (!engineRef.current) {
            addLog('决策树未就绪');
            return;
        }
        setRunning(true);
        addLog('开始执行决策（10Hz）');
        tick();
        timerRef.current = setInterval(tick, 100);
    }, [tick, addLog]);

    const stop = React.useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setRunning(false);
        addLog('停止执行');
        rosRef.current.cancelCurrentGoal();
        setStatus('idle');
    }, []);

    React.useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    return {
        running, runningNodeIds, currentPathIds, targetWaypoint, status, log,
        start, stop,
    };
}
