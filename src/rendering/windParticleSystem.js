/**
 * 粒子系统的总调度器。
 * 将 GPU 粒子位置计算与流线渲染串成 Cesium 图元执行序列，并统一处理配置变更和资源释放。
 */
import { WindParticlesComputing } from "./windParticlesComputing";
import { WindParticlesRendering } from "./windParticlesRendering";
import { ClearCommand, Color, Pass } from "cesium";
import { deepMerge } from "../core/utils";

export class WindParticleSystem {
  constructor(context, windData, options, viewerParameters, scene) {
    this.context = context;
    this.options = options;
    this.viewerParameters = viewerParameters;
    this.computing = new WindParticlesComputing(context, windData, options, viewerParameters, scene);
    this.rendering = new WindParticlesRendering(context, options, viewerParameters, this.computing);
    this.clearFramebuffers();
  }

  getPrimitives() {
    return [
      this.computing.primitives.calculateSpeed,
      this.computing.primitives.updatePosition,
      this.computing.primitives.postProcessingPosition,
      this.rendering.primitives.segments,
    ];
  }

  clearFramebuffers() {
    const clearCommand = new ClearCommand({
      color: new Color(0.0, 0.0, 0.0, 0.0),
      depth: 1.0,
      framebuffer: undefined,
      pass: Pass.OPAQUE,
    });

    Object.keys(this.rendering.framebuffers).forEach((key) => {
      clearCommand.framebuffer = this.rendering.framebuffers[key];
      clearCommand.execute(this.context);
    });
  }

  changeOptions(options) {
    let maxParticlesChanged = false;
    if (options.particlesTextureSize && this.options.particlesTextureSize !== options.particlesTextureSize) {
      maxParticlesChanged = true;
    }
    const verticalSelectionChanged = ["verticalMode", "heightRange", "selectedLevel", "fixedHeight"]
      .some((key) => options[key] !== undefined);

    const newOptions = deepMerge(options, this.options);
    if (newOptions.particlesTextureSize < 1) {
      throw new Error("particlesTextureSize must be greater than 0");
    }
    this.options = newOptions;

    this.rendering.updateOptions(options);
    this.computing.updateOptions(options);
    if (maxParticlesChanged || verticalSelectionChanged) {
      this.computing.destroyParticlesTextures();
      this.computing.createParticlesTextures();
      this.rendering.onParticlesTextureSizeChange();
    }
  }

  applyViewerParameters(viewerParameters) {
    this.viewerParameters = viewerParameters;
    this.computing.viewerParameters = viewerParameters;
    this.rendering.viewerParameters = viewerParameters;
  }

  destroy() {
    this.computing.destroy();
    this.rendering.destroy();
  }
}
