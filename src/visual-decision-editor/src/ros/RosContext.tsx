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
    // Navigation is driven by publishing PoseStamped to /goal_pose (bt_navigator
    // subscribes and preempts the current goal on each new pose — same interface as
    // RViz's "2D Goal Pose"). This avoids the rosbridge action protocol entirely
    // (which crashes rosbridge 2.0.6 via ActionClient.destroy() vs. the spin thread).
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
    const goalPosePubRef = React.useRef<ROSLIB.Topic | null>(null);

    const [state, setState] = React.useState<RosConnectionState>('disconnected');
    const [errorMessage, setErrorMessage] = React.useState('');
    const [latestReferee, setLatestReferee] = React.useState<Referee | null>(null);
    const [latestOdom, setLatestOdom] = React.useState<Odometry | null>(null);

    const teardown = React.useCallback(() => {
        cmdVelPubRef.current = null;
        goalPosePubRef.current = null;
        if (rosRef.current) {
            try { rosRef.current.close(); } catch { /* ignore */ }
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
            let refereeReceivedOnce = false;
            refereeTopic.subscribe((msg) => {
                if (!refereeReceivedOnce) {
                    refereeReceivedOnce = true;
                    console.info('[ros] 收到 /referee 数据流');
                }
                setLatestReferee(msg as unknown as Referee);
            });

            const odomTopic = new ROSLIB.Topic({
                ros, name: '/odom', messageType: 'nav_msgs/msg/Odometry',
            });
            odomTopic.subscribe((msg) => setLatestOdom(msg as unknown as Odometry));

            // cmd_vel publisher (for STOP)
            cmdVelPubRef.current = new ROSLIB.Topic({
                ros, name: 'cmd_vel', messageType: 'geometry_msgs/msg/Twist',
            });

            // /goal_pose publisher — drives Nav2 navigation. A new pose preempts the
            // current goal automatically (no action cancel needed).
            goalPosePubRef.current = new ROSLIB.Topic({
                ros, name: '/goal_pose', messageType: 'geometry_msgs/msg/PoseStamped',
            });
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

    const publishGoalPose = React.useCallback((pose: PoseStamped) => {
        // Ensure header is set (frame_id='map'); roslibjs accepts a plain object.
        const msg = {
            header: pose.header?.frame_id ? pose.header : { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
            pose: pose.pose,
        };
        goalPosePubRef.current?.publish(msg as any);
    }, []);

    const value: RosContextValue = {
        state, errorMessage,
        connect, disconnect,
        latestReferee, latestOdom,
        sendNavigationGoal: (_name, pose) => publishGoalPose(pose),
        sendNavigationGoalToPose: (x, y, _label) => publishGoalPose({
            header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
            pose: {
                position: { x, y, z: 0.0 },
                orientation: { x: 0, y: 0, z: 0, w: 1.0 },
            },
        }),
        // No action cancel in topic mode; preemption is implicit via a new /goal_pose.
        // The engine calls this on STOP/branch-switch but it is a no-op here — STOP
        // publishes the current odom pose as the goal to halt the robot.
        cancelCurrentGoal: () => { /* no-op: /goal_pose preempts implicitly */ },
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

    return <RosContext.Provider value={value}>{children}</RosContext.Provider>;
}

export function useRos(): RosContextValue {
    const ctx = React.useContext(RosContext);
    if (!ctx) throw new Error('useRos must be used within RosProvider');
    return ctx;
}
