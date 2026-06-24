import React from 'react';
import ROSLIB from 'roslib';
import { Referee, Odometry, Twist, PoseStamped } from './types';
import { ParamConfig } from '../engine/DecisionTreeTypes';

const ROSBRIDGE_URL = 'ws://localhost:9090';

export type RosConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface RosContextValue {
    state: RosConnectionState;
    errorMessage: string;
    connect: () => void;
    disconnect: () => void;
    latestReferee: Referee | null;
    latestOdom: Odometry | null;
    // Action / publisher / service callbacks wired to roslibjs.
    sendNavigationGoal: (waypointName: string, pose: PoseStamped) => void;
    sendNavigationGoalToPose: (x: number, y: number, label: string) => void;
    cancelCurrentGoal: () => void;
    publishCmdVel: (twist: Twist) => void;
    setRemoteParameter: (config: ParamConfig) => void;
}

const RosContext = React.createContext<RosContextValue | null>(null);

export function RosProvider({ children }: { children: React.ReactNode }) {
    const rosRef = React.useRef<ROSLIB.Ros | null>(null);
    const cmdVelPubRef = React.useRef<ROSLIB.Topic | null>(null);
    // Active nav goal id (rosbridge send_action_goal cid). Owns goal tracking so the
    // engine can stay transport-agnostic.
    const currentGoalIdRef = React.useRef<string | null>(null);
    const goalCounterRef = React.useRef(0);
    const socketListenerRef = React.useRef<((ev: MessageEvent) => void) | null>(null);

    const [state, setState] = React.useState<RosConnectionState>('disconnected');
    const [errorMessage, setErrorMessage] = React.useState('');
    const [latestReferee, setLatestReferee] = React.useState<Referee | null>(null);
    const [latestOdom, setLatestOdom] = React.useState<Odometry | null>(null);

    const resultListeners = React.useRef<Array<(goalId: string, succeeded: boolean) => void>>([]);

    const teardown = React.useCallback(() => {
        // Remove our raw message listener from the underlying WebSocket.
        const ros = rosRef.current;
        if (ros && socketListenerRef.current) {
            try { ((ros as any).socket as WebSocket).removeEventListener('message', socketListenerRef.current); }
            catch { /* ignore */ }
        }
        socketListenerRef.current = null;
        currentGoalIdRef.current = null;
        cmdVelPubRef.current = null;
        if (ros) {
            try { ros.close(); } catch { /* ignore */ }
            rosRef.current = null;
        }
    }, []);

    const connect = React.useCallback(() => {
        if (rosRef.current) return;
        setState('connecting');
        setErrorMessage('');
        const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
        rosRef.current = ros;

        ros.on('connection', () => {
            setState('connected');
            // Subscribers
            const refereeTopic = new ROSLIB.Topic({
                ros, name: '/referee', messageType: 'sentry_msgs/msg/Referee',
                throttle_rate: 0,
            });
            refereeTopic.subscribe((msg) => setLatestReferee(msg as unknown as Referee));

            const odomTopic = new ROSLIB.Topic({
                ros, name: '/odom', messageType: 'nav_msgs/msg/Odometry',
            });
            odomTopic.subscribe((msg) => setLatestOdom(msg as unknown as Odometry));

            // cmd_vel publisher
            cmdVelPubRef.current = new ROSLIB.Topic({
                ros, name: 'cmd_vel', messageType: 'geometry_msgs/msg/Twist',
            });

            // Nav2 action results come back as the rosbridge `action_result` op, which
            // roslibjs's SocketAdapter silently drops. Listen on the raw WebSocket via
            // addEventListener (independent of roslibjs's onmessage) to catch them.
            const onMessage = (ev: MessageEvent) => {
                let msg: any;
                try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}'); }
                catch { return; }
                if (!msg || msg.op !== 'action_result') return;
                // Only forward results for the currently-active goal (mirrors C++
                // resultCallback ignoring non-current goals).
                if (currentGoalIdRef.current == null || msg.id !== currentGoalIdRef.current) return;
                const cid = currentGoalIdRef.current;
                const succeeded = msg.result === true && Number(msg.status) === 4; // STATUS_SUCCEEDED
                currentGoalIdRef.current = null;
                resultListeners.current.forEach((fn) => fn(cid, succeeded));
            };
            socketListenerRef.current = onMessage;
            try { ((ros as any).socket as WebSocket).addEventListener('message', onMessage); }
            catch { /* socket not ready */ }
        });

        ros.on('error', (err) => {
            setState('error');
            setErrorMessage(err?.message || String(err) || 'rosbridge error');
        });
        ros.on('close', () => {
            setState('disconnected');
        });
    }, []);

    const disconnect = React.useCallback(() => { teardown(); setState('disconnected'); }, [teardown]);

    // Cleanup on unmount
    React.useEffect(() => () => { teardown(); }, [teardown]);

    const sendGoalPose = React.useCallback((poseStamped: PoseStamped) => {
        const ros = rosRef.current;
        if (!ros) return;
        const cid = `nav-${Date.now()}-${++goalCounterRef.current}`;
        currentGoalIdRef.current = cid;
        // rosbridge native action op (ROS2). roslibjs has no ROS2 action support, so we
        // send the raw op via callOnConnection.
        ros.callOnConnection({
            op: 'send_action_goal',
            id: cid,
            action: '/navigate_to_pose',
            action_type: 'nav2_msgs/action/NavigateToPose',
            args: { pose: poseStamped, behavior_tree: '' },
            feedback: false,
        } as any);
    }, []);

    const registerResultListener = React.useCallback((fn: (goalId: string, succeeded: boolean) => void) => {
        resultListeners.current.push(fn);
        return () => {
            resultListeners.current = resultListeners.current.filter((f) => f !== fn);
        };
    }, []);

    const value: RosContextValue = {
        state, errorMessage,
        connect, disconnect,
        latestReferee, latestOdom,
        sendNavigationGoal: (_name, pose) => sendGoalPose(pose),
        sendNavigationGoalToPose: (x, y, _label) => sendGoalPose({
            header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
            pose: {
                position: { x, y, z: 0.0 },
                orientation: { x: 0, y: 0, z: 0, w: 1.0 },
            },
        }),
        cancelCurrentGoal: () => {
            const ros = rosRef.current;
            const cid = currentGoalIdRef.current;
            if (ros && cid) {
                ros.callOnConnection({
                    op: 'cancel_action_goal',
                    id: cid,
                    action: '/navigate_to_pose',
                } as any);
            }
            currentGoalIdRef.current = null;
        },
        publishCmdVel: (twist) => {
            cmdVelPubRef.current?.publish(twist);
        },
        setRemoteParameter: (config) => {
            if (!rosRef.current) return;
            const serviceName = `/${config.node_name}/set_parameters`;
            const paramValue: any = (() => {
                switch (config.param_type) {
                    case 'int': return { type: 2, int_value: parseInt(config.param_value, 10) };
                    case 'double': return { type: 3, double_value: parseFloat(config.param_value) };
                    case 'bool': return { type: 1, bool_value: config.param_value === 'true' || config.param_value === '1' };
                    default: return { type: 4, string_value: config.param_value };
                }
            })();
            const request = new ROSLIB.ServiceRequest({
                parameters: [{ name: config.param_name, value: paramValue }],
            });
            const srv = new ROSLIB.Service({
                ros: rosRef.current, name: serviceName,
                serviceType: 'rcl_interfaces/srv/SetParameters',
            });
            try { srv.callService(request, () => { /* fire and forget */ }); } catch { /* ignore */ }
        },
    };

    // expose registerResultListener via a side channel attached to value (hack-free: custom hook)
    (value as any).__registerResultListener = registerResultListener;

    return <RosContext.Provider value={value}>{children}</RosContext.Provider>;
}

export function useRos(): RosContextValue {
    const ctx = React.useContext(RosContext);
    if (!ctx) throw new Error('useRos must be used within RosProvider');
    return ctx;
}

/** Register a listener for nav action results (used by the engine to update state). */
export function useActionResultListener(fn: (goalId: string, succeeded: boolean) => void) {
    const ctx = React.useContext(RosContext);
    const register = (ctx as any)?.__registerResultListener as
        | ((fn: (goalId: string, succeeded: boolean) => void) => () => void)
        | undefined;
    React.useEffect(() => {
        if (!register) return;
        return register(fn);
    }, [register, fn]);
}
