import { NodeStatus } from './Status';
import { isPointInPolygon } from './pointInPolygon';
import { getFieldValue } from './fieldMapper';
import {
    DecisionNode,
    ConditionNode,
    ActionNode,
    SelectorNode,
    SequenceNode,
    ParamNode,
    ZoneNode,
    ParamConfig,
} from './DecisionTreeTypes';
import { Referee, Odometry, Twist, PoseStamped } from '../ros/types';

const REFEREE_TARGET_ACTION = 'REFEREE_TARGET';
const REFEREE_TARGET_EPSILON = 0.05;

/**
 * Action execution callbacks injected by the ROS bridge (roslibjs).
 * The engine calls these instead of issuing ROS calls directly, keeping it
 * decoupled from the transport and 1:1 with the C++ DecisionExecutor's
 * sendNavigationGoal / cancelCurrentGoal / cmd_vel publish / setRemoteParameter.
 */
export interface ActionCallbacks {
    sendNavigationGoal: (waypointName: string, pose: PoseStamped) => void;
    sendNavigationGoalToPose: (x: number, y: number, label: string) => void;
    cancelCurrentGoal: () => void;
    publishCmdVel: (twist: Twist) => void;
    setRemoteParameter: (config: ParamConfig) => void;
    log?: (msg: string) => void;
}

/** Mirrors decision_executor::ExecutionContext (DecisionExecutor.hpp:34-54). */
interface ExecutionContext {
    currentSequence: SequenceNode | null;
    sequenceIndices: Map<string, number>; // sequence id -> active child index
    actionIndices: Map<string, number>; // action id -> current action index
    actionStartTimes: Map<string, number>; // action id -> start timestamp (ms)
    targetWaypoint: string;
    goalSent: boolean;
    failureTimestamps: Map<string, number>; // waypoint -> failure timestamp (ms)
    // completed_sequences is vestigial in C++ (never written) — not replicated.
}

function nowMs(): number {
    return Date.now();
}

/**
 * TS mirror of decision_executor::DecisionExecutor.
 * Every tick function is a faithful port of the C++ source (file:line refs inline).
 */
export class DecisionEngine {
    private root: SelectorNode;
    private waypoints: Record<string, { x: number; y: number }>;
    private zones: Record<string, { worldPolygon: Array<[number, number]> }>;
    private cb: ActionCallbacks;

    private ctx: ExecutionContext = {
        currentSequence: null,
        sequenceIndices: new Map(),
        actionIndices: new Map(),
        actionStartTimes: new Map(),
        targetWaypoint: '',
        goalSent: false,
        failureTimestamps: new Map(),
    };

    // Nav2 state machine (mirrors goal_in_progress_ / last_nav_succeeded_ /
    // referee_target_active_). The active goal id is owned by the ROS bridge.
    private goalInProgress = false;
    private lastNavSucceeded = false;
    private refereeTargetActive = false;
    private activeRefereeTargetX = 0.0;
    private activeRefereeTargetY = 0.0;

    // Param cache (mirrors current_param_values_).
    private currentParamValues: Map<string, string> = new Map();

    // Latest sensor data.
    private latestMsg: Referee | null = null;
    private currentOdom: Odometry | null = null;

    // Highlight output of the last tick.
    private runningNodeIds: Set<string> = new Set();
    private currentPathIds: string[] = [];

    // Diagnostic throttle: log top-level branch evaluation ~2Hz to help debug
    // reactive preemption (why a higher-priority branch isn't being chosen).
    private lastDiagLog = 0;

    constructor(
        root: SelectorNode,
        waypoints: Record<string, { x: number; y: number }>,
        zones: Record<string, { worldPolygon: Array<[number, number]> }>,
        cb: ActionCallbacks
    ) {
        this.root = root;
        this.waypoints = waypoints;
        this.zones = zones;
        this.cb = cb;
    }

    setReferee(msg: Referee) { this.latestMsg = msg; }
    setOdom(msg: Odometry) { this.currentOdom = msg; }

