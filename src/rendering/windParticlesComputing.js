/**
 * 风场粒子的 GPU 计算模块。
 * 创建三维风场纹理和粒子状态纹理，依次执行速度采样、位置推进、越界检测及随机重生。
 */
import {
  PixelDatatype,
  PixelFormat,
  Sampler,
  Texture,
  Texture3D,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  Cartesian2,
  FrameRateMonitor,
} from "cesium";
import { ShaderManager } from "../core/shaderManager";
import CustomPrimitive from "../core/customPrimitive";
import { deepMerge } from "../core/utils";
import { resolveVerticalSelection } from "../core/verticalSelection.js";
import { createParticlePositionData } from "../data/weightedParticleSampler.js";

export class WindParticlesComputing {
  constructor(context, windData, options, viewerParameters, scene) {
    this.context = context;
    this.options = options;
    this.viewerParameters = viewerParameters;
    this.windData = windData;

    // frameRate / frameRateAdjustment 必须在首帧前有有效值，
    // 否则 calculateSpeed 里 speed * undefined 会得到 NaN 位置，粒子全部不可见
    this.frameRate = 60;
    this.frameRateAdjustment = 1;

    this.frameRateMonitor = new FrameRateMonitor({
      scene,
      samplingWindow: 1.0,
      quietPeriod: 0.0,
    });
    this.initFrameRate();
    this.createWindTexture();
    this.createParticlesTextures();
    this.createComputingPrimitives();
  }

  initFrameRate() {
    const updateFrameRate = () => {
      if (this.frameRateMonitor.lastFramesPerSecond > 20) {
        this.frameRate = this.frameRateMonitor.lastFramesPerSecond;
        this.frameRateAdjustment = 60 / Math.max(this.frameRate, 1);
      }
    };

    updateFrameRate();

    const intervalId = setInterval(updateFrameRate, 1000);

    const originalDestroy = this.destroy.bind(this);
    this.destroy = () => {
      clearInterval(intervalId);
      originalDestroy();
    };
  }

