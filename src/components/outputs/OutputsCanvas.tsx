"use client";

import { useCallback, useEffect, useRef, useState, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, RotateCcw, Grid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useConfigStore } from "@/stores/configStore";
import { useOutputsCanvasStore } from "@/stores/outputsCanvasStore";

interface OutputRect {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  transform: string;
  off: boolean;
  selected: boolean;
  dragging: boolean;
}

function parseMode(mode: string | undefined): { width: number; height: number } | null {
  if (!mode) return null;
  const match = mode.match(/^(\d+)x(\d+)(?:@[\d.]+)?$/);
  if (!match) return null;
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

function getTransformedDimensions(width: number, height: number, transform: string): { width: number; height: number } {
  if (transform === "90" || transform === "270") {
    return { width: height, height: width };
  }
  return { width, height };
}

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function snapToEdges(
  value: number,
  size: number,
  otherRects: OutputRect[],
  gridSize: number,
  axis: "x" | "y"
): number {
  const edges: number[] = [0];
  for (const rect of otherRects) {
    const rectStart = axis === "x" ? rect.x : rect.y;
    const rectEnd = axis === "x" ? rect.x + rect.width : rect.y + rect.height;
    edges.push(rectStart, rectEnd);
  }
  
  for (const edge of edges) {
    if (Math.abs(value - edge) <= gridSize / 2) return edge;
    if (Math.abs(value + size - edge) <= gridSize / 2) return edge - size;
  }
  return value;
}

export function OutputsCanvas() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const update = useConfigStore((s) => s.update);
  
  const zoom = useOutputsCanvasStore((s) => s.zoom);
  const pan = useOutputsCanvasStore((s) => s.pan);
  const selectedOutputId = useOutputsCanvasStore((s) => s.selectedOutputId);
  const dragState = useOutputsCanvasStore((s) => s.dragState);
  const showGrid = useOutputsCanvasStore((s) => s.showGrid);
  const gridSize = useOutputsCanvasStore((s) => s.gridSize);
  
  const setZoom = useOutputsCanvasStore((s) => s.setZoom);
  const zoomIn = useOutputsCanvasStore((s) => s.zoomIn);
  const zoomOut = useOutputsCanvasStore((s) => s.zoomOut);
  const resetZoom = useOutputsCanvasStore((s) => s.resetZoom);
  const setPan = useOutputsCanvasStore((s) => s.setPan);
  const panBy = useOutputsCanvasStore((s) => s.panBy);
  const resetPan = useOutputsCanvasStore((s) => s.resetPan);
  const setSelectedOutputId = useOutputsCanvasStore((s) => s.setSelectedOutputId);
  const startDrag = useOutputsCanvasStore((s) => s.startDrag);
  const endDrag = useOutputsCanvasStore((s) => s.endDrag);
  const toggleGrid = useOutputsCanvasStore((s) => s.toggleGrid);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rects, setRects] = useState<OutputRect[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  const debouncedUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute rects from config
  useEffect(() => {
    if (!config) {
      setRects([]);
      return;
    }

    const computedRects: OutputRect[] = config.outputs.map((output) => {
      const mode = parseMode(output.mode ?? undefined);
      const baseWidth = mode?.width ?? 1920;
      const baseHeight = mode?.height ?? 1080;
      const scale = output.scale ?? 1;
      const { width, height } = getTransformedDimensions(baseWidth, baseHeight, output.transform ?? "normal");
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const position = output.position ?? { x: 0, y: 0 };

      return {
        id: output.name,
        name: output.name,
        x: position.x,
        y: position.y,
        width: scaledWidth,
        height: scaledHeight,
        scale,
        transform: output.transform ?? "normal",
        off: output.off ?? false,
        selected: output.name === selectedOutputId,
        dragging: dragState.isDragging && dragState.outputId === output.name,
      };
    });

    setRects(computedRects);
  }, [config, selectedOutputId, dragState.isDragging, dragState.outputId]);

  // Handle pointer events on canvas
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    // Check if clicking on an output
    const clickedRect = rects.find(
      (r) =>
        pointerX >= (pan.x + r.x) * zoom &&
        pointerX <= (pan.x + r.x + r.width) * zoom &&
        pointerY >= (pan.y + r.y) * zoom &&
        pointerY <= (pan.y + r.y + r.height) * zoom
    );

    if (clickedRect) {
      setSelectedOutputId(clickedRect.id);
      startDrag(clickedRect.id, { x: clickedRect.x, y: clickedRect.y }, { x: pointerX, y: pointerY });
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      // Start panning
      setIsPanning(true);
      setPanStart({ x: pointerX, y: pointerY });
      canvas.setPointerCapture(e.pointerId);
    }
  }, [pan, zoom, rects, setSelectedOutputId, startDrag]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    if (dragState.isDragging && dragState.outputId && dragState.startPosition) {
      const newX = dragState.startPosition.x + (pointerX - (dragState.startPointer?.x ?? pointerX)) / zoom;
      const newY = dragState.startPosition.y + (pointerY - (dragState.startPointer?.y ?? pointerY)) / zoom;

      const snappedX = snapToGrid(newX, gridSize);
      const snappedY = snapToGrid(newY, gridSize);

      const otherRects = rects.filter((r) => r.id !== dragState.outputId);
      const finalX = snapToEdges(snappedX, rects.find(r => r.id === dragState.outputId)?.width ?? 0, otherRects, gridSize, "x");
      const finalY = snapToEdges(snappedY, rects.find(r => r.id === dragState.outputId)?.height ?? 0, otherRects, gridSize, "y");

      // Update the config with debounce
      if (debouncedUpdateRef.current) clearTimeout(debouncedUpdateRef.current);
      debouncedUpdateRef.current = setTimeout(() => {
        update((draft) => {
          const output = draft.outputs.find((o) => o.name === dragState.outputId);
          if (output) {
            output.position = { x: finalX, y: finalY };
          }
        });
      }, 16); // ~60fps
    } else if (isPanning && panStart) {
      const dx = (pointerX - panStart.x) / zoom;
      const dy = (pointerY - panStart.y) / zoom;
      setPan({ x: pan.x + dx, y: pan.y + dy });
      setPanStart({ x: pointerX, y: pointerY });
    }
  }, [dragState, zoom, gridSize, rects, isPanning, panStart, pan, setPan, update]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragState.isDragging) {
      endDrag();
    }
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
    canvas.releasePointerCapture(e.pointerId);
  }, [dragState.isDragging, isPanning, endDrag]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.25, Math.min(4, zoom * zoomFactor));

      // Zoom towards pointer
      const newPanX = pointerX - (pointerX - pan.x) * (newZoom / zoom);
      const newPanY = pointerY - (pointerY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    } else {
      // Pan with wheel
      panBy({ x: -e.deltaX / zoom, y: -e.deltaY / zoom });
    }
  }, [zoom, pan, setZoom, setPan, panBy]);

  const handleDoubleClick = useCallback(() => {
    resetZoom();
    resetPan();
  }, [resetZoom, resetPan]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setSelectedOutputId(null);
    }
  }, [setSelectedOutputId]);

  const handleNativeKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelectedOutputId(null);
    }
  }, [setSelectedOutputId]);

  useEffect(() => {
    window.addEventListener("keydown", handleNativeKeyDown as unknown as EventListener);
    return () => window.removeEventListener("keydown", handleNativeKeyDown as unknown as EventListener);
  }, [handleNativeKeyDown]);

  const canvasWidth = rects.reduce((max, r) => Math.max(max, r.x + r.width), 800);
  const canvasHeight = rects.reduce((max, r) => Math.max(max, r.y + r.height), 600);

  return (
    <TooltipProvider>
      <div
        className="relative flex-1 overflow-hidden bg-background border-border"
        style={{ touchAction: "none" }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          width={Math.max(canvasWidth, 800) * zoom + Math.abs(pan.x) * 2}
          height={Math.max(canvasHeight, 600) * zoom + Math.abs(pan.y) * 2}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            cursor: isPanning ? "grabbing" : dragState.isDragging ? "grabbing" : "grab",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />
        
        {/* Grid overlay */}
        {showGrid && (
          <canvas
            className="absolute top-0 left-0 pointer-events-none"
            width={Math.max(canvasWidth, 800)}
            height={Math.max(canvasHeight, 600)}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          />
        )}

        {/* Toolbar */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={zoomIn} aria-label={t("outputs.zoom_in")}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("outputs.zoom_in")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={zoomOut} aria-label={t("outputs.zoom_out")}>
                  <Minus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("outputs.zoom_out")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={resetZoom} aria-label={t("outputs.reset_zoom")}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("outputs.reset_view")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={toggleGrid} aria-label={t("outputs.toggle_grid")}>
                  <Grid className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("outputs.toggle_grid")}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pointer-events-auto">
            <span>{Math.round(zoom * 100)}%</span>
            <Separator orientation="vertical" className="h-4" />
            <span>{Math.round(pan.x)}, {Math.round(pan.y)}</span>
          </div>
        </div>

        {/* Output rectangles are rendered on the canvas */}
      </div>
    </TooltipProvider>
  );
}