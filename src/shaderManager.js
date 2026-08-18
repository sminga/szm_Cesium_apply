import { ShaderSource } from "cesium";
import { updatePositionShader } from "./shaders/updatePosition";
import { calculateSpeedShader } from "./shaders/calculateSpeed";
import { postProcessingPositionFragmentShader } from "./shaders/postProcessingPosition";
import {
  renderParticlesFragmentShader,
  renderParticlesVertexShader,
} from "./shaders/segmentDraw";

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