    /**
     * Called when a nav action result arrives. Mirrors DecisionExecutor::resultCallback.
     * The ROS bridge only forwards results for the currently-active goal id, so any
     * result received here is guaranteed to belong to the current goal (equivalent to
     * C++ ignoring non-current goals via current_goal_handle_ comparison).
     */
    onActionResult(_goalId: string, succeeded: boolean) {
        this.goalInProgress = false;
        this.lastNavSucceeded = succeeded;
        // goalSent left as-is so tickNode can read result (mirrors C++ comment at resultCallback).
    }

    getRunningNodeIds(): Set<string> { return this.runningNodeIds; }
    getCurrentPathIds(): string[] { return this.currentPathIds; }

    private resetContext() {
        this.ctx.currentSequence = null;
        this.ctx.targetWaypoint = '';
        this.ctx.goalSent = false;
        // Does NOT clear indices maps — mirrors C++ ExecutionContext::reset().
    }

    private clearAllState() {
        this.ctx.sequenceIndices.clear();
        this.ctx.actionIndices.clear();
        this.ctx.actionStartTimes.clear();
        this.ctx.goalSent = false;
        this.ctx.targetWaypoint = '';
    }

    private cancelCurrentGoal() {
        // The ROS bridge tracks the active goal id; we gate on goalInProgress as the
        // proxy for "a goal handle exists" (mirrors C++ `if (current_goal_handle_)`).
        if (this.goalInProgress) {
            this.cb.cancelCurrentGoal();
        }
        this.goalInProgress = false;
    }

    private setRemoteParameter(config: ParamConfig) {
        const key = `${config.node_name}/${config.param_name}`;
        if (this.currentParamValues.get(key) === config.param_value) return; // cache hit
        this.currentParamValues.set(key, config.param_value); // optimistic update
        this.cb.setRemoteParameter(config);
    }

    private markRunning(node: DecisionNode) {
        if (node.sourceId) this.runningNodeIds.add(node.sourceId);
        this.currentPathIds.push(node.sourceId || node.id);
    }

    // ===== executeDecisionTree (DecisionExecutor.cpp:306) =====
    tick(): NodeStatus {
        this.runningNodeIds = new Set();
        this.currentPathIds = [];
        if (!this.latestMsg || !this.root) return NodeStatus.FAILURE;

        const status = this.tickSelector(this.root, this.latestMsg);
        if (status !== NodeStatus.RUNNING) {
            this.resetContext();
        }
        this.emitDiagnostics(this.latestMsg, status);
        return status;
    }

    /**
     * Diagnostic: log each top-level Sequence's first Condition evaluation +
     * which branch the Selector chose. Throttled to ~2Hz. Helps diagnose why a
     * higher-priority branch isn't pre-empting a running lower-priority one.
     */
    private emitDiagnostics(msg: Referee, chosenStatus: NodeStatus) {
        const now = nowMs();
        if (now - this.lastDiagLog < 500) return; // 2Hz cap
        this.lastDiagLog = now;

        const children = this.root.children;
        const parts: string[] = [];
        for (let i = 0; i < children.length; ++i) {
            const child = children[i];
            if (child.type !== 'Sequence') continue;
            const seq = child as SequenceNode;
            const first = seq.children[0];
            if (!first || first.type !== 'Condition') {
                parts.push(`[#${i} p${seq.priority} skip]`);
                continue;
            }
            const cond = first as ConditionNode;
            let fieldValue: string;
            try { fieldValue = String(getFieldValue(cond.field, msg)); }
            catch { fieldValue = '?'; }
            let result: boolean;
            try { result = cond.evaluate(msg); }
            catch (e) { parts.push(`[#${i} p${seq.priority} ${cond.field}${cond.operator}${cond.threshold} ERR:${(e as Error).message}]`); continue; }
            const isCurrent = this.ctx.currentSequence === seq;
            parts.push(`[#${i} p${seq.priority}${isCurrent ? '*' : ''} ${cond.field}=${fieldValue}${cond.operator}${cond.threshold}=>${result ? 'T' : 'F'}]`);
        }
        this.cb.log?.(`diag ${chosenStatus === NodeStatus.RUNNING ? 'RUN' : chosenStatus === NodeStatus.SUCCESS ? 'OK' : 'FAIL'} | ${parts.join(' ')}`);
    }

