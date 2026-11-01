// Keep the reference path explicit. iPadOS can identify itself as macOS, so
// include touch-capable Macs when choosing the Apple mobile GPU budget.
export function entranceRenderPolicy({quality, userAgent='', platform='', maxTouchPoints=0}={}){
  const reference=quality==='reference';
  const appleMobile=/iPad|iPhone|iPod/.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1);
  const mobile=!reference&&(quality==='mobile'||(quality!=='desktop'&&appleMobile));
  return Object.freeze({
    name:reference?'reference':mobile?'mobile':'desktop',
    mobile,
    maxPixelRatio:mobile?3:2,
    // Antialias the scene in the composer, avoiding a second multisampled
    // framebuffer for the final full-screen output on mobile.
    canvasAntialias:!mobile,
    mainSamples:mobile?0:reference?4:2,
    reflectionSamples:mobile?0:2,
    exteriorReflectionWidth:mobile?512:null,
    chamberReflectionWidth:mobile?384:512,
    chessReflectionScale:mobile?2/3:1,
  });
}