  // 把 (u, v, w) 三张数组拼成一张 RGBA 的 3D 纹理数据 (u, v, w, 0)
  createWindTexture() {
    const { nx, ny, nz, u, v, w } = this.windData;
    const total = nx * ny * nz;
    const data = new Float32Array(total * 4);
    for (let i = 0; i < total; i++) {
      data[i * 4 + 0] = u.array[i];
      data[i * 4 + 1] = v.array[i];
      data[i * 4 + 2] = w.array[i];
      data[i * 4 + 3] = 0.0;
    }

    this.windTexture = new Texture3D({
      context: this.context,
      width: nx,
      height: ny,
      depth: nz,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: this.options.flipY ?? false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.CLAMP_TO_EDGE,
        wrapT: TextureWrap.CLAMP_TO_EDGE,
        wrapR: TextureWrap.CLAMP_TO_EDGE,
      }),
      source: {
        width: nx,
        height: ny,
        depth: nz,
        arrayBufferView: data,
      },
    });
  }

  createParticlesTextures() {
    const size = this.options.particlesTextureSize;
    const total = size * size;

    const baseOptions = {
      context: this.context,
      width: size,
      height: size,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.NEAREST,
        magnificationFilter: TextureMagnificationFilter.NEAREST,
      }),
    };

    // 初始粒子随机分布：若全为 0，所有粒子从 (lon=0,lat=0,z=0) 出发（相机视角外），
    // 只能靠 dropRate 缓慢重新播种，导致首屏长时间看不到风场。
    const randomData = this.createRandomParticlesData();
    const zeroData = new Float32Array(total * 4);

    this.particlesTextures = {
      previousParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      currentParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      nextParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: zeroData } }),
      postProcessingPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      particlesSpeed: new Texture({ ...baseOptions, source: { arrayBufferView: zeroData } }),
    };
  }

  createRandomParticlesData() {
    const size = this.options.particlesTextureSize;
    return createParticlePositionData(this.windData, size * size, this.options);
  }

  destroyParticlesTextures() {
    Object.values(this.particlesTextures).forEach((texture) => texture.destroy());
  }

  createComputingPrimitives() {
    const windData = this.windData;
    this.primitives = {
      calculateSpeed: new CustomPrimitive({
        commandType: "Compute",
        uniformMap: {
          windTexture: () => this.windTexture,
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          minimum: () => new Cartesian2(windData.bounds.west, windData.bounds.south),
          maximum: () => new Cartesian2(windData.bounds.east, windData.bounds.north),
          minHeight: () => windData.levels[0],
          maxHeight: () => windData.levels[windData.levels.length - 1],
          fixedVertical: () => resolveVerticalSelection(windData, this.options).fixed,
          speedRange: () => new Cartesian2(windData.speed.min, windData.speed.max),
          speedScaleFactor: () => (this.viewerParameters.pixelSize + 50) * this.options.speedFactor,
          frameRateAdjustment: () => this.frameRateAdjustment,
        },
        fragmentShaderSource: ShaderManager.getCalculateSpeedShader(),
        outputTexture: this.particlesTextures.particlesSpeed,
        preExecute: () => {
          const temp = this.particlesTextures.previousParticlesPosition;
          this.particlesTextures.previousParticlesPosition = this.particlesTextures.currentParticlesPosition;
          this.particlesTextures.currentParticlesPosition = this.particlesTextures.postProcessingPosition;
          this.particlesTextures.postProcessingPosition = temp;
          if (this.primitives.calculateSpeed.commandToExecute) {
            this.primitives.calculateSpeed.commandToExecute.outputTexture = this.particlesTextures.particlesSpeed;
          }
        },
        isDynamic: () => this.options.dynamic,
      }),

      updatePosition: new CustomPrimitive({
        commandType: "Compute",
        uniformMap: {
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed,
        },
        fragmentShaderSource: ShaderManager.getUpdatePositionShader(),
        outputTexture: this.particlesTextures.nextParticlesPosition,
        preExecute: () => {
          if (this.primitives.updatePosition.commandToExecute) {
            this.primitives.updatePosition.commandToExecute.outputTexture = this.particlesTextures.nextParticlesPosition;
          }
        },
        isDynamic: () => this.options.dynamic,
      }),

      postProcessingPosition: new CustomPrimitive({
        commandType: "Compute",
        uniformMap: {
          nextParticlesPosition: () => this.particlesTextures.nextParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed,
          windTexture: () => this.windTexture,
          lonRange: () => this.viewerParameters.lonRange,
          latRange: () => this.viewerParameters.latRange,
          dataLonRange: () => new Cartesian2(windData.bounds.west, windData.bounds.east),
          dataLatRange: () => new Cartesian2(windData.bounds.south, windData.bounds.north),
          speedRange: () => new Cartesian2(windData.speed.min, windData.speed.max),
          randomCoefficient: () => Math.random(),
          dropRate: () => this.options.dropRate,
          dropRateBump: () => this.options.dropRateBump,
          useViewerBounds: () => this.options.useViewerBounds,
          densityBySpeed: () => this.options.densityBySpeed,
          densityExponent: () => this.options.densityExponent,
          densityFloor: () => this.options.densityFloor,
          verticalRange: () => resolveVerticalSelection(windData, this.options).normalizedRange,
          fixedVertical: () => resolveVerticalSelection(windData, this.options).fixed,
          fixedVerticalPosition: () => resolveVerticalSelection(windData, this.options).normalizedHeight,
        },
        fragmentShaderSource: ShaderManager.getPostProcessingPositionShader(),
        outputTexture: this.particlesTextures.postProcessingPosition,
        preExecute: () => {
          if (this.primitives.postProcessingPosition.commandToExecute) {
            this.primitives.postProcessingPosition.commandToExecute.outputTexture = this.particlesTextures.postProcessingPosition;
          }
        },
        isDynamic: () => this.options.dynamic,
      }),
    };
  }

  reCreateWindTexture() {
    this.windTexture.destroy();
    this.createWindTexture();
  }

  updateWindData(data) {
    this.windData = data;
    this.reCreateWindTexture();
  }

  updateOptions(options) {
    const needUpdateWindTexture = options.flipY !== undefined && options.flipY !== this.options.flipY;
    this.options = deepMerge(options, this.options);
    if (needUpdateWindTexture) {
      this.reCreateWindTexture();
    }
  }

  destroy() {
    if (this.windTexture) this.windTexture.destroy();
    Object.values(this.particlesTextures).forEach((texture) => texture.destroy());
    Object.values(this.primitives).forEach((primitive) => primitive.destroy());
    this.frameRateMonitor.destroy();
  }
}