    // ===== tickSelector (DecisionExecutor.cpp:322) =====
    private tickSelector(node: SelectorNode, msg: Referee): NodeStatus {
        const children = node.children;
        for (let i = 0; i < children.length; ++i) {
            const child = children[i];
            let status: NodeStatus;

            if (child.type === 'Sequence') {
                status = this.tickSequence(child as SequenceNode, msg);
                if (status === NodeStatus.SUCCESS || status === NodeStatus.RUNNING) {
                    this.markRunning(node);
                    this.markRunning(child);
                    if (this.ctx.currentSequence !== child) {
                        if (this.ctx.currentSequence) this.cancelCurrentGoal();
                        this.clearAllState();
                        this.ctx.currentSequence = child as SequenceNode;
                    }
                    return status;
                }
                // FAILURE: move to next child
            } else {
                // Direct action/condition
                status = this.tickNode(child, msg);
                if (status === NodeStatus.SUCCESS || status === NodeStatus.RUNNING) {
                    this.markRunning(node);
                    this.markRunning(child);
                    if (this.ctx.currentSequence !== null) {
                        this.cancelCurrentGoal();
                        this.clearAllState();
                    }
                    this.ctx.currentSequence = null;
                    return status;
                }
            }
        }

        // All children failed
        if (this.ctx.goalSent || this.goalInProgress) this.cancelCurrentGoal();
        this.resetContext();
        return NodeStatus.FAILURE;
    }

    // ===== tickSequence (DecisionExecutor.cpp:388) =====
    private tickSequence(node: SequenceNode, msg: Referee): NodeStatus {
        const seqId = node.id;
        let runningChildIndex = this.ctx.sequenceIndices.get(seqId) ?? 0;
        const children = node.children;

        // Identify latch field and duration lock from the running action child.
        let latchField = '';
        let isDurationLocked = false;
        if (runningChildIndex < children.length) {
            const runningChild = children[runningChildIndex];
            if (runningChild.type === 'Action') {
                const action = runningChild as ActionNode;
                if (action.hasExitCondition()) {
                    latchField = action.getExitConditionField?.() ?? '';
                }
                if (action.duration > 0.0) {
                    const start = this.ctx.actionStartTimes.get(action.id);
                    if (start !== undefined) {
                        if ((nowMs() - start) / 1000 < action.duration) isDurationLocked = true;
                    } else {
                        isDurationLocked = true; // just entered, no start time yet
                    }
                }
            }
        }

        // Re-check preceding conditions (0..runningChildIndex-1) with latch/duration exemptions.
        if (runningChildIndex > 0) {
            const latestParams: Map<string, ParamConfig> = new Map();
            for (let j = 0; j < runningChildIndex; ++j) {
                const c = children[j];
                if (c.type === 'Condition') {
                    const cond = c as ConditionNode;
                    const condStatus = cond.tick(msg);
                    if (condStatus === NodeStatus.FAILURE) {
                        if (latchField && cond.field === latchField) continue;
                        if (isDurationLocked) continue;
                        this.cb.log?.(`Branch condition no longer met (field ${cond.field}), releasing branch`);
                        this.ctx.sequenceIndices.delete(seqId);
                        if (runningChildIndex < children.length) {
                            this.ctx.actionStartTimes.delete(children[runningChildIndex].id);
                        }
                        if (this.ctx.currentSequence === node) {
                            this.cancelCurrentGoal();
                            this.clearAllState();
                            this.ctx.currentSequence = null;
                        }
                        return NodeStatus.FAILURE;
                    }
                }
                if (c.type === 'Param') {
                    const param = c as ParamNode;
                    const key = `${param.config.node_name}/${param.config.param_name}`;
                    latestParams.set(key, param.config);
                }
            }
            for (const config of latestParams.values()) {
                this.setRemoteParameter(config);
            }
        }

        // Execute from runningChildIndex onward.
        for (let i = runningChildIndex; i < children.length; ++i) {
            const status = this.tickNode(children[i], msg);
            if (status === NodeStatus.FAILURE) {
                this.ctx.sequenceIndices.delete(seqId);
                this.ctx.actionStartTimes.delete(children[i].id);
                if (this.ctx.currentSequence === node) {
                    this.cancelCurrentGoal();
                    this.ctx.goalSent = false;
                    this.ctx.targetWaypoint = '';
                    this.ctx.currentSequence = null;
                }
                return NodeStatus.FAILURE;
            }
            if (status === NodeStatus.RUNNING) {
                this.markRunning(node);
                this.markRunning(children[i]);
                this.ctx.sequenceIndices.set(seqId, i);
                return NodeStatus.RUNNING;
            }
            // SUCCESS: continue
        }

        this.ctx.sequenceIndices.delete(seqId);
        return NodeStatus.SUCCESS;
    }

