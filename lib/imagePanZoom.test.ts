import { describe, expect, it } from 'vitest';

import {
  IMAGE_PAN_ZOOM_ACTUAL_SCALE,
  IMAGE_PAN_ZOOM_MAX_SCALE,
  IMAGE_PAN_ZOOM_MIN_SCALE,
  clampImagePanZoomScale,
  nextImageWheelScale,
  normalizeImageWheelDelta,
  imageFitScale,
} from './imagePanZoom';

const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({ deltaY, deltaMode, ctrlKey });

describe('image pan zoom scale', () => {
  it('fits intrinsic pixels without treating the reduced display as 100%', () => {
    expect(imageFitScale(2048, 2048, 512, 512)).toBe(0.25);
    expect(imageFitScale(1024, 2048, 800, 512)).toBe(0.25);
    expect(imageFitScale(8192, 4096, 512, 512)).toBe(0.0625);
    expect(nextImageWheelScale(0.0625, wheel(100), 0.0625 * 0.2)).toBeLessThan(0.0625);
  });

  it('gives mouse notches, trackpad scrolls and pinches comparable steps', () => {
    // Chromium pixel notch, Firefox line notch and a page step all cap at one notch.
    expect(normalizeImageWheelDelta(wheel(120))).toBe(100);
    expect(normalizeImageWheelDelta(wheel(3, 1))).toBe(100);
    expect(normalizeImageWheelDelta(wheel(-1, 2))).toBe(-100);
    // Trackpad scroll stays proportional; pinch is boosted to keep pace with the fingers.
    expect(normalizeImageWheelDelta(wheel(4))).toBe(4);
    expect(normalizeImageWheelDelta(wheel(-4, 0, true))).toBe(-40);

    const notchIn = nextImageWheelScale(IMAGE_PAN_ZOOM_ACTUAL_SCALE, wheel(-100));
    expect(notchIn).toBeCloseTo(1.105, 3);
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_ACTUAL_SCALE, wheel(100))).toBeCloseTo(1 / notchIn);
    // Twenty-five 4 px trackpad events add up to one notch.
    let scale = IMAGE_PAN_ZOOM_ACTUAL_SCALE;
    for (let i = 0; i < 25; i += 1) scale = nextImageWheelScale(scale, wheel(-4));
    expect(scale).toBeCloseTo(notchIn);
    expect(nextImageWheelScale(1, wheel(-100), undefined, 2)).toBeCloseTo(notchIn ** 2);
  });

  it('clamps the wheel at the min and max scale', () => {
    expect(clampImagePanZoomScale(0)).toBe(IMAGE_PAN_ZOOM_MIN_SCALE);
    expect(clampImagePanZoomScale(99)).toBe(IMAGE_PAN_ZOOM_MAX_SCALE);
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_MIN_SCALE, wheel(400))).toBe(
      IMAGE_PAN_ZOOM_MIN_SCALE,
    );
    expect(nextImageWheelScale(IMAGE_PAN_ZOOM_MAX_SCALE, wheel(-400))).toBe(
      IMAGE_PAN_ZOOM_MAX_SCALE,
    );
  });
});
