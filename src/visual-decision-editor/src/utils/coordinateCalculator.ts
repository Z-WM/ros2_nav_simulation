import { Point, PixelPoint } from '../types';

/**
 * Calculate world coordinates (in meters) from pixel coordinates
 * 
 * Formula:
 *   world_x = (u - u0) * resolution
 *   world_y = (v0 - v) * resolution  (Note: Y-axis is inverted in image space)
 * 
 * @param targetPixel - The pixel coordinates of the target point Ptarget(u, v)
 * @param originPixel - The pixel coordinates of the origin point Porigin(u0, v0)
 * @param resolution - Resolution in meters per pixel
 * @returns World coordinates in meters
 */
export function pixelToWorld(
    targetPixel: PixelPoint,
    originPixel: PixelPoint,
    resolution: number
): Point {
    const { u, v } = targetPixel;
    const { u: u0, v: v0 } = originPixel;

    const world_x = (u - u0) * resolution;
    const world_y = (v0 - v) * resolution; // Y-axis inversion

    return {
        x: parseFloat(world_x.toFixed(3)),
        y: parseFloat(world_y.toFixed(3))
    };
}

/**
 * Calculate pixel coordinates from world coordinates
 * 
 * @param worldPoint - World coordinates in meters
 * @param originPixel - The pixel coordinates of the origin point
 * @param resolution - Resolution in meters per pixel
 * @returns Pixel coordinates
 */
export function worldToPixel(
    worldPoint: Point,
    originPixel: PixelPoint,
    resolution: number
): PixelPoint {
    const { x, y } = worldPoint;
    const { u: u0, v: v0 } = originPixel;

    const u = Math.round(x / resolution + u0);
    const v = Math.round(v0 - y / resolution); // Y-axis inversion

    return { u, v };
}

/**
 * Validate if a resolution value is reasonable
 */
export function isValidResolution(resolution: number): boolean {
    return resolution > 0 && resolution < 1; // Typically 0.01 to 0.1 m/pixel
}