    private hasValidRefereeTarget(msg: Referee): boolean {
        return msg.target_position_x !== 0.0 && msg.target_position_y !== 0.0;
    }

    private isSameRefereeTarget(x: number, y: number): boolean {
        return this.refereeTargetActive &&
            Math.abs(this.activeRefereeTargetX - x) < REFEREE_TARGET_EPSILON &&
            Math.abs(this.activeRefereeTargetY - y) < REFEREE_TARGET_EPSILON;
    }

    // ===== tickRefereeTargetAction (DecisionExecutor.cpp:529) =====
    private tickRefereeTargetAction(msg: Referee, actionId: string): NodeStatus {
        const x = msg.target_position_x;
        const y = msg.target_position_y;

        if (!this.hasValidRefereeTarget(msg)) {
            if (this.refereeTargetActive || this.ctx.targetWaypoint === REFEREE_TARGET_ACTION) {
                this.cancelCurrentGoal();
            }
            this.refereeTargetActive = false;
            this.activeRefereeTargetX = 0.0;
            this.activeRefereeTargetY = 0.0;
            this.ctx.goalSent = false;
            this.ctx.targetWaypoint = '';
            this.lastNavSucceeded = false;
            return NodeStatus.FAILURE;
        }

        const targetChanged = !this.isSameRefereeTarget(x, y);
        const actionChanged = this.ctx.targetWaypoint !== REFEREE_TARGET_ACTION;

        if (!this.ctx.goalSent || actionChanged || targetChanged) {
            if (this.ctx.goalSent || this.goalInProgress) {
                this.cancelCurrentGoal();
            }
            this.activeRefereeTargetX = x;
            this.activeRefereeTargetY = y;
            this.refereeTargetActive = true;
            this.ctx.targetWaypoint = REFEREE_TARGET_ACTION;
            this.ctx.goalSent = true;
            this.cb.sendNavigationGoalToPose(x, y, 'referee target');
            // Mirrors C++ sendNavigationGoalToPose: goal_in_progress_=true; last_nav_succeeded_=false;
            this.goalInProgress = true;
            this.lastNavSucceeded = false;
            return NodeStatus.RUNNING;
        }

        if (!this.goalInProgress) {
            if (this.lastNavSucceeded) {
                this.ctx.actionStartTimes.delete(actionId);
                this.ctx.goalSent = false;
                this.ctx.targetWaypoint = '';
                this.refereeTargetActive = false;
                this.activeRefereeTargetX = 0.0;
                this.activeRefereeTargetY = 0.0;
                return NodeStatus.SUCCESS;
            }
            this.ctx.goalSent = false;
            return NodeStatus.RUNNING;
        }

        return NodeStatus.RUNNING;
    }

