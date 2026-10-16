// Keep one proportional frame shared by the rendered clips and interactive ball.
export function framePlacement(viewportWidth, viewportHeight, focus, cover) {
  const scale = (cover ? Math.max : Math.min)(viewportWidth / 1920, viewportHeight / 1080);
  const width = 1920 * scale;
  const height = 1080 * scale;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  return {
    width, height,
    x: cover ? clamp(viewportWidth / 2 - focus[0] * width, viewportWidth - width, 0) : (viewportWidth - width) / 2,
    y: cover ? clamp(viewportHeight / 2 - focus[1] * height, viewportHeight - height, 0) : (viewportHeight - height) / 2,
  };
}
