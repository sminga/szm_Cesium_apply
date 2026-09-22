/**
 * 风速采样与粒子位移计算着色器。
 * 从三维风场纹理插值速度，使用二阶 Runge-Kutta 推进，并输出经纬高位移及原始速度幅值。
 */
export const calculateSpeedShader = `#version 300 es
precision highp float;

// 3D wind field stored in a WebGL2 3D texture: RGB = (u, v, w) in m/s
uniform sampler3D windTexture;
// particle position: (lon, lat, zNorm); zNorm in [0,1] maps lowest..highest level
uniform sampler2D currentParticlesPosition;

uniform vec2 minimum;   // (west, south)
uniform vec2 maximum;   // (east, north)
uniform vec2 speedRange; // (min, max) speed magnitude, for color normalization
uniform float minHeight;
uniform float maxHeight;
uniform bool fixedVertical;

uniform float speedScaleFactor;
uniform float frameRateAdjustment;

in vec2 v_textureCoordinates;
out vec4 fragColor;

// length of one degree of lon/lat in meters (WGS84)
vec2 lengthOfLonLat(vec2 lonLat) {
  float latitude = radians(lonLat.y);
  float latLength = 111132.92 - 559.82 * cos(2.0 * latitude)
                  + 1.175 * cos(4.0 * latitude) - 0.0023 * cos(6.0 * latitude);
  float longLength = 111412.84 * cos(latitude) - 93.5 * cos(3.0 * latitude)
                   + 0.118 * cos(5.0 * latitude);
  return vec2(longLength, latLength);
}

// sample wind vector (u, v, w) in m/s at a (lon, lat, zNorm) position
// hardware trilinear interpolation across the 3D texture
vec3 getWind(vec3 lonLatZ) {
  vec2 pos2d = clamp(lonLatZ.xy, minimum, maximum);
  vec2 norm2d = (pos2d - minimum) / (maximum - minimum);
  vec3 norm = vec3(norm2d, clamp(lonLatZ.z, 0.0, 1.0));
  return texture(windTexture, norm).xyz;
}

// convert m/s -> (degrees/s, degrees/s, zNorm/s)
vec3 convertSpeedUnit(vec3 lonLatZ, vec3 speed) {
  vec2 len = lengthOfLonLat(lonLatZ.xy);
  float heightRange = maxHeight - minHeight;
  float dz = fixedVertical ? 0.0 : speed.z / max(heightRange, 0.000001);
  return vec3(speed.x / len.x, speed.y / len.y, dz);
}

// Runge-Kutta 2 (midpoint method) advection velocity
vec3 calculateSpeedByRungeKutta2(vec3 lonLatZ) {
  const float h = 0.5;
  vec3 f_n = getWind(lonLatZ);
  vec3 mid = lonLatZ + 0.5 * h * convertSpeedUnit(lonLatZ, f_n) * speedScaleFactor;
  vec3 speed = h * getWind(mid) * speedScaleFactor;
  return speed;
}

void main() {
  vec3 lonLatZ = texture(currentParticlesPosition, v_textureCoordinates).rgb;
  vec3 speedOrigin = getWind(lonLatZ);
  vec3 speed = calculateSpeedByRungeKutta2(lonLatZ) * frameRateAdjustment;
  vec3 speedInUnits = convertSpeedUnit(lonLatZ, speed);
  float magnitude = length(speedOrigin);
  // .rgb = (dLon, dLat, dzNorm) displacement, .a = speed magnitude (m/s)
  fragColor = vec4(speedInUnits, magnitude);
}
`;
