/**
 * 粒子位置推进计算着色器。
 * 把当前经纬高归一化坐标与本帧位移相加，输出未经边界处理的下一位置。
 */
export const updatePositionShader = `#version 300 es
precision highp float;

uniform sampler2D currentParticlesPosition;
uniform sampler2D particlesSpeed;

in vec2 v_textureCoordinates;
out vec4 fragColor;

void main() {
  vec3 currentPos = texture(currentParticlesPosition, v_textureCoordinates).rgb;
  vec3 speed = texture(particlesSpeed, v_textureCoordinates).rgb;
  vec3 nextPos = currentPos + speed;
  fragColor = vec4(nextPos, 1.0);
}
`;
