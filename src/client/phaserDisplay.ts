import { Core, GameObjects, type Game, type Scene } from 'phaser';

const MAX_RENDER_SCALE = 2;
const MAX_RENDER_DIMENSION = 3072;
const MAX_RENDER_PIXELS = 5_000_000;

type CameraBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CameraState = {
  scrollX: number;
  scrollY: number;
  bounds: CameraBounds | null;
};

const cameraStates = new WeakMap<object, CameraState>();

const getCameraState = (scene: Scene): CameraState => {
  const camera = scene.cameras.main;
  const existing = cameraStates.get(camera);
  if (existing) {
    return existing;
  }

  const created = {
    scrollX: camera.scrollX,
    scrollY: camera.scrollY,
    bounds: null,
  };
  cameraStates.set(camera, created);
  return created;
};

const getRenderScale = (width: number, height: number): number => {
  const deviceScale = Math.max(1, window.devicePixelRatio || 1);
  const dimensionScale = Math.min(
    MAX_RENDER_DIMENSION / Math.max(1, width),
    MAX_RENDER_DIMENSION / Math.max(1, height)
  );
  const pixelScale = Math.sqrt(
    MAX_RENDER_PIXELS / Math.max(1, width * height)
  );

  return Math.max(
    1,
    Math.min(MAX_RENDER_SCALE, deviceScale, dimensionScale, pixelScale)
  );
};

const getCameraOffset = (size: number, renderScale: number): number =>
  -(size * (renderScale - 1)) / 2;

export const getHighDensityRenderScale = getRenderScale;

export const getHighDensityCameraOffset = getCameraOffset;

const prepareSceneCamera = (
  scene: Scene,
  renderWidth: number,
  renderHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  renderScale: number
): void => {
  const camera = scene.cameras.main;
  const state = getCameraState(scene);
  const offsetX = getCameraOffset(logicalWidth, renderScale);
  const offsetY = getCameraOffset(logicalHeight, renderScale);

  if (camera.width !== renderWidth || camera.height !== renderHeight) {
    camera.setSize(renderWidth, renderHeight);
  }
  if (camera.zoomX !== renderScale || camera.zoomY !== renderScale) {
    camera.setZoom(renderScale);
  }

  if (state.bounds && camera.useBounds) {
    // Phaser's bounds clamp uses the camera viewport size before zooming. The
    // supersampled viewport is physical pixels, so that clamp would shift the
    // logical scene off-screen. Scene adapters clamp their logical scroll state.
    camera.removeBounds();
  }

  camera.scrollX = state.scrollX + offsetX;
  camera.scrollY = state.scrollY + offsetY;

  for (const child of scene.children.list) {
    if (child instanceof GameObjects.Graphics && child.name === 'tile-wars-backdrop') {
      // Fixed camera objects do not receive the camera scroll offset. Move the
      // backdrop in the opposite direction so its logical bounds still fill
      // the physical viewport after supersampling.
      child.setPosition(-offsetX, -offsetY);
    }
    if (child instanceof GameObjects.Text) {
      if (child.style.fontFamily.toLowerCase().includes('arial black')) {
        child.setFontStyle('bold');
      }
      if (child.style.resolution !== renderScale) {
        child.setResolution(renderScale);
      }
    }
  }
};

export const installHighDensityRendering = (game: Game): void => {
  let renderWidth = 0;
  let renderHeight = 0;

  game.events.on(Core.Events.PRE_RENDER, () => {
    const logicalWidth = game.scale.width;
    const logicalHeight = game.scale.height;
    const renderScale = getRenderScale(logicalWidth, logicalHeight);
    const nextRenderWidth = Math.round(logicalWidth * renderScale);
    const nextRenderHeight = Math.round(logicalHeight * renderScale);

    if (
      renderWidth !== nextRenderWidth ||
      renderHeight !== nextRenderHeight ||
      game.canvas.width !== nextRenderWidth ||
      game.canvas.height !== nextRenderHeight
    ) {
      renderWidth = nextRenderWidth;
      renderHeight = nextRenderHeight;
      game.scale.baseSize.setSize(renderWidth, renderHeight);
      game.canvas.width = renderWidth;
      game.canvas.height = renderHeight;
      game.renderer.resize(renderWidth, renderHeight);
      game.scale.updateBounds();

      const bounds = game.canvas.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        game.scale.displayScale.set(
          renderWidth / bounds.width,
          renderHeight / bounds.height
        );
      }
    }

    for (const scene of game.scene.getScenes(true)) {
      prepareSceneCamera(
        scene,
        renderWidth,
        renderHeight,
        logicalWidth,
        logicalHeight,
        renderScale
      );
    }
  });
};

export const getLogicalCameraScrollY = (scene: Scene): number =>
  getCameraState(scene).scrollY;

export const getLogicalPointerY = (scene: Scene, pointerY: number): number =>
  pointerY / getRenderScale(scene.scale.width, scene.scale.height);

export const setLogicalCameraScrollY = (scene: Scene, value: number): void => {
  getCameraState(scene).scrollY = value;
};

export const setLogicalCameraBounds = (
  scene: Scene,
  x: number,
  y: number,
  width: number,
  height: number
): void => {
  getCameraState(scene).bounds = { x, y, width, height };
};
