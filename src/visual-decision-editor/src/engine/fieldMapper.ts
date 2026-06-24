import { Referee } from '../ros/types';

/**
 * Mirrors decision_executor::FieldMapper (FieldMapper.cpp).
 * The C++ version uses ROS2 message introspection (offset-based) to read any
 * numeric field of the Referee message by name. In the browser rosbridge
 * delivers Referee as a plain JSON object, so we just index by field name and
 * coerce to number.
 *
 * Only numeric primitive fields are supported (matches C++ getValue switch).
 */
export function getFieldValue(field: string, msg: Referee): number {
    const value = (msg as unknown as Record<string, unknown>)[field];
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === undefined || value === null) {
        throw new Error(`Invalid field: ${field}`);
    }
    const n = Number(value);
    if (Number.isNaN(n)) {
        throw new Error(`Non-numeric field: ${field}`);
    }
    return n;
}

export function hasField(field: string, msg: Referee): boolean {
    try {
        const v = (msg as unknown as Record<string, unknown>)[field];
        return v !== undefined && v !== null && typeof v !== 'object';
    } catch {
        return false;
    }
}
