import {ShaderChunk} from 'three';

// A fragment's normal, view direction and material are shared by every area
// light. Compute the LTC lookup and shading transforms once, rather than once
// per light and once again for each specular/diffuse/clearcoat lobe. Keep Three's
// polygon integral, Fresnel approximation and horizon clipping unchanged.
const sharedAreaLighting = /* glsl */`
mat3 journeyLtcDiffuse, journeyLtcSpecular;
vec3 journeyLtcFresnel;
#ifdef USE_CLEARCOAT
  mat3 journeyLtcCoat;
  vec3 journeyLtcCoatFresnel;
#endif

void journeyPrepareLtc(vec3 N, vec3 V, vec3 Ncc, PhysicalMaterial material) {
  vec3 T = normalize(V - N * dot(V, N));
  journeyLtcDiffuse = transpose(mat3(T, -cross(N, T), N));
  vec2 uv = LTC_Uv(N, V, material.roughness);
  vec4 a = texture2D(ltc_1, uv), b = texture2D(ltc_2, uv);
  journeyLtcSpecular = mat3(vec3(a.x, 0, a.y), vec3(0, 1, 0), vec3(a.z, 0, a.w)) * journeyLtcDiffuse;
  journeyLtcFresnel = material.specularColorBlended * b.x + (material.specularF90 - material.specularColorBlended) * b.y;
  #ifdef USE_CLEARCOAT
    #ifdef JOURNEY_SHARED_AREA_COAT
      journeyLtcCoatFresnel = material.clearcoatF0 * b.x + (material.clearcoatF90 - material.clearcoatF0) * b.y;
    #else
    T = normalize(V - Ncc * dot(V, Ncc));
    uv = LTC_Uv(Ncc, V, material.clearcoatRoughness);
    a = texture2D(ltc_1, uv); b = texture2D(ltc_2, uv);
    journeyLtcCoat = mat3(vec3(a.x, 0, a.y), vec3(0, 1, 0), vec3(a.z, 0, a.w)) * transpose(mat3(T, -cross(Ncc, T), Ncc));
    journeyLtcCoatFresnel = material.clearcoatF0 * b.x + (material.clearcoatF90 - material.clearcoatF0) * b.y;
    #endif
  #endif
}

float journeyEvaluateLtc(mat3 transform, vec3 center, vec3 width, vec3 height) {
  // Transform the rectangle's center and axes; linearity gives the same four
  // corners using three matrix-vector products instead of four.
  vec3 c = transform * center, w = transform * width, h = transform * height;
  vec3 a = normalize(c + w - h), b = normalize(c - w - h);
  vec3 d = normalize(c - w + h), e = normalize(c + w + h);
  return LTC_ClippedSphereFormFactor(
    LTC_EdgeVectorFormFactor(a, b) + LTC_EdgeVectorFormFactor(b, d) +
    LTC_EdgeVectorFormFactor(d, e) + LTC_EdgeVectorFormFactor(e, a)
  );
}

void RE_Direct_RectArea_Physical(
  const in RectAreaLight light, const in vec3 P, const in vec3 N,
  const in vec3 V, const in vec3 Ncc, const in PhysicalMaterial material,
  inout ReflectedLight reflectedLight
) {
  // The emitter's back side contributes nothing to any of the three lobes.
  if (dot(cross(-light.halfWidth, light.halfHeight), P - light.position) < 0.0) return;
  vec3 center = light.position - P;
  float specularIntegral = journeyEvaluateLtc(journeyLtcSpecular, center, light.halfWidth, light.halfHeight);
  reflectedLight.directSpecular += light.color * journeyLtcFresnel * specularIntegral;
  if (any(greaterThan(material.diffuseContribution, vec3(0.0)))) {
    reflectedLight.directDiffuse += light.color * material.diffuseContribution * journeyEvaluateLtc(journeyLtcDiffuse, center, light.halfWidth, light.halfHeight);
  }
  #ifdef USE_CLEARCOAT
    #ifdef JOURNEY_SHARED_AREA_COAT
      clearcoatSpecularDirect += light.color * journeyLtcCoatFresnel * specularIntegral;
    #else
      clearcoatSpecularDirect += light.color * journeyLtcCoatFresnel * journeyEvaluateLtc(journeyLtcCoat, center, light.halfWidth, light.halfHeight);
    #endif
  #endif
}
`;

const physical = ShaderChunk.lights_physical_pars_fragment;
const start = physical.indexOf('\tvoid RE_Direct_RectArea_Physical(');
const end = physical.indexOf('\n#endif', start);
if (start < 0 || end < 0) throw new Error('Three area-light shader changed; review the LTC cache.');
const cachedPhysical = physical.slice(0, start) + sharedAreaLighting + physical.slice(end);

// Equal roughness and unperturbed normals produce exactly the same LTC lobe.
// Keep its distinct Fresnel/color contribution, sharing only the integral.
export function canShareAreaCoat(material) {
  return material.clearcoat > 0 && !material.normalMap && !material.bumpMap &&
    !material.clearcoatNormalMap && !material.roughnessMap && !material.clearcoatRoughnessMap &&
    Math.max(material.roughness, .0525) === Math.max(material.clearcoatRoughness, .0525);
}

export function cacheAreaLighting(shader, shareCoat = false) {
  if (shareCoat) shader.fragmentShader = '#define JOURNEY_SHARED_AREA_COAT\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_pars_fragment>', cachedPhysical)
    .replace('#include <lights_fragment_begin>', ShaderChunk.lights_fragment_begin)
    .replace('RectAreaLight rectAreaLight;', `
      journeyPrepareLtc(geometryNormal, geometryViewDir, geometryClearcoatNormal, material);
      RectAreaLight rectAreaLight;`);
}
