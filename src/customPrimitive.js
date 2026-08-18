import {
  Geometry,
  ShaderProgram,
  VertexArray,
  DrawCommand,
  RenderState,
  Pass,
  PrimitiveType,
  ShaderSource,
  ClearCommand,
  Color,
  defined,
  ComputeCommand,
  Matrix4,
  BufferUsage,
  destroyObject,
} from "cesium";

export default class CustomPrimitive {
  constructor(options) {
    this.commandType = options.commandType;
    this.geometry = options.geometry;
    this.attributeLocations = options.attributeLocations;
    this.primitiveType = options.primitiveType;
    this.uniformMap = options.uniformMap || {};
    this.vertexShaderSource = options.vertexShaderSource;
    this.fragmentShaderSource = options.fragmentShaderSource;
    this.rawRenderState = options.rawRenderState;
    this.framebuffer = options.framebuffer;
    this.outputTexture = options.outputTexture;
    this.autoClear = options.autoClear ?? false;
    this.preExecute = options.preExecute;

    this.show = true;
    this.commandToExecute = undefined;
    this.clearCommand = undefined;
    this.isDynamic = options.isDynamic ?? (() => true);

    if (this.autoClear) {
      this.clearCommand = new ClearCommand({
        color: new Color(0.0, 0.0, 0.0, 0.0),
        depth: 1.0,
        framebuffer: this.framebuffer,
        pass: Pass.OPAQUE,
      });
    }
  }

  createCommand(context) {
    if (this.commandType === "Draw") {
      const vertexArray = VertexArray.fromGeometry({
        context,
        geometry: this.geometry,
        attributeLocations: this.attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW,
      });

      const shaderProgram = ShaderProgram.fromCache({
        context,
        vertexShaderSource: this.vertexShaderSource,
        fragmentShaderSource: this.fragmentShaderSource,
        attributeLocations: this.attributeLocations,
      });

      const renderState = RenderState.fromCache(this.rawRenderState);
      return new DrawCommand({
        owner: this,
        vertexArray,
        primitiveType: this.primitiveType,
        modelMatrix: Matrix4.IDENTITY,
        renderState,
        shaderProgram,
        framebuffer: this.framebuffer,
        uniformMap: this.uniformMap,
        pass: Pass.OPAQUE,
      });
    } else if (this.commandType === "Compute") {
      return new ComputeCommand({
        owner: this,
        fragmentShaderSource: this.fragmentShaderSource,
        uniformMap: this.uniformMap,
        outputTexture: this.outputTexture,
        persists: true,
      });
    }
    throw new Error("Unknown command type");
  }

  setGeometry(context, geometry) {
    this.geometry = geometry;
    if (defined(this.commandToExecute)) {
      this.commandToExecute.vertexArray = VertexArray.fromGeometry({
        context,
        geometry: this.geometry,
        attributeLocations: this.attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW,
      });
    }
  }

  update(frameState) {
    if (!this.isDynamic()) return;
    if (!this.show || !defined(frameState)) return;

    if (!defined(this.commandToExecute)) {
      this.commandToExecute = this.createCommand(frameState.context);
    }

    if (defined(this.preExecute)) {
      this.preExecute();
    }

    if (!frameState.commandList) {
      console.warn("frameState.commandList is undefined");
      return;
    }

    if (defined(this.clearCommand)) {
      frameState.commandList.push(this.clearCommand);
    }

    if (defined(this.commandToExecute)) {
      frameState.commandList.push(this.commandToExecute);
    }
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    if (defined(this.commandToExecute)) {
      this.commandToExecute.shaderProgram?.destroy();
      this.commandToExecute.shaderProgram = undefined;
    }
    return destroyObject(this);
  }
}
