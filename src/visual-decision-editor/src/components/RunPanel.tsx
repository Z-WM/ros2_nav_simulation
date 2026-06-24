import { useRos } from '../ros/RosContext';

interface RunPanelProps {
    running: boolean;
    status: string;
    targetWaypoint: string;
    onRun: () => void;
    onStop: () => void;
}

/**
 * rosbridge connect/disconnect + decision run/pause controls.
 * Sits in the app header next to the YAML buttons.
 */
export function RunPanel({ running, status, targetWaypoint, onRun, onStop }: RunPanelProps) {
    const ros = useRos();

    const connLabel = ros.state === 'connecting'
        ? '⏳ 连接中'
        : ros.state === 'connected'
            ? '🟢 ROS 已连接'
            : ros.state === 'error'
                ? '🔴 连接失败'
                : '⚪ 未连接';

    return (
        <div className="run-panel">
            <button
                onClick={() => (ros.state === 'connected' ? ros.disconnect() : ros.connect())}
                className="connect-btn"
                disabled={ros.state === 'connecting'}
            >
                {connLabel}
            </button>
            {!running ? (
                <button
                    onClick={onRun}
                    className="run-btn"
                    disabled={ros.state !== 'connected'}
                    title={ros.state !== 'connected' ? '请先连接 rosbridge' : '运行决策执行器'}
                >
                    ▶ 运行决策
                </button>
            ) : (
                <button onClick={onStop} className="stop-btn">
                    ⏹ 停止
                </button>
            )}
            {targetWaypoint && (
                <span className="target-badge" title="当前执行目标">
                    🎯 {targetWaypoint}
                </span>
            )}
            {status && status !== 'idle' && (
                <span className={`status-badge status-${status}`}>
                    {status === 'running' ? '🔄 执行中' : status === 'success' ? '✅ 完成' : '❌ 失败'}
                </span>
            )}
            {ros.errorMessage && (
                <span className="ros-error" title={ros.errorMessage}>{ros.errorMessage}</span>
            )}
        </div>
    );
}
