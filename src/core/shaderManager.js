/**
 * 着色器源码的集中装配入口。
 * 将各计算和绘制阶段的 GLSL 字符串包装为 Cesium ShaderSource，供自定义图元创建 GPU 命令。
 */
import { ShaderSource } from "cesium";
import { updatePositionShader } from "../shaders/updatePosition";
import { calculateSpeedShader } from "../shaders/calculateSpeed";
import { postProcessingPositionFragmentShader } from "../shaders/postProcessingPosition";
import {
  renderParticlesFragmentShader,
  renderParticlesVertexShader,
} from "../shaders/segmentDraw";

export class ShaderManager {
  static getCalculateSpeedShader() {
    return new ShaderSource({ sources: [calculateSpeedShader] });
  }

  static getUpdatePositionShader() {
    return new ShaderSource({ sources: [updatePositionShader] });
  }

  static getSegmentDrawVertexShader() {
    return new ShaderSource({ sources: [renderParticlesVertexShader] });
  }

  static getSegmentDrawFragmentShader() {
    return new ShaderSource({ sources: [renderParticlesFragmentShader] });
  }

  static getPostProcessingPositionShader() {
    return new ShaderSource({ sources: [postProcessingPositionFragmentShader] });
  }
}