    // ===== tickNode (DecisionExecutor.cpp:590) =====
    private tickNode(node: DecisionNode, msg: Referee): NodeStatus {
        if (!node) return NodeStatus.FAILURE;

        if (node.type === 'Condition') {
            return node.tick(msg);
        }
        if (node.type === 'Param') {
            this.setRemoteParameter((node as ParamNode).config);
            return NodeStatus.SUCCESS;
        }
        if (node.type === 'Sequence') {
            return this.tickSequence(node as SequenceNode, msg);
        }
        if (node.type === 'Selector') {
            return this.tickSelector(node as SelectorNode, msg);
        }
        if (node.type === 'Zone') {
            return this.tickZone(node as ZoneNode, msg);
        }

        // Action
        if (node.type === 'Action') {
            return this.tickAction(node as ActionNode, msg);
        }

        return NodeStatus.FAILURE;
    }

    private tickAction(action: ActionNode, msg: Referee): NodeStatus {
        const nodeId = action.id;
        let currentActIdx = this.ctx.actionIndices.get(nodeId) ?? 0;
        let waypoint = action.actions[currentActIdx] ?? '';

        if (!waypoint) {
            this.ctx.actionStartTimes.delete(nodeId);
            if (action.loop) {
                currentActIdx = 0;
                this.ctx.actionIndices.set(nodeId, 0);
                waypoint = action.actions[0] ?? '';
            } else {
                this.ctx.actionIndices.set(nodeId, 0);
                this.ctx.targetWaypoint = '';
                return NodeStatus.SUCCESS;
            }
        }

        // STOP
        if (waypoint === 'STOP') {
            if (this.goalInProgress) this.cancelCurrentGoal();
            this.cb.publishCmdVel({
                linear: { x: 0, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: 0 },
            });
            if (action.duration > 0.0 && !this.ctx.actionStartTimes.has(nodeId)) {
                this.ctx.actionStartTimes.set(nodeId, nowMs());
            }
            if (action.hasExitCondition()) {
                if (!action.checkExitCondition(msg)) {
                    return NodeStatus.RUNNING;
                }
                this.ctx.actionStartTimes.delete(nodeId);
                this.ctx.actionIndices.set(nodeId, currentActIdx + 1);
                return NodeStatus.RUNNING;
            }
            if (action.duration > 0.0) {
                const start = this.ctx.actionStartTimes.get(nodeId)!;
                if ((nowMs() - start) / 1000 >= action.duration) {
                    this.ctx.actionStartTimes.delete(nodeId);
                    this.ctx.actionIndices.set(nodeId, currentActIdx + 1);
                    return NodeStatus.RUNNING;
                }
                return NodeStatus.RUNNING;
            }
            return NodeStatus.RUNNING;
        }

        // REFEREE_TARGET
        if (waypoint === REFEREE_TARGET_ACTION) {
            const status = this.tickRefereeTargetAction(msg, nodeId);
            if (status === NodeStatus.SUCCESS) {
                this.ctx.actionIndices.set(nodeId, currentActIdx + 1);
                return NodeStatus.RUNNING;
            }
            return status;
        }

        // Failure cooldown (5s). In C++ failure_timestamps is only read, never written
        // (dormant). Replicated as-is: structure present, never populated.
        const failTs = this.ctx.failureTimestamps.get(waypoint);
        if (failTs !== undefined) {
            if ((nowMs() - failTs) / 1000 < 5.0) {
                return NodeStatus.FAILURE;
            }
            this.ctx.failureTimestamps.delete(waypoint);
        }

        // Send/resend goal on first tick or target mismatch.
        if (!this.ctx.goalSent || this.ctx.targetWaypoint !== waypoint) {
            if (this.ctx.goalSent) this.cancelCurrentGoal();
            const wp = this.waypoints[waypoint];
            if (!wp) {
                this.cb.log?.(`Unknown waypoint: ${waypoint}`);
                return NodeStatus.FAILURE;
            }
            this.cb.sendNavigationGoal(waypoint, {
                header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
                pose: {
                    position: { x: wp.x, y: wp.y, z: 0.0 },
                    orientation: { x: 0, y: 0, z: 0, w: 1.0 },
                },
            });
            // Mirrors C++ sendNavigationGoal: goal_in_progress_=true; last_nav_succeeded_=false;
            this.goalInProgress = true;
            this.lastNavSucceeded = false;
            this.ctx.goalSent = true;
            this.ctx.targetWaypoint = waypoint;
            return NodeStatus.RUNNING;
        }

        // Nav2 stopped (result arrived).
        if (!this.goalInProgress) {
            if (this.lastNavSucceeded) {
                if (action.duration > 0.0 && !this.ctx.actionStartTimes.has(nodeId)) {
                    this.ctx.actionStartTimes.set(nodeId, nowMs());
                }
                if (action.hasExitCondition()) {
                    if (!action.checkExitCondition(msg)) {
                        this.ctx.goalSent = false;
                        return NodeStatus.RUNNING;
                    }
                }
                if (action.duration > 0.0) {
                    const start = this.ctx.actionStartTimes.get(nodeId)!;
                    if ((nowMs() - start) / 1000 < action.duration) {
                        this.ctx.goalSent = false;
                        return NodeStatus.RUNNING;
                    }
                }
                this.ctx.actionStartTimes.delete(nodeId);
                this.ctx.actionIndices.set(nodeId, currentActIdx + 1);
                this.ctx.goalSent = false;
                this.ctx.targetWaypoint = '';
                return NodeStatus.RUNNING;
            }
            // Stopped but not reached: retry, do not fail.
            this.ctx.goalSent = false;
            return NodeStatus.RUNNING;
        }

        // goal_in_progress_: check exit condition while moving.
        if (action.hasExitCondition() && action.checkExitCondition(msg)) {
            this.cancelCurrentGoal();
            this.ctx.actionStartTimes.delete(nodeId);
            this.ctx.actionIndices.set(nodeId, currentActIdx + 1);
            this.ctx.goalSent = false;
            this.ctx.targetWaypoint = '';
            return NodeStatus.RUNNING;
        }
        return NodeStatus.RUNNING;
    }

