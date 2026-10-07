import { describe, expect, it } from 'vitest';

import {
  IMAGE_PAN_ZOOM_ACTUAL_SCALE,
  IMAGE_PAN_ZOOM_MAX_SCALE,
  IMAGE_PAN_ZOOM_MIN_SCALE,
  clampImagePanZoomScale,
  nextImageWheelScale,
  imageFitScale,
} from './imagePanZoom';

describe('image pan zoom scale', () => {
  it('fits intrinsic pixels without treating the reduced display as 100%', () => {
    expect(imageFitScale(2048, 2048, 512, 512)).toBe(0.25);
    expect(imageFitScale(1024, 2048, 800, 512)).toBe(0.25);
    expect(imageFitScale(8192, 4096, 512, 512)).toBe(0.0625);
    expect(nextImageWheelScale(0.0625, 120, 0.0625 * 0.2)).toBe(0.046875);
  });
  it('lets the wheel zoom out below fit', () => {
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_ACTUAL_SCALE, 120)).toBe(0.75);
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_ACTUAL_SCALE, -120)).toBe(1.25);
  });

  it('clamps the wheel at the min and max scale', () => {
    expect(clampImagePanZoomScale(0)).toBe(IMAGE_PAN_ZOOM_MIN_SCALE);
    expect(clampImagePanZoomScale(99)).toBe(IMAGE_PAN_ZOOM_MAX_SCALE);
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_MIN_SCALE, 400)).toBe(IMAGE_PAN_ZOOM_MIN_SCALE);
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_MAX_SCALE, -400)).toBe(IMAGE_PAN_ZOOM_MAX_SCALE);
  });
});
