import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Position } from "@/types/config";
import { logger } from "@/lib/logger";

interface DragState {
  isDragging: boolean;
  outputId: string | null;
  startPosition: Position | null;
  startPointer: { x: number; y: number } | null;
}

interface OutputsCanvasState {
  zoom: number;
  pan: Position;
  selectedOutputId: string | null;
  dragState: DragState;
  showGrid: boolean;
  gridSize: number;

  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPan: (pan: Position) => void;
  panBy: (delta: Position) => void;
  resetPan: () => void;
  setSelectedOutputId: (id: string | null) => void;
  startDrag: (outputId: string, position: Position, pointer: { x: number; y: number }) => void;
  endDrag: () => void;
  toggleGrid: () => void;
  setGridSize: (size: number) => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export const useOutputsCanvasStore = create<OutputsCanvasState>()(
  immer((set) => ({
    zoom: 1,
    pan: { x: 0, y: 0 },
    selectedOutputId: null,
    dragState: {
      isDragging: false,
      outputId: null,
      startPosition: null,
      startPointer: null,
    },
    showGrid: true,
    gridSize: 20,

    setZoom: (zoom) =>
      set((state) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        logger.trace("outputsCanvas", "zoom changed", { zoom: newZoom });
        state.zoom = newZoom;
      }),

    zoomIn: () =>
      set((state) => {
        const newZoom = Math.min(MAX_ZOOM, state.zoom + ZOOM_STEP);
        logger.trace("outputsCanvas", "zoom in", { zoom: newZoom });
        state.zoom = newZoom;
      }),

    zoomOut: () =>
      set((state) => {
        const newZoom = Math.max(MIN_ZOOM, state.zoom - ZOOM_STEP);
        logger.trace("outputsCanvas", "zoom out", { zoom: newZoom });
        state.zoom = newZoom;
      }),

    resetZoom: () =>
      set((state) => {
        logger.debug("outputsCanvas", "reset zoom");
        state.zoom = 1;
      }),

    setPan: (pan) =>
      set((state) => {
        logger.trace("outputsCanvas", "pan changed", { pan });
        state.pan = pan;
      }),

    panBy: (delta) =>
      set((state) => {
        state.pan.x += delta.x;
        state.pan.y += delta.y;
        logger.trace("outputsCanvas", "pan by", { delta, pan: state.pan });
      }),

    resetPan: () =>
      set((state) => {
        logger.debug("outputsCanvas", "reset pan");
        state.pan = { x: 0, y: 0 };
      }),

    setSelectedOutputId: (id) =>
      set((state) => {
        logger.debug("outputsCanvas", "selected output changed", { outputId: id });
        state.selectedOutputId = id;
      }),

    startDrag: (outputId, position, pointer) =>
      set((state) => {
        logger.debug("outputsCanvas", "drag started", { outputId, position, pointer });
        state.dragState = {
          isDragging: true,
          outputId,
          startPosition: { x: position.x, y: position.y },
          startPointer: { x: pointer.x, y: pointer.y },
        };
      }),

    endDrag: () =>
      set((state) => {
        logger.debug("outputsCanvas", "drag ended", { outputId: state.dragState.outputId });
        state.dragState = {
          isDragging: false,
          outputId: null,
          startPosition: null,
          startPointer: null,
        };
      }),

    toggleGrid: () =>
      set((state) => {
        logger.debug("outputsCanvas", "grid toggled", { showGrid: !state.showGrid });
        state.showGrid = !state.showGrid;
      }),

    setGridSize: (size) =>
      set((state) => {
        const newSize = Math.max(10, Math.min(100, size));
        logger.debug("outputsCanvas", "grid size changed", { gridSize: newSize });
        state.gridSize = newSize;
      }),
  }))
);