    // ===== tickZone (DecisionExecutor.cpp:796) =====
    private tickZone(node: ZoneNode, msg: Referee): NodeStatus {
        if (!this.isRobotInZone(node.zoneId)) return NodeStatus.FAILURE;

        for (const cond of node.conditions) {
            if (cond.tick(msg) === NodeStatus.FAILURE) return NodeStatus.FAILURE;
        }

        for (const param of node.params) {
            this.setRemoteParameter(param.config);
        }

        if (!node.action && node.children.length === 0) {
            if (node.params.length === 0) return NodeStatus.FAILURE; // pure area gate
            return NodeStatus.FAILURE; // params applied, don't preempt running actions
        }

        if (node.action) {
            const status = this.tickNode(node.action, msg);
            if (status === NodeStatus.RUNNING) return NodeStatus.RUNNING;
        }

        for (const child of node.children) {
            const status = this.tickNode(child, msg);
            if (status === NodeStatus.RUNNING) return NodeStatus.RUNNING;
            if (status === NodeStatus.FAILURE) return NodeStatus.FAILURE;
        }

        return NodeStatus.SUCCESS;
    }

    private isRobotInZone(zoneId: string): boolean {
        if (!this.currentOdom) return false;
        const zone = this.zones[zoneId];
        if (!zone) return false;
        const x = this.currentOdom.pose.pose.position.x;
        const y = this.currentOdom.pose.pose.position.y;
        return isPointInPolygon(x, y, zone.worldPolygon);
    }

    // Expose current action target for UI display.
    getTargetWaypoint(): string { return this.ctx.targetWaypoint; }
}
