/**
 * 粒子位置后处理计算着色器。
 * 检测粒子是否越出风场，并按基础丢弃率和速度增量概率将粒子随机重生到数据域或当前视域。
 */
export const postProcessingPositionFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D nextParticlesPosition;
uniform sampler2D particlesSpeed; // (dLon, dLat, dzNorm, magnitude)
uniform sampler3D windTexture;

uniform vec2 lonRange;
uniform vec2 latRange;
uniform vec2 dataLonRange;
uniform vec2 dataLatRange;
uniform vec2 speedRange;

uniform float randomCoefficient;
uniform float dropRate;
uniform float dropRateBump;
uniform bool useViewerBounds;
uniform bool densityBySpeed;
uniform float densityExponent;
uniform float densityFloor;
uniform vec2 verticalRange;
uniform bool fixedVertical;
uniform float fixedVerticalPosition;

in vec2 v_textureCoordinates;
out vec4 fragColor;

const vec3 randomConstants = vec3(12.9898, 78.233, 4375.85453);
const vec2 normalRange = vec2(0.0, 1.0);

float rand(vec2 seed, vec2 range) {
  vec2 randomSeed = randomCoefficient * seed;
  float temp = dot(randomConstants.xy, randomSeed);
  temp = fract(sin(temp) * (randomConstants.z + temp));
  return temp * (range.y - range.x) + range.x;
}

vec3 generateRandomParticle(vec2 seed) {
  float randomLon, randomLat, randomZ;
  if (useViewerBounds) {
    randomLon = rand(seed, lonRange);
    randomLat = rand(-seed, latRange);
  } else {
    randomLon = rand(seed, dataLonRange);
    randomLat = rand(-seed, dataLatRange);
  }
  randomZ = fixedVertical
    ? fixedVerticalPosition
    : rand(seed.yx, verticalRange);
  return vec3(randomLon, randomLat, randomZ);
}

float particleWeight(vec3 particle) {
  vec2 dataSpan = max(
    vec2(dataLonRange.y - dataLonRange.x, dataLatRange.y - dataLatRange.x),
    vec2(0.000001)
  );
  vec2 normalizedXY = (particle.xy - vec2(dataLonRange.x, dataLatRange.x)) / dataSpan;
  float magnitude = length(texture(windTexture, vec3(normalizedXY, particle.z)).xyz);
  float normalizedSpeed = clamp((magnitude - speedRange.x) / max(speedRange.y - speedRange.x, 0.000001), 0.0, 1.0);
  return densityFloor + (1.0 - densityFloor) * pow(normalizedSpeed, densityExponent);
}

vec3 generateWeightedParticle(vec2 seed) {
  vec3 selected = generateRandomParticle(seed);
  if (!densityBySpeed) return selected;

  float totalWeight = particleWeight(selected);
  for (int candidateIndex = 1; candidateIndex < 6; candidateIndex++) {
    float offset = float(candidateIndex) * 17.173;
    vec2 candidateSeed = seed.yx + vec2(offset, -offset * 0.618);
    vec3 candidate = generateRandomParticle(candidateSeed);
    float weight = particleWeight(candidate);
    totalWeight += weight;
    if (rand(candidateSeed + vec2(3.7, 9.1), normalRange) < weight / totalWeight) {
      selected = candidate;
    }
  }
  return selected;
}

bool particleOutbound(vec3 particle) {
  return particle.y < dataLatRange.x || particle.y > dataLatRange.y
      || particle.x < dataLonRange.x || particle.x > dataLonRange.y
      || (!fixedVertical && (particle.z < verticalRange.x || particle.z > verticalRange.y));
}

void main() {
  vec3 nextParticle = texture(nextParticlesPosition, v_textureCoordinates).rgb;
  if (fixedVertical) nextParticle.z = fixedVerticalPosition;
  vec4 nextSpeed = texture(particlesSpeed, v_textureCoordinates);
  float magnitude = nextSpeed.a;
  float speedNorm = clamp((magnitude - speedRange.x) / (speedRange.y - speedRange.x), 0.0, 1.0);
  float particleDropRate = dropRate + dropRateBump * speedNorm;

  vec2 seed1 = nextParticle.xy + v_textureCoordinates;
  vec2 seed2 = nextSpeed.rg + v_textureCoordinates;
  vec3 randomParticle = generateWeightedParticle(seed1);
  float randomNumber = rand(seed2, normalRange);

  if (randomNumber < particleDropRate || particleOutbound(nextParticle)) {
    fragColor = vec4(randomParticle, 1.0);
  } else {
    fragColor = vec4(nextParticle, 0.0);
  }
}
`;
