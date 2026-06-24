import { Polygon } from './DecisionTreeTypes';

/**
 * Mirrors DecisionExecutor::isPointInPolygon (DecisionExecutor.cpp:868-890).
 * Standard ray-casting algorithm.
 */
export function isPointInPolygon(x: number, y: number, polygon: Polygon): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];

        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) {
            inside = !inside;
        }
    }

    return inside;
}
