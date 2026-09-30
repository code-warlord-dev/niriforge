import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Position } from "@/types/config";

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
        state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      }),

    zoomIn: () =>
      set((state) => {
        state.zoom = Math.min(MAX_ZOOM, state.zoom + ZOOM_STEP);
      }),

    zoomOut: () =>
      set((state) => {
        state.zoom = Math.max(MIN_ZOOM, state.zoom - ZOOM_STEP);
      }),

    resetZoom: () =>
      set((state) => {
        state.zoom = 1;
      }),

    setPan: (pan) =>
      set((state) => {
        state.pan = pan;
      }),

    panBy: (delta) =>
      set((state) => {
        state.pan.x += delta.x;
        state.pan.y += delta.y;
      }),

    resetPan: () =>
      set((state) => {
        state.pan = { x: 0, y: 0 };
      }),

    setSelectedOutputId: (id) =>
      set((state) => {
        state.selectedOutputId = id;
      }),

    startDrag: (outputId, position, pointer) =>
      set((state) => {
        state.dragState = {
          isDragging: true,
          outputId,
          startPosition: { x: position.x, y: position.y },
          startPointer: { x: pointer.x, y: pointer.y },
        };
      }),

    endDrag: () =>
      set((state) => {
        state.dragState = {
          isDragging: false,
          outputId: null,
          startPosition: null,
          startPointer: null,
        };
      }),

    toggleGrid: () =>
      set((state) => {
        state.showGrid = !state.showGrid;
      }),

    setGridSize: (size) =>
      set((state) => {
        state.gridSize = Math.max(10, Math.min(100, size));
      }),
  }))
